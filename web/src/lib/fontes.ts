// Cadastro de fontes (seção 6.2) por cidade. Os ids precisam existir no cadastro de backend/src/conectores.js
// (FONTES_POR_CIDADE), e cada fonte só é aceita numa busca da mesma cidade.
export interface Fonte {
  id: string;
  nome: string;
  cidade: string;
  ativa: boolean;
  observacao?: string;
}

export const CIDADES = [
  { nome: "Ponta Grossa", uf: "PR" },
  { nome: "Curitiba", uf: "PR" },
] as const;

export type Cidade = (typeof CIDADES)[number]["nome"];
export const CIDADE_PADRAO: Cidade = "Ponta Grossa";

const PG = "Ponta Grossa";
const CWB = "Curitiba";

export const FONTES: Fonte[] = [
  { id: "flow", nome: "Flow Imobiliária", cidade: PG, ativa: true },
  { id: "kikina", nome: "Kikina Imóveis", cidade: PG, ativa: true },
  { id: "adquira", nome: "Adquira Imóveis", cidade: PG, ativa: true },
  { id: "conceito", nome: "Conceito Imóveis", cidade: PG, ativa: true },
  { id: "casatop", nome: "Imobiliária Casa Top", cidade: PG, ativa: true },
  { id: "classica", nome: "Clássica Imóveis", cidade: PG, ativa: true },
  { id: "madol", nome: "Madol Imóveis", cidade: PG, ativa: true, observacao: "pode pedir captcha" },
  { id: "tavarnaro", nome: "Tavarnaro Consultoria", cidade: PG, ativa: true },
  { id: "aspen", nome: "Imobiliária Aspen", cidade: PG, ativa: true },
  { id: "torre_branca", nome: "Torre Blanca", cidade: PG, ativa: true },
  { id: "taques", nome: "Taques Negócios Imobiliários", cidade: PG, ativa: true },
  { id: "montoro", nome: "Montoro Imóveis", cidade: PG, ativa: true },

  // Curitiba — Rede UNA (plataforma PipeImob): cada uma traz só o estoque próprio da rede compartilhada.
  { id: "kondor", nome: "Kondor Imóveis", cidade: CWB, ativa: true },
  { id: "habitec", nome: "Habitec Imóveis", cidade: CWB, ativa: true },
  { id: "cilar", nome: "Imobiliária Cilar", cidade: CWB, ativa: true },
  { id: "afortiori", nome: "Afortiori Imóveis", cidade: CWB, ativa: true },
  { id: "paraiso", nome: "Imobiliária Paraíso", cidade: CWB, ativa: true },
  { id: "burgman", nome: "Burgman Imóveis", cidade: CWB, ativa: true },
  { id: "construa", nome: "Construa Imóveis", cidade: CWB, ativa: true },
  { id: "gomes", nome: "Gomes Imóveis", cidade: CWB, ativa: true },
  { id: "jamaica", nome: "Imobiliária Jamaica", cidade: CWB, ativa: true },
  { id: "outrasul", nome: "Outra Sul Imóveis", cidade: CWB, ativa: true },
  { id: "toyo", nome: "Toyo Imóveis", cidade: CWB, ativa: true },
  { id: "razao", nome: "Imobiliária Razão", cidade: CWB, ativa: true },
  // Curitiba — outras plataformas
  { id: "calluf", nome: "Calluf Imóveis", cidade: CWB, ativa: true },
  { id: "casa722", nome: "Casa722 Imóveis", cidade: CWB, ativa: true },
  { id: "cielo", nome: "Cielo Imóveis", cidade: CWB, ativa: true },
  { id: "view", nome: "View Imóveis", cidade: CWB, ativa: true },
  { id: "sawasaki", nome: "Sawasaki Imóveis", cidade: CWB, ativa: true },
  { id: "gm2", nome: "GM2 Imóveis", cidade: CWB, ativa: true },
  { id: "primesoho", nome: "Prime Soho Imóveis", cidade: CWB, ativa: true, observacao: "alto padrão, só venda" },
  { id: "bembrasil", nome: "Bem Brasil Imóveis", cidade: CWB, ativa: true },
  { id: "galo", nome: "Galo Imóveis", cidade: CWB, ativa: true },
];

export const FONTES_ATIVAS = FONTES.filter((f) => f.ativa);

export function fontesDaCidade(cidade: string): Fonte[] {
  return FONTES.filter((f) => f.cidade === cidade);
}

/** Cidade de uma lista de fontes (pesquisas salvas guardam só as fontes). Sem fonte conhecida: a padrão. */
export function cidadeDasFontes(ids: string[]): Cidade {
  const f = FONTES.find((x) => ids.includes(x.id));
  return (f?.cidade as Cidade) ?? CIDADE_PADRAO;
}

export function ufDaCidade(cidade: string): string {
  return CIDADES.find((c) => c.nome === cidade)?.uf ?? "PR";
}

export function nomeFonte(id: string): string {
  return FONTES.find((f) => f.id === id)?.nome ?? id;
}
