// Conectores das imobiliárias (seção 6.2). Roda no serviço do backend (src/coleta.ts) e localmente
// (scripts/testar-coleta.ts). Depende só de `http(url, opcoes)`: GET que devolve texto, JSON (json: true)
// ou bytes (binario: true) e lança erro com httpCode em status >= 400.
// Cada conector devolve { imoveis, erro } com imóveis no formato do contrato (seção 5.2),
// ainda sem criterios/status: isso é feito depois por processarImoveis().


import {
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
} from "./conectores-base.js";
import { FONTES_CURITIBA } from "./conectores-curitiba.js";

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

function imovelCasaTop(p, locacao) {
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
      preco_total: ouNulo(at(locacao ? "valor_locacao" : "valor_venda")),
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
  const locacao = ehLocacao(filtros);
  const operacao = locacao ? "rent" : "sale";
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => def.tipos[t] || []))]) {
    const base = `${def.base}/imoveis?type=${encodeURIComponent(tipoSite)}&operation=${operacao}&order=price-asc`;
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
        for (const p of pp.properties || []) if (p.operation === operacao && !vistos.has(p.reference)) vistos.set(p.reference, imovelDe(p, locacao));
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

function imovelMontoro(p, locacao) {
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
      preco_total: ouNulo(locacao ? at("rent-value") ?? at("value") : at("value")),
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
    preco_total: im._locacao ? ouNulo(obj["rent-value"]) ?? ouNulo(obj.value) : ouNulo(obj.value),
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
  // O slug traz a finalidade: "casa-a-venda-no-…", "apartamento-para-locacao-na-…", "casa-para-alugar-…".
  const locacao = ehLocacao(filtros);
  const marca = locacao ? /-para-(?:locacao|alugar)(?=-|$)/ : /-(?:a|para)-venda(?=-|$)/;
  const candidatos = links
    .filter(([, , s]) => marca.test(s) && (locacao || !/locacao|alugar/.test(s)))
    .map(([, url, s, ref]) => ({ url, s, ref, tipo: tipoDeTexto(s.split(marca)[0]) }))
    .filter((c) => c.tipo && filtros.tipos.includes(c.tipo) && bairroPedido(filtros, c.s.split(marca)[1]))
    .sort((a, b) => Number(b.ref) - Number(a.ref)); // mais recentes primeiro

  const imoveis = candidatos.map((c) =>
    imovelBase(
      { id: CLASSICA.id, nome: CLASSICA.nome, contato: CLASSICA.contato, informante: null },
      {
        id: `classica-${c.ref}`,
        url_anuncio: c.url,
        titulo: deSlug(c.s),
        tipo: c.tipo,
        endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(c.s.split(marca)[1].replace(/^-(?:em|no|na|nos|nas)-/, "")), cidade: "Ponta Grossa", uf: "PR" },
        area_construida_m2: null,
        area_terreno_m2: null,
        preco_total: null,
        dormitorios: null,
        _ref: c.ref,
        _locacao: locacao,
      },
    ),
  );
  log(`classica: ${links.length} anúncios no sitemap, ${imoveis.length} do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(CLASSICA, imoveis, { get, cfg, sinal, log }, aplicarDetalheClassica);
  // Sem a página do anúncio não há preço nem área: fica de fora.
  return imoveis
    .filter((i) => i.detalhe_coletado && slug(i.endereco.cidade) === "ponta-grossa")
    .map((i) => { delete i._ref; delete i._locacao; return i; });
}

// ======================================================================
// Madol Imóveis — plataforma Praedium. Cards com JSON-LD (schema.org Product);
// /imoveis/{a-venda|para-alugar}/ponta-grossa-pr/{bairro}?pagina=N
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
  const tipo = tipoDeTexto(slugUrl.split(/-(?:a-venda|para-alugar)/)[0]);
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
  const finalidade = ehLocacao(filtros) ? "para-alugar" : "a-venda";
  const bases = filtros.bairros.length
    ? filtros.bairros.map((b) => `${MADOL.base}/imoveis/${finalidade}/ponta-grossa-pr/${slug(b)}`)
    : [`${MADOL.base}/imoveis/${finalidade}/ponta-grossa-pr`];
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
// /{comprar|alugar}/Ponta-Grossa/{Casa|Sobrado|Apartamento|Terreno}?pag=N
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
  const preco = t.match(/\/alugar\//.test(im.url_anuncio) ? /\|\s*Aluguel\s*\|\s*([\d.]+,\d{2})/ : /\|\s*Venda\s*\|\s*([\d.]+,\d{2})/);
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
  const finalidade = ehLocacao(filtros) ? "alugar" : "comprar";
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => TAVARNARO.tipos[t] || []))]) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      const url = `${TAVARNARO.base}/${finalidade}/Ponta-Grossa/${tipoSite}${pag > 1 ? `?pag=${pag}` : ""}`;
      const html = latin1(await get(url, { headers: { "User-Agent": UA }, binario: true }));
      paginas++;
      let novos = 0;
      for (const m of html.matchAll(new RegExp(`href="(/${finalidade}/Ponta-Grossa/([A-Za-z]+)/([A-Za-z]+)/([^"/]+)/(\\d+))"`, "g"))) {
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
// /filtro2/list/{venda|locacao}/{tipo}/todas/todos/{min}-{max}/todos/todos/{pagina}
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
  const preco = t.match(/\/imovel\/locacao\//.test(im.url_anuncio) ? /Loca[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/ : /Venda:\s*R\$\s*([\d.]+,\d{2})/);
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
  const finalidade = ehLocacao(filtros) ? "locacao" : "venda";
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => ASPEN.tipos[t] || []))]) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      const html = String(await get(`${ASPEN.base}/filtro2/list/${finalidade}/${tipoSite}/todas/todos/${min}-${max}/todos/todos/${pag}`, { headers: { "User-Agent": UA } }));
      paginas++;
      let novos = 0;
      for (const m of html.matchAll(new RegExp(`https://www\\.imobiliariaaspen\\.com\\.br/imovel/${finalidade}/([^"/]+)/([^"/]+)/([^"/]+)/([^"/]+)/(\\d+)`, "g"))) {
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
  return bairros.map((b) => `${base}/busca/${ehLocacao(filtros) ? "locacao" : "venda"}/${[...tipos, "cidade_ponta-grossa", b, ...preco, "mostrar_100"].filter(Boolean).join("/")}`);
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
// Plataforma CasaSoft (Kikina): API JSON pública que o próprio
// site usa. `filtro.tipodivulgacao` = "v" (venda) ou "l" (locação); o anúncio abre a galeria completa.
// ======================================================================

const CASASOFT_API = "https://apiimoveisv3.casasoftsig.com/api/v3/imoveis/pesquisa";

const KIKINA = {
  id: "kikina",
  nome: "Kikina Imóveis",
  base: "https://www.kikina.com.br",
  clienteId: 2950,
  cidade: "Ponta Grossa",
  contato: "(42) 99851-0022",
  // Nomes de tipo cadastrados pela Kikina (a busca da API exige o nome exato).
  tipos: {
    casa: ["Casa Residencial", "Sobrado", "Casa em Condomínio"],
    apartamento: ["Apartamento", "Kitinet.", "Flat"],
    terreno: ["Terreno"],
  },
};

/** Tipo do contrato: pela lista da imobiliária (quando houver) ou pelo tipo padrão da CasaSoft. */
function tipoCasaSoft(def, r) {
  if (def.tipos) {
    for (const [tipo, lista] of Object.entries(def.tipos)) if (lista.includes(r.tipoImovelDescricao)) return tipo;
    return null;
  }
  return tipoDeTexto(r.tipoImovelPadraoDescricao) || tipoDeTexto(r.tipoImovelDescricao);
}

const LOGRADOUROS = { aveni: "Avenida", aven: "Avenida", av: "Avenida", rua: "Rua", r: "Rua", trave: "Travessa", alame: "Alameda", rodov: "Rodovia", estra: "Estrada", praca: "Praça", pç: "Praça" };

function dataBR(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m && m[3] !== "0001" ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function urlCasaSoft(def, r, locacao) {
  // Mesmo formato de link que o site monta (o servidor só exige id e ref; o slug é descritivo).
  const partes = [
    slug(r.tipoImovelDescricao),
    r.imovelQuartos ? `${r.imovelQuartos}-quartos` : "",
    r.imovelEnderecoBairro ? slug(r.imovelEnderecoBairro) : "",
    r.imovelEnderecoCidade ? slug(r.imovelEnderecoCidade) : "",
    r.imovelVagas ? "com-garagem" : "",
    r.imovelAreaTotal ? `${Math.floor(r.imovelAreaTotal)}m2` : "",
    locacao ? `locacao-rs-${r.imovelValorAluguel}` : `venda-rs-${r.imovelValorVenda}`,
  ].filter(Boolean);
  return `${def.base}/imovel/${partes.join("-")}?id=${r.clienteId}&ref=${encodeURIComponent(r.imovelReferencia)}&search=0`;
}

function imovelDeApiCasaSoft(def, r, locacao) {
  const tipo = tipoCasaSoft(def, r);
  const prefixo = LOGRADOUROS[slug(r.imovelTipoEndereco || "").replace(/-/g, "")] || (r.imovelTipoEndereco || "").trim();
  const logradouro = r.imovelEndereco ? `${prefixo ? prefixo + " " : ""}${r.imovelEndereco.trim()}` : null;
  const numero = r.imovelEnderecoNumero && /\d/.test(r.imovelEnderecoNumero) ? String(r.imovelEnderecoNumero).trim() : null;
  const corretor = (String(r.imovelPontosFortes || "").match(/Corretor[a]?\s+([^#]+?)\s*#13/i) || [])[1] || null;
  const util = ouNulo(r.imovelAreaUtil);
  const total = ouNulo(r.imovelAreaTotal);
  const foto = r.urlFotoPrincipal || null;

  const im = imovelBase(
    { id: def.id, nome: def.nome, contato: def.contato, informante: corretor },
    {
      id: `${def.id}-${r.imovelReferencia}`,
      url_anuncio: urlCasaSoft(def, r, locacao),
      titulo: `${r.tipoImovelDescricao}${r.imovelQuartos ? ` ${r.imovelQuartos} quartos` : ""} – ${r.imovelEnderecoBairro || ""}`.trim(),
      tipo,
      endereco: { logradouro, numero, numero_informado: Boolean(numero), bairro: r.imovelEnderecoBairro || null, cidade: r.imovelEnderecoCidade || def.cidade, uf: r.imovelEnderecoEstado || "PR" },
      // CasaSoft: AreaUtil = construída/privativa; AreaTotal = terreno (casa/terreno) ou total (apto).
      area_construida_m2: tipo === "terreno" ? null : tipo === "apartamento" ? util ?? total : util,
      area_terreno_m2: tipo === "apartamento" ? null : total,
      preco_total: ouNulo(locacao ? r.imovelValorAluguel : r.imovelValorVenda),
      dormitorios: tipo === "terreno" ? null : ouNulo(r.imovelQuartos),
      suites: tipo === "terreno" ? null : ouNulo(r.imovelSuites),
      banheiros: tipo === "terreno" ? null : ouNulo(r.imovelBanheiros),
      vagas_total: tipo === "terreno" ? null : ouNulo(r.imovelVagas),
      condominio: tipo === "apartamento" || /condom[ií]nio/i.test(r.tipoImovelDescricao || "") || r.imovelCondominio === 1 ? true : r.imovelCondominio === 0 ? false : null,
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

function aplicarDetalheCasaSoft(im, html) {
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

const criarConectorCasaSoft = (def) => async function conectorCasaSoft({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const locacao = ehLocacao(filtros);
  // Sem URLSearchParams: o código nasceu no nó Code do n8n, cujo sandbox nem sempre expõe esse global.
  const params = new Parametros({
    "filtro.clienteid": String(def.clienteId),
    "filtro.tipodivulgacao": locacao ? "l" : "v",
    "filtro.cidade": def.cidade,
    ordenacao: "imovelvalor",
    ascdesc: "asc",
  });
  if (def.tipos) params.set("filtro.tiposimoveis", [...new Set(filtros.tipos.flatMap((t) => def.tipos[t] || []))].join(","));
  if (filtros.bairros.length) params.set("filtro.bairro", filtros.bairros.join(","));
  // As faixas de valor da API valem para o preço de venda; na locação o filtro de preço é aplicado depois.
  if (!locacao && filtros.preco_total.min != null) params.set("filtro.valorminimo", String(Math.round(filtros.preco_total.min)));
  if (!locacao && filtros.preco_total.max != null) params.set("filtro.valormaximo", String(Math.round(filtros.preco_total.max)));

  const porPagina = 100;
  const brutos = [];
  for (let pag = 1; pag <= cfg.max_paginas; pag++) {
    params.set("pagina", String(pag));
    params.set("maximo", String(porPagina));
    let resp = await get(`${CASASOFT_API}?${params}`, { headers: { "User-Agent": UA, Referer: `${def.base}/`, Accept: "application/json" }, json: true });
    if (typeof resp === "string") resp = JSON.parse(resp);
    if (!resp || !resp.data || !Array.isArray(resp.data.resultado))
      throw Object.assign(new Error("Possível mudança na API: resposta sem data.resultado"), { codigo: "LAYOUT" });
    brutos.push(...resp.data.resultado);
    if (brutos.length >= resp.data.total || resp.data.resultado.length < porPagina) break;
  }

  const imoveis = brutos
    .filter((r) => (locacao ? r.imovelLocacao : r.imovelVenda))
    .map((r) => imovelDeApiCasaSoft(def, r, locacao))
    .filter((i) => i.tipo && filtros.tipos.includes(i.tipo));
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar).slice(0, cfg.max_detalhes);
  log(`${def.id}: ${imoveis.length} imóveis na API; abrindo ${paraDetalhar.length} detalhes`);
  for (const im of paraDetalhar) {
    if (sinal.abortado) break;
    try {
      aplicarDetalheCasaSoft(im, String(await get(im.url_anuncio, { headers: { "User-Agent": UA } })));
    } catch (e) {
      log(`${def.id}: falha no detalhe ${im.url_anuncio}: ${e.message}`);
    }
  }
  for (const im of imoveis) delete im._imovelId;
  return imoveis;
};

const conectorKikina = criarConectorCasaSoft(KIKINA);


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

function imovelDeTorreBlanca(r, locacao) {
  const attrs = r.attributes || {};
  const tipo = tipoTorreBlanca(attrs.tipo);
  // A consulta já vem filtrada pela finalidade; o preço segue a finalidade pedida, não a ordem de attrs.operacao
  // (um imóvel ["Locação", "Venda"] numa busca de venda mostraria o aluguel como preço).
  const preco = locacao ? ouNulo(attrs.valor_locacao) : ouNulo(attrs.valor_venda);
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
  const locacao = ehLocacao(filtros);

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
    const url = `${TORRE_BLANCA.base}/_next/data/${buildId}/imoveis.json?operacao=${locacao ? "Loca%C3%A7%C3%A3o" : "Venda"}&endereco_cidade=Ponta+Grossa&page=${pag}`;
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
    .map((r) => imovelDeTorreBlanca(r, locacao))
    .filter((i) => i.tipo && tiposAlvo.has(i.tipo));

  return imoveis;
}

// ======================================================================
// Execução de todas as fontes em paralelo, com timeout por fonte (6.3)
// ======================================================================

// As funções de casatop, classica, madol, tavarnaro e aspen estão em conectores-novos.js (concatenado no build).
// Cadastro das fontes por cidade: id → { nome, conector }. Os ids precisam bater com web/src/lib/fontes.ts.
const FONTES_PONTA_GROSSA = {
  flow: { nome: SYSONE.flow.nome, conector: criarConectorSysOne(SYSONE.flow) },
  adquira: { nome: SYSONE.adquira.nome, conector: criarConectorSysOne(SYSONE.adquira) },
  conceito: { nome: SYSONE.conceito.nome, conector: criarConectorSysOne(SYSONE.conceito) },
  taques: { nome: SYSONE.taques.nome, conector: criarConectorSysOne(SYSONE.taques) },
  kikina: { nome: KIKINA.nome, conector: conectorKikina },
  casatop: { nome: CASATOP.nome, conector: conectorCasaTop },
  classica: { nome: CLASSICA.nome, conector: conectorClassica },
  madol: { nome: MADOL.nome, conector: conectorMadol },
  tavarnaro: { nome: TAVARNARO.nome, conector: conectorTavarnaro },
  aspen: { nome: ASPEN.nome, conector: conectorAspen },
  montoro: { nome: MONTORO.nome, conector: conectorMontoro },
  torre_branca: { nome: TORRE_BLANCA.nome, conector: conectorTorreBlanca },
};

const FONTES_POR_CIDADE = {
  "Ponta Grossa": FONTES_PONTA_GROSSA,
  Curitiba: FONTES_CURITIBA,
};

const CONECTORES = {};
const NOMES = {};
/** id da fonte → cidade que ela atende (a busca só aceita fontes da cidade pedida). */
const CIDADE_DA_FONTE = {};
for (const [cidade, fontes] of Object.entries(FONTES_POR_CIDADE)) {
  for (const [id, f] of Object.entries(fontes)) {
    CONECTORES[id] = f.conector;
    NOMES[id] = f.nome;
    CIDADE_DA_FONTE[id] = cidade;
  }
}
const CIDADES = Object.keys(FONTES_POR_CIDADE);

async function coletarFontes({ requisicao, http, timeoutFonteMs, config, avaliar, log = () => {} }) {
  const filtros = { ...requisicao.filtros, finalidade: ehLocacao(requisicao.filtros) ? "locacao" : "venda" };
  const cidade = requisicao.cidade || "Ponta Grossa";
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
        const brutos = await Promise.race([
          conector({ filtros, cidade, http, cfg, sinal, avaliar, log }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`A fonte não respondeu em ${Math.round(timeoutFonteMs / 1000)} segundos`), { codigo: "TIMEOUT" })), timeoutFonteMs); }),
        ]);
        // Rede de segurança: imóvel de outra cidade (região metropolitana, litoral…) não entra na busca.
        const imoveis = brutos.filter((im) => !im.endereco || !im.endereco.cidade || slug(im.endereco.cidade) === slug(cidade));
        if (imoveis.length < brutos.length) log(`${fonteId}: ${brutos.length - imoveis.length} imóveis de outras cidades descartados`);
        for (const im of imoveis) im.finalidade = filtros.finalidade;
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

export { coletarFontes, NOMES, CIDADE_DA_FONTE, CIDADES };
