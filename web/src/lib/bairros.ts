// Bairros oficiais de Ponta Grossa, conforme usados pelas imobiliárias (Flow e Kikina, out/2026).
// Ponto em aberto nº 3: confirmar com a avaliadora/prefeitura. Vilas e jardins (ex.: Jardim América)
// não são bairros oficiais; os sites os classificam dentro destes bairros.
export const BAIRROS_PONTA_GROSSA = [
  "Boa Vista",
  "Cara-Cara",
  "Centro",
  "Chapada",
  "Colônia Dona Luíza",
  "Contorno",
  "Estrela",
  "Jardim Carvalho",
  "Neves",
  "Nova Rússia",
  "Oficinas",
  "Olarias",
  "Órfãs",
  "Periquitos",
  "Ronda",
  "Uvaranas",
].sort((a, b) => a.localeCompare(b, "pt-BR"));

// Variações comuns encontradas nos anúncios → nome oficial (regra 4.1).
const APELIDOS: Record<string, string> = {
  "jd carvalho": "Jardim Carvalho",
  "jd. carvalho": "Jardim Carvalho",
  orfas: "Órfãs",
  piriquitos: "Periquitos",
  "col dona luiza": "Colônia Dona Luíza",
};

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function normalizarBairro(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const chave = semAcento(bruto).replace(/\s+/g, " ");
  const apelido = APELIDOS[chave];
  if (apelido) return apelido;
  const oficial = BAIRROS_PONTA_GROSSA.find((b) => semAcento(b) === chave);
  return oficial ?? bruto.trim();
}
