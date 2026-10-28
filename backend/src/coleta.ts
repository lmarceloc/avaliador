// Coleta em todas as fontes (em paralelo) + normalização, deduplicação, filtros e outliers.
// Era o nó "Coletar e processar" do n8n; os conectores e as regras são os mesmos.
import type { FonteResumo, RequisicaoBusca, RespostaBusca, StatusBusca } from "../../web/src/lib/contrato";
import { avaliarCriterios, processarImoveis } from "../../web/src/lib/regras";
import { coletarFontes } from "./conectores.js";

// A especificação pede 25 s; com a galeria completa a coleta real leva ~60 s.
export const TIMEOUT_FONTE_MS = 120_000;

export interface OpcoesHttp {
  headers?: Record<string, string>;
  timeout?: number;
  json?: boolean;
  binario?: boolean;
}
export type Http = (url: string, opcoes?: OpcoesHttp) => Promise<unknown>;

/** GET usado pelos conectores: lança erro com httpCode em status >= 400 (como o httpRequest do n8n). */
export const httpPadrao: Http = async (url, { headers, timeout, json, binario } = {}) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout ?? 20_000) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { httpCode: r.status });
  return binario ? new Uint8Array(await r.arrayBuffer()) : json ? r.json() : r.text();
};

export interface ResultadoColeta {
  status: StatusBusca;
  fontes_status: FonteResumo[];
  resposta: RespostaBusca;
  logs: string[];
}

interface DepsColeta {
  http?: Http;
  timeoutFonteMs?: number;
  /** Ajustes por fonte (6.3). Ex.: { flow: { max_paginas: 5, max_detalhes: 30, intervalo_ms: 1500 } } */
  config?: Record<string, Record<string, number>>;
  /** Substitui os conectores reais (testes). */
  coletar?: typeof coletarFontes;
}

export async function executarColeta(req: RequisicaoBusca, deps: DepsColeta = {}): Promise<ResultadoColeta> {
  const logs: string[] = [];
  const inicio = Date.now();
  const log = (m: string) => logs.push(`[${((Date.now() - inicio) / 1000).toFixed(1)}s] ${m}`);
  try {
    const coleta = await (deps.coletar ?? coletarFontes)({
      requisicao: req,
      http: deps.http ?? httpPadrao,
      timeoutFonteMs: deps.timeoutFonteMs ?? TIMEOUT_FONTE_MS,
      config: deps.config ?? {},
      avaliar: avaliarCriterios,
      log,
    });
    const { imoveis, resumo } = processarImoveis(coleta.imoveis, req.filtros);
    const ok = coleta.fontes.filter((f) => f.status === "ok").length;
    const status: StatusBusca = ok === 0 ? "erro" : ok < coleta.fontes.length ? "parcial" : "concluido";
    return {
      status,
      fontes_status: coleta.fontes,
      resposta: { requisicao_id: req.requisicao_id, status, gerado_em: new Date().toISOString(), fontes: coleta.fontes, resumo, imoveis, erros: coleta.erros },
      logs,
    };
  } catch (e) {
    const mensagem = (e as Error).message;
    log(`erro geral: ${mensagem}`);
    const fontes: FonteResumo[] = req.fontes.map((id) => ({ id, nome: id, status: "erro", mensagem, itens: 0 }));
    return {
      status: "erro",
      fontes_status: fontes,
      resposta: {
        requisicao_id: req.requisicao_id, status: "erro", gerado_em: new Date().toISOString(), fontes, imoveis: [],
        erros: [{ fonte: "*", codigo: "ERRO_INTERNO", mensagem }],
      },
      logs,
    };
  }
}
