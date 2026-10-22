// ======================================================================
// Utilitários dos conectores HTML/JSON adicionais
// ======================================================================

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

// ======================================================================
// Imobiliária Casa Top — plataforma Jetimob (Next.js). Os imóveis vêm completos
// (inclusive todas as fotos) no __NEXT_DATA__ da listagem: não precisa abrir anúncio.
// /imoveis?type=Casa/Sobrado&operation=sale&district=Uvaranas&order=price-asc&page=2
// ======================================================================

const CASATOP = {
  id: "casatop",
  nome: "Imobiliária Casa Top",
  base: "https://imobiliariacasatop.com.br",
  contato: "(42) 99992-4545",
  tipos: { casa: ["Casa/Sobrado"], apartamento: ["Apartamento"], terreno: ["Terreno/Lote"] },
};

/** "Ponta Grossa - PR" → "Ponta Grossa". */
const semUf = (c) => String(c || "").replace(/\s*-\s*[A-Za-z]{2}$/, "");

function nextData(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw erroLayout("página sem __NEXT_DATA__");
  const d = parseJsonSeguro(m[1]);
  if (!d || !d.props || !d.props.pageProps) throw erroLayout("__NEXT_DATA__ sem pageProps");
  return d.props.pageProps;
}

function imovelCasaTop(p) {
  const at = (k) => {
    const a = (p.attributes || []).find((x) => x.key === k);
    return a ? a.value : null;
  };
  const tipo = tipoDeTexto(`${p.type || ""} ${p.subtype || ""}`) || tipoDeTexto(p.title);
  const fotos = ((p.media && p.media.pictures) || [])
    // "display: false" não esconde a foto no site (o anúncio mostra todas): usa todas.
    .filter((f) => f.src)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((f) => f.src);
  const construida = ouNulo(at("area_util")) ?? ouNulo(at("total-area"));
  const terreno = ouNulo(at("land-area"));
  const emCondominio = Boolean(at("condominio-nome")) || at("em-condominio") === true || tipo === "apartamento";
  const im = imovelBase(
    { id: CASATOP.id, nome: CASATOP.nome, contato: CASATOP.contato, informante: null },
    {
      id: `casatop-${p.reference}`,
      url_anuncio: `${CASATOP.base}/imovel/${encodeURIComponent(p.reference)}`,
      titulo: p.title || `${p.subtype || p.type} – ${at("district") || ""}`,
      tipo,
      endereco: { logradouro: at("street") || null, numero: at("number") ? String(at("number")) : null, numero_informado: Boolean(at("number")), bairro: at("district") || null, cidade: at("city") || "Ponta Grossa", uf: at("state") || "PR" },
      area_construida_m2: tipo === "terreno" ? null : construida,
      area_terreno_m2: tipo === "apartamento" ? null : tipo === "terreno" ? terreno ?? ouNulo(at("total-area")) : terreno,
      preco_total: ouNulo(at("valor_venda")),
      dormitorios: tipo === "terreno" ? null : ouNulo(at("bedrooms")),
      suites: tipo === "terreno" ? null : ouNulo(at("suites")),
      banheiros: tipo === "terreno" ? null : ouNulo(at("bathrooms")),
      vagas_total: tipo === "terreno" ? null : ouNulo(at("garage")),
      condominio: emCondominio ? true : at("em-condominio") === false ? false : null,
      fotos,
      foto_capa: fotos[0] || null,
      data_anuncio: p.created_at ? String(p.created_at).slice(0, 10) : null,
      detalhe_coletado: true,
    },
  );
  lerTextoAnuncio(im, textoJetimob(p));
  return im;
}

/** Descrição + atributos marcados (piscina, churrasqueira, gourmet-space…) de um imóvel Jetimob. */
const textoJetimob = (p) => `${p.description || ""} | ${chavesVerdadeiras((p.attributes || []).map((a) => [a.key, a.value]))} | ${p.tags || ""}`;

// Listagem com os imóveis completos no __NEXT_DATA__ (Casa Top e Montoro): `def` traz base e tipos do site.
const criarConectorListagemNext = (def, imovelDe) => async function conectorListagemNext({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => def.tipos[t] || []))]) {
    const base = `${def.base}/imoveis?type=${encodeURIComponent(tipoSite)}&operation=sale&order=price-asc`;
    const primeira = nextData(await get(base, { headers: { "User-Agent": UA } }));
    paginas++;
    // O filtro exige o nome exato do bairro como o site grava ("Orfãs", "Cará-cará"...): usa a lista da própria página.
    let distritos = [null];
    if (filtros.bairros.length) {
      distritos = (primeira.districts || [])
        .filter((d) => slug(semUf(d.city)) === "ponta-grossa" && bairroPedido(filtros, d.name))
        .map((d) => d.name);
      if (!distritos.length) continue;
    }
    for (const distrito of distritos) {
      const url = distrito ? `${base}&district=${encodeURIComponent(distrito)}` : base;
      for (let pag = 1; pag <= cfg.max_paginas; pag++) {
        const pp = !distrito && pag === 1 ? primeira : nextData(await get(`${url}&page=${pag}`, { headers: { "User-Agent": UA } }));
        if (distrito || pag > 1) paginas++;
        for (const p of pp.properties || []) if (p.operation === "sale" && !vistos.has(p.reference)) vistos.set(p.reference, imovelDe(p));
        const info = pp.pageInfo || {};
        if (!info.total || pag >= info.total) break;
      }
    }
  }
  const imoveis = [...vistos.values()].filter(
    (i) => i.tipo && filtros.tipos.includes(i.tipo) && slug(i.endereco.cidade) === "ponta-grossa" && bairroPedido(filtros, i.endereco.bairro),
  );
  log(`${def.id}: ${imoveis.length} imóveis em ${paginas} páginas (dados e fotos já vêm na listagem)`);
  return imoveis;
};

const conectorCasaTop = criarConectorListagemNext(CASATOP, imovelCasaTop);

// ======================================================================
// Montoro Imóveis — mesma listagem __NEXT_DATA__ da Casa Top (/imoveis?type=…&operation=sale),
// com os atributos em outras chaves. Não publica logradouro nem área do terreno.
// ======================================================================

const MONTORO = {
  id: "montoro",
  nome: "Montoro Imóveis",
  base: "https://montoroimoveis.com.br",
  contato: "(42) 99147-0703",
  tipos: { casa: ["Casa"], apartamento: ["Apartamento"], terreno: ["Terreno"] },
};

function imovelMontoro(p) {
  const at = (k) => {
    const a = (p.attributes || []).find((x) => x.key === k);
    return a ? a.value : null;
  };
  const tipo = tipoDeTexto(`${p.type || ""} ${p.subtype || ""}`) || tipoDeTexto(p.title);
  const fotos = ((p.media && p.media.pictures) || []).map((f) => f.src).filter(Boolean);
  const construida = ouNulo(area(at("constructed-area"))) ?? ouNulo(area(at("util-area"))) ?? ouNulo(area(at("private-area")));
  const ref = String(p.reference).replace(/^REF-/, "");
  // Alguns anúncios não preenchem o bairro, mas o endereço completo vem como "Estrela, Ponta Grossa - PR".
  const bairroDoEndereco = (String(at("full-address") || "").match(/^(.+?),\s*[^,]+\s-\s[A-Z]{2}$/) || [])[1];
  const emCondominio = at("em-condominio") === true || at("in-condominium") === true || tipo === "apartamento";
  const im = imovelBase(
    { id: MONTORO.id, nome: MONTORO.nome, contato: MONTORO.contato, informante: null },
    {
      id: `montoro-${ref}`,
      url_anuncio: `${MONTORO.base}/imovel/${encodeURIComponent(ref)}`,
      titulo: p.title || `${p.subtype || p.type} – ${at("district") || ""}`,
      tipo,
      endereco: {
        logradouro: at("address-street") || null,
        numero: at("address-number") ? String(at("address-number")) : null,
        numero_informado: Boolean(at("address-number")),
        bairro: at("district") || bairroDoEndereco || null,
        cidade: semUf(at("city")) || "Ponta Grossa",
        uf: "PR",
      },
      area_construida_m2: tipo === "terreno" ? null : construida,
      area_terreno_m2: tipo === "terreno" ? ouNulo(area(at("total-area"))) ?? ouNulo(area(at("land-area"))) : null,
      preco_total: ouNulo(at("value")),
      dormitorios: tipo === "terreno" ? null : ouNulo(at("bedrooms")),
      suites: tipo === "terreno" ? null : ouNulo(at("suites")),
      banheiros: tipo === "terreno" ? null : ouNulo(at("bathrooms")),
      vagas_total: tipo === "terreno" ? null : ouNulo(at("garage")),
      condominio: emCondominio ? true : null,
      fotos,
      foto_capa: fotos[0] || null,
      data_anuncio: p.created_at ? String(p.created_at).slice(0, 10) : null,
      detalhe_coletado: true,
    },
  );
  lerTextoAnuncio(im, textoJetimob(p));
  return im;
}

const conectorMontoro = criarConectorListagemNext(MONTORO, imovelMontoro);

// ======================================================================
// Clássica Imóveis — plataforma Techbins (Next.js App Router).
// A listagem só traz a 1ª página no HTML (o resto vem de /api/, que o robots.txt proíbe),
// então a lista de anúncios sai do sitemap (/sitemap/property) e os dados, de cada anúncio.
// ======================================================================

const CLASSICA = { id: "classica", nome: "Clássica Imóveis", base: "https://classicaimoveis.com.br", contato: "(42) 3225-1015" };

function rscTexto(html) {
  let txt = "";
  for (const m of String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      txt += JSON.parse(`"${m[1]}"`);
    } catch {
      /* fragmento ilegível: ignora */
    }
  }
  return txt;
}

function aplicarDetalheClassica(im, html) {
  const txt = rscTexto(html);
  // A página tem mais de um objeto com a mesma referência (um resumo e o completo): fica com o mais completo.
  let obj = null;
  for (const m of txt.matchAll(/\{"id":"ppt_/g)) {
    const bruto = objetoJson(txt, m.index);
    // Dois formatos na mesma plataforma: campos na raiz ou dentro de "values".
    const o = bruto && bruto.values && typeof bruto.values === "object" ? { ...bruto, ...bruto.values } : bruto;
    if (o && String(o.reference) === im._ref && (!obj || Object.keys(o).length > Object.keys(obj).length)) obj = o;
  }
  if (!obj) throw erroLayout("anúncio sem objeto do imóvel");
  const tipo = tipoDeTexto(obj.type) || im.tipo;
  const fotos = (obj["media.pictures"] || (obj.media && obj.media.pictures) || []).map((f) => f.src).filter(Boolean);
  Object.assign(im, {
    titulo: (obj.title || im.titulo).trim(),
    tipo,
    preco_total: ouNulo(obj.value),
    area_construida_m2: tipo === "terreno" ? null : ouNulo(area(obj["constructed-area"])) ?? ouNulo(area(obj["private-area"])),
    area_terreno_m2: tipo === "apartamento" ? null : ouNulo(area(obj["total-area"])) ?? ouNulo(area(obj["land-area"])),
    dormitorios: tipo === "terreno" ? null : ouNulo(obj.bedrooms),
    suites: tipo === "terreno" ? null : ouNulo(obj.suites),
    banheiros: tipo === "terreno" ? null : ouNulo(obj.bathrooms),
    vagas_total: tipo === "terreno" ? null : ouNulo(obj.garage),
    condominio: tipo === "apartamento" || /condom/i.test(`${obj.model || ""} ${obj.title || ""}`) ? true : null,
    fotos,
    foto_capa: fotos[0] || null,
    data_anuncio: obj.modified_at ? String(obj.modified_at).slice(0, 10) : null,
    detalhe_coletado: true,
  });
  im.endereco = {
    logradouro: obj["address-street"] || null,
    numero: obj["address-number"] ? String(obj["address-number"]) : null,
    numero_informado: Boolean(obj["address-number"]),
    bairro: obj.district || im.endereco.bairro,
    cidade: String(obj.city || "Ponta Grossa").replace(/\s*-\s*PR$/i, ""),
    uf: "PR",
  };
  lerTextoAnuncio(im, `${String(obj.description || "").replace(/<[^>]+>/g, " | ")} | ${chavesVerdadeiras(Object.entries(obj))}`);
}

async function conectorClassica({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const xml = String(await get(`${CLASSICA.base}/sitemap/property`, { headers: { "User-Agent": UA } }));
  const links = [...xml.matchAll(/<loc>(https:\/\/classicaimoveis\.com\.br\/imovel\/([^/<]+)\/(\d+))<\/loc>/g)];
  if (!links.length) throw erroLayout("sitemap sem anúncios");
  const candidatos = links
    .filter(([, , s]) => /(^|-)(a|para)-venda(-|$)/.test(s) && !/locacao/.test(s))
    .map(([, url, s, ref]) => ({ url, s, ref, tipo: tipoDeTexto(s.split(/-(?:a|para)-venda/)[0]) }))
    .filter((c) => c.tipo && filtros.tipos.includes(c.tipo) && bairroPedido(filtros, c.s.split(/-(?:a|para)-venda/)[1]))
    .sort((a, b) => Number(b.ref) - Number(a.ref)); // mais recentes primeiro

  const imoveis = candidatos.map((c) =>
    imovelBase(
      { id: CLASSICA.id, nome: CLASSICA.nome, contato: CLASSICA.contato, informante: null },
      {
        id: `classica-${c.ref}`,
        url_anuncio: c.url,
        titulo: deSlug(c.s),
        tipo: c.tipo,
        endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(c.s.replace(/^.*?-(?:a|para)-venda-(?:em|no|na|nos|nas)-/, "")), cidade: "Ponta Grossa", uf: "PR" },
        area_construida_m2: null,
        area_terreno_m2: null,
        preco_total: null,
        dormitorios: null,
        _ref: c.ref,
      },
    ),
  );
  log(`classica: ${links.length} anúncios no sitemap, ${imoveis.length} do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(CLASSICA, imoveis, { get, cfg, sinal, log }, aplicarDetalheClassica);
  // Sem a página do anúncio não há preço nem área: fica de fora.
  return imoveis
    .filter((i) => i.detalhe_coletado && slug(i.endereco.cidade) === "ponta-grossa")
    .map((i) => { delete i._ref; return i; });
}

// ======================================================================
// Madol Imóveis — plataforma Praedium. Cards com JSON-LD (schema.org Product);
// /imoveis/a-venda/ponta-grossa-pr/{bairro}?pagina=N
// ======================================================================

const MADOL = { id: "madol", nome: "Madol Imóveis", base: "https://madolimoveis.com.br", contato: "(42) 3027-3595" };

function produtosJsonLd(html) {
  const lista = [];
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const d = parseJsonSeguro(m[1]);
    if (d && Array.isArray(d["@type"]) && d["@type"].includes("Product") && d.offers && d.offers.url) lista.push(d);
  }
  return lista;
}

function imovelMadol(d) {
  const url = d.offers.url;
  const slugUrl = url.split("/imovel/")[1] || "";
  const tipo = tipoDeTexto(slugUrl.split("-a-venda")[0]);
  const bairro = ((d.name || "").match(/ em (.+?), /) || [])[1] || null;
  const imagem = typeof d.image === "string" ? d.image : Array.isArray(d.image) ? d.image[0] : null;
  return imovelBase(
    { id: MADOL.id, nome: MADOL.nome, contato: MADOL.contato, informante: null },
    {
      id: `madol-${(slugUrl.match(/-id-(\d+)/) || [])[1] || slug(slugUrl)}`,
      url_anuncio: url,
      titulo: (d.name || "").replace(/ por R\$.*$/, ""),
      tipo,
      endereco: { logradouro: null, numero: null, numero_informado: false, bairro, cidade: "Ponta Grossa", uf: "PR" },
      area_construida_m2: tipo === "terreno" ? null : ouNulo(d.floorSize && d.floorSize.value),
      area_terreno_m2: tipo === "terreno" ? ouNulo(d.floorSize && d.floorSize.value) : null,
      preco_total: ouNulo(Number(d.offers.price)),
      dormitorios: tipo === "terreno" ? null : ouNulo(d.numberOfBedrooms),
      banheiros: tipo === "terreno" ? null : ouNulo(d.numberOfBathroomsTotal),
      fotos: imagem ? [imagem] : [],
      foto_capa: imagem,
    },
  );
}

function aplicarDetalheMadol(im, html) {
  const ini = html.indexOf("property-gallery-row");
  const fim = ini >= 0 ? html.indexOf("</section>", ini) : -1;
  const galeria = ini >= 0 ? html.slice(ini, fim > ini ? fim : ini + 20000) : "";
  const bases = [...new Set([...galeria.matchAll(/(https:\/\/cdn3\.praedium\.com\.br\/[^"'\s]+?)_(?:sm|md|lg|xl)\.(?:webp|jpe?g)/g)].map((m) => m[1]))];
  if (bases.length) {
    im.fotos = bases.map((b) => `${b}_md.jpg`);
    im.foto_capa = im.fotos[0];
  }
  const t = textoPipes(html);
  const m2 = (rotulo) => {
    const m = t.match(new RegExp(`([\\d.,]+)\\s*m²\\s*${rotulo}`, "i"));
    return m ? ouNulo(area(m[1])) : null;
  };
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("área total") ?? im.area_terreno_m2;
  } else {
    im.area_construida_m2 = m2("área construída") ?? m2("área útil") ?? im.area_construida_m2;
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("área total");
    im.dormitorios = antesDe(t, "Quartos?\\b") ?? im.dormitorios;
    im.suites = ouNulo(antesDe(t, "Su[ií]tes?\\b"));
    im.banheiros = ouNulo(antesDe(t, "Banheiros?\\b")) ?? im.banheiros;
    im.vagas_total = ouNulo(antesDe(t, "Vagas? de garagem"));
  }
  im.condominio = im.tipo === "apartamento" || /condom[ií]nio fechado/i.test(t) ? true : null;
  // Do quadro de cômodos até antes de "Você também pode gostar" (dali para baixo são outros imóveis).
  const iniTexto = t.indexOf("Cômodos e espaços");
  const fimTexto = t.indexOf("Você também pode gostar", iniTexto);
  if (iniTexto >= 0) lerTextoAnuncio(im, t.slice(iniTexto, fimTexto > iniTexto ? fimTexto : iniTexto + 8000));
  im.detalhe_coletado = true;
}

async function conectorMadol({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const bases = filtros.bairros.length
    ? filtros.bairros.map((b) => `${MADOL.base}/imoveis/a-venda/ponta-grossa-pr/${slug(b)}`)
    : [`${MADOL.base}/imoveis/a-venda/ponta-grossa-pr`];
  const vistos = new Map();
  let paginas = 0;
  let reconhecida = false;
  for (const base of bases) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      let html;
      try {
        html = String(await get(pag === 1 ? base : `${base}?pagina=${pag}`, { headers: { "User-Agent": UA } }));
      } catch (e) {
        if (pag === 1 && /404/.test(e.message)) break; // bairro sem página no site
        throw e;
      }
      paginas++;
      const produtos = produtosJsonLd(html);
      reconhecida ||= produtos.length > 0 || html.includes("property-search");
      let novos = 0;
      for (const d of produtos) if (!vistos.has(d.offers.url)) { vistos.set(d.offers.url, imovelMadol(d)); novos++; }
      if (!novos) break;
    }
  }
  if (!reconhecida) throw erroLayout("listagem sem JSON-LD de imóveis");
  const imoveis = [...vistos.values()].filter((i) => i.tipo && filtros.tipos.includes(i.tipo));
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar);
  log(`madol: ${imoveis.length} imóveis em ${paginas} páginas; abrindo ${Math.min(paraDetalhar.length, cfg.max_detalhes)} detalhes`);
  await abrirDetalhes(MADOL, paraDetalhar, { get, cfg, sinal, log }, aplicarDetalheMadol);
  return imoveis;
}

// ======================================================================
// Tavarnaro Consultoria — plataforma Kurole, HTML em ISO-8859-1.
// /comprar/Ponta-Grossa/{Casa|Sobrado|Apartamento|Terreno}?pag=N
// ======================================================================

const TAVARNARO = {
  id: "tavarnaro",
  nome: "Tavarnaro Consultoria",
  base: "https://www.tavarnaroconsultoria.com.br",
  contato: "(42) 2101-0000",
  tipos: { casa: ["Casa", "Sobrado"], apartamento: ["Apartamento"], terreno: ["Terreno"] },
};

function aplicarDetalheTavarnaro(im, html) {
  const id = im.id.replace("tavarnaro-", "");
  const fotos = [...new Set(html.match(new RegExp(`https://[^"'\\s)]+/foto_/\\d{4}/${id}/[^"'\\s)]+?\\.(?:webp|jpe?g|png)`, "gi")) || [])];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const t = textoPipes(html);
  const titulo = decodificar((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || "");
  if (titulo) im.titulo = textoPipes(titulo).replace(/^\s*\|\s*|\s*\|\s*$/g, "");
  const preco = t.match(/\|\s*Venda\s*\|\s*([\d.]+,\d{2})/);
  im.preco_total = preco ? ouNulo(numeroBR(preco[1])) : im.preco_total;
  const m2 = (rotulo) => {
    const m = t.match(new RegExp(`([\\d.,]+)\\s*m²\\s*\\|\\s*${rotulo}`, "i"));
    return m ? ouNulo(area(m[1])) : null;
  };
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("A\\. Terreno") ?? m2("A\\. Total");
  } else {
    im.area_construida_m2 = m2("A\\. Constru[ií]da") ?? m2("A\\. Privativa") ?? m2("A\\. [ÚU]til");
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("A\\. Terreno");
    im.dormitorios = ouNulo(antesDe(t, "Dormit"));
    im.suites = ouNulo(antesDe(t, "Su[ií]te"));
    im.banheiros = ouNulo(antesDe(t, "Banheiro"));
    im.vagas_total = ouNulo(antesDe(t, "Garage"));
  }
  if (/\/Condominio\//.test(im.url_anuncio) || im.tipo === "apartamento") im.condominio = true;
  // Descrição + itens do imóvel/condomínio; depois vem o texto genérico do bairro.
  const ini = t.indexOf("Descrição do Imóvel");
  const fim = t.search(/Conheça um pouco mais sobre o bairro|Simule um Financiamento/);
  if (ini >= 0) lerTextoAnuncio(im, t.slice(ini, fim > ini ? fim : ini + 8000));
  const canonica = (html.match(/<link rel="canonical" href="([^"]+\/\d+)"/) || [])[1];
  if (canonica) im.url_anuncio = canonica;
  im.detalhe_coletado = true;
}

async function conectorTavarnaro({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => TAVARNARO.tipos[t] || []))]) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      const url = `${TAVARNARO.base}/comprar/Ponta-Grossa/${tipoSite}${pag > 1 ? `?pag=${pag}` : ""}`;
      const html = latin1(await get(url, { headers: { "User-Agent": UA }, binario: true }));
      paginas++;
      let novos = 0;
      for (const m of html.matchAll(/href="(\/comprar\/Ponta-Grossa\/([A-Za-z]+)\/([A-Za-z]+)\/([^"/]+)\/(\d+))"/g)) {
        const [, caminho, tipoUrl, sub, bairroUrl, id] = m;
        if (vistos.has(id)) continue;
        novos++;
        const tipo = tipoDeTexto(`${tipoUrl} ${sub}`);
        vistos.set(id, imovelBase(
          { id: TAVARNARO.id, nome: TAVARNARO.nome, contato: TAVARNARO.contato, informante: null },
          {
            id: `tavarnaro-${id}`,
            url_anuncio: `${TAVARNARO.base}${caminho}`,
            titulo: `${tipoUrl} ${sub === "Padrao" ? "" : sub} – ${deSlug(bairroUrl)}`.replace(/\s+/g, " "),
            tipo,
            endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(bairroUrl), cidade: "Ponta Grossa", uf: "PR" },
            area_construida_m2: null,
            area_terreno_m2: null,
            preco_total: null,
            dormitorios: null,
            _bairroUrl: bairroUrl,
          },
        ));
      }
      if (!novos) break;
    }
  }
  if (!paginas) throw erroLayout("nenhuma página lida");
  const imoveis = [...vistos.values()].filter((i) => i.tipo && filtros.tipos.includes(i.tipo) && bairroPedido(filtros, i._bairroUrl));
  log(`tavarnaro: ${vistos.size} anúncios em ${paginas} páginas, ${imoveis.length} do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(TAVARNARO, imoveis, { get, cfg, sinal, log }, aplicarDetalheTavarnaro, { binario: true });
  return imoveis.filter((i) => i.detalhe_coletado).map((i) => { delete i._bairroUrl; return i; });
}

// ======================================================================
// Imobiliária Aspen — plataforma Imonov/si9.
// /filtro2/list/venda/{tipo}/todas/todos/{min}-{max}/todos/todos/{pagina}
// Obs.: o site expõe credenciais do sistema si9 no JS público. NÃO são usadas aqui.
// ======================================================================

const ASPEN = {
  id: "aspen",
  nome: "Imobiliária Aspen",
  base: "https://www.imobiliariaaspen.com.br",
  contato: "(42) 99842-7103",
  tipos: { casa: ["casa", "sobrado", "condominio-fechado"], apartamento: ["apartamento"], terreno: ["terreno"] },
};

function aplicarDetalheAspen(im, html) {
  const fotos = [...new Set(html.match(/https:\/\/si9dados3\.com\.br\/fotos\/aspen\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi) || [])];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const t = textoPipes(html);
  const titulo = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
  if (titulo) im.titulo = decodificar(titulo).replace(/\s*-\s*Imobili[áa]ria Aspen\s*$/i, "");
  const preco = t.match(/Venda:\s*R\$\s*([\d.]+,\d{2})/);
  im.preco_total = preco ? ouNulo(numeroBR(preco[1])) : null;
  const m2 = (rotulo) => {
    const m = t.match(new RegExp(`([\\d.,]+)\\s*m²\\s*\\|\\s*\\(m²\\)\\s*${rotulo}`, "i"));
    return m ? ouNulo(area(m[1])) : null;
  };
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("Área do Terreno") ?? m2("Área Total");
  } else {
    im.area_construida_m2 = m2("Área Constru[ií]da") ?? m2("Área Privativa") ?? m2("Área Total");
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("Área do Terreno");
    im.dormitorios = ouNulo(antesDe(t, "Quarto\\(s\\)"));
    im.suites = ouNulo(antesDe(t, "Su[ií]te\\(s\\)"));
    im.banheiros = ouNulo(antesDe(t, "Banheiro\\(s\\)"));
    im.vagas_total = ouNulo(antesDe(t, "Garage"));
  }
  if (im.tipo === "apartamento" || /condom[ií]nio/i.test(im.titulo) || /\/condominio-fechado\//.test(im.url_anuncio)) im.condominio = true;
  // Descrição + características; "Imóveis similares" em diante são outros anúncios.
  const ini = t.indexOf("| Descrição |");
  const fim = t.indexOf("Imóveis similares", ini);
  if (ini >= 0) lerTextoAnuncio(im, t.slice(ini, fim > ini ? fim : ini + 8000));
  const ogUrl = (html.match(/<meta property="og:url" content="([^"]+)"/) || [])[1];
  if (ogUrl) im.url_anuncio = ogUrl;
  im.detalhe_coletado = true;
}

async function conectorAspen({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const min = Math.round(filtros.preco_total.min ?? 0);
  const max = Math.round(filtros.preco_total.max ?? 100000000);
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => ASPEN.tipos[t] || []))]) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      const html = String(await get(`${ASPEN.base}/filtro2/list/venda/${tipoSite}/todas/todos/${min}-${max}/todos/todos/${pag}`, { headers: { "User-Agent": UA } }));
      paginas++;
      let novos = 0;
      for (const m of html.matchAll(/https:\/\/www\.imobiliariaaspen\.com\.br\/imovel\/venda\/([^"/]+)\/([^"/]+)\/([^"/]+)\/([^"/]+)\/(\d+)/g)) {
        const [url, tipoUrl, cidade, bairroUrl, , id] = m;
        if (vistos.has(id)) continue;
        novos++;
        const tipo = tipoDeTexto(tipoUrl);
        vistos.set(id, imovelBase(
          { id: ASPEN.id, nome: ASPEN.nome, contato: ASPEN.contato, informante: null },
          {
            id: `aspen-${id}`,
            url_anuncio: url,
            titulo: `${deSlug(tipoUrl)} – ${deSlug(bairroUrl)}`,
            tipo,
            endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(bairroUrl), cidade: cidade === "ponta-grossa-pr" ? "Ponta Grossa" : deSlug(cidade), uf: "PR" },
            area_construida_m2: null,
            area_terreno_m2: null,
            preco_total: null,
            dormitorios: null,
            _cidade: cidade,
            _bairroUrl: bairroUrl,
          },
        ));
      }
      if (!novos) break;
    }
  }
  const imoveis = [...vistos.values()].filter((i) => i._cidade === "ponta-grossa-pr" && i.tipo && filtros.tipos.includes(i.tipo) && bairroPedido(filtros, i._bairroUrl));
  log(`aspen: ${vistos.size} anúncios em ${paginas} páginas, ${imoveis.length} de Ponta Grossa do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(ASPEN, imoveis, { get, cfg, sinal, log }, aplicarDetalheAspen);
  return imoveis.filter((i) => i.detalhe_coletado).map((i) => { delete i._cidade; delete i._bairroUrl; return i; });
}
