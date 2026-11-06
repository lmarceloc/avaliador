// Persistência de analises_foto, analises_foto_log e triagens_jev (backend da VPS; arquivo local só em desenvolvimento).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
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

// Proteção contra SSRF no download das fotos: ver ./rede-segura.ts
export { fetchFoto, urlPermitida } from "./rede-segura";
