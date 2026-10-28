// Persistência de analises_foto, analises_foto_log e triagens_jev (backend da VPS; arquivo local só em desenvolvimento).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { backend, backendJson } from "@/lib/servidor";
import type { Armazenamento, LinhaAnalise, LinhaLogFoto } from "./analise-fotos";
import type { ArmazenamentoTriagem, LinhaTriagem } from "./triagem-jev";

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

const post = (caminho: string, corpo: unknown) => backendJson(caminho, { method: "POST", body: JSON.stringify(corpo) });

export const armazenamento: Armazenamento = {
  async gravarAnalise(a: LinhaAnalise) {
    if (!backend.base) return gravarLocal(ARQ_ANALISES, [...(await lerLocal<LinhaAnalise>(ARQ_ANALISES)), a]);
    await post("/analises-foto", a);
  },
  async gravarLogs(linhas: LinhaLogFoto[]) {
    if (linhas.length === 0) return;
    if (!backend.base) return gravarLocal(ARQ_LOG, [...(await lerLocal<LinhaLogFoto>(ARQ_LOG)), ...linhas]);
    await post("/analises-foto/logs", linhas);
  },
};

export const armazenamentoTriagem: ArmazenamentoTriagem = {
  async gravarTriagens(linhas: LinhaTriagem[]) {
    if (linhas.length === 0) return;
    if (!backend.base) return gravarLocal(ARQ_TRIAGENS, [...(await lerLocal<LinhaTriagem>(ARQ_TRIAGENS)), ...linhas]);
    await post("/analises-foto/triagens", linhas);
  },
};

/** Marca a análise como aprovada depois que o usuário confirmou e a avaliação foi gravada. */
export async function aprovarAnalise(id: string, imovelId: string, por: string | null): Promise<void> {
  if (!backend.base) {
    const todas = await lerLocal<LinhaAnalise>(ARQ_ANALISES);
    const alvo = todas.find((a) => a.id === id && a.imovel_id === imovelId);
    if (!alvo) throw new Error("Análise não encontrada");
    Object.assign(alvo, { aprovado_por: por, aprovado_em: new Date().toISOString() });
    return gravarLocal(ARQ_ANALISES, todas);
  }
  await post(`/analises-foto/${encodeURIComponent(id)}/aprovar`, { imovel_id: imovelId, aprovado_por: por });
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
