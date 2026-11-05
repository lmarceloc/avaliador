// Tipos de conectores.js (o código é JS puro, herdado do nó Code do n8n).
import type { ErroFonte, FonteResumo, Imovel, RequisicaoBusca } from "../../web/src/lib/contrato";

export const NOMES: Record<string, string>;
/** id da fonte → cidade que ela atende ("Ponta Grossa" | "Curitiba"). */
export const CIDADE_DA_FONTE: Record<string, string>;
export const CIDADES: string[];

export function coletarFontes(opcoes: {
  requisicao: RequisicaoBusca;
  http: (url: string, opcoes?: { headers?: Record<string, string>; timeout?: number; json?: boolean; binario?: boolean }) => Promise<unknown>;
  timeoutFonteMs: number;
  config?: Record<string, Record<string, number>>;
  avaliar: (imovel: Imovel, filtros: RequisicaoBusca["filtros"]) => Pick<Imovel, "criterios" | "atende" | "resumo_filtro">;
  log?: (mensagem: string) => void;
}): Promise<{ fontes: FonteResumo[]; imoveis: Imovel[]; erros: ErroFonte[] }>;
