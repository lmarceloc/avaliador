// Triagem em texto com o Jev (TypeSafe), depois da análise de fotos. O Jev NÃO vê imagens: recebe só o
// resultado da análise como estado e responde perguntas tipadas. Nada aqui grava em avaliacoes_imovel;
// o resultado é uma recomendação (revisão obrigatória ou não) e uma segunda opinião de padrão.
//
// Confirmado na documentação (docs.typesafe.ai: api.md, sdk/javascript.md, models.md) e nos tipos do
// SDK instalado (@typesafe-ai/sdk 0.7.0, Node >= 22):
//  - pacote `@typesafe-ai/sdk`; `new TypeSafeClient({ apiKey, baseURL, defaultModel, timeout, retry, fetch })`.
//    apiKey cai em TYPESAFE_API_KEY e baseURL em TYPESAFE_BASE_URL, depois https://api.typesafe.ai.
//  - `client.systemOne({ state, questions, model }, { timeout, retry })` → `{ model, answers, usage }`.
//  - o tipo "boolean" da especificação chama-se `noul` na API/SDK (helper `noul()`): `answers.x.noul` é a
//    probabilidade de "sim", de 0 a 1. `choice()` devolve `choice`, `confidence` e `probabilities`;
//    `score()` recebe 2 a 10 níveis indexados de 0 e devolve `score` (esperado, pode ser fracionário).
//  - `timeout` é POR TENTATIVA (padrão do SDK 10 s; aqui JEV_TIMEOUT_MS, padrão 20 s) e não há orçamento
//    total. `retry.maxRetries` conta tentativas extras; o SDK já repete timeout, 408, 429 e 5xx.
//  - jev-1.13.0 existe e é o alvo de `jev-latest`; usamos o id versionado, nunca o alias.
// Não confirmado na documentação: limites de taxa e valores de timeout do lado do servidor.
import { choice, noul, score, TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { randomUUID } from "node:crypto";
import { PADROES_ACABAMENTO } from "../config/avaliacao.ts";
import type { ResultadoAnalise } from "./analise-fotos.ts";

export type TipoImovelTriagem = "casa" | "apartamento" | "terreno";

export interface ConfigJev {
  apiKey: string | null;
  modelo: string;
  baseURL: string | null;
  limiteRevisao: number;
  limiteCoerencia: number;
  notaMinima: number;
  timeoutMs: number;
  logRespostaBruta: boolean;
}

export interface LinhaTriagem {
  id: string;
  analise_id: string;
  imovel_id: string;
  pergunta: string;
  tipo: "boolean" | "choice" | "score";
  probabilidade: number | null;
  valor_escolhido: string | null;
  nota: number | null;
  modelo: string;
  status: "ok" | "erro";
  motivo_erro: string | null;
  latencia_ms: number | null;
  /** Só com LOG_RESPOSTA_BRUTA=true. */
  resposta_bruta: unknown | null;
  criado_em: string;
}

export interface Triagem {
  status: "ok" | "indisponivel";
  revisao_humana: { probabilidade: number } | null;
  coerente: { probabilidade: number } | null;
  nota_coerencia: number | null;
  candidatos_padrao: { codigo: string; nome: string; probabilidade: number }[];
  modelo: string;
  /** true quando o Jev recomenda revisar OU não houve resposta. Falta de resposta nunca é aprovação. */
  revisao_obrigatoria: boolean;
  motivos: string[];
}

export interface ArmazenamentoTriagem {
  gravarTriagens(linhas: LinhaTriagem[]): Promise<void>;
}

export interface DepsTriagem {
  config: ConfigJev;
  armazenamento: ArmazenamentoTriagem;
  /** Para testes: substitui o fetch do SDK e outras opções do cliente. */
  clienteOpcoes?: Partial<TypeSafeClientConfig>;
}

const numero = (v: string | undefined, padrao: number, minimo = -Infinity, maximo = Infinity) => {
  const n = Number.parseFloat((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= minimo && n <= maximo ? n : padrao;
};

export function lerConfigJev(env: Record<string, string | undefined> = process.env): ConfigJev {
  return {
    apiKey: env.TYPESAFE_API_KEY?.trim() || null,
    modelo: env.JEV_MODEL?.trim() || "jev-1.13.0",
    baseURL: env.JEV_BASE_URL?.trim() || null,
    limiteRevisao: numero(env.JEV_LIMITE_REVISAO, 0.5, 0, 1),
    limiteCoerencia: numero(env.JEV_LIMITE_COERENCIA, 0.5, 0, 1),
    notaMinima: numero(env.JEV_NOTA_MINIMA, 3, 1, 5),
    timeoutMs: numero(env.JEV_TIMEOUT_MS, 20_000, 1),
    logRespostaBruta: env.LOG_RESPOSTA_BRUTA === "true",
  };
}

// ---------- Estado (somente texto, lista explícita de campos) ----------

export function montarEstado(r: ResultadoAnalise, tipo: TipoImovelTriagem) {
  return {
    tipo_imovel: tipo,
    ec_classe: r.ec_classe,
    depreciacao_percentual: r.depreciacao_percentual,
    padrao_codigo: r.padrao_codigo,
    padrao_nome: r.padrao_nome,
    justificativa: r.justificativa,
    confianca: r.confianca,
    fotos_lidas: r.fotos_lidas,
    fotos_total: r.fotos_total,
  };
}

// ---------- Perguntas ----------

const CONTEXTO =
  "O estado descreve a sugestão de um modelo de visão que avaliou fotos de um imóvel (o Jev não vê as fotos). " +
  "ec_classe é o estado de conservação (IBAPE, A = nova … I = sem valor) e padrao_codigo o padrão de acabamento (VEIU, 2.1 rústico … 2.8 luxo).";

const CRITERIOS_PADRAO = Object.fromEntries(PADROES_ACABAMENTO.map((p) => [p.codigo, p.nome]));

export const PERGUNTAS = {
  /** Decide a revisão: probabilidade acima de JEV_LIMITE_REVISAO → revisão obrigatória. */
  revisao_humana: {
    tipo: "boolean" as const,
    pergunta: noul(
      `${CONTEXTO} A sugestão precisa de revisão humana antes de ser usada? Considere poucas fotos lidas, confiança baixa, campos ausentes e justificativa vaga ou contraditória.`,
      { true: "Há motivo para um humano rever a classificação antes de usá-la.", false: "A sugestão é consistente e bem fundamentada." },
    ),
  },
  /** Verifica se a justificativa sustenta a classe. */
  justificativa_coerente: {
    tipo: "boolean" as const,
    pergunta: noul(
      `${CONTEXTO} A justificativa descreve sinais compatíveis com a classe ec_classe?`,
      { true: "Os sinais descritos correspondem ao estado de conservação da classe.", false: "Os sinais descritos contradizem a classe ou não a sustentam." },
    ),
  },
  /** Nota de 1 a 5 (o SDK devolve 0 a 4; somamos 1). */
  confianca_triagem: {
    tipo: "score" as const,
    pergunta: score(`${CONTEXTO} Qual o grau de coerência entre a quantidade de fotos lidas, a justificativa e a classe sugerida?`, [
      "Incoerente: justificativa contradiz a classe ou quase nenhuma foto foi lida.",
      "Fraca: justificativa vaga ou pouco ligada à classe, ou muito poucas fotos.",
      "Razoável: justificativa plausível, mas genérica ou com amostra pequena de fotos.",
      "Boa: justificativa específica e compatível com a classe, com fotos suficientes.",
      "Excelente: justificativa específica, compatível e bem apoiada por várias fotos.",
    ]),
  },
  /** Segunda opinião; só é feita com confiança baixa ou padrão ausente. Não sobrescreve a sugestão. */
  candidatos_padrao: {
    tipo: "choice" as const,
    pergunta: choice(
      `${CONTEXTO} Qual padrão de acabamento VEIU melhor corresponde ao que a justificativa descreve?`,
      CRITERIOS_PADRAO,
    ),
  },
};

type NomePergunta = keyof typeof PERGUNTAS;

export function perguntasParaEstado(r: ResultadoAnalise): NomePergunta[] {
  const nomes: NomePergunta[] = ["revisao_humana", "justificativa_coerente", "confianca_triagem"];
  if (r.confianca === "baixa" || r.padrao_codigo === null) nomes.push("candidatos_padrao");
  return nomes;
}

// ---------- Execução ----------

const entre = (n: unknown, a: number, b: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= a && n <= b;

interface Leitura {
  revisao: number;
  coerente: number;
  nota: number;
  candidatos: Triagem["candidatos_padrao"] | null;
  linhas: Omit<LinhaTriagem, "id" | "analise_id" | "imovel_id" | "modelo" | "latencia_ms" | "criado_em">[];
}

/** Valida o formato da resposta; qualquer divergência vira falha de triagem. */
function lerRespostas(answers: Record<string, unknown>, nomes: NomePergunta[], bruto: boolean): Leitura {
  const a = answers as Record<string, Record<string, unknown> | undefined>;
  const noulDe = (k: string) => {
    const v = a[k];
    if (v?.type !== "noul" || !entre(v.noul, 0, 1)) throw new Error(`resposta inválida em ${k}`);
    return v.noul;
  };
  const revisao = noulDe("revisao_humana");
  const coerente = noulDe("justificativa_coerente");
  const s = a.confianca_triagem;
  if (s?.type !== "score" || !entre(s.score, 0, 4)) throw new Error("resposta inválida em confianca_triagem");
  const nota = Math.round((s.score + 1) * 100) / 100;

  let candidatos: Leitura["candidatos"] = null;
  if (nomes.includes("candidatos_padrao")) {
    const c = a.candidatos_padrao;
    const probs = c?.probabilities as Record<string, unknown> | undefined;
    if (c?.type !== "choice" || typeof c.choice !== "string" || !probs) throw new Error("resposta inválida em candidatos_padrao");
    candidatos = PADROES_ACABAMENTO.map((p) => ({ codigo: p.codigo as string, nome: p.nome as string, probabilidade: probs[p.codigo] }))
      .map((p) => {
        if (!entre(p.probabilidade, 0, 1)) throw new Error("resposta inválida em candidatos_padrao");
        return p as { codigo: string; nome: string; probabilidade: number };
      })
      .sort((x, y) => y.probabilidade - x.probabilidade)
      .slice(0, 3);
  }

  const raw = (k: string) => (bruto ? a[k] ?? null : null);
  const linhas: Leitura["linhas"] = [
    { pergunta: "revisao_humana", tipo: "boolean", probabilidade: revisao, valor_escolhido: null, nota: null, status: "ok", motivo_erro: null, resposta_bruta: raw("revisao_humana") },
    { pergunta: "justificativa_coerente", tipo: "boolean", probabilidade: coerente, valor_escolhido: null, nota: null, status: "ok", motivo_erro: null, resposta_bruta: raw("justificativa_coerente") },
    { pergunta: "confianca_triagem", tipo: "score", probabilidade: null, valor_escolhido: null, nota, status: "ok", motivo_erro: null, resposta_bruta: raw("confianca_triagem") },
  ];
  if (candidatos)
    linhas.push({
      pergunta: "candidatos_padrao", tipo: "choice", probabilidade: candidatos[0].probabilidade, valor_escolhido: candidatos[0].codigo,
      nota: null, status: "ok", motivo_erro: null, resposta_bruta: raw("candidatos_padrao"),
    });
  return { revisao, coerente, nota, candidatos, linhas };
}

function motivoDeErro(e: unknown): string {
  const nome = (e as Error)?.constructor?.name ?? "Error";
  const status = (e as { status?: number }).status;
  if (typeof status === "number") return `HTTP ${status}`;
  if (nome === "APITimeoutError") return "timeout";
  if (nome === "APIConnectionError") return "falha de conexão";
  if (nome === "TypeSafeError") return "erro de configuração do SDK";
  return (e as Error)?.message?.slice(0, 120) || "erro desconhecido";
}

/** Só roda para análises com status "sugerido"; devolve null nos demais casos. */
export async function triarAnalise(
  analise: ResultadoAnalise,
  tipo: TipoImovelTriagem,
  deps: DepsTriagem,
): Promise<Triagem | null> {
  if (analise.status !== "sugerido") return null;
  const { config } = deps;
  const nomes = perguntasParaEstado(analise);
  const agora = () => new Date().toISOString();
  const base = (pergunta: NomePergunta) => ({
    id: randomUUID(), analise_id: analise.analise_id, imovel_id: analise.imovel_id, pergunta,
    tipo: PERGUNTAS[pergunta].tipo, modelo: config.modelo, criado_em: agora(),
  });

  let leitura: Leitura | null = null;
  let falha: string | null = null;
  const t0 = Date.now();
  if (!config.apiKey) {
    falha = "TYPESAFE_API_KEY não configurada";
  } else {
    try {
      const cliente = new TypeSafeClient({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        defaultModel: config.modelo,
        timeout: config.timeoutMs,
        ...deps.clienteOpcoes,
        retry: { maxRetries: 1, ...deps.clienteOpcoes?.retry }, // 1 nova tentativa em timeout, 429 e 5xx
      });
      const resposta = await cliente.systemOne({
        state: montarEstado(analise, tipo),
        questions: Object.fromEntries(nomes.map((n) => [n, PERGUNTAS[n].pergunta])),
        model: config.modelo,
      });
      leitura = lerRespostas(resposta.answers as Record<string, unknown>, nomes, config.logRespostaBruta);
    } catch (e) {
      falha = motivoDeErro(e);
    }
  }
  const latencia = Date.now() - t0;

  const linhas: LinhaTriagem[] = leitura
    ? leitura.linhas.map((l) => ({ ...base(l.pergunta as NomePergunta), ...l, latencia_ms: latencia }))
    : nomes.map((n) => ({
        ...base(n), probabilidade: null, valor_escolhido: null, nota: null, status: "erro" as const,
        motivo_erro: falha, latencia_ms: latencia, resposta_bruta: null,
      }));

  const motivos: string[] = [];
  let triagem: Triagem;
  if (leitura) {
    if (leitura.revisao > config.limiteRevisao) motivos.push("O Jev recomenda revisão humana");
    if (leitura.coerente < config.limiteCoerencia) motivos.push("Justificativa pouco coerente com a classe");
    if (leitura.nota < config.notaMinima) motivos.push("Nota de coerência abaixo do mínimo");
    triagem = {
      status: "ok", revisao_humana: { probabilidade: leitura.revisao }, coerente: { probabilidade: leitura.coerente },
      nota_coerencia: leitura.nota, candidatos_padrao: leitura.candidatos ?? [], modelo: config.modelo,
      revisao_obrigatoria: motivos.length > 0, motivos,
    };
  } else {
    triagem = {
      status: "indisponivel", revisao_humana: null, coerente: null, nota_coerencia: null, candidatos_padrao: [],
      modelo: config.modelo, revisao_obrigatoria: true, motivos: [`Triagem indisponível (${falha}): revisão humana obrigatória`],
    };
  }

  try {
    await deps.armazenamento.gravarTriagens(linhas);
  } catch {
    triagem.revisao_obrigatoria = true;
    triagem.motivos.push("Falha ao gravar o log da triagem");
  }
  return triagem;
}
