import type { Imovel, TipoImovel } from "./contrato";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export const moeda = (v: number | null) => (v === null ? "—" : brl.format(v));
export const numero = (v: number | null) => (v === null ? "—" : num.format(v));
export const m2 = (v: number | null) => (v === null ? "—" : `${num.format(v)} m²`);

export function data(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export const ROTULO_TIPO: Record<TipoImovel, string> = { casa: "Casa", apartamento: "Apartamento", terreno: "Terreno" };

export function enderecoCompleto(i: Imovel): string {
  const { logradouro, numero } = i.endereco;
  if (!logradouro) return "Endereço não informado";
  return `${logradouro}, ${numero ?? "nº não informado"}`;
}

export const ROTULO_CAMPO: Record<string, string> = {
  tipo: "Tipo",
  bairro: "Bairro",
  "endereco.logradouro": "Logradouro",
  "endereco.numero": "Número",
  "endereco.bairro": "Bairro",
  area_construida_m2: "Área construída",
  area_terreno_m2: "Área do terreno",
  preco_total: "Preço total",
  pavimentos: "Pavimentos",
  condominio: "Condomínio",
  dormitorios: "Dormitórios",
  suites: "Suítes",
  banheiros: "Banheiros",
  vagas_cobertas: "Vagas cobertas",
  vagas_descobertas: "Vagas descobertas",
  vagas_total: "Vagas (total)",
  area_lazer: "Área de lazer / churrasqueira",
  piscina: "Piscina",
  data_anuncio: "Data do anúncio",
  fotos: "Fotos",
};

function valorCampo(campo: string, v: unknown): string {
  if (v === null || v === undefined) return "não informado";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && campo === "tipo" ? ROTULO_TIPO[x as TipoImovel] ?? x : x)).join(", ");
  if (typeof v === "number") {
    if (campo === "preco_total") return moeda(v);
    if (campo.endsWith("_m2")) return m2(v);
    return numero(v);
  }
  if (campo === "tipo") return ROTULO_TIPO[v as TipoImovel] ?? String(v);
  return String(v);
}

/** "320 m² (mínimo 300)" */
export function descreverCriterio(campo: string, exigido: unknown, encontrado: unknown): string {
  const achado = valorCampo(campo, encontrado);
  if (exigido && typeof exigido === "object" && !Array.isArray(exigido)) {
    const { min, max } = exigido as { min?: number; max?: number };
    const partes = [];
    if (min !== undefined) partes.push(`mínimo ${valorCampo(campo, min)}`);
    if (max !== undefined) partes.push(`máximo ${valorCampo(campo, max)}`);
    return `${achado} (${partes.join(", ")})`;
  }
  return `${achado} (exigido: ${valorCampo(campo, exigido)})`;
}
