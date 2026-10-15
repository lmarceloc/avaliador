// Utilitários só do servidor: configuração do n8n, validação da requisição e armazenamento das avaliações.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AvaliacaoImovel, RequisicaoBusca } from "./contrato";

export const n8n = {
  base: process.env.N8N_BASE_URL?.replace(/\/$/, "") ?? null,
  apiKey: process.env.N8N_API_KEY ?? "",
};

/** Backend simulado quando não há n8n configurado, ou com FORCAR_MOCK=1 (testes de interface). */
export function usandoMock(): boolean {
  return !n8n.base || process.env.FORCAR_MOCK === "1";
}

export async function chamarN8n(caminho: string, init: RequestInit = {}): Promise<Response> {
  const resp = await fetch(`${n8n.base}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-API-Key": n8n.apiKey, ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = await resp.text();
  return new Response(corpo || "{}", { status: resp.status, headers: { "Content-Type": "application/json" } });
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

let supabase: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase ??= createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

// Sem Supabase configurado, grava em arquivo local (apenas desenvolvimento).
const ARQUIVO_LOCAL = path.join(process.cwd(), ".data", "avaliacoes.json");

async function lerLocal(): Promise<Record<string, AvaliacaoImovel>> {
  try {
    return JSON.parse(await fs.readFile(ARQUIVO_LOCAL, "utf8"));
  } catch {
    return {};
  }
}

export async function listarAvaliacoes(): Promise<AvaliacaoImovel[]> {
  const cliente = db();
  if (!cliente) return Object.values(await lerLocal());
  const { data, error } = await cliente.from("avaliacoes_imovel").select("*");
  if (error) throw new Error(error.message);
  return data as AvaliacaoImovel[];
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
  const cliente = db();
  if (!cliente) {
    const todos = await lerLocal();
    todos[registro.imovel_id] = registro;
    await fs.mkdir(path.dirname(ARQUIVO_LOCAL), { recursive: true });
    await fs.writeFile(ARQUIVO_LOCAL, JSON.stringify(todos, null, 2));
    return registro;
  }
  const { data, error } = await cliente
    .from("avaliacoes_imovel")
    .upsert(registro, { onConflict: "imovel_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AvaliacaoImovel;
}
