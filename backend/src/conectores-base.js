// Utilitários compartilhados pelos conectores (Ponta Grossa e Curitiba): cliente HTTP com ritmo,
// leitura de números/áreas no formato brasileiro, texto do anúncio, tipo de imóvel e montagem do imóvel base.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 BuscaImoveisPG/1.0 (Agencia Byte)";

const CONFIG_PADRAO = {
  max_paginas: 10,       // 6.3 limite de páginas de resultado por fonte
  max_detalhes: 50,      // páginas de detalhe abertas por fonte (galeria completa)
  intervalo_ms: 1000,    // 6.3 ritmo: 1 a 2 s entre requisições à mesma fonte
  timeout_req_ms: 20000,
};

// Ajustes por fonte que valem sempre (o parâmetro `config` de coletarFontes ainda pode sobrescrever).
const CONFIG_POR_FONTE = {
  madol: { intervalo_ms: 2000, max_detalhes: 25 }, // tem WAF com captcha: ritmo mais lento
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** true quando a busca é de imóveis para alugar (filtros.finalidade = "locacao"); o padrão é venda. */
const ehLocacao = (filtros) => Boolean(filtros && filtros.finalidade === "locacao");

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
        // Proteção anti-robô (captcha/WAF): não tenta contornar; interrompe a fonte com motivo claro.
        if (Number(status) === 405 || Number(status) === 429 || /captcha|human verification/i.test(String(e.message)))
          throw Object.assign(new Error("o site pediu verificação humana (anti-robô); coleta interrompida — tente mais tarde"), { codigo: "BLOQUEADO" });
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
    area_lazer: null,
    piscina: null,
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

// ----------------------------------------------------------------------
// Texto livre do anúncio (descrição + listas de características). Muitos anúncios só citam
// piscina, churrasqueira ou a medida do terreno ("Terreno medindo 14x33m") no texto.
// ----------------------------------------------------------------------

const RE_PISCINA = /piscinas?|\bpool\b/gi;
const RE_LAZER = /churrasqueiras?|\bbbq\b|barbecue|[áa]rea de lazer|recreation area|(?:espa[çc]o|[áa]rea|varanda) gourmet|gourmet space|sal[ãa]o de festas|quiosques?/gi;
// "possibilidade de construção de piscina", "espaço para instalação de piscina", "sem piscina"…
const SO_POTENCIAL = /(?:possibilidade|possibilita|permite|espa[çc]o|prepara[çc][ãa]o|preparad[oa]|projeto|sem|n[ãa]o\s+(?:possui|tem|h[áa])|construir|constru[çc][ãa]o|instala[çc][ãa]o|instalar|implanta[çc][ãa]o|implantar|fazer)\s+(?:(?:de|da|do|para|pra|p\/|a|uma|um|construir|constru[çc][ãa]o|instala[çc][ãa]o|instalar|implanta[çc][ãa]o|implantar|fazer|lazer|ou|e)\s+){0,5}$/i;
// "Piscina: Não", "Churrasqueira: 0"
const NEGADO_DEPOIS = /^\s*[:\-–]?\s*(?:n[ãa]o\b|0\b)/i;

/** true se o texto cita o item como existente (descarta "espaço para piscina", "Piscina: Não"). */
function citaItem(texto, re) {
  for (const m of texto.matchAll(re)) {
    const antes = texto.slice(Math.max(0, m.index - 80), m.index);
    const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 10);
    if (!SO_POTENCIAL.test(antes) && !NEGADO_DEPOIS.test(depois)) return true;
  }
  return false;
}

const NUM_AREA = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)(?![\\d.,])(?!\\s*m?\\s*[xX×]\\s*\\d)";
const RE_TERRENO_ROTULO = new RegExp(`[áa]rea\\s+(?:total\\s+)?(?:d[oe]\\s+)?terreno\\s*:?\\s*(?:de\\s+)?(?:aprox\\.?\\s*|aproximadamente\\s+)?${NUM_AREA}`, "gi");
const RE_TERRENO_M2 = new RegExp(`\\bterreno\\s+(?:total\\s+)?(?:de|com|medindo|possui)?\\s*(?:aprox\\.?\\s*|aproximadamente\\s+|cerca de\\s+)?${NUM_AREA}\\s*(?:m²|m2|mts|metros|m\\b)`, "gi");
// "14,80m x 23m (340m²)": se a área vier entre parênteses, vale ela (o produto das medidas é aproximado).
const RE_TERRENO_MEDIDAS = /\b(?:terreno|lote)\b[^.;|\n]{0,60}?(\d+(?:[.,]\d+)?)\s*(?:m|mts|metros)?\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:m\b|mts|metros)?\s*(?:\(\s*([\d.,]+)\s*m[²2]\s*\))?/gi;

/** Área do terreno citada no texto: "terreno de 462m²", "Área do terreno: 660,00 m²", "terreno medindo 14x33". */
function terrenoDoTexto(texto) {
  // "2 terrenos de 462 m2 (14x33) cada": a soma não dá para inferir com segurança.
  if (/\b(?:\d+|dois|duas|tr[êe]s)\s+(?:terrenos|lotes)\b/i.test(texto)) return null;
  const citados = [];
  for (const re of [RE_TERRENO_ROTULO, RE_TERRENO_M2]) for (const m of texto.matchAll(re)) citados.push(area(m[1]));
  for (const m of texto.matchAll(RE_TERRENO_MEDIDAS)) {
    const [frente, fundo] = [Number(m[1].replace(",", ".")), Number(m[2].replace(",", "."))];
    if (frente >= 3 && fundo >= 3 && frente <= 500 && fundo <= 500) citados.push(m[3] ? area(m[3]) : Math.round(frente * fundo * 100) / 100);
  }
  const validos = citados.filter((n) => n && n >= 40 && n <= 200000);
  if (!validos.length) return null;
  // Valores que não batem entre si (ex.: dois terrenos citados) ficam de fora.
  return validos.every((n) => Math.abs(n - validos[0]) <= validos[0] * 0.03) ? validos[0] : null;
}

/**
 * Completa o imóvel com o que só aparece no texto do anúncio. Pode ser chamada mais de uma vez
 * (ex.: descrição da API e depois a página): uma citação positiva sempre vale; "Não" só onde estava vazio.
 * Terreno: só preenche quando a fonte não informou o campo.
 */
function lerTextoAnuncio(im, texto) {
  const t = String(texto || "").replace(/\s+/g, " ");
  if (t.length < 30) return;
  if (im.tipo !== "terreno") {
    const piscina = citaItem(t, RE_PISCINA);
    const lazer = piscina || citaItem(t, RE_LAZER);
    im.piscina = piscina || (im.piscina ?? false);
    im.area_lazer = lazer || (im.area_lazer ?? false);
  }
  if (im.tipo !== "apartamento" && im.area_terreno_m2 == null) im.area_terreno_m2 = terrenoDoTexto(t);
}

/** Atributos booleanos dos sites em Next.js ("pool", "gourmet-space") viram texto para lerTextoAnuncio. */
const chavesVerdadeiras = (pares) => pares.filter(([, v]) => v === true || v === "True" || v === "true").map(([k]) => String(k).replace(/-/g, " ")).join(" | ");

/** Ordena os candidatos: primeiro os que não reprovam em nenhum critério com os dados do card. */
function priorizarDetalhes(imoveis, filtros, avaliar) {
  return imoveis
    .map((im, i) => ({ im, i, ruim: avaliar(im, filtros).criterios.filter((c) => c.resultado === "nao_atende").length }))
    .sort((a, b) => a.ruim - b.ruim || a.i - b.i)
    .filter((x) => x.ruim === 0)
    .map((x) => x.im);
}

const ENTIDADES = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  acirc: "â", ecirc: "ê", ocirc: "ô", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", atilde: "ã", otilde: "õ", Atilde: "Ã", Otilde: "Õ",
  ccedil: "ç", Ccedil: "Ç", agrave: "à", Agrave: "À", ordm: "º", ordf: "ª", deg: "°", sup2: "²", nbsp: " ",
};

/** Texto da página com as tags trocadas por " | " (facilita casar "3 | Quartos"). */
function textoPipes(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " | ")
    .replace(/&([a-zA-Z]+\d?);/g, (m, n) => ENTIDADES[n] ?? decodificar(m))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/(\s*\|\s*)+/g, " | ");
}

/** Bytes → texto ISO-8859-1 (cada byte é um caractere). Sem Buffer/TextDecoder, que nem todo sandbox tem. */
function latin1(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return s;
}

/** Área: aceita "1.006,00", "127.10" e "120". */
function area(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t);
  return numeroBR(t);
}

const NAO_RESIDENCIAL = /(^|-)(comercial|barracao|galpao|armazem|sala|loja|ponto|predio|chacara|sitio|fazenda|rural|area-rural|industrial|hotel|pousada|garagem|box)(-|$)/;

/** Tipo do contrato a partir de um texto livre (rótulo ou slug do link). */
function tipoDeTexto(s) {
  const t = slug(s || "");
  if (/(^|-)(apartamento|cobertura|kitnet|kitinet|kitinete|studio|flat|loft|duplex)(-|$)/.test(t)) return "apartamento";
  if (NAO_RESIDENCIAL.test(t)) return null;
  if (/(^|-)(terreno|lote|loteamento)(-|$)/.test(t)) return "terreno";
  if (/(^|-)(casa|sobrado|residencia|condominio-fechado|geminado)(-|$)/.test(t)) return "casa";
  return null;
}

/** true se não há filtro de bairro ou se o bairro (ou o slug do link) contém um dos pedidos. */
function bairroPedido(filtros, texto) {
  if (!filtros.bairros.length) return true;
  const alvo = `-${slug(texto || "")}-`;
  return filtros.bairros.some((b) => alvo.includes(`-${slug(b)}-`));
}

const deSlug = (s) => String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || null;

/** Primeiro número que aparece antes de um rótulo no texto com pipes: "3 | Quartos". */
function antesDe(texto, rotulo) {
  const m = texto.match(new RegExp(`(\\d+)\\s*\\|?\\s*${rotulo}`, "i"));
  return m ? Number(m[1]) : null;
}

function parseJsonSeguro(s) {
  try {
    return JSON.parse(s.replace(/[\u0000-\u001F]+/g, " "));
  } catch {
    return null;
  }
}

/** Lê um objeto JSON balanceado começando em `inicio` (para extrair dados embutidos em scripts). */
function objetoJson(txt, inicio) {
  let prof = 0, emString = false, escape = false;
  for (let i = inicio; i < txt.length; i++) {
    const c = txt[i];
    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emString = false;
    } else if (c === '"') emString = true;
    else if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return parseJsonSeguro(txt.slice(inicio, i + 1));
  }
  return null;
}

function erroLayout(msg) {
  return Object.assign(new Error(`Possível mudança de layout: ${msg}`), { codigo: "LAYOUT" });
}

/** Abre os anúncios em sequência (respeitando o ritmo) e aplica `aplicar` em cada um. */
async function abrirDetalhes(def, lista, { get, cfg, sinal, log }, aplicar, opcoes = {}) {
  for (const im of lista.slice(0, cfg.max_detalhes)) {
    if (sinal.abortado) break;
    try {
      const bruto = await get(im.url_anuncio, { headers: { "User-Agent": UA }, ...opcoes });
      aplicar(im, opcoes.binario ? latin1(bruto) : String(bruto));
    } catch (e) {
      log(`${def.id}: falha no detalhe ${im.url_anuncio}: ${e.message}`);
    }
  }
}

export {
  UA,
  ehLocacao,
  CONFIG_PADRAO,
  CONFIG_POR_FONTE,
  dormir,
  decodificar,
  textoLimpo,
  numeroBR,
  ouNulo,
  slug,
  separarEndereco,
  limparLogradouro,
  Parametros,
  cliente,
  imovelBase,
  RE_PISCINA,
  RE_LAZER,
  SO_POTENCIAL,
  NEGADO_DEPOIS,
  citaItem,
  NUM_AREA,
  RE_TERRENO_ROTULO,
  RE_TERRENO_M2,
  RE_TERRENO_MEDIDAS,
  terrenoDoTexto,
  lerTextoAnuncio,
  chavesVerdadeiras,
  priorizarDetalhes,
  ENTIDADES,
  textoPipes,
  latin1,
  area,
  NAO_RESIDENCIAL,
  tipoDeTexto,
  bairroPedido,
  deSlug,
  antesDe,
  parseJsonSeguro,
  objetoJson,
  erroLayout,
  abrirDetalhes,
};
