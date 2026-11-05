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

// Os 75 bairros oficiais de Curitiba (IPPUC). "Ecoville" e "Champagnat" são nomes de mercado: os sites os
// usam no título, mas o bairro oficial é Mossunguê/Campo Comprido e Bigorrilho.
export const BAIRROS_CURITIBA = [
  "Abranches",
  "Água Verde",
  "Ahú",
  "Alto Boqueirão",
  "Alto da Glória",
  "Alto da Rua XV",
  "Atuba",
  "Augusta",
  "Bacacheri",
  "Bairro Alto",
  "Barreirinha",
  "Batel",
  "Bigorrilho",
  "Boa Vista",
  "Bom Retiro",
  "Boqueirão",
  "Butiatuvinha",
  "Cabral",
  "Cachoeira",
  "Cajuru",
  "Campina do Siqueira",
  "Campo Comprido",
  "Campo de Santana",
  "Capão da Imbuia",
  "Capão Raso",
  "Cascatinha",
  "Caximba",
  "Centro",
  "Centro Cívico",
  "Cidade Industrial",
  "Cristo Rei",
  "Fanny",
  "Fazendinha",
  "Ganchinho",
  "Guabirotuba",
  "Guaíra",
  "Hauer",
  "Hugo Lange",
  "Jardim Botânico",
  "Jardim das Américas",
  "Jardim Social",
  "Juvevê",
  "Lamenha Pequena",
  "Lindóia",
  "Mercês",
  "Mossunguê",
  "Novo Mundo",
  "Orleans",
  "Parolin",
  "Pilarzinho",
  "Pinheirinho",
  "Portão",
  "Prado Velho",
  "Rebouças",
  "Riviera",
  "Santa Cândida",
  "Santa Felicidade",
  "Santa Quitéria",
  "Santo Inácio",
  "São Braz",
  "São Francisco",
  "São João",
  "São Lourenço",
  "São Miguel",
  "Seminário",
  "Sítio Cercado",
  "Taboão",
  "Tarumã",
  "Tatuquara",
  "Tingui",
  "Uberaba",
  "Umbará",
  "Vila Izabel",
  "Vista Alegre",
  "Xaxim",
].sort((a, b) => a.localeCompare(b, "pt-BR"));

/** Bairros oficiais por cidade (as cidades atendidas pela busca). */
export const BAIRROS_POR_CIDADE: Record<string, string[]> = {
  "Ponta Grossa": BAIRROS_PONTA_GROSSA,
  Curitiba: BAIRROS_CURITIBA,
};

// Variações comuns encontradas nos anúncios → nome oficial (regra 4.1). A chave já vem sem acento e em minúsculas.
const APELIDOS: Record<string, string> = {
  "jd carvalho": "Jardim Carvalho",
  "jd. carvalho": "Jardim Carvalho",
  orfas: "Órfãs",
  piriquitos: "Periquitos",
  "col dona luiza": "Colônia Dona Luíza",
  // Curitiba
  cic: "Cidade Industrial",
  "cidade industrial de curitiba": "Cidade Industrial",
  "alto da xv": "Alto da Rua XV",
  "jd das americas": "Jardim das Américas",
  "vila isabel": "Vila Izabel",
};

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function normalizarBairro(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const chave = semAcento(bruto).replace(/\s+/g, " ");
  const apelido = APELIDOS[chave];
  if (apelido) return apelido;
  // Nomes que existem nas duas cidades ("Centro", "Boa Vista") têm a mesma grafia: a busca não depende da cidade.
  const oficial = [...BAIRROS_PONTA_GROSSA, ...BAIRROS_CURITIBA].find((b) => semAcento(b) === chave);
  return oficial ?? bruto.trim();
}
