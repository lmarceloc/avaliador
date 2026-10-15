// Coleta em todas as fontes (em paralelo) + normalização, deduplicação, filtros e outliers.
// O código dos conectores e das regras é gerado a partir de n8n/src/conectores.js e web/src/lib/regras.ts.
const TIMEOUT_FONTE_MS = 120000; // a especificação pede 25 s; com a galeria completa a coleta real leva ~60 s
const CONFIG_FONTES = {
  // Ajustes por fonte (6.3). Ex.: flow: { max_paginas: 5, max_detalhes: 30, intervalo_ms: 1500 }
};

const entrada = $("Validar requisição").first().json;
const req = entrada.requisicao;
const helpers = this.helpers;
const http = (url, opcoes = {}) =>
  helpers.httpRequest({ method: "GET", url, headers: opcoes.headers, timeout: opcoes.timeout, json: Boolean(opcoes.json) });

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
  if (filtros.condominio !== "indiferente") {
    const quer = filtros.condominio === "sim";
    c.push({
      campo: "condominio",
      exigido: quer,
      encontrado: imovel.condominio,
      resultado: imovel.condominio === null ? "nao_verificado" : imovel.condominio === quer ? "atende" : "nao_atende"
    });
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
var Regras = { avaliarCriterios, calcularPrecoM2, camposFaltantes, deduplicar, marcarOutliers, paraNumero, processarImoveis };


// Conectores das imobiliárias (seção 6.2). Roda dentro do nó Code do n8n e também localmente
// (n8n/testar.mjs). Depende só de `http(url, opcoes)` — no n8n, um wrapper de this.helpers.httpRequest.
// Cada conector devolve { imoveis, erro } com imóveis no formato do contrato (seção 5.2),
// ainda sem criterios/status: isso é feito depois por processarImoveis().

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 BuscaImoveisPG/1.0 (Agencia Byte)";

const CONFIG_PADRAO = {
  max_paginas: 10,       // 6.3 limite de páginas de resultado por fonte
  max_detalhes: 50,      // páginas de detalhe abertas por fonte (galeria completa)
  intervalo_ms: 1000,    // 6.3 ritmo: 1 a 2 s entre requisições à mesma fonte
  timeout_req_ms: 20000,
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function decodificar(s) {
  if (s == null) return s;
  return String(s)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&sup2;/g, "²")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const textoLimpo = (html) => decodificar(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "R$ 4.500.000,00" → 4500000 · "1.006,00m²" → 1006 · "" → null */
function numeroBR(s) {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, "").match(/\d[\d.]*(,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Zero vindo de sistema de imobiliária quase sempre significa "não informado" (regra 4.1: nunca zero). */
const ouNulo = (n) => (n === null || n === undefined || Number.isNaN(n) || n === 0 ? null : n);

const slug = (s) => String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Separa "Avenida Anita Garibaldi, 1979" em logradouro e número. */
function separarEndereco(s) {
  if (!s) return { logradouro: null, numero: null };
  const m = String(s).trim().match(/^(.*?)(?:,\s*|\s+n[ºo°]?\s*)(\d+[A-Za-z]?)\b/);
  if (m) return { logradouro: m[1].trim(), numero: m[2] };
  return { logradouro: String(s).trim() || null, numero: null };
}

/** Remove "s/n" e sobras do logradouro. */
function limparLogradouro(s) {
  if (!s) return null;
  const l = String(s).replace(/,?\s*(s\/?n|sem n[úu]mero)\.?$/i, "").replace(/[,\s-]+$/, "").trim();
  return l || null;
}

class Parametros {
  constructor(inicial) { this.v = { ...inicial }; }
  set(k, val) { this.v[k] = val; }
  toString() { return Object.entries(this.v).map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join("&"); }
}

function cliente(http, cfg, sinal) {
  // GET com ritmo controlado e 1 retentativa (3 s) para erro de rede ou 5xx (6.3).
  let ultima = 0;
  return async function get(url, opcoes = {}) {
    if (sinal.abortado) throw new Error("abortado");
    const espera = ultima + cfg.intervalo_ms - Date.now();
    if (espera > 0) await dormir(espera);
    for (let tentativa = 0; ; tentativa++) {
      ultima = Date.now();
      try {
        return await http(url, { timeout: cfg.timeout_req_ms, ...opcoes });
      } catch (e) {
        const status = e.httpCode || e.statusCode || e.status || (e.response && e.response.status);
        const transitorio = !status || Number(status) >= 500;
        if (tentativa >= 1 || !transitorio || sinal.abortado) throw e;
        await dormir(3000);
      }
    }
  };
}

function imovelBase(fonte, extra) {
  return {
    fonte,
    fontes_alternativas: [],
    pavimentos: null,
    condominio: null,
    suites: null,
    banheiros: null,
    vagas_cobertas: null,
    vagas_descobertas: null,
    vagas_total: null,
    padrao_acabamento_anuncio: null,
    estado_conservacao_anuncio: null,
    fotos: [],
    foto_capa: null,
    data_anuncio: null,
    status: "normal",
    criterios: [],
    atende: false,
    resumo_filtro: "",
    campos_faltantes: [],
    preco_m2: null,
    coletado_em: new Date().toISOString(),
    detalhe_coletado: false,
    ...extra,
  };
}

/** Ordena os candidatos: primeiro os que não reprovam em nenhum critério com os dados do card. */
function priorizarDetalhes(imoveis, filtros, avaliar) {
  return imoveis
    .map((im, i) => ({ im, i, ruim: avaliar(im, filtros).criterios.filter((c) => c.resultado === "nao_atende").length }))
    .sort((a, b) => a.ruim - b.ruim || a.i - b.i)
    .filter((x) => x.ruim === 0)
    .map((x) => x.im);
}

// ======================================================================
// Flow Imobiliária — plataforma SysOne, HTML server-side
// Busca: /busca/venda/tipo_casa/bairro_orfas/valormin_X/valormax_Y/mostrar_100/pag_2
// ======================================================================

const FLOW = {
  id: "flow",
  nome: "Flow Imobiliária",
  base: "https://flowimobiliaria.com.br",
  tipos: { casa: ["tipo_casa", "tipo_sobrado"], apartamento: ["tipo_apartamento"], terreno: ["tipo_terreno"] },
};

function tipoFlow(rotulo) {
  const t = slug(rotulo || "");
  if (/apartamento|cobertura|kitnet|studio|flat/.test(t)) return "apartamento";
  if (/terreno|lote/.test(t)) return "terreno";
  if (/casa|sobrado/.test(t)) return "casa";
  return null;
}

function urlsBuscaFlow(filtros) {
  const tipos = [...new Set(filtros.tipos.flatMap((t) => FLOW.tipos[t] || []))];
  const preco = [];
  if (filtros.preco_total.min != null) preco.push(`valormin_${Math.round(filtros.preco_total.min)}`);
  if (filtros.preco_total.max != null) preco.push(`valormax_${Math.round(filtros.preco_total.max)}`);
  // O site aceita um bairro por vez: uma busca por bairro.
  const bairros = filtros.bairros.length ? filtros.bairros.map((b) => `bairro_${slug(b)}`) : [""];
  return bairros.map((b) => `${FLOW.base}/busca/venda/${[...tipos, b, ...preco, "mostrar_100"].filter(Boolean).join("/")}`);
}

function parseCardsFlow(html) {
  const cards = [];
  const partes = html.split('<div class="searchItem');
  for (const p of partes.slice(1)) {
    const url = (p.match(/href="(https:\/\/flowimobiliaria\.com\.br\/imovel\/[^"]+)"/) || [])[1];
    if (!url) continue;
    const infos = [...p.matchAll(/<div class="innerInfo"\s*>([\s\S]*?)<\/div>/g)].map((m) => textoLimpo(m[1]));
    const li = (rotulo) => {
      const m = p.match(new RegExp(`<li>\\s*<i[^>]*></i>\\s*([\\d.,]+)\\s*<span>\\s*${rotulo}`, "i"));
      return m ? numeroBR(m[1]) : null;
    };
    const endereco = textoLimpo((p.match(/<div class="hide">([\s\S]*?)<\/div>/) || [])[1] || "");
    cards.push({
      url,
      codigo: (url.match(/\/imovel\/([\d.]+)\//) || [])[1] || null,
      foto: (p.match(/data-src="([^"]+)"/) || [])[1] || null,
      rotuloTipo: infos[0] || "",
      bairro: infos[1] || null,
      titulo: textoLimpo((p.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || ""),
      endereco,
      quartos: li("Quartos"),
      suites: li("Suítes"),
      vagas: li("Vagas"),
      area: li("Área"),
      preco: numeroBR((p.match(/class="imobPrice[^"]*">([^<]+)/) || [])[1]),
    });
  }
  const proxima = /class='step'><a href='([^']+)'/.exec(html);
  return { cards, temProxima: Boolean(proxima), paginaReconhecida: html.includes("searchResults") };
}

function imovelDeCardFlow(c, contato) {
  const tipo = tipoFlow(c.rotuloTipo);
  const valido = c.endereco && !/\/PR$|^Ponta Grossa/i.test(c.endereco) && slug(c.endereco) !== slug(c.bairro || "");
  const { logradouro: bruto, numero } = valido ? separarEndereco(c.endereco) : { logradouro: null, numero: null };
  const logradouro = limparLogradouro(bruto);
  return imovelBase(
    { id: FLOW.id, nome: FLOW.nome, contato: contato.telefone, informante: contato.nome },
    {
      id: `flow-${c.codigo}`,
      url_anuncio: c.url,
      titulo: c.titulo || `${c.rotuloTipo} – ${c.bairro}`,
      tipo,
      endereco: { logradouro, numero, numero_informado: Boolean(numero), bairro: c.bairro, cidade: "Ponta Grossa", uf: "PR" },
      area_construida_m2: tipo === "terreno" ? null : ouNulo(c.area),
      area_terreno_m2: tipo === "terreno" ? ouNulo(c.area) : null,
      preco_total: ouNulo(c.preco),
      dormitorios: tipo === "terreno" ? null : ouNulo(c.quartos),
      suites: tipo === "terreno" ? null : c.suites,
      vagas_total: tipo === "terreno" ? null : c.vagas,
      condominio: /condom/i.test(c.url) ? true : null,
      fotos: c.foto ? [c.foto] : [],
      foto_capa: c.foto,
      codigo_comum: null,
    },
  );
}

function contatoFlow(html) {
  // Primeiro corretor da barra de contato: <small>Dico</small> ... (42) 99918-9908
  const m = html.match(/<small>([^<]+)<\/small>\s*<a[^>]*whatsapp[^>]*>[\s\S]*?<span>\((\d{2})\)<\/span>(?:&nbsp;|\s)*([\d-]+)/);
  return m ? { nome: m[1].trim(), telefone: `(${m[2]}) ${m[3]}` } : { nome: null, telefone: null };
}

function aplicarDetalheFlow(im, html) {
  const fotos = [...new Set([...html.matchAll(/<a[^>]*data-fancybox="group"[^>]*href="([^"]+)"/g)].map((m) => decodificar(m[1])))];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const canonica = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (canonica) im.url_anuncio = canonica;

  // "Avenida Anita Garibaldi, 1979 - Orfãs - Ponta Grossa/PR"
  const linhaEnd = textoLimpo((html.match(/fa-map-marker"><\/i>(?:&nbsp;)?([^<]+)<\/div>\s*<div class="price"/) || [])[1] || "");
  // Sem logradouro publicado a linha vem só como "Orfãs - Ponta Grossa/PR".
  const pedacos = linhaEnd.split(" - ");
  if (linhaEnd) {
    const { logradouro, numero } = pedacos.length >= 3 ? separarEndereco(pedacos[0]) : { logradouro: null, numero: null };
    im.endereco.logradouro = limparLogradouro(logradouro);
    im.endereco.numero = numero;
    im.endereco.numero_informado = Boolean(numero);
  }

  const campo = (rotulo) => {
    const m = html.match(new RegExp(`<li><span>${rotulo}</span>([^<]+)`, "i"));
    return m ? decodificar(m[1]).trim() : null;
  };
  const dep = (rotulo) => {
    const m = html.match(new RegExp(`(\\d+)\\s*<span>${rotulo}`, "i"));
    return m ? Number(m[1]) : null;
  };

  const tipo = tipoFlow(campo("Tipo Imóvel")) || im.tipo;
  im.tipo = tipo;
  const construida = numeroBR(campo("Área Construída")) ?? numeroBR(campo("Área Privativa")) ?? numeroBR(campo("Área Útil")) ?? numeroBR(campo("Área Total"));
  const terreno = numeroBR(campo("Área Terreno")) ?? numeroBR(campo("Área do Terreno"));
  if (tipo === "terreno") {
    im.area_construida_m2 = null;
    im.area_terreno_m2 = ouNulo(terreno ?? numeroBR(campo("Área Total")));
  } else {
    im.area_construida_m2 = ouNulo(construida) ?? im.area_construida_m2;
    im.area_terreno_m2 = tipo === "apartamento" ? null : ouNulo(terreno);
    im.dormitorios = dep("Dormitório\\(s\\)") ?? im.dormitorios;
    im.suites = dep("Suíte\\(s\\)") ?? im.suites;
    im.banheiros = ouNulo(dep("Banheiro\\(s\\)"));
    im.vagas_total = dep("Vaga\\(s\\)") ?? im.vagas_total;
  }

  const classificacao = campo("Classificação") || "";
  const temCondominio = /condom[ií]nio/i.test(classificacao) || /<span>Condom[ií]nio<\/span>/i.test(html) || tipo === "apartamento";
  im.condominio = classificacao || tipo === "apartamento" ? temCondominio : im.condominio;
  im.detalhe_coletado = true;
}

async function conectorFlow({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const vistos = new Map();
  let contato = { nome: null, telefone: null };
  let paginasLidas = 0;
  let algumaReconhecida = false;

  for (const base of urlsBuscaFlow(filtros)) {
    for (let pag = 1; pag <= cfg.max_paginas && paginasLidas < cfg.max_paginas * 3; pag++) {
      const html = String(await get(pag === 1 ? base : `${base}/pag_${pag}`, { headers: { "User-Agent": UA } }));
      paginasLidas++;
      if (!contato.nome) contato = contatoFlow(html);
      const { cards, temProxima, paginaReconhecida } = parseCardsFlow(html);
      algumaReconhecida ||= paginaReconhecida;
      for (const c of cards) if (!vistos.has(c.url)) vistos.set(c.url, imovelDeCardFlow(c, contato));
      if (!temProxima || cards.length === 0) break;
    }
  }

  if (!algumaReconhecida) throw Object.assign(new Error("Possível mudança de layout: página de busca não reconhecida"), { codigo: "LAYOUT" });

  const imoveis = [...vistos.values()].filter((i) => i.tipo && filtros.tipos.includes(i.tipo));
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar).slice(0, cfg.max_detalhes);
  log(`flow: ${imoveis.length} imóveis em ${paginasLidas} páginas; abrindo ${paraDetalhar.length} detalhes`);
  for (const im of paraDetalhar) {
    if (sinal.abortado) break;
    try {
      aplicarDetalheFlow(im, String(await get(im.url_anuncio, { headers: { "User-Agent": UA } })));
    } catch (e) {
      log(`flow: falha no detalhe ${im.url_anuncio}: ${e.message}`);
    }
  }
  return imoveis;
}

// ======================================================================
// Kikina Imóveis — plataforma CasaSoft, API JSON pública usada pelo próprio site
// ======================================================================

const KIKINA = {
  id: "kikina",
  nome: "Kikina Imóveis",
  base: "https://www.kikina.com.br",
  api: "https://apiimoveisv3.casasoftsig.com/api/v3/imoveis/pesquisa",
  clienteId: 2950,
  contato: "(42) 99851-0022",
  tipos: {
    casa: ["Casa Residencial", "Sobrado", "Casa em Condomínio"],
    apartamento: ["Apartamento", "Kitinet.", "Flat"],
    terreno: ["Terreno"],
  },
};

function tipoKikina(desc) {
  for (const [tipo, lista] of Object.entries(KIKINA.tipos)) if (lista.includes(desc)) return tipo;
  return null;
}

const LOGRADOUROS = { aveni: "Avenida", aven: "Avenida", av: "Avenida", rua: "Rua", r: "Rua", trave: "Travessa", alame: "Alameda", rodov: "Rodovia", estra: "Estrada", praca: "Praça", pç: "Praça" };

function dataBR(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m && m[3] !== "0001" ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function urlKikina(r) {
  // Mesmo formato de link que o site monta (o servidor só exige id e ref; o slug é descritivo).
  const partes = [
    slug(r.tipoImovelDescricao),
    r.imovelQuartos ? `${r.imovelQuartos}-quartos` : "",
    r.imovelEnderecoBairro ? slug(r.imovelEnderecoBairro) : "",
    r.imovelEnderecoCidade ? slug(r.imovelEnderecoCidade) : "",
    r.imovelVagas ? "com-garagem" : "",
    r.imovelAreaTotal ? `${Math.floor(r.imovelAreaTotal)}m2` : "",
    `venda-rs-${r.imovelValorVenda}`,
  ].filter(Boolean);
  return `${KIKINA.base}/imovel/${partes.join("-")}?id=${r.clienteId}&ref=${encodeURIComponent(r.imovelReferencia)}&search=0`;
}

function imovelDeApiKikina(r) {
  const tipo = tipoKikina(r.tipoImovelDescricao);
  const prefixo = LOGRADOUROS[slug(r.imovelTipoEndereco || "").replace(/-/g, "")] || (r.imovelTipoEndereco || "").trim();
  const logradouro = r.imovelEndereco ? `${prefixo ? prefixo + " " : ""}${r.imovelEndereco.trim()}` : null;
  const numero = r.imovelEnderecoNumero && /\d/.test(r.imovelEnderecoNumero) ? String(r.imovelEnderecoNumero).trim() : null;
  const corretor = (String(r.imovelPontosFortes || "").match(/Corretor[a]?\s+([^#]+?)\s*#13/i) || [])[1] || null;
  const util = ouNulo(r.imovelAreaUtil);
  const total = ouNulo(r.imovelAreaTotal);
  const foto = r.urlFotoPrincipal || null;

  return imovelBase(
    { id: KIKINA.id, nome: KIKINA.nome, contato: KIKINA.contato, informante: corretor },
    {
      id: `kikina-${r.imovelReferencia}`,
      url_anuncio: urlKikina(r),
      titulo: `${r.tipoImovelDescricao}${r.imovelQuartos ? ` ${r.imovelQuartos} quartos` : ""} – ${r.imovelEnderecoBairro || ""}`.trim(),
      tipo,
      endereco: { logradouro, numero, numero_informado: Boolean(numero), bairro: r.imovelEnderecoBairro || null, cidade: r.imovelEnderecoCidade || "Ponta Grossa", uf: r.imovelEnderecoEstado || "PR" },
      // CasaSoft: AreaUtil = construída/privativa; AreaTotal = terreno (casa/terreno) ou total (apto).
      area_construida_m2: tipo === "terreno" ? null : tipo === "apartamento" ? util ?? total : util,
      area_terreno_m2: tipo === "apartamento" ? null : total,
      preco_total: ouNulo(r.imovelValorVenda),
      dormitorios: tipo === "terreno" ? null : ouNulo(r.imovelQuartos),
      suites: tipo === "terreno" ? null : ouNulo(r.imovelSuites),
      banheiros: tipo === "terreno" ? null : ouNulo(r.imovelBanheiros),
      vagas_total: tipo === "terreno" ? null : ouNulo(r.imovelVagas),
      condominio: tipo === "apartamento" || r.tipoImovelDescricao === "Casa em Condomínio" || r.imovelCondominio === 1 ? true : r.imovelCondominio === 0 ? false : null,
      fotos: foto ? [foto] : [],
      foto_capa: foto,
      data_anuncio: dataBR(r.imovelDataIncluido),
      codigo_comum: null,
      _imovelId: r.imovelId,
    },
  );
}

function aplicarDetalheKikina(im, html) {
  const id = im._imovelId;
  const re = new RegExp(`https://fotos2\\.casasoft\\.net\\.br/indicadordeimoveis/imobiliarias/\\d+/fotos/${id}/[^"'\\s)]+?\\.(?:jpe?g|png|webp)`, "gi");
  const fotos = [...new Set(html.match(re) || [])];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const canonica = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (canonica) im.url_anuncio = decodificar(canonica);

  // Blocos "Características"/"Dependências": pares "Rótulo: valor" (ex.: "BWC Social: 2", "Garagem: 1 vaga").
  const ini = html.indexOf("Características");
  const fim = html.indexOf("Imóvel atualizado", ini);
  const bloco = ini > 0 ? html.slice(ini, fim > ini ? fim : ini + 20000) : "";
  const pares = decodificar(bloco.replace(/<[^>]+>/g, "|"))
    .split("|")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .map((x) => x.match(/^([^:]{2,40}):\s*(.+)$/))
    .filter(Boolean)
    .map((m) => [slug(m[1]), m[2]]);
  const soma = (re) => {
    const v = pares.filter(([k]) => re.test(k)).map(([, val]) => numeroBR(val)).filter((n) => n !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const um = (re) => soma(re);

  if (im.tipo !== "apartamento") im.area_terreno_m2 = ouNulo(um(/^area-do-terreno$|^area-terreno$/)) ?? im.area_terreno_m2;
  if (im.tipo !== "terreno") {
    im.area_construida_m2 = ouNulo(um(/^area-construida$|^area-util$|^area-privativa$/)) ?? im.area_construida_m2;
    im.banheiros = ouNulo(soma(/^bwc|^banheiro/)) ?? im.banheiros;
    im.suites = ouNulo(um(/^suites?$/)) ?? im.suites;
    im.vagas_total = im.vagas_total ?? ouNulo(um(/^garagem$|^vagas?$/));
    im.pavimentos = ouNulo(um(/^pavimentos?$|^andares$/)) ?? im.pavimentos;
  }
  im.detalhe_coletado = true;
}

async function conectorKikina({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  // Sem URLSearchParams: nem todo sandbox do nó Code expõe esse global.
  const params = new Parametros({
    "filtro.clienteid": String(KIKINA.clienteId),
    "filtro.tipodivulgacao": "v",
    "filtro.cidade": "Ponta Grossa",
    "filtro.tiposimoveis": [...new Set(filtros.tipos.flatMap((t) => KIKINA.tipos[t] || []))].join(","),
    ordenacao: "imovelvalor",
    ascdesc: "asc",
  });
  if (filtros.bairros.length) params.set("filtro.bairro", filtros.bairros.join(","));
  if (filtros.preco_total.min != null) params.set("filtro.valorminimo", String(Math.round(filtros.preco_total.min)));
  if (filtros.preco_total.max != null) params.set("filtro.valormaximo", String(Math.round(filtros.preco_total.max)));

  const porPagina = 100;
  const brutos = [];
  for (let pag = 1; pag <= cfg.max_paginas; pag++) {
    params.set("pagina", String(pag));
    params.set("maximo", String(porPagina));
    let resp = await get(`${KIKINA.api}?${params}`, { headers: { "User-Agent": UA, Referer: `${KIKINA.base}/`, Accept: "application/json" }, json: true });
    if (typeof resp === "string") resp = JSON.parse(resp);
    if (!resp || !resp.data || !Array.isArray(resp.data.resultado))
      throw Object.assign(new Error("Possível mudança na API: resposta sem data.resultado"), { codigo: "LAYOUT" });
    brutos.push(...resp.data.resultado);
    if (brutos.length >= resp.data.total || resp.data.resultado.length < porPagina) break;
  }

  const imoveis = brutos.filter((r) => r.imovelVenda).map(imovelDeApiKikina).filter((i) => i.tipo);
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar).slice(0, cfg.max_detalhes);
  log(`kikina: ${imoveis.length} imóveis na API; abrindo ${paraDetalhar.length} detalhes`);
  for (const im of paraDetalhar) {
    if (sinal.abortado) break;
    try {
      aplicarDetalheKikina(im, String(await get(im.url_anuncio, { headers: { "User-Agent": UA } })));
    } catch (e) {
      log(`kikina: falha no detalhe ${im.url_anuncio}: ${e.message}`);
    }
  }
  for (const im of imoveis) delete im._imovelId;
  return imoveis;
}

// ======================================================================
// Execução de todas as fontes em paralelo, com timeout por fonte (6.3)
// ======================================================================

const CONECTORES = { flow: conectorFlow, kikina: conectorKikina };
const NOMES = { flow: FLOW.nome, kikina: KIKINA.nome, adquira: "Adquira Imóveis", torre_branca: "Torre Branca", quintoandar: "QuintoAndar" };

async function coletarFontes({ requisicao, http, timeoutFonteMs, config, avaliar, log = () => {} }) {
  const resultados = await Promise.all(
    requisicao.fontes.map(async (fonteId) => {
      const nome = NOMES[fonteId] || fonteId;
      const conector = CONECTORES[fonteId];
      if (!conector)
        return { fonte: { id: fonteId, nome, status: "erro", mensagem: "Conector ainda não implementado", itens: 0 }, imoveis: [], erro: { fonte: fonteId, codigo: "SEM_CONECTOR", mensagem: `${nome}: conector ainda não implementado` } };

      const cfg = { ...CONFIG_PADRAO, ...(config && config[fonteId]) };
      const sinal = { abortado: false };
      let timer;
      const inicio = Date.now();
      try {
        const imoveis = await Promise.race([
          conector({ filtros: requisicao.filtros, http, cfg, sinal, avaliar, log }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`A fonte não respondeu em ${Math.round(timeoutFonteMs / 1000)} segundos`), { codigo: "TIMEOUT" })), timeoutFonteMs); }),
        ]);
        log(`${fonteId}: ok em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
        return { fonte: { id: fonteId, nome, status: "ok", itens: imoveis.length }, imoveis, erro: null };
      } catch (e) {
        sinal.abortado = true;
        const codigo = e.codigo || "ERRO_COLETA";
        const mensagem = codigo === "TIMEOUT" ? "Tempo esgotado" : e.message;
        log(`${fonteId}: erro ${codigo} – ${e.message}`);
        return { fonte: { id: fonteId, nome, status: "erro", mensagem, itens: 0 }, imoveis: [], erro: { fonte: fonteId, codigo, mensagem: `${nome}: ${e.message}` } };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return {
    fontes: resultados.map((r) => r.fonte),
    imoveis: resultados.flatMap((r) => r.imoveis),
    erros: resultados.map((r) => r.erro).filter(Boolean),
  };
}


const logs = [];
const inicio = Date.now();
try {
  if (typeof Regras.processarImoveis !== "function" || typeof Regras.avaliarCriterios !== "function")
    throw new Error("Regras não carregadas no nó Code (gere o JSON de novo com node build.mjs)");
  const coleta = await coletarFontes({
    requisicao: req,
    http,
    timeoutFonteMs: TIMEOUT_FONTE_MS,
    config: CONFIG_FONTES,
    avaliar: Regras.avaliarCriterios,
    log: (m) => logs.push("[" + ((Date.now() - inicio) / 1000).toFixed(1) + "s] " + m),
  });
  const { imoveis, resumo } = Regras.processarImoveis(coleta.imoveis, req.filtros);
  const ok = coleta.fontes.filter((f) => f.status === "ok").length;
  const status = ok === 0 ? "erro" : ok < coleta.fontes.length ? "parcial" : "concluido";
  return [{
    json: {
      requisicao_id: req.requisicao_id,
      status,
      fontes_status: coleta.fontes,
      resposta: { requisicao_id: req.requisicao_id, status, gerado_em: new Date().toISOString(), fontes: coleta.fontes, resumo, imoveis, erros: coleta.erros },
      logs,
    },
  }];
} catch (e) {
  logs.push("erro geral: " + e.message);
  const fontes = req.fontes.map((id) => ({ id, nome: id, status: "erro", mensagem: e.message, itens: 0 }));
  return [{
    json: {
      requisicao_id: req.requisicao_id,
      status: "erro",
      fontes_status: fontes,
      resposta: { requisicao_id: req.requisicao_id, status: "erro", gerado_em: new Date().toISOString(), fontes, imoveis: [], erros: [{ fonte: "*", codigo: "ERRO_INTERNO", mensagem: e.message }] },
      logs,
    },
  }];
}