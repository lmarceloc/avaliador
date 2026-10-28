// Utilitários só do servidor: acesso ao backend da VPS, validação da requisição e armazenamento das avaliações.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AvaliacaoImovel, RequisicaoBusca } from "./contrato";

// Backend da VPS (pasta backend/): coleta das imobiliárias e banco Postgres.
export const backend = {
  base: process.env.BACKEND_URL?.replace(/\/$/, "") ?? null,
  apiKey: process.env.BACKEND_API_KEY ?? "",
};

/** Busca simulada quando não há backend configurado, ou com FORCAR_MOCK=1 (testes de interface). */
export function usandoMock(): boolean {
  return !backend.base || process.env.FORCAR_MOCK === "1";
}

/** Repassa a chamada ao backend e devolve status e corpo como vieram. Backend fora do ar vira 502 com mensagem. */
export async function chamarBackend(caminho: string, init: RequestInit = {}): Promise<Response> {
  const json = { "Content-Type": "application/json" };
  try {
    const resp = await fetch(`${backend.base}${caminho}`, {
      ...init,
      headers: { ...json, "X-API-Key": backend.apiKey, ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = await resp.text();
    return new Response(corpo || "{}", { status: resp.status, headers: json });
  } catch (e) {
    const mensagem = `O servidor de busca não respondeu (${(e as Error).message}). Tente de novo em instantes.`;
    return Response.json({ status: "erro", mensagem }, { status: 502 });
  }
}

/** Chama o backend e devolve o JSON; erro do backend vira exceção com a mensagem dele. */
export async function backendJson<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resp = await chamarBackend(caminho, init);
  const corpo = (await resp.json().catch(() => ({}))) as { mensagem?: string };
  if (!resp.ok) throw new Error(corpo.mensagem ?? `O backend respondeu ${resp.status}`);
  return corpo as T;
}

/** Regras da seção 5.1. Retorna a mensagem de erro, ou null se a requisição é válida. */
export function validarRequisicao(r: Partial<RequisicaoBusca>): string | null {
  if (!r || typeof r !== "object") return "Corpo inválido";
  if (!r.requisicao_id) return "requisicao_id é obrigatório";
  if (!r.filtros || !Array.isArray(r.filtros.tipos) || r.filtros.tipos.length === 0)
    return "filtros.tipos é obrigatório e não pode ser vazio";
  if (!Array.isArray(r.fontes) || r.fontes.length === 0) return "Selecione ao menos uma fonte";
  return null;
}

// ---------- Avaliações da avaliadora (seção 7) ----------

// Sem backend configurado, grava em arquivo local (apenas desenvolvimento).
const ARQUIVO_LOCAL = path.join(process.cwd(), ".data", "avaliacoes.json");

async function lerLocal(): Promise<Record<string, AvaliacaoImovel>> {
  try {
    return JSON.parse(await fs.readFile(ARQUIVO_LOCAL, "utf8"));
  } catch {
    return {};
  }
}

export async function listarAvaliacoes(): Promise<AvaliacaoImovel[]> {
  if (!backend.base) return Object.values(await lerLocal());
  return backendJson<AvaliacaoImovel[]>("/avaliacoes");
}

export async function salvarAvaliacao(a: AvaliacaoImovel): Promise<AvaliacaoImovel> {
  const registro: AvaliacaoImovel = {
    imovel_id: a.imovel_id,
    estado_conservacao: a.estado_conservacao ?? null,
    padrao_acabamento: a.padrao_acabamento ?? null,
    observacoes: a.observacoes ?? null,
    incluido_avaliacao: a.incluido_avaliacao ?? null,
    atualizado_em: new Date().toISOString(),
  };
  if (!backend.base) {
    const todos = await lerLocal();
    todos[registro.imovel_id] = registro;
    await fs.mkdir(path.dirname(ARQUIVO_LOCAL), { recursive: true });
    await fs.writeFile(ARQUIVO_LOCAL, JSON.stringify(todos, null, 2));
    return registro;
  }
  return backendJson<AvaliacaoImovel>("/avaliacoes", { method: "PUT", body: JSON.stringify(registro) });
}
