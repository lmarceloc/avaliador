// Tipos do contrato front ↔ n8n (especificação, seção 5).

export type TipoImovel = "casa" | "apartamento" | "terreno";
export type Condominio = "sim" | "nao" | "indiferente";

export interface Faixa {
  min: number | null;
  max: number | null;
}

export interface Filtros {
  tipos: TipoImovel[];
  bairros: string[];
  area_construida: Faixa;
  area_terreno: Faixa;
  preco_total: Faixa;
  dormitorios_min: number | null;
  suites_min: number | null;
  banheiros_min: number | null;
  vagas_min: number | null;
  condominio: Condominio;
  pavimentos: Faixa;
}

export interface RequisicaoBusca {
  requisicao_id: string;
  cidade: string;
  uf: string;
  filtros: Filtros;
  fontes: string[];
  atualizar_cache: boolean;
  solicitado_em: string;
}

export type StatusBusca = "concluido" | "parcial" | "processando" | "erro";
export type StatusFonte = "ok" | "erro" | "buscando" | "aguardando";
export type StatusImovel = "normal" | "repetido" | "outlier";
export type ResultadoCriterio = "atende" | "nao_atende" | "nao_verificado";

export interface FonteResumo {
  id: string;
  nome: string;
  status: StatusFonte;
  itens: number;
  mensagem?: string;
}

export interface FonteImovel {
  id: string;
  nome: string;
  contato: string | null;
  informante: string | null;
}

export interface FonteAlternativa {
  id: string;
  nome: string;
  url_anuncio: string;
}

export interface Endereco {
  logradouro: string | null;
  numero: string | null;
  numero_informado: boolean;
  bairro: string | null;
  cidade: string;
  uf: string;
}

export interface Criterio {
  campo: string;
  exigido: unknown;
  encontrado: unknown;
  resultado: ResultadoCriterio;
}

export interface Imovel {
  id: string;
  fonte: FonteImovel;
  fontes_alternativas: FonteAlternativa[];
  url_anuncio: string;
  titulo: string;
  tipo: TipoImovel;
  endereco: Endereco;
  area_construida_m2: number | null;
  area_terreno_m2: number | null;
  preco_total: number | null;
  preco_m2: number | null;
  pavimentos: number | null;
  condominio: boolean | null;
  dormitorios: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas_cobertas: number | null;
  vagas_descobertas: number | null;
  vagas_total: number | null;
  padrao_acabamento_anuncio: string | null;
  estado_conservacao_anuncio: string | null;
  fotos: string[];
  foto_capa: string | null;
  data_anuncio: string | null;
  status: StatusImovel;
  criterios: Criterio[];
  atende: boolean;
  resumo_filtro: string;
  campos_faltantes: string[];
  coletado_em: string;
  /** false quando só os dados do card foram coletados (sem página de detalhe nem galeria completa). */
  detalhe_coletado?: boolean;
  /** Opcional: código publicado pela imobiliária, usado na deduplicação (4.3, item 1). */
  codigo_comum?: string | null;
}

export interface ErroFonte {
  fonte: string;
  codigo: string;
  mensagem: string;
}

export interface RespostaBusca {
  requisicao_id: string;
  status: StatusBusca;
  gerado_em?: string;
  fontes?: FonteResumo[];
  resumo?: {
    total: number;
    atendem_todos: number;
    atendem_parcial: number;
    nao_atendem: number;
    repetidos_removidos: number;
  };
  imoveis?: Imovel[];
  erros?: ErroFonte[];
}

// Registro da avaliadora (seção 7), separado dos dados do anúncio.
export interface AvaliacaoImovel {
  imovel_id: string;
  estado_conservacao: string | null;
  padrao_acabamento: string | null;
  observacoes: string | null;
  incluido_avaliacao: boolean | null;
  atualizado_em?: string;
}

export const FILTROS_VAZIOS: Filtros = {
  tipos: ["casa"],
  bairros: [],
  area_construida: { min: null, max: null },
  area_terreno: { min: null, max: null },
  preco_total: { min: null, max: null },
  dormitorios_min: null,
  suites_min: null,
  banheiros_min: null,
  vagas_min: null,
  condominio: "indiferente",
  pavimentos: { min: null, max: null },
};
