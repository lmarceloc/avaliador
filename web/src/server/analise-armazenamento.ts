// Persistência de analises_foto e analises_foto_log (Supabase; arquivo local só em desenvolvimento).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Armazenamento, LinhaAnalise, LinhaLogFoto } from "./analise-fotos";
import type { ArmazenamentoTriagem, LinhaTriagem } from "./triagem-jev";

let supabase: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase ??= createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

const PASTA = path.join(process.cwd(), ".data");
const ARQ_ANALISES = path.join(PASTA, "analises_foto.json");
const ARQ_LOG = path.join(PASTA, "analises_foto_log.json");
const ARQ_TRIAGENS = path.join(PASTA, "triagens_jev.json");

async function lerLocal<T>(arq: string): Promise<T[]> {
  try {
    return JSON.parse(await fs.readFile(arq, "utf8"));
  } catch {
    return [];
  }
}
async function gravarLocal(arq: string, dados: unknown[]) {
  await fs.mkdir(PASTA, { recursive: true });
  await fs.writeFile(arq, JSON.stringify(dados, null, 2));
}

export const armazenamento: Armazenamento = {
  async gravarAnalise(a: LinhaAnalise) {
    const cliente = db();
    if (!cliente) return gravarLocal(ARQ_ANALISES, [...(await lerLocal<LinhaAnalise>(ARQ_ANALISES)), a]);
    const { error } = await cliente.from("analises_foto").insert(a);
    if (error) throw new Error(error.message);
  },
  async gravarLogs(linhas: LinhaLogFoto[]) {
    if (linhas.length === 0) return;
    const cliente = db();
    if (!cliente) return gravarLocal(ARQ_LOG, [...(await lerLocal<LinhaLogFoto>(ARQ_LOG)), ...linhas]);
    const { error } = await cliente.from("analises_foto_log").insert(linhas);
    if (error) throw new Error(error.message);
  },
};

export const armazenamentoTriagem: ArmazenamentoTriagem = {
  async gravarTriagens(linhas: LinhaTriagem[]) {
    if (linhas.length === 0) return;
    const cliente = db();
    if (!cliente) return gravarLocal(ARQ_TRIAGENS, [...(await lerLocal<LinhaTriagem>(ARQ_TRIAGENS)), ...linhas]);
    const { error } = await cliente.from("triagens_jev").insert(linhas);
    if (error) throw new Error(error.message);
  },
};

/** Marca a análise como aprovada depois que o usuário confirmou e a avaliação foi gravada. */
export async function aprovarAnalise(id: string, imovelId: string, por: string | null): Promise<void> {
  const aprovacao = { aprovado_por: por, aprovado_em: new Date().toISOString() };
  const cliente = db();
  if (!cliente) {
    const todas = await lerLocal<LinhaAnalise>(ARQ_ANALISES);
    const alvo = todas.find((a) => a.id === id && a.imovel_id === imovelId);
    if (!alvo) throw new Error("Análise não encontrada");
    Object.assign(alvo, aprovacao);
    return gravarLocal(ARQ_ANALISES, todas);
  }
  const { data, error } = await cliente.from("analises_foto").update(aprovacao).eq("id", id).eq("imovel_id", imovelId).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Análise não encontrada");
}

// ---------- Proteção contra SSRF: o servidor só baixa fotos de endereços públicos ----------

function ipPrivado(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return ipPrivado(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export async function urlPermitida(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host)) return !ipPrivado(host);
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    const enderecos = await dns.lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipPrivado(e.address));
  } catch {
    return false;
  }
}
