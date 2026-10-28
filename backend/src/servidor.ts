// API HTTP do backend. Só o servidor do site (Vercel) chama estas rotas, sempre com o header X-API-Key.
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AvaliacaoImovel, RequisicaoBusca } from "../../web/src/lib/contrato";
import { aprovarAnalise, gravarAnalise, gravarLogs, gravarTriagens } from "./analises";
import { listarAvaliacoes, salvarAvaliacao } from "./avaliacoes";
import { consultarBusca, iniciarBusca } from "./buscas";
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

  switch (rota) {
    case "POST /buscas": {
      const r = await iniciarBusca(db, await lerJson(req), deps.coletar);
      r.coleta?.catch((e) => deps.log?.(`coleta falhou ao gravar: ${(e as Error).message}`));
      return [r.codigo, r.corpo];
    }
    case "GET /buscas/:": {
      const r = await consultarBusca(db, partes[1]);
      return [r.codigo, r.corpo];
    }
    case "GET /avaliacoes":
      return [200, await listarAvaliacoes(db)];
    case "PUT /avaliacoes": {
      const a = (await lerJson(req)) as AvaliacaoImovel | null;
      if (!a?.imovel_id) throw new ErroHttp(400, "imovel_id é obrigatório");
      if (a.estado_conservacao && !ESTADOS_IBAPE.has(a.estado_conservacao))
        throw new ErroHttp(400, "Estado de conservação deve ser de A a I (IBAPE)");
      return [200, await salvarAvaliacao(db, a)];
    }
    case "POST /analises-foto": {
      const a = await lerJson(req);
      if (!a || typeof a !== "object") throw new ErroHttp(400, "Corpo inválido");
      await gravarAnalise(db, a as Record<string, unknown>);
      return [201, { ok: true }];
    }
    case "POST /analises-foto/:": {
      // POST /analises-foto/logs e POST /analises-foto/triagens
      const corpo = await lerJson(req);
      if (partes[1] === "logs") await gravarLogs(db, lista(corpo, "logs"));
      else if (partes[1] === "triagens") await gravarTriagens(db, lista(corpo, "triagens"));
      else break;
      return [201, { ok: true }];
    }
    case "POST /analises-foto/:/:": {
      // POST /analises-foto/:id/aprovar  { imovel_id, aprovado_por }
      if (partes[2] !== "aprovar") break;
      const c = (await lerJson(req)) as { imovel_id?: string; aprovado_por?: string | null } | null;
      if (!c?.imovel_id) throw new ErroHttp(400, "imovel_id é obrigatório");
      const ok = await aprovarAnalise(db, partes[1], c.imovel_id, c.aprovado_por ?? null);
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
      if (e instanceof ErroHttp) return enviar(res, e.codigo, { mensagem: e.message });
      // Erro do Postgres (ex.: violação de check) vira 500 com a mensagem; não há dado sensível nela.
      deps.log?.(`${req.method} ${req.url}: ${(e as Error).message}`);
      enviar(res, 500, { mensagem: (e as Error).message });
    }
  });
}
