// Conectores das imobiliárias (seção 6.2). Roda no serviço do backend (src/coleta.ts) e localmente
// (scripts/testar-coleta.ts). Depende só de `http(url, opcoes)`: GET que devolve texto, JSON (json: true)
// ou bytes (binario: true) e lança erro com httpCode em status >= 400.
// Cada conector devolve { imoveis, erro } com imóveis no formato do contrato (seção 5.2),
// ainda sem criterios/status: isso é feito depois por processarImoveis().

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

// ======================================================================
// Plataforma SysOne (Flow, Adquira, Conceito, Taques) — HTML server-side
// Busca: /busca/venda/tipo_casa/cidade_ponta-grossa/bairro_orfas/valormin_X/valormax_Y/mostrar_100/pag_2
// ======================================================================

const SYSONE = {
  flow: { id: "flow", nome: "Flow Imobiliária", base: "https://flowimobiliaria.com.br" },
  adquira: { id: "adquira", nome: "Adquira Imóveis", base: "https://adquiraimoveis.net" },
  conceito: { id: "conceito", nome: "Conceito Imóveis", base: "https://conceitoimoveispg.com.br" },
  taques: { id: "taques", nome: "Taques Negócios Imobiliários", base: "https://taquesimoveis.com.br" },
};
const TIPOS_SYSONE = { casa: ["tipo_casa", "tipo_sobrado"], apartamento: ["tipo_apartamento"], terreno: ["tipo_terreno"] };

function tipoFlow(rotulo) {
  const t = slug(rotulo || "");
  if (/apartamento|cobertura|kitnet|studio|flat/.test(t)) return "apartamento";
  if (/terreno|lote/.test(t)) return "terreno";
  if (/casa|sobrado/.test(t)) return "casa";
  return null;
}

function urlsBuscaSysOne(base, filtros) {
  const tipos = [...new Set(filtros.tipos.flatMap((t) => TIPOS_SYSONE[t] || []))];
  const preco = [];
  if (filtros.preco_total.min != null) preco.push(`valormin_${Math.round(filtros.preco_total.min)}`);
  if (filtros.preco_total.max != null) preco.push(`valormax_${Math.round(filtros.preco_total.max)}`);
  // O site aceita um bairro por vez: uma busca por bairro.
  const bairros = filtros.bairros.length ? filtros.bairros.map((b) => `bairro_${slug(b)}`) : [""];
  // cidade_ponta-grossa: Adquira e Conceito também anunciam Castro, Carambeí etc.
  return bairros.map((b) => `${base}/busca/venda/${[...tipos, "cidade_ponta-grossa", b, ...preco, "mostrar_100"].filter(Boolean).join("/")}`);
}

function parseCardsFlow(html) {
  const cards = [];
  const partes = html.split('<div class="searchItem');
  for (const p of partes.slice(1)) {
    const url = (p.match(/href="(https:\/\/[^"\/]+\/imovel\/[\d.]+\/[^"]+)"/) || [])[1];
    if (!url) continue;
    const infos = [...p.matchAll(/<div class="innerInfo"\s*>([\s\S]*?)<\/div>/g)].map((m) => textoLimpo(m[1]));
    // Tema "v3" (Adquira): o card não tem rótulo de tipo, só o bairro com ícone de mapa e o preço em .innerInfo.price.
    const bairroIcone = textoLimpo((p.match(/<div class="innerInfo"\s*>\s*<i class="fa fa-map-marker"><\/i>([\s\S]*?)<\/div>/) || [])[1] || "");
    const slugUrl = (url.match(/\/imovel\/[\d.]+\/([^"?]+)/) || [])[1] || "";
    const li = (rotulo) => {
      const m = p.match(new RegExp(`<li>\\s*<i[^>]*></i>\\s*([\\d.,]+)\\s*<span>\\s*${rotulo}`, "i"));
      return m ? numeroBR(m[1]) : null;
    };
    const endereco = textoLimpo((p.match(/<div class="hide">([\s\S]*?)<\/div>/) || [])[1] || "");
    cards.push({
      url,
      codigo: (url.match(/\/imovel\/([\d.]+)\//) || [])[1] || null,
      foto: (p.match(/data-src="([^"]+)"/) || p.match(/<img src="([^"]+)"/) || [])[1] || null,
      rotuloTipo: bairroIcone ? slugUrl.split("-")[0] : infos[0] || "",
      bairro: bairroIcone || infos[1] || null,
      titulo: textoLimpo((p.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/) || [])[1] || ""),
      endereco,
      quartos: li("Quartos"),
      suites: li("Suítes"),
      vagas: li("Vagas"),
      area: li("Área"),
      preco: numeroBR((p.match(/class="imobPrice[^"]*">([^<]+)/) || p.match(/class="innerInfo price[^"]*">([^<]+)/) || [])[1]),
    });
  }
  const proxima = /class='step'><a href='([^']+)'/.exec(html);
  return { cards, temProxima: Boolean(proxima), paginaReconhecida: html.includes("searchResults") };
}

function imovelDeCardFlow(c, contato, def) {
  const tipo = tipoFlow(c.rotuloTipo);
  const valido = c.endereco && !/\/PR$|^Ponta Grossa/i.test(c.endereco) && slug(c.endereco) !== slug(c.bairro || "");
  const { logradouro: bruto, numero } = valido ? separarEndereco(c.endereco) : { logradouro: null, numero: null };
  const logradouro = limparLogradouro(bruto);
  return imovelBase(
    { id: def.id, nome: def.nome, contato: contato.telefone, informante: contato.nome },
    {
      id: `${def.id}-${c.codigo}`,
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
  // Descrição + dependências + características; para antes dos valores/simulador (o resto da página traz outros imóveis).
  const ini = html.indexOf("imovelInfoBox");
  if (ini >= 0) {
    const fim = html.slice(ini).search(/uniqueBox|Valores de Venda/);
    lerTextoAnuncio(im, textoPipes(html.slice(ini, fim > 0 ? ini + fim : ini + 20000)));
  }
  im.detalhe_coletado = true;
}

const criarConectorSysOne = (def) => async function conectorSysOne({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const vistos = new Map();
  let contato = { nome: null, telefone: null };
  let paginasLidas = 0;
  let algumaReconhecida = false;

  for (const base of urlsBuscaSysOne(def.base, filtros)) {
    for (let pag = 1; pag <= cfg.max_paginas && paginasLidas < cfg.max_paginas * 3; pag++) {
      const html = String(await get(pag === 1 ? base : `${base}/pag_${pag}`, { headers: { "User-Agent": UA } }));
      paginasLidas++;
      if (!contato.nome) contato = contatoFlow(html);
      const { cards, temProxima, paginaReconhecida } = parseCardsFlow(html);
      algumaReconhecida ||= paginaReconhecida;
      for (const c of cards) if (!vistos.has(c.url)) vistos.set(c.url, imovelDeCardFlow(c, contato, def));
      if (!temProxima || cards.length === 0) break;
    }
  }

  if (!algumaReconhecida) throw Object.assign(new Error("Possível mudança de layout: página de busca não reconhecida"), { codigo: "LAYOUT" });

  const imoveis = [...vistos.values()].filter((i) => i.tipo && filtros.tipos.includes(i.tipo));
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar).slice(0, cfg.max_detalhes);
  log(`${def.id}: ${imoveis.length} imóveis em ${paginasLidas} páginas; abrindo ${paraDetalhar.length} detalhes`);
  for (const im of paraDetalhar) {
    if (sinal.abortado) break;
    try {
      aplicarDetalheFlow(im, String(await get(im.url_anuncio, { headers: { "User-Agent": UA } })));
    } catch (e) {
      log(`${def.id}: falha no detalhe ${im.url_anuncio}: ${e.message}`);
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

  const im = imovelBase(
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
  // imovelPontosFortes é a descrição do anúncio ("#13" = quebra de linha).
  lerTextoAnuncio(im, String(r.imovelPontosFortes || "").replace(/#13/g, " "));
  return im;
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
  lerTextoAnuncio(im, textoPipes(bloco));
  im.detalhe_coletado = true;
}

async function conectorKikina({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  // Sem URLSearchParams: o código nasceu no nó Code do n8n, cujo sandbox nem sempre expõe esse global.
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
// Torre Blanca — Next.js SSR, API JSON nativa via /_next/data/{buildId}/
// Levantamento: 2026-10-15. Sem anti-bot. robots.txt ausente (404).
// ======================================================================

const TORRE_BLANCA = {
  id: "torre_branca",
  nome: "Torre Blanca",
  base: "https://torreblanca.com.br",
  contato: "(42) 99816-0179",
  tipos: {
    casa:        ["Casa/Sobrado", "Casa", "Sobrado", "Casa em Condomínio"],
    apartamento: ["Apartamento", "Cobertura", "Kitnet", "Studio", "Flat", "Loft"],
    terreno:     ["Terreno", "Lote"],
  },
};

function tipoTorreBlanca(desc) {
  for (const [tipo, lista] of Object.entries(TORRE_BLANCA.tipos))
    if (lista.some((s) => slug(s) === slug(desc || ""))) return tipo;
  // Fallback por palavra-chave
  const d = slug(desc || "");
  if (/apartamento|cobertura|kitnet|studio|flat|loft/.test(d)) return "apartamento";
  if (/terreno|lote/.test(d)) return "terreno";
  if (/casa|sobrado|chacara|sitio/.test(d)) return "casa";
  return null;
}

/** Extrai o buildId do HTML da homepage.
 *  Ex.: /_next/static/mZfUg5wbay9813tO3Hb_c/_buildManifest.js → mZfUg5wbay9813tO3Hb_c */
function extrairBuildId(html) {
  const m = String(html).match(new RegExp("/_next/static/([A-Za-z0-9_-]+)/_buildManifest\.js"));
  return m ? m[1] : null;
}

function imovelDeTorreBlanca(r) {
  const attrs = r.attributes || {};
  const tipo = tipoTorreBlanca(attrs.tipo);
  const operacao = (attrs.operacao || [])[0] || "Venda";
  const preco = operacao === "Locação" ? ouNulo(attrs.valor_locacao) : ouNulo(attrs.valor_venda);
  const ref = r.reference || r.id;

  const fotos = Array.isArray(r.media_assets?.images)
    ? r.media_assets.images.map((img) => img.full || img.md || img.sm).filter(Boolean)
    : [];
  const capa = r.thumbnail || (r.media_assets?.images?.find((img) => img.cover)?.full) || fotos[0] || null;

  const im = imovelBase(
    { id: TORRE_BLANCA.id, nome: TORRE_BLANCA.nome, contato: TORRE_BLANCA.contato, informante: attrs.corretor_nome || null },
    {
      id: `torre_branca-${ref}`,
      url_anuncio: `${TORRE_BLANCA.base}/imovel/${ref}`,
      titulo: r.title || `${attrs.tipo || "Imóvel"} – ${attrs.endereco_bairro || ""}`,
      tipo,
      endereco: {
        logradouro: limparLogradouro(attrs.endereco_logradouro || null),
        numero: attrs.endereco_numero ? String(attrs.endereco_numero) : null,
        numero_informado: Boolean(attrs.endereco_numero),
        bairro: attrs.endereco_bairro || null,
        cidade: attrs.endereco_cidade || "Ponta Grossa",
        uf: attrs.endereco_estado || "PR",
      },
      area_construida_m2: tipo === "terreno" ? null : ouNulo(attrs.area_util),
      area_terreno_m2: tipo === "apartamento" ? null : ouNulo(attrs.area_total),
      preco_total: preco,
      dormitorios: tipo === "terreno" ? null : ouNulo(attrs.dormitorios),
      suites: tipo === "terreno" ? null : ouNulo(attrs.suites),
      banheiros: tipo === "terreno" ? null : ouNulo(attrs.banheiros),
      vagas_total: tipo === "terreno" ? null : ouNulo(attrs.vagas_garagem),
      condominio: attrs.em_condominio != null ? Boolean(attrs.em_condominio) : tipo === "apartamento" ? true : null,
      fotos,
      foto_capa: capa,
      detalhe_coletado: true, // a listagem já traz todos os campos necessários
      codigo_comum: null,
    },
  );
  const caracteristicas = Array.isArray(attrs.caracteristicas) ? attrs.caracteristicas.join(" | ") : "";
  lerTextoAnuncio(im, `${r.description || ""} | ${caracteristicas}`);
  return im;
}

async function conectorTorreBlanca({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);

  // 1. Obtém o buildId atual da homepage (muda a cada deploy do site).
  const htmlHome = String(await get(TORRE_BLANCA.base, { headers: { "User-Agent": UA, Accept: "text/html" } }));
  const buildId = extrairBuildId(htmlHome);
  if (!buildId) throw Object.assign(new Error("buildId não encontrado na homepage – possível mudança de layout"), { codigo: "LAYOUT" });

  // 2. Pagina pela API JSON nativa do Next.js.
  const porPagina = 20; // fixo pelo site
  const brutos = [];
  let totalPaginas = null;

  for (let pag = 1; pag <= cfg.max_paginas; pag++) {
    if (sinal.abortado) break;
    const url = `${TORRE_BLANCA.base}/_next/data/${buildId}/imoveis.json?operacao=Venda&endereco_cidade=Ponta+Grossa&page=${pag}`;
    let resp;
    try {
      resp = await get(url, { headers: { "User-Agent": UA, Accept: "application/json" }, json: true });
      if (typeof resp === "string") resp = JSON.parse(resp);
    } catch (e) {
      // buildId pode ter expirado se o site fez deploy durante a coleta – tenta renovar uma vez.
      if (pag === 1) throw e;
      log(`torre_branca: erro na pág ${pag} (${e.message}); encerrando coleta`);
      break;
    }

    const pp = resp && (resp.pageProps || (resp.props && resp.props.pageProps));
    if (!pp || !Array.isArray(pp.properties))
      throw Object.assign(new Error("Resposta da API sem pageProps.properties – possível mudança de layout"), { codigo: "LAYOUT" });

    brutos.push(...pp.properties);

    if (totalPaginas === null) {
      const info = pp.pageInfo || {};
      totalPaginas = Number(info.total) || 1;
      log(`torre_branca: ${pp.totalProperties || "?"} imóveis, ${totalPaginas} páginas (buildId ${buildId})`);
    }

    if (pag >= totalPaginas || pp.properties.length < porPagina) break;
  }

  // 3. Mapeia e filtra por tipo.
  const tiposAlvo = new Set(filtros.tipos);
  const imoveis = brutos
    .map(imovelDeTorreBlanca)
    .filter((i) => i.tipo && tiposAlvo.has(i.tipo));

  return imoveis;
}

// ======================================================================
// Execução de todas as fontes em paralelo, com timeout por fonte (6.3)
// ======================================================================

// As funções de casatop, classica, madol, tavarnaro e aspen estão em conectores-novos.js (concatenado no build).
const CONECTORES = {
  flow: criarConectorSysOne(SYSONE.flow),
  adquira: criarConectorSysOne(SYSONE.adquira),
  conceito: criarConectorSysOne(SYSONE.conceito),
  taques: criarConectorSysOne(SYSONE.taques),
  kikina: conectorKikina,
  casatop: conectorCasaTop,
  classica: conectorClassica,
  madol: conectorMadol,
  tavarnaro: conectorTavarnaro,
  aspen: conectorAspen,
  montoro: conectorMontoro,
  torre_branca: conectorTorreBlanca,
};
const NOMES = {
  flow: SYSONE.flow.nome, adquira: SYSONE.adquira.nome, conceito: SYSONE.conceito.nome, taques: SYSONE.taques.nome, kikina: KIKINA.nome,
  casatop: CASATOP.nome, classica: CLASSICA.nome, madol: MADOL.nome, tavarnaro: TAVARNARO.nome, aspen: ASPEN.nome, montoro: MONTORO.nome,
  torre_branca: "Torre Blanca", quintoandar: "QuintoAndar",
};

async function coletarFontes({ requisicao, http, timeoutFonteMs, config, avaliar, log = () => {} }) {
  const resultados = await Promise.all(
    requisicao.fontes.map(async (fonteId) => {
      const nome = NOMES[fonteId] || fonteId;
      const conector = CONECTORES[fonteId];
      if (!conector)
        return { fonte: { id: fonteId, nome, status: "erro", mensagem: "Conector ainda não implementado", itens: 0 }, imoveis: [], erro: { fonte: fonteId, codigo: "SEM_CONECTOR", mensagem: `${nome}: conector ainda não implementado` } };

      const cfg = { ...CONFIG_PADRAO, ...CONFIG_POR_FONTE[fonteId], ...(config && config[fonteId]) };
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

export { coletarFontes, NOMES };
