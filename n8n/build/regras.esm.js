// src/lib/bairros.ts
var BAIRROS_PONTA_GROSSA = [
  "Boa Vista",
  "Cara-Cara",
  "Centro",
  "Chapada",
  "Col\xF4nia Dona Lu\xEDza",
  "Contorno",
  "Estrela",
  "Jardim Carvalho",
  "Neves",
  "Nova R\xFAssia",
  "Oficinas",
  "Olarias",
  "\xD3rf\xE3s",
  "Periquitos",
  "Ronda",
  "Uvaranas"
].sort((a, b) => a.localeCompare(b, "pt-BR"));
var APELIDOS = {
  "jd carvalho": "Jardim Carvalho",
  "jd. carvalho": "Jardim Carvalho",
  orfas: "\xD3rf\xE3s",
  piriquitos: "Periquitos",
  "col dona luiza": "Col\xF4nia Dona Lu\xEDza"
};
function semAcento(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
function normalizarBairro(bruto) {
  if (!bruto) return null;
  const chave = semAcento(bruto).replace(/\s+/g, " ");
  const apelido = APELIDOS[chave];
  if (apelido) return apelido;
  const oficial = BAIRROS_PONTA_GROSSA.find((b) => semAcento(b) === chave);
  return oficial ?? bruto.trim();
}

// src/lib/regras.ts
function paraNumero(bruto) {
  if (bruto === null || bruto === void 0 || bruto === "") return null;
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  const limpo = String(bruto).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}
function calcularPrecoM2(preco, area) {
  if (!preco || !area) return null;
  return Math.round(preco / area);
}
var CAMPOS_VERIFICAVEIS = [
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
  ["data_anuncio", (i) => i.data_anuncio]
];
function camposFaltantes(imovel) {
  const faltam = CAMPOS_VERIFICAVEIS.filter(([, get]) => get(imovel) === null).map(([c]) => c);
  if (imovel.fotos.length === 0) faltam.push("fotos");
  if (imovel.tipo === "terreno") {
    const naoSeAplica = /* @__PURE__ */ new Set([
      "area_construida_m2",
      "pavimentos",
      "dormitorios",
      "suites",
      "banheiros",
      "vagas_cobertas",
      "vagas_descobertas",
      "vagas_total"
    ]);
    return faltam.filter((c) => !naoSeAplica.has(c));
  }
  return faltam;
}
function faixaPreenchida(f) {
  return f.min !== null || f.max !== null;
}
function exigidoFaixa(f) {
  const r = {};
  if (f.min !== null) r.min = f.min;
  if (f.max !== null) r.max = f.max;
  return r;
}
function avaliarFaixa(campo, valor, f) {
  const exigido = exigidoFaixa(f);
  if (valor === null) return { campo, exigido, encontrado: null, resultado: "nao_verificado" };
  const ok = (f.min === null || valor >= f.min) && (f.max === null || valor <= f.max);
  return { campo, exigido, encontrado: valor, resultado: ok ? "atende" : "nao_atende" };
}
function avaliarSimNao(campo, valor, exigencia) {
  const quer = exigencia === "sim";
  return {
    campo,
    exigido: quer,
    encontrado: valor,
    resultado: valor === null ? "nao_verificado" : valor === quer ? "atende" : "nao_atende"
  };
}
function avaliarMinimo(campo, valor, min) {
  if (valor === null) return { campo, exigido: { min }, encontrado: null, resultado: "nao_verificado" };
  return { campo, exigido: { min }, encontrado: valor, resultado: valor >= min ? "atende" : "nao_atende" };
}
function avaliarCriterios(imovel, filtros) {
  const c = [];
  c.push({
    campo: "tipo",
    exigido: filtros.tipos,
    encontrado: imovel.tipo,
    resultado: filtros.tipos.includes(imovel.tipo) ? "atende" : "nao_atende"
  });
  if (filtros.bairros.length > 0) {
    const bairro = imovel.endereco.bairro;
    const alvo = new Set(filtros.bairros.map(semAcento));
    c.push({
      campo: "bairro",
      exigido: filtros.bairros,
      encontrado: bairro,
      resultado: bairro === null ? "nao_verificado" : alvo.has(semAcento(bairro)) ? "atende" : "nao_atende"
    });
  }
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
  if (filtros.condominio !== "indiferente") c.push(avaliarSimNao("condominio", imovel.condominio, filtros.condominio));
  if (imovel.tipo !== "terreno") {
    if (filtros.area_lazer && filtros.area_lazer !== "indiferente")
      c.push(avaliarSimNao("area_lazer", imovel.area_lazer ?? null, filtros.area_lazer));
    if (filtros.piscina && filtros.piscina !== "indiferente")
      c.push(avaliarSimNao("piscina", imovel.piscina ?? null, filtros.piscina));
  }
  const atendidos = c.filter((x) => x.resultado === "atende").length;
  const naoVerificados = c.filter((x) => x.resultado === "nao_verificado").length;
  const verificados = c.length - naoVerificados;
  const atende = atendidos === c.length;
  let resumo = atende ? "Atende todos os filtros" : `Atende ${atendidos} de ${verificados} crit\xE9rios verificados`;
  if (naoVerificados > 0) resumo += ` (${naoVerificados} n\xE3o verificado${naoVerificados > 1 ? "s" : ""})`;
  return { criterios: c, atende, resumo_filtro: resumo };
}
function quantidadeDeDados(i) {
  return CAMPOS_VERIFICAVEIS.filter(([, get]) => get(i) !== null).length + Math.min(i.fotos.length, 10) / 10;
}
function proximo(a, b, tolerancia = 0.01) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(a, b) * tolerancia;
}
function chaveEndereco(i) {
  const { logradouro, numero } = i.endereco;
  if (!logradouro || !numero) return null;
  const log = semAcento(logradouro).replace(/^(r|rua|av|avenida|al|alameda|tv|travessa)\.?\s+/, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return `${log}|${numero.replace(/\D/g, "")}`;
}
function mesmoImovel(a, b) {
  if (a.fonte.id === b.fonte.id) return false;
  if (a.codigo_comum && b.codigo_comum) return a.codigo_comum === b.codigo_comum;
  const ka = chaveEndereco(a);
  return ka !== null && ka === chaveEndereco(b) && proximo(a.area_construida_m2, b.area_construida_m2) && proximo(a.preco_total, b.preco_total);
}
function deduplicar(imoveis) {
  const grupos = [];
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
      status: "repetido",
      fontes_alternativas: [
        ...principal.fontes_alternativas,
        ...outros.map((o) => ({ id: o.fonte.id, nome: o.fonte.nome, url_anuncio: o.url_anuncio }))
      ]
    };
  });
  return { imoveis: resultado, removidos };
}
function marcarOutliers(imoveis) {
  const valores = imoveis.map((i) => i.preco_m2).filter((v) => v !== null).sort((a, b) => a - b);
  if (valores.length < 4) return imoveis;
  const meio = Math.floor(valores.length / 2);
  const mediana = valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const desvio = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length);
  if (desvio === 0) return imoveis;
  return imoveis.map(
    (i) => i.preco_m2 !== null && Math.abs(i.preco_m2 - mediana) > 1.5 * desvio ? { ...i, status: "outlier" } : i
  );
}
function processarImoveis(brutos, filtros) {
  const normalizados = brutos.map((i) => {
    const im = {
      ...i,
      endereco: { ...i.endereco, bairro: normalizarBairro(i.endereco.bairro) },
      foto_capa: i.fotos[0] ?? null,
      fontes_alternativas: i.fontes_alternativas ?? [],
      status: "normal"
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
      repetidos_removidos: removidos
    }
  };
}
export {
  avaliarCriterios,
  calcularPrecoM2,
  camposFaltantes,
  deduplicar,
  marcarOutliers,
  paraNumero,
  processarImoveis
};
