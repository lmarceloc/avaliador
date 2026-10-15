// Regras de negócio da seção 4 (normalização, filtros, deduplicação e outliers).
// Funções puras, sem dependências: o mesmo código pode ir para um nó Code do n8n.

import type { Criterio, Faixa, Filtros, Imovel, RespostaBusca } from "./contrato";
import { normalizarBairro, semAcento } from "./bairros";

// ---------- 4.1 Normalização ----------

/** "R$ 1.800.000,00" → 1800000; "320 m²" → 320; vazio → null (nunca zero). */
export function paraNumero(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  const limpo = String(bruto)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

export function calcularPrecoM2(preco: number | null, area: number | null): number | null {
  if (!preco || !area) return null;
  return Math.round(preco / area);
}

const CAMPOS_VERIFICAVEIS: [string, (i: Imovel) => unknown][] = [
  ["endereco.logradouro", (i) => i.endereco.logradouro],
  ["endereco.numero", (i) => i.endereco.numero],
  ["endereco.bairro", (i) => i.endereco.bairro],
  ["area_construida_m2", (i) => i.area_construida_m2],
  ["area_terreno_m2", (i) => i.area_terreno_m2],
  ["preco_total", (i) => i.preco_total],
  ["pavimentos", (i) => i.pavimentos],
  ["condominio", (i) => i.condominio],
  ["dormitorios", (i) => i.dormitorios],
  ["suites", (i) => i.suites],
  ["banheiros", (i) => i.banheiros],
  ["vagas_cobertas", (i) => i.vagas_cobertas],
  ["vagas_descobertas", (i) => i.vagas_descobertas],
  ["vagas_total", (i) => i.vagas_total],
  ["data_anuncio", (i) => i.data_anuncio],
];

export function camposFaltantes(imovel: Imovel): string[] {
  const faltam = CAMPOS_VERIFICAVEIS.filter(([, get]) => get(imovel) === null).map(([c]) => c);
  if (imovel.fotos.length === 0) faltam.push("fotos");
  // Terreno não tem área construída nem cômodos: não cobra esses campos.
  if (imovel.tipo === "terreno") {
    const naoSeAplica = new Set([
      "area_construida_m2", "pavimentos", "dormitorios", "suites", "banheiros",
      "vagas_cobertas", "vagas_descobertas", "vagas_total",
    ]);
    return faltam.filter((c) => !naoSeAplica.has(c));
  }
  return faltam;
}

// ---------- 4.2 Avaliação dos filtros ----------

function faixaPreenchida(f: Faixa): boolean {
  return f.min !== null || f.max !== null;
}

function exigidoFaixa(f: Faixa): Partial<Faixa> {
  const r: Partial<Faixa> = {};
  if (f.min !== null) r.min = f.min;
  if (f.max !== null) r.max = f.max;
  return r;
}

function avaliarFaixa(campo: string, valor: number | null, f: Faixa): Criterio {
  const exigido = exigidoFaixa(f);
  if (valor === null) return { campo, exigido, encontrado: null, resultado: "nao_verificado" };
  const ok = (f.min === null || valor >= f.min) && (f.max === null || valor <= f.max);
  return { campo, exigido, encontrado: valor, resultado: ok ? "atende" : "nao_atende" };
}

function avaliarMinimo(campo: string, valor: number | null, min: number): Criterio {
  if (valor === null) return { campo, exigido: { min }, encontrado: null, resultado: "nao_verificado" };
  return { campo, exigido: { min }, encontrado: valor, resultado: valor >= min ? "atende" : "nao_atende" };
}

export function avaliarCriterios(imovel: Imovel, filtros: Filtros): Pick<Imovel, "criterios" | "atende" | "resumo_filtro"> {
  const c: Criterio[] = [];

  c.push({
    campo: "tipo",
    exigido: filtros.tipos,
    encontrado: imovel.tipo,
    resultado: filtros.tipos.includes(imovel.tipo) ? "atende" : "nao_atende",
  });

  if (filtros.bairros.length > 0) {
    const bairro = imovel.endereco.bairro;
    const alvo = new Set(filtros.bairros.map(semAcento));
    c.push({
      campo: "bairro",
      exigido: filtros.bairros,
      encontrado: bairro,
      resultado: bairro === null ? "nao_verificado" : alvo.has(semAcento(bairro)) ? "atende" : "nao_atende",
    });
  }

  // Área construída não se aplica a terreno.
  if (faixaPreenchida(filtros.area_construida) && imovel.tipo !== "terreno")
    c.push(avaliarFaixa("area_construida_m2", imovel.area_construida_m2, filtros.area_construida));
  if (faixaPreenchida(filtros.area_terreno) && imovel.tipo !== "apartamento")
    c.push(avaliarFaixa("area_terreno_m2", imovel.area_terreno_m2, filtros.area_terreno));
  if (faixaPreenchida(filtros.preco_total))
    c.push(avaliarFaixa("preco_total", imovel.preco_total, filtros.preco_total));
  if (faixaPreenchida(filtros.pavimentos) && imovel.tipo !== "terreno")
    c.push(avaliarFaixa("pavimentos", imovel.pavimentos, filtros.pavimentos));

  if (imovel.tipo !== "terreno") {
    if (filtros.dormitorios_min !== null) c.push(avaliarMinimo("dormitorios", imovel.dormitorios, filtros.dormitorios_min));
    if (filtros.suites_min !== null) c.push(avaliarMinimo("suites", imovel.suites, filtros.suites_min));
    if (filtros.banheiros_min !== null) c.push(avaliarMinimo("banheiros", imovel.banheiros, filtros.banheiros_min));
    if (filtros.vagas_min !== null) c.push(avaliarMinimo("vagas_total", imovel.vagas_total, filtros.vagas_min));
  }

  if (filtros.condominio !== "indiferente") {
    const quer = filtros.condominio === "sim";
    c.push({
      campo: "condominio",
      exigido: quer,
      encontrado: imovel.condominio,
      resultado: imovel.condominio === null ? "nao_verificado" : imovel.condominio === quer ? "atende" : "nao_atende",
    });
  }

  const atendidos = c.filter((x) => x.resultado === "atende").length;
  const naoVerificados = c.filter((x) => x.resultado === "nao_verificado").length;
  const verificados = c.length - naoVerificados;
  const atende = atendidos === c.length;

  let resumo = atende
    ? "Atende todos os filtros"
    : `Atende ${atendidos} de ${verificados} critérios verificados`;
  if (naoVerificados > 0) resumo += ` (${naoVerificados} não verificado${naoVerificados > 1 ? "s" : ""})`;

  return { criterios: c, atende, resumo_filtro: resumo };
}

// ---------- 4.3 Deduplicação ----------

function quantidadeDeDados(i: Imovel): number {
  return CAMPOS_VERIFICAVEIS.filter(([, get]) => get(i) !== null).length + Math.min(i.fotos.length, 10) / 10;
}

function proximo(a: number | null, b: number | null, tolerancia = 0.01): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(a, b) * tolerancia;
}

function chaveEndereco(i: Imovel): string | null {
  const { logradouro, numero } = i.endereco;
  if (!logradouro || !numero) return null;
  const log = semAcento(logradouro)
    .replace(/^(r|rua|av|avenida|al|alameda|tv|travessa)\.?\s+/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${log}|${numero.replace(/\D/g, "")}`;
}

function mesmoImovel(a: Imovel, b: Imovel): boolean {
  if (a.fonte.id === b.fonte.id) return false;
  if (a.codigo_comum && b.codigo_comum) return a.codigo_comum === b.codigo_comum;
  const ka = chaveEndereco(a);
  return (
    ka !== null &&
    ka === chaveEndereco(b) &&
    proximo(a.area_construida_m2, b.area_construida_m2) &&
    proximo(a.preco_total, b.preco_total)
  );
}

export function deduplicar(imoveis: Imovel[]): { imoveis: Imovel[]; removidos: number } {
  const grupos: Imovel[][] = [];
  for (const im of imoveis) {
    const grupo = grupos.find((g) => g.some((x) => mesmoImovel(x, im)));
    if (grupo) grupo.push(im);
    else grupos.push([im]);
  }

  let removidos = 0;
  const resultado = grupos.map((g) => {
    if (g.length === 1) return g[0];
    const [principal, ...outros] = [...g].sort((a, b) => quantidadeDeDados(b) - quantidadeDeDados(a));
    removidos += outros.length;
    return {
      ...principal,
      status: "repetido" as const,
      fontes_alternativas: [
        ...principal.fontes_alternativas,
        ...outros.map((o) => ({ id: o.fonte.id, nome: o.fonte.nome, url_anuncio: o.url_anuncio })),
      ],
    };
  });
  return { imoveis: resultado, removidos };
}

// ---------- 4.4 Outliers ----------

export function marcarOutliers(imoveis: Imovel[]): Imovel[] {
  const valores = imoveis.map((i) => i.preco_m2).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (valores.length < 4) return imoveis;
  const meio = Math.floor(valores.length / 2);
  const mediana = valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const desvio = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length);
  if (desvio === 0) return imoveis;
  return imoveis.map((i) =>
    i.preco_m2 !== null && Math.abs(i.preco_m2 - mediana) > 1.5 * desvio ? { ...i, status: "outlier" } : i,
  );
}

// ---------- Pipeline completo (Normalizar → Deduplicar → preço/m² → filtros → outliers) ----------

export function processarImoveis(
  brutos: Imovel[],
  filtros: Filtros,
): { imoveis: Imovel[]; resumo: NonNullable<RespostaBusca["resumo"]> } {
  const normalizados = brutos.map((i) => {
    const im: Imovel = {
      ...i,
      endereco: { ...i.endereco, bairro: normalizarBairro(i.endereco.bairro) },
      foto_capa: i.fotos[0] ?? null,
      fontes_alternativas: i.fontes_alternativas ?? [],
      status: "normal",
    };
    im.endereco.numero_informado = Boolean(im.endereco.numero);
    im.preco_m2 = calcularPrecoM2(im.preco_total, im.area_construida_m2);
    return im;
  });

  const { imoveis: unicos, removidos } = deduplicar(normalizados);
  const avaliados = unicos.map((i) => ({ ...i, ...avaliarCriterios(i, filtros), campos_faltantes: camposFaltantes(i) }));
  const finais = marcarOutliers(avaliados);

  const atendem = finais.filter((i) => i.atende).length;
  const naoAtendem = finais.filter((i) => i.criterios.some((c) => c.resultado === "nao_atende")).length;
  return {
    imoveis: finais,
    resumo: {
      total: finais.length,
      atendem_todos: atendem,
      atendem_parcial: finais.length - atendem - naoAtendem,
      nao_atendem: naoAtendem,
      repetidos_removidos: removidos,
    },
  };
}
