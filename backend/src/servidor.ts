// API HTTP do backend. Só o servidor do site (Vercel) chama estas rotas, sempre com o header X-API-Key.
// Fora o login e a troca de senha, toda rota exige também X-Usuario-Id (o usuário da sessão do site): a
// empresa sai do banco a partir dele, nunca do que o site manda, e cada rota só enxerga dados dessa empresa.
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AvaliacaoImovel, RequisicaoBusca } from "../../web/src/lib/contrato";
import { aprovarAnalise, gravarAnalise, gravarLogs, gravarTriagens } from "./analises";
import { listarAvaliacoes, salvarAvaliacao } from "./avaliacoes";
import { consultarBusca, iniciarBusca } from "./buscas";
import { alterarPesquisa, criarPesquisa, ErroPesquisa, excluirPesquisa, lerPesquisa, listarPesquisas, marcarImovel } from "./pesquisas";
import { autenticar, contextoDoUsuario, ErroUsuario, trocarSenha, type Contexto } from "./usuarios";
import type { ResultadoColeta } from "./coleta";
import type { Db } from "./db";

const LIMITE_CORPO = 5 * 1024 * 1024;
const ESTADOS_IBAPE = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);

export interface DepsServidor {
  db: Db;
  apiKey: string;
  coletar: (req: RequisicaoBusca) => Promise<ResultadoColeta>;
  log?: (m: string) => void;
}

class ErroHttp extends Error {
  constructor(readonly codigo: number, mensagem: string) {
    super(mensagem);
  }
}

const resumo = (s: string) => createHash("sha256").update(s).digest();
function chaveValida(recebida: string | undefined, esperada: string): boolean {
  return Boolean(recebida) && timingSafeEqual(resumo(recebida!), resumo(esperada));
}

async function lerJson(req: http.IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += (parte as Buffer).length;
    if (tamanho > LIMITE_CORPO) throw new ErroHttp(413, "Corpo grande demais");
    partes.push(parte as Buffer);
  }
  if (tamanho === 0) return null;
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw new ErroHttp(400, "JSON inválido");
  }
}

function enviar(res: http.ServerResponse, codigo: number, corpo: unknown) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(corpo));
}

/** Correções à mão: área do terreno positiva (m²); piscina e condomínio sim/não. null ou ausente = vale o anúncio. */
export function validarCorrecoes(a: { area_terreno_m2?: unknown; piscina?: unknown; condominio?: unknown; tipo_casa?: unknown; geminada?: unknown }): string | null {
  const area = a.area_terreno_m2;
  if (area != null && (typeof area !== "number" || !Number.isFinite(area) || area <= 0 || area >= 10_000_000))
    return "Área do terreno deve ser um número de m² maior que zero";
  if (a.tipo_casa != null && a.tipo_casa !== "terrea" && a.tipo_casa !== "sobrado") return "tipo_casa deve ser terrea, sobrado ou vazio";
  for (const campo of ["piscina", "condominio", "geminada"] as const)
    if (a[campo] != null && typeof a[campo] !== "boolean") return `${campo} deve ser sim, não ou vazio`;
  return null;
}

const lista = (v: unknown, nome: string): Record<string, unknown>[] => {
  if (!Array.isArray(v) || v.some((x) => !x || typeof x !== "object")) throw new ErroHttp(400, `${nome} deve ser uma lista de objetos`);
  return v as Record<string, unknown>[];
};

/** Roteia uma requisição já autenticada. Devolve [status, corpo]. */
async function rotear(req: http.IncomingMessage, deps: DepsServidor): Promise<[number, unknown]> {
  const { db } = deps;
  const url = new URL(req.url ?? "/", "http://interno");
  const partes = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const metodo = req.method ?? "GET";
  const rota = `${metodo} /${partes.map((p, i) => (i > 0 ? ":" : p)).join("/")}`;

  if (rota === "POST /auth/:") {
    // POST /auth/login { email, senha } → { id, email, nome, papel, empresa }. O site cria a sessão; o backend só confere.
    // POST /auth/senha { email, senha_atual, senha_nova }
    const c = (await lerJson(req)) as { email?: unknown; senha?: unknown; senha_atual?: unknown; senha_nova?: unknown } | null;
    if (partes[1] === "login") return [200, await autenticar(db, c?.email, c?.senha)];
    if (partes[1] !== "senha") throw new ErroHttp(404, "Rota não encontrada");
    await trocarSenha(db, c?.email, c?.senha_atual, c?.senha_nova);
    return [200, { ok: true }];
  }

  const ctx: Contexto | null = await contextoDoUsuario(db, req.headers["x-usuario-id"]);
  if (!ctx) throw new ErroHttp(401, "Sua sessão expirou. Entre de novo.");

  switch (rota) {
    case "POST /buscas": {
      const r = await iniciarBusca(db, ctx, await lerJson(req), deps.coletar);
      r.coleta?.catch((e) => deps.log?.(`coleta falhou ao gravar: ${(e as Error).message}`));
      return [r.codigo, r.corpo];
    }
    case "GET /buscas/:": {
      const r = await consultarBusca(db, ctx, partes[1]);
      return [r.codigo, r.corpo];
    }
    case "GET /avaliacoes":
      return [200, await listarAvaliacoes(db, ctx)];
    case "PUT /avaliacoes": {
      const a = (await lerJson(req)) as AvaliacaoImovel | null;
      if (!a?.imovel_id) throw new ErroHttp(400, "imovel_id é obrigatório");
      if (a.estado_conservacao && !ESTADOS_IBAPE.has(a.estado_conservacao))
        throw new ErroHttp(400, "Estado de conservação deve ser de A a I (IBAPE)");
      const erro = validarCorrecoes(a);
      if (erro) throw new ErroHttp(400, erro);
      return [200, await salvarAvaliacao(db, ctx, a)];
    }
    case "POST /analises-foto": {
      const a = await lerJson(req);
      if (!a || typeof a !== "object") throw new ErroHttp(400, "Corpo inválido");
      await gravarAnalise(db, ctx, a as Record<string, unknown>);
      return [201, { ok: true }];
    }
    case "POST /analises-foto/:": {
      // POST /analises-foto/logs e POST /analises-foto/triagens
      const corpo = await lerJson(req);
      let ok: boolean;
      if (partes[1] === "logs") ok = await gravarLogs(db, ctx, lista(corpo, "logs"));
      else if (partes[1] === "triagens") ok = await gravarTriagens(db, ctx, lista(corpo, "triagens"));
      else break;
      if (!ok) throw new ErroHttp(404, "Análise não encontrada");
      return [201, { ok: true }];
    }
    case "GET /pesquisas":
      return [200, await listarPesquisas(db, ctx)];
    case "POST /pesquisas":
      return [201, await criarPesquisa(db, ctx, (await lerJson(req)) as never)];
    case "GET /pesquisas/:":
      return [200, await lerPesquisa(db, ctx, partes[1])];
    case "PATCH /pesquisas/:":
      return [200, await alterarPesquisa(db, ctx, partes[1], (await lerJson(req)) as never)];
    case "DELETE /pesquisas/:":
      await excluirPesquisa(db, ctx, partes[1]);
      return [200, { ok: true }];
    case "PUT /pesquisas/:/:": {
      // PUT /pesquisas/:id/selecao  { imovel_id, incluido: true | false | null }
      if (partes[2] !== "selecao") break;
      const c = (await lerJson(req)) as { imovel_id?: unknown; incluido?: unknown } | null;
      return [200, await marcarImovel(db, ctx, partes[1], c?.imovel_id, c?.incluido ?? null)];
    }
    case "POST /analises-foto/:/:": {
      // POST /analises-foto/:id/aprovar  { imovel_id, aprovado_por }
      if (partes[2] !== "aprovar") break;
      const c = (await lerJson(req)) as { imovel_id?: string; aprovado_por?: string | null } | null;
      if (!c?.imovel_id) throw new ErroHttp(400, "imovel_id é obrigatório");
      const ok = await aprovarAnalise(db, ctx, partes[1], c.imovel_id, c.aprovado_por ?? null);
      if (!ok) throw new ErroHttp(404, "Análise não encontrada");
      return [200, { ok: true }];
    }
  }
  throw new ErroHttp(404, "Rota não encontrada");
}

export function criarServidor(deps: DepsServidor): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/saude") {
        await deps.db.query("select 1");
        return enviar(res, 200, { ok: true });
      }
      if (!chaveValida(req.headers["x-api-key"] as string | undefined, deps.apiKey))
        return enviar(res, 401, { mensagem: "Chave de API inválida" });
      const [codigo, corpo] = await rotear(req, deps);
      enviar(res, codigo, corpo);
    } catch (e) {
      if (e instanceof ErroHttp || e instanceof ErroPesquisa || e instanceof ErroUsuario) return enviar(res, e.codigo, { mensagem: e.message });
      // Erro do Postgres (ex.: violação de check) vira 500 com a mensagem; não há dado sensível nela.
      deps.log?.(`${req.method} ${req.url}: ${(e as Error).message}`);
      enviar(res, 500, { mensagem: (e as Error).message });
    }
  });
}
