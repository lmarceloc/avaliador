// Análise de fotos de um imóvel por modelo de visão (OpenRouter). Gera apenas uma SUGESTÃO:
// nada daqui grava em avaliacoes_imovel. Sem dependências do Next, para poder ser testado com `node --test`.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CLASSES_EC,
  CODIGOS_PADRAO,
  ESTADOS_CONSERVACAO,
  PADROES_ACABAMENTO,
  depreciacaoDe,
  padraoDe,
  sisdiaDe,
} from "../config/avaliacao.ts";

export const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const LIMITE_BYTES = 20 * 1024 * 1024;
export const TIMEOUT_DOWNLOAD_MS = 15_000;
const TIMEOUT_MODELO_MS = 90_000;
const MAX_REDIRECTS = 3;

export type StatusFoto = "lida" | "ignorada" | "erro";

export interface LinhaLogFoto {
  id: string;
  analise_id: string;
  imovel_id: string;
  foto_url: string;
  foto_sha256: string | null;
  bytes: number | null;
  content_type: string | null;
  modelo: string;
  provedor: string;
  status: StatusFoto;
  motivo_erro: string | null;
  /** O provedor informa o uso por chamada, não por foto: o total da análise fica na primeira foto lida. */
  tokens_entrada: number | null;
  tokens_saida: number | null;
  /** Tempo de download da foto. */
  latencia_ms: number | null;
  criado_em: string;
}

export interface LinhaAnalise {
  id: string;
  imovel_id: string;
  status: "sugerido" | "erro";
  ec_classe: string | null;
  padrao_codigo: string | null;
  padrao_sisdia: number | null;
  justificativa: string | null;
  confianca: string | null;
  modelo: string;
  criado_em: string;
  aprovado_por: string | null;
  aprovado_em: string | null;
  /** Só preenchido com LOG_RESPOSTA_BRUTA=true. */
  resposta_bruta: string | null;
}

export interface ResultadoAnalise {
  analise_id: string;
  imovel_id: string;
  status: "sugerido" | "erro";
  ec_classe: string | null;
  depreciacao_percentual: number | null;
  padrao_codigo: string | null;
  padrao_nome: string | null;
  padrao_sisdia: number | null;
  /** true quando o padrão sugerido ainda não tem valor Sisdia confirmado. */
  sisdia_a_confirmar: boolean;
  justificativa: string | null;
  confianca: "baixa" | "media" | "alta" | null;
  fotos_lidas: number;
  fotos_total: number;
  pendencias: string[];
  /** Resumo do log por foto, para exibição. */
  log: { foto_url: string; status: StatusFoto; motivo_erro: string | null }[];
}

export interface Armazenamento {
  gravarAnalise(a: LinhaAnalise): Promise<void>;
  gravarLogs(linhas: LinhaLogFoto[]): Promise<void>;
}

export interface ConfigAnalise {
  fotosMax: number;
  modelo: string | null;
  apiKey: string | null;
  logRespostaBruta: boolean;
  endpoint: string;
}

export interface DepsAnalise {
  fetch: typeof fetch;
  armazenamento: Armazenamento;
  config: ConfigAnalise;
  /** Rejeita URLs que não devem ser buscadas pelo servidor (rede interna etc.). */
  urlPermitida?: (url: string) => Promise<boolean>;
  onProgresso?: (processadas: number, total: number) => void;
}

export function lerConfig(env: Record<string, string | undefined> = process.env): ConfigAnalise {
  const max = Number.parseInt(env.FOTOS_MAX ?? "", 10);
  return {
    fotosMax: Number.isFinite(max) && max > 0 ? max : 6,
    modelo: env.OPENROUTER_MODEL?.trim() || null,
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    logRespostaBruta: env.LOG_RESPOSTA_BRUTA === "true",
    endpoint: env.OPENROUTER_ENDPOINT?.trim() || "https://openrouter.ai/api/v1/chat/completions",
  };
}

// ---------- Seleção das fotos ----------

/** Sem rótulo de cômodo nas URLs, usa a ordem do anúncio: a 1ª (capa) costuma ser a fachada e o restante é
 * amostrado de forma espaçada para cobrir as áreas internas. */
export function selecionarFotos(urls: string[], max: number): string[] {
  const unicas = [...new Set(urls.filter((u) => typeof u === "string" && u.trim()))];
  if (unicas.length <= max) return unicas;
  if (max === 1) return [unicas[0]];
  const idx = new Set<number>();
  for (let k = 0; k < max; k++) idx.add(Math.round((k * (unicas.length - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => unicas[i]);
}

// ---------- Download ----------

interface FotoBaixada {
  buffer: Buffer;
  contentType: string;
}

class FotoInvalida extends Error {
  status: "ignorada" | "erro";
  constructor(status: "ignorada" | "erro", motivo: string) {
    super(motivo);
    this.status = status;
  }
}

async function lerCorpoLimitado(resp: Response): Promise<Buffer> {
  if (!resp.body) return Buffer.from(await resp.arrayBuffer());
  const partes: Uint8Array[] = [];
  let total = 0;
  const reader = resp.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_BYTES) {
      await reader.cancel();
      throw new FotoInvalida("ignorada", "arquivo maior que 20 MB");
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

async function baixarFoto(url: string, deps: DepsAnalise): Promise<FotoBaixada> {
  let atual = url;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    let u: URL;
    try {
      u = new URL(atual);
    } catch {
      throw new FotoInvalida("ignorada", "URL inválida");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new FotoInvalida("ignorada", "protocolo não permitido");
    if (deps.urlPermitida && !(await deps.urlPermitida(atual))) throw new FotoInvalida("ignorada", "endereço não permitido");

    let resp: Response;
    try {
      resp = await deps.fetch(atual, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; BuscaImoveis/1.0)", Accept: "image/*" }, signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS) });
    } catch (e) {
      const nome = (e as Error).name;
      throw new FotoInvalida("erro", nome === "TimeoutError" || nome === "AbortError" ? "timeout de 15 s no download" : "falha de rede no download");
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      atual = new URL(resp.headers.get("location")!, atual).toString();
      continue;
    }
    if (!resp.ok) throw new FotoInvalida("erro", `HTTP ${resp.status} no download`);

    const contentType = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_ACEITOS.includes(contentType)) throw new FotoInvalida("ignorada", `content-type não aceito (${contentType || "ausente"})`);
    const declarado = Number(resp.headers.get("content-length"));
    if (declarado > LIMITE_BYTES) throw new FotoInvalida("ignorada", "arquivo maior que 20 MB");
    try {
      return { buffer: await lerCorpoLimitado(resp), contentType };
    } catch (e) {
      if (e instanceof FotoInvalida) throw e;
      throw new FotoInvalida("erro", "timeout ou falha na leitura da foto");
    }
  }
  throw new FotoInvalida("erro", "redirecionamentos demais");
}

// ---------- Prompt e resposta do modelo ----------

export function montarPromptSistema(): string {
  const ec = ESTADOS_CONSERVACAO.map((e) => `${e.classe} – ${e.nome}`).join("\n");
  const vp = PADROES_ACABAMENTO.map((p) => `${p.codigo} ${p.nome}`).join("\n");
  return `Você é um engenheiro avaliador de imóveis residenciais brasileiros. Com base SOMENTE nas fotos enviadas, classifique o imóvel.

ESTADO DE CONSERVAÇÃO (IBAPE-SP, Quadro 1) – classes A a I:
${ec}
Critério: A = sem sinais de desgaste, como recém-construída ou reformada por completo; B/C = apenas pintura e desgaste leve de uso; D/E = necessita de reparos simples (pintura geral, pequenos reparos em revestimentos, esquadrias e instalações); F/G = reparos importantes (infiltrações, trincas, telhado, instalações e revestimentos comprometidos); H = reparos muito importantes, próximo de edificação sem valor; I = ruína.

PADRÃO DE ACABAMENTO (VEIU):
${vp}
Critério: 2.1/2.2 = materiais rudimentares ou mínimos, sem revestimentos, pisos de cimento queimado, esquadrias simples; 2.3/2.4 = acabamentos econômicos a simples, cerâmica comum, pintura látex, louças e metais básicos; 2.5 = padrão médio, porcelanato ou cerâmica de boa qualidade, forro de gesso, box e bancadas em granito, caixilhos de alumínio; 2.6/2.7 = superior a fino, porcelanato grande formato, mármore ou granito nobre, marcenaria planejada, automação, esquadrias de qualidade; 2.8 = luxo, materiais importados ou exclusivos, projeto arquitetônico de alto padrão.

Responda APENAS com um objeto JSON, sem nenhum texto fora dele, exatamente neste formato:
{"ec_classe": "A-I", "padrao_codigo": "2.1-2.8", "justificativa": "uma frase", "fotos_consideradas": [índices das fotos usadas, começando em 0], "confianca": "baixa|media|alta"}
Se não for possível julgar com as fotos enviadas, responda ec_classe e padrao_codigo como null e explique na justificativa.`;
}

const RespostaModelo = z.object({
  ec_classe: z.enum(CLASSES_EC).nullable(),
  padrao_codigo: z.enum(CODIGOS_PADRAO).nullable(),
  justificativa: z.string().trim().min(1).max(800),
  fotos_consideradas: z.array(z.number().int().min(0)),
  confianca: z.enum(["baixa", "media", "alta"]),
});
export type RespostaModelo = z.infer<typeof RespostaModelo>;

/** Aceita JSON puro ou dentro de cerca de código; valida com zod. Lança Error se inválido. */
export function interpretarResposta(texto: string): RespostaModelo {
  let t = texto.trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();
  if (!t.startsWith("{")) {
    const ini = t.indexOf("{");
    const fim = t.lastIndexOf("}");
    if (ini >= 0 && fim > ini) t = t.slice(ini, fim + 1);
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(t);
  } catch {
    throw new Error("resposta não é JSON");
  }
  const r = RespostaModelo.safeParse(bruto);
  if (!r.success) throw new Error(`JSON fora do formato: ${r.error.issues[0]?.path.join(".") || "raiz"}`);
  return r.data;
}

interface UsoTokens {
  entrada: number;
  saida: number;
}

async function chamarModelo(
  fotos: FotoBaixada[],
  imovelId: string,
  deps: DepsAnalise,
): Promise<{ texto: string; uso: UsoTokens }> {
  const { config } = deps;
  const conteudo: unknown[] = [{ type: "text", text: `Imóvel ${imovelId}. Seguem ${fotos.length} fotos, numeradas de 0 a ${fotos.length - 1}.` }];
  fotos.forEach((f, i) => {
    conteudo.push({ type: "text", text: `Foto ${i}:` });
    conteudo.push({ type: "image_url", image_url: { url: `data:${f.contentType};base64,${f.buffer.toString("base64")}` } });
  });
  const resp = await deps.fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, "X-Title": "Busca de imoveis" },
    body: JSON.stringify({
      model: config.modelo,
      temperature: 0,
      messages: [
        { role: "system", content: montarPromptSistema() },
        { role: "user", content: conteudo },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MODELO_MS),
  });
  if (!resp.ok) throw new Error(`OpenRouter respondeu HTTP ${resp.status}`);
  const corpo = (await resp.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (corpo.error) throw new Error(`OpenRouter: ${corpo.error.message ?? "erro"}`);
  const c = corpo.choices?.[0]?.message?.content;
  const texto = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "";
  if (!texto) throw new Error("resposta vazia do modelo");
  return { texto, uso: { entrada: corpo.usage?.prompt_tokens ?? 0, saida: corpo.usage?.completion_tokens ?? 0 } };
}

// ---------- Orquestração ----------

async function emParalelo<T, R>(itens: T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(itens.length);
  let prox = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (prox < itens.length) {
        const i = prox++;
        out[i] = await fn(itens[i], i);
      }
    }),
  );
  return out;
}

export async function analisarFotos(entrada: { imovel_id: string; fotos: string[] }, deps: DepsAnalise): Promise<ResultadoAnalise> {
  const { config } = deps;
  const analiseId = randomUUID();
  const agora = () => new Date().toISOString();
  const modelo = config.modelo ?? "(não configurado)";
  const selecionadas = selecionarFotos(entrada.fotos, config.fotosMax);
  const pendencias: string[] = [];
  const linhas: LinhaLogFoto[] = [];
  const baixadas: { linha: LinhaLogFoto; foto: FotoBaixada }[] = [];

  const base = (url: string): LinhaLogFoto => ({
    id: randomUUID(), analise_id: analiseId, imovel_id: entrada.imovel_id, foto_url: url, foto_sha256: null, bytes: null,
    content_type: null, modelo, provedor: "openrouter", status: "ignorada", motivo_erro: null,
    tokens_entrada: null, tokens_saida: null, latencia_ms: null, criado_em: agora(),
  });

  let processadas = 0;
  await emParalelo(selecionadas, 3, async (url) => {
    const linha = base(url);
    const t0 = Date.now();
    try {
      const foto = await baixarFoto(url, deps);
      linha.latencia_ms = Date.now() - t0;
      linha.bytes = foto.buffer.byteLength;
      linha.content_type = foto.contentType;
      linha.foto_sha256 = createHash("sha256").update(foto.buffer).digest("hex");
      linha.status = "lida";
      baixadas.push({ linha, foto });
    } catch (e) {
      linha.latencia_ms = Date.now() - t0;
      linha.status = e instanceof FotoInvalida ? e.status : "erro";
      linha.motivo_erro = e instanceof FotoInvalida ? e.message : "falha inesperada no download";
    }
    linhas.push(linha);
    deps.onProgresso?.(++processadas, selecionadas.length);
  });
  // Mantém a ordem original das fotos no log.
  linhas.sort((a, b) => selecionadas.indexOf(a.foto_url) - selecionadas.indexOf(b.foto_url));
  baixadas.sort((a, b) => selecionadas.indexOf(a.linha.foto_url) - selecionadas.indexOf(b.linha.foto_url));

  let sugestao: RespostaModelo | null = null;
  let bruto: string | null = null;
  const uso: UsoTokens = { entrada: 0, saida: 0 };

  if (!config.modelo || !config.apiKey) {
    pendencias.push("OPENROUTER_MODEL ou OPENROUTER_API_KEY não configurados no servidor");
  } else if (baixadas.length === 0) {
    pendencias.push("Nenhuma foto válida para analisar");
  } else {
    let ultimoErro = "";
    for (let tentativa = 0; tentativa < 2 && !sugestao; tentativa++) {
      try {
        const r = await chamarModelo(baixadas.map((b) => b.foto), entrada.imovel_id, deps);
        uso.entrada += r.uso.entrada;
        uso.saida += r.uso.saida;
        bruto = r.texto;
        sugestao = interpretarResposta(r.texto);
      } catch (e) {
        ultimoErro = (e as Error).message;
      }
    }
    if (!sugestao) pendencias.push(`Modelo não devolveu uma resposta válida após 2 tentativas (${ultimoErro})`);
  }

  const primeiraLida = baixadas[0]?.linha;
  if (primeiraLida && (uso.entrada || uso.saida)) {
    primeiraLida.tokens_entrada = uso.entrada;
    primeiraLida.tokens_saida = uso.saida;
  }

  const ec = sugestao?.ec_classe ?? null;
  const padrao = padraoDe(sugestao?.padrao_codigo ?? null);
  const sis = sisdiaDe(padrao?.codigo ?? null);
  if (sugestao && (!ec || !padrao)) pendencias.push("O modelo não conseguiu julgar com as fotos enviadas");
  if (padrao && sis.a_confirmar) pendencias.push(`Padrão ${padrao.codigo} ${padrao.nome}: valor Sisdia a confirmar`);
  for (const l of linhas) if (l.status !== "lida") pendencias.push(`Foto ignorada (${l.motivo_erro}): ${l.foto_url}`);

  const status: "sugerido" | "erro" = sugestao ? "sugerido" : "erro";
  const registro: LinhaAnalise = {
    id: analiseId, imovel_id: entrada.imovel_id, status, ec_classe: ec, padrao_codigo: padrao?.codigo ?? null,
    padrao_sisdia: sis.sisdia, justificativa: sugestao?.justificativa ?? null, confianca: sugestao?.confianca ?? null,
    modelo, criado_em: agora(), aprovado_por: null, aprovado_em: null,
    resposta_bruta: config.logRespostaBruta ? bruto : null,
  };

  let falhaLog = false;
  try {
    await deps.armazenamento.gravarAnalise(registro);
    await deps.armazenamento.gravarLogs(linhas);
  } catch {
    falhaLog = true;
    pendencias.push("Falha ao gravar o log da análise");
  }

  return {
    analise_id: analiseId,
    imovel_id: entrada.imovel_id,
    status: falhaLog ? "erro" : status,
    ec_classe: ec,
    depreciacao_percentual: depreciacaoDe(ec),
    padrao_codigo: padrao?.codigo ?? null,
    padrao_nome: padrao?.nome ?? null,
    padrao_sisdia: sis.sisdia,
    sisdia_a_confirmar: sis.a_confirmar,
    justificativa: sugestao?.justificativa ?? null,
    confianca: sugestao?.confianca ?? null,
    fotos_lidas: linhas.filter((l) => l.status === "lida").length,
    fotos_total: entrada.fotos.length,
    pendencias,
    log: linhas.map((l) => ({ foto_url: l.foto_url, status: l.status, motivo_erro: l.motivo_erro })),
  };
}
