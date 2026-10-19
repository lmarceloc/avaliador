// Cadastro de fontes (seção 6.2). Espelha a tabela `fontes` do Supabase.
export interface Fonte {
  id: string;
  nome: string;
  ativa: boolean;
  observacao?: string;
}

export const FONTES: Fonte[] = [
  { id: "flow", nome: "Flow Imobiliária", ativa: true },
  { id: "kikina", nome: "Kikina Imóveis", ativa: true },
  { id: "adquira", nome: "Adquira Imóveis", ativa: true },
  { id: "conceito", nome: "Conceito Imóveis", ativa: true },
  { id: "casatop", nome: "Imobiliária Casa Top", ativa: true },
  { id: "classica", nome: "Clássica Imóveis", ativa: true },
  { id: "madol", nome: "Madol Imóveis", ativa: true, observacao: "pode pedir captcha" },
  { id: "tavarnaro", nome: "Tavarnaro Consultoria", ativa: true },
  { id: "aspen", nome: "Imobiliária Aspen", ativa: true },
  { id: "torre_branca", nome: "Torre Blanca", ativa: true },
  { id: "taques", nome: "Taques Negócios Imobiliários", ativa: true },
  { id: "montoro", nome: "Montoro Imóveis", ativa: true },
];

export const FONTES_ATIVAS = FONTES.filter((f) => f.ativa);

export function nomeFonte(id: string): string {
  return FONTES.find((f) => f.id === id)?.nome ?? id;
}
