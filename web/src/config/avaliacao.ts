// Tabelas de referência da avaliação. Nenhum componente deve repetir estes valores.

/** Estado de conservação — IBAPE-SP, Quadro 1. `depreciacao` em %. */
export const ESTADOS_CONSERVACAO = [
  { classe: "A", nome: "Nova", depreciacao: 0.0 },
  { classe: "B", nome: "Entre nova e regular", depreciacao: 0.32 },
  { classe: "C", nome: "Regular", depreciacao: 2.52 },
  { classe: "D", nome: "Entre regular e necessitando de reparos simples", depreciacao: 8.09 },
  { classe: "E", nome: "Necessitando de reparos simples", depreciacao: 18.1 },
  { classe: "F", nome: "Necessitando de reparos simples a importantes", depreciacao: 33.2 },
  { classe: "G", nome: "Necessitando de reparos importantes", depreciacao: 52.6 },
  { classe: "H", nome: "Necessitando de reparos importantes a edificação sem valor", depreciacao: 75.2 },
  { classe: "I", nome: "Sem valor (ruína)", depreciacao: 100.0 },
] as const;

export type ClasseEc = (typeof ESTADOS_CONSERVACAO)[number]["classe"];
export const CLASSES_EC = ESTADOS_CONSERVACAO.map((e) => e.classe) as [ClasseEc, ...ClasseEc[]];

/** Padrão de acabamento — VEIU. */
export const PADROES_ACABAMENTO = [
  { codigo: "2.1", nome: "Rústico" },
  { codigo: "2.2", nome: "Proletário" },
  { codigo: "2.3", nome: "Econômico" },
  { codigo: "2.4", nome: "Simples" },
  { codigo: "2.5", nome: "Médio" },
  { codigo: "2.6", nome: "Superior" },
  { codigo: "2.7", nome: "Fino" },
  { codigo: "2.8", nome: "Luxo" },
] as const;

export type CodigoPadrao = (typeof PADROES_ACABAMENTO)[number]["codigo"];
export const CODIGOS_PADRAO = PADROES_ACABAMENTO.map((p) => p.codigo) as [CodigoPadrao, ...CodigoPadrao[]];

/** Rótulo gravado em avaliacoes_imovel.padrao_acabamento, ex.: "2.5 Médio". */
export const rotuloPadrao = (p: { codigo: string; nome: string }) => `${p.codigo} ${p.nome}`;

/**
 * Escala numérica da avaliadora (Sisdia), campo `padrao_sisdia`.
 * Confirmados: 0 = 2.3 Econômico, 2 = 2.4 Simples, 3 = 2.5 Médio, 4 = 2.7 Fino.
 * PENDENTES de confirmação (valor null + a_confirmar): 2.1, 2.2, 2.6 e 2.8, além do valor 1 da escala,
 * que ainda não tem padrão associado. Não inventar mapeamento.
 */
export const MAPA_SISDIA: Record<CodigoPadrao, { sisdia: number | null; a_confirmar: boolean }> = {
  "2.1": { sisdia: null, a_confirmar: true },
  "2.2": { sisdia: null, a_confirmar: true },
  "2.3": { sisdia: 0, a_confirmar: false },
  "2.4": { sisdia: 2, a_confirmar: false },
  "2.5": { sisdia: 3, a_confirmar: false },
  "2.6": { sisdia: null, a_confirmar: true },
  "2.7": { sisdia: 4, a_confirmar: false },
  "2.8": { sisdia: null, a_confirmar: true },
};

export function depreciacaoDe(classe: string | null): number | null {
  return ESTADOS_CONSERVACAO.find((e) => e.classe === classe)?.depreciacao ?? null;
}

export function padraoDe(codigo: string | null) {
  return PADROES_ACABAMENTO.find((p) => p.codigo === codigo) ?? null;
}

export function sisdiaDe(codigo: string | null): { sisdia: number | null; a_confirmar: boolean } {
  const m = MAPA_SISDIA[codigo as CodigoPadrao];
  return m ?? { sisdia: null, a_confirmar: false };
}
