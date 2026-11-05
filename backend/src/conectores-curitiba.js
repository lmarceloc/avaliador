// Conectores das imobiliárias de Curitiba/PR, agrupados por plataforma (um conector por plataforma,
// parametrizado pela imobiliária). Levantamento de 05/11/2026: só entram sites cujo robots.txt permite
// as páginas usadas. Os sites na plataforma Kenlo (Partner, Hoje, Cilar Imóveis, Avante, Lugano, Versat)
// proíbem robôs genéricos ("User-agent: * / Disallow: /") e por isso ficaram de fora.
//
// Todos respeitam filtros.finalidade ("venda" | "locacao") e só devolvem imóveis da cidade de Curitiba.
import {
  UA,
  ehLocacao,
  cliente,
  imovelBase,
  lerTextoAnuncio,
  priorizarDetalhes,
  abrirDetalhes,
  textoPipes,
  latin1,
  area,
  numeroBR,
  ouNulo,
  slug,
  deSlug,
  decodificar,
  separarEndereco,
  limparLogradouro,
  tipoDeTexto,
  bairroPedido,
  parseJsonSeguro,
  erroLayout,
} from "./conectores-base.js";

const CIDADE = "Curitiba";
const ehCuritiba = (cidade) => slug(cidade || "") === "curitiba";

/** Valor depois de um rótulo no texto com pipes: "| Banheiros: | 5 |" → "5". */
function campoPipes(texto, rotulo) {
  const m = texto.match(new RegExp(`\\|\\s*${rotulo}\\s*:?\\s*\\|\\s*([^|]+?)\\s*\\|`, "i"));
  return m ? m[1].trim() : null;
}

/** Blocos JSON-LD da página (objetos soltos ou @graph). */
function jsonLd(html) {
  const lista = [];
  for (const m of String(html).matchAll(/<script type="?application\/ld\+json"?[^>]*>([\s\S]*?)<\/script>/g)) {
    const d = parseJsonSeguro(m[1]);
    if (!d) continue;
    if (Array.isArray(d)) lista.push(...d);
    else if (Array.isArray(d["@graph"])) lista.push(...d["@graph"]);
    else lista.push(d);
  }
  return lista;
}

/** Texto de atributo/meta com entidades HTML ("Gua&iacute;ra") → texto puro. */
const semEntidades = (s) => textoPipes(String(s || "")).replace(/^\s*\|\s*|\s*\|\s*$/g, "").replace(/\s*\|\s*/g, " ").trim();

/** Remove campos auxiliares (prefixo "_") antes de devolver os imóveis. */
function limparAuxiliares(imoveis) {
  for (const im of imoveis) for (const k of Object.keys(im)) if (k.startsWith("_")) delete im[k];
  return imoveis;
}

// ======================================================================
// PipeImob — Rede UNA Imóveis Conectados. Os sites das associadas mostram o MESMO estoque compartilhado
// da rede; a dona de cada anúncio vem no sufixo da referência ("101122.001-CL" = Cilar). Por isso a rede é
// percorrida UMA vez por busca (no site da Habitec, que publica a referência no card) e cada imobiliária
// recebe só o estoque próprio, com o link para o próprio site (o caminho /imovel/… é o mesmo em todas).
// Listagem: /imoveis/{venda|alugar}/curitiba[/{bairro_com_underscore}]/{casa|apartamento|terreno}?page=N
// Códigos conferidos nos destaques da página inicial de cada site (05/11/2026); AFO e PAR pela sigla.
// ======================================================================

const PORTAL_UNA = "https://habitec.com.br";

const PIPEIMOB = [
  { id: "kondor", nome: "Kondor Imóveis", base: "https://kondorimoveis.com.br", contato: "(41) 3273-1212", codigos: ["KD"] },
  { id: "habitec", nome: "Habitec Imóveis", base: "https://habitec.com.br", contato: "(41) 3340-3202", codigos: ["HT"] },
  { id: "cilar", nome: "Imobiliária Cilar", base: "https://cilar.com.br", contato: "(41) 3883-2100", codigos: ["CL"] },
  { id: "afortiori", nome: "Afortiori Imóveis", base: "https://afortiori.com.br", contato: "(41) 3029-2863", codigos: ["AFO"] },
  { id: "paraiso", nome: "Imobiliária Paraíso", base: "https://imobiliariaparaiso.com.br", contato: "(41) 3233-6025", codigos: ["PAR"] },
  { id: "burgman", nome: "Burgman Imóveis", base: "https://burgmanimoveis.com.br", contato: "(41) 3308-3378", codigos: ["BUR"] },
  { id: "construa", nome: "Construa Imóveis", base: "https://construa.com.br", contato: "(41) 3243-3438", codigos: ["CAI"] },
  { id: "gomes", nome: "Gomes Imóveis", base: "https://gomesimoveis.net", contato: "(41) 98406-7324", codigos: ["GOMG"] },
  { id: "jamaica", nome: "Imobiliária Jamaica", base: "https://jamaicaimoveis.com.br", contato: "(41) 3201-2424", codigos: ["JA1"] },
  { id: "outrasul", nome: "Outra Sul Imóveis", base: "https://outrasul.com.br", contato: "(41) 3212-1000", codigos: ["OUT"] },
  { id: "toyo", nome: "Toyo Imóveis", base: "https://toyoimoveis.com.br", contato: "(41) 6347-7844", codigos: ["TOYO"] },
  { id: "razao", nome: "Imobiliária Razão", base: "https://irazao.com.br", contato: "(41) 99706-3735", codigos: ["RZ"] },
];

/**
 * Cards da listagem. Há dois modelos de site na plataforma:
 * - "portal" (Kondor, Afortiori, Paraíso): <a href … data-imovel-id data-titulo data-valor data-capa>;
 * - "clássico" (Cilar, Habitec…): <a class="card-imovel" … data-id-imovel data-nome-imovel data-bairro
 *   data-cidade data-tipo-imovel data-qtd-quartos data-qtd-suites data-qtd-banheiros data-qtd-vagas data-valor-imovel>.
 */
function cardsPipeImob(html) {
  const ld = new Map();
  for (const d of jsonLd(html)) {
    if (d["@type"] !== "ItemList") continue;
    for (const el of d.itemListElement || []) {
      const it = el.item || {};
      if (it.url) ld.set(it.url, it.mainEntity || {});
    }
  }
  const porId = new Map();
  for (const m of String(html).matchAll(/<a\b([^>]*\bhref="https?:\/\/[^"]+\/imovel\/[^"]+"[^>]*)>/g)) {
    const attrs = m[1];
    const attr = (...nomes) => {
      for (const n of nomes) {
        const v = (attrs.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1];
        if (v != null && v !== "") return decodificar(v).trim();
      }
      return null;
    };
    const idImovel = attr("data-imovel-id", "data-id-imovel");
    if (!idImovel || porId.has(idImovel)) continue;
    const url = attr("href");
    // Modelo clássico: a capa é a primeira foto do carrossel logo depois do link.
    const depois = String(html).slice(m.index, m.index + 4000);
    const capa = attr("data-capa") ||
      ((depois.match(new RegExp(`https://cdn[\\w.-]*\\.pipeimob\\.com\\.br/[^"'\\s]*/${idImovel}/${idImovel}_[^"'\\s?]+`)) || [])[0] || null);
    porId.set(idImovel, {
      url,
      idImovel,
      ref: attr("data-ref-imovel"),
      titulo: attr("data-titulo", "data-nome-imovel"),
      valor: attr("data-valor", "data-valor-imovel"),
      capa,
      bairro: attr("data-bairro"),
      cidade: attr("data-cidade"),
      tipoTxt: attr("data-tipo-imovel"),
      quartos: attr("data-qtd-quartos"),
      suites: attr("data-qtd-suites"),
      banheiros: attr("data-qtd-banheiros"),
      vagas: attr("data-qtd-vagas"),
      ld: ld.get(url) || {},
    });
  }
  return [...porId.values()];
}

function imovelPipeImob(def, c, locacao) {
  const caminho = c.url.split("/imovel/")[1] || "";
  const slugUrl = caminho.split("/")[0];
  const tipo = tipoDeTexto(c.tipoTxt) ||
    tipoDeTexto(slugUrl.replace(/^(comprar|alugar)-/, "").replace(/-\d+-quartos?.*$/, "")) || tipoDeTexto(c.titulo);
  // "Casa em Condomínio à venda 4 quartos, 370 m² em Pinheirinho, Curitiba - Edifício Vigo": o último " em ".
  const local = (c.titulo || "").match(/^.* em (.+?), ([^,-]+?)(?:,\s*[A-Z]{2})?(?:\s+-\s+.*)?$/);
  const endereco = c.ld.address || {};
  const { logradouro, numero } = separarEndereco(endereco.streetAddress);
  const areaCard = ouNulo(c.ld.floorSize && Number(c.ld.floorSize.value)) ??
    ouNulo(Number(((c.titulo || "").match(/,\s*([\d.,]+)\s*m²/) || [])[1]?.replace(/\./g, "").replace(",", ".")));
  const quartos = Number(c.quartos) || Number((slugUrl.match(/-(\d+)-quartos?-/) || [])[1]) || null;
  const n = (v) => (v == null || v === "" ? null : ouNulo(Number(v)));
  return imovelBase(
    { id: def.id, nome: def.nome, contato: def.contato, informante: null },
    {
      id: `${def.id}-${c.idImovel}`,
      url_anuncio: `${def.base}/imovel/${caminho}`,
      titulo: c.titulo || deSlug(slugUrl),
      tipo,
      endereco: {
        logradouro: limparLogradouro(logradouro),
        numero,
        numero_informado: Boolean(numero),
        bairro: c.bairro || (local ? local[1].trim() : null),
        cidade: c.cidade || endereco.addressLocality || (local ? local[2].trim() : CIDADE),
        uf: endereco.addressRegion || "PR",
      },
      area_construida_m2: tipo === "terreno" ? null : areaCard,
      area_terreno_m2: tipo === "terreno" ? areaCard : null,
      preco_total: ouNulo(Number(c.valor)),
      dormitorios: tipo === "terreno" ? null : ouNulo(quartos),
      suites: tipo === "terreno" ? null : n(c.suites),
      banheiros: tipo === "terreno" ? null : n(c.banheiros),
      vagas_total: tipo === "terreno" ? null : n(c.vagas),
      condominio: tipo === "apartamento" || /condominio/.test(slugUrl) ? true : null,
      fotos: c.capa ? [c.capa] : [],
      foto_capa: c.capa,
      codigo_comum: c.ref || null,
      _locacao: locacao,
    },
  );
}

function aplicarDetalhePipeImob(im, html) {
  const anuncio = jsonLd(html).find((d) => d["@type"] === "RealEstateListing");
  if (!anuncio) throw erroLayout("anúncio sem JSON-LD RealEstateListing");
  const ent = anuncio.mainEntity || {};
  const fotos = (Array.isArray(anuncio.image) ? anuncio.image : [anuncio.image]).filter(Boolean);
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  if (anuncio.offers && anuncio.offers.price) im.preco_total = ouNulo(Number(anuncio.offers.price)) ?? im.preco_total;
  if (ent.address && ent.address.streetAddress) {
    const { logradouro, numero } = separarEndereco(ent.address.streetAddress);
    im.endereco.logradouro = limparLogradouro(logradouro);
    im.endereco.numero = numero;
    im.endereco.numero_informado = Boolean(numero);
  }
  const t = textoPipes(html);
  // Só rótulos com dois-pontos ("Quartos: | 3"): o formulário de filtros da página tem "Quartos | 1+".
  const campo = (rotulo) => campoPipes(t, `${rotulo}:`);
  const m2 = (rotulo) => ouNulo(area((campo(rotulo) || "").replace(/\s*m²/, "")));
  const tipoQuadro = tipoDeTexto(campo("Tipo"));
  if (tipoQuadro) im.tipo = tipoQuadro;
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("Área do terreno") ?? m2("Área total") ?? im.area_terreno_m2;
  } else {
    im.area_construida_m2 = m2("Área privativa") ?? m2("Área construída") ?? m2("Área útil") ?? im.area_construida_m2;
    // Modelo clássico não tem "Área do terreno": numa casa, a "Área total" maior que a privativa é o terreno.
    const total = m2("Área total");
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("Área do terreno") ?? (total && total > (im.area_construida_m2 || 0) ? total : null);
    const quartos = campo("Quartos") || "";
    im.dormitorios = ouNulo(Number((quartos.match(/^(\d+)/) || [])[1])) ?? ouNulo(ent.numberOfBedrooms) ?? im.dormitorios;
    im.suites = ouNulo(Number((quartos.match(/\((\d+)\s*su[ií]te/i) || [])[1])) ?? ouNulo(numeroBR(campo("Suítes"))) ?? im.suites;
    im.banheiros = ouNulo(numeroBR(campo("Banheiros"))) ?? ouNulo(ent.numberOfBathroomsTotal);
    im.vagas_total = ouNulo(numeroBR(campo("Vagas") || campo("Vagas de garagem"))) ?? im.vagas_total;
  }
  if (/condom[ií]nio/i.test(campo("Tipo") || "")) im.condominio = true;
  // Descrição + características. Modelo portal: "Características da unidade" … "Localização";
  // modelo clássico: "Localização" … "Características" … "Simule seu financiamento". Depois vêm outros imóveis.
  let ini = t.indexOf("Características da unidade");
  let fim = t.indexOf("| Localização |", ini);
  if (ini < 0) {
    ini = t.indexOf("| Características |");
    fim = t.indexOf("Simule seu financiamento", ini);
  }
  lerTextoAnuncio(im, `${anuncio.description || ""} | ${ini >= 0 ? t.slice(ini, fim > ini ? fim : ini + 4000) : ""}`);
  im.detalhe_coletado = true;
}

const TIPOS_PIPEIMOB = { casa: ["casa"], apartamento: ["apartamento"], terreno: ["terreno"] };

/** Uma varredura da rede por busca: as associadas pedidas na mesma busca compartilham o resultado. */
const varredurasUna = new WeakMap();

function varrerRedeUna(filtros, { http, cfg, log }) {
  if (varredurasUna.has(filtros)) return varredurasUna.get(filtros);
  const promessa = (async () => {
    // Sinal próprio: o timeout de uma associada não interrompe a varredura que as outras esperam.
    const get = cliente(http, cfg, { abortado: false });
    const finalidade = ehLocacao(filtros) ? "alugar" : "venda";
    const bairros = filtros.bairros.length ? filtros.bairros.map((b) => slug(b).replace(/-/g, "_")) : [null];
    const maxPaginas = cfg.max_paginas_rede || 40;
    const cards = new Map();
    let paginas = 0;
    let reconhecida = false;
    for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => TIPOS_PIPEIMOB[t] || []))]) {
      for (const bairro of bairros) {
        const base = `${PORTAL_UNA}/imoveis/${finalidade}/curitiba/${bairro ? `${bairro}/` : ""}${tipoSite}`;
        for (let pag = 1; pag <= maxPaginas; pag++) {
          let html;
          try {
            html = String(await get(pag === 1 ? base : `${base}?page=${pag}`, { headers: { "User-Agent": UA } }));
          } catch (e) {
            if (pag === 1 && /404/.test(e.message)) break; // bairro sem imóveis desse tipo
            throw e;
          }
          paginas++;
          reconhecida ||= /id="(?:imoveis-grid|busca-imoveis|imoveis-list|grid-imoveis)"/.test(html);
          let novos = 0;
          for (const c of cardsPipeImob(html)) if (!cards.has(c.idImovel)) { cards.set(c.idImovel, { ...c, tipoSite }); novos++; }
          if (!novos) break;
        }
      }
    }
    if (!reconhecida) throw erroLayout("listagem da Rede UNA não reconhecida");
    log(`rede UNA: ${cards.size} anúncios em ${paginas} páginas (varredura compartilhada pelas associadas)`);
    return [...cards.values()];
  })();
  varredurasUna.set(filtros, promessa);
  return promessa;
}

const criarConectorPipeImob = (def) => async function conectorPipeImob({ filtros, http, cfg, sinal, avaliar, log }) {
  const locacao = ehLocacao(filtros);
  const cards = await varrerRedeUna(filtros, { http, cfg, log });
  const proprios = cards.filter((c) => def.codigos.includes(String(c.ref || "").split("-").pop()));
  const imoveis = proprios
    .map((c) => imovelPipeImob(def, c, locacao))
    .filter((i) => i.tipo && filtros.tipos.includes(i.tipo) && ehCuritiba(i.endereco.cidade) && bairroPedido(filtros, i.endereco.bairro));
  const get = cliente(http, cfg, sinal);
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar);
  log(`${def.id}: ${imoveis.length} imóveis próprios (${def.codigos.join("/")}) na rede; abrindo ${Math.min(paraDetalhar.length, cfg.max_detalhes)} detalhes`);
  await abrirDetalhes(def, paraDetalhar, { get, cfg, sinal, log }, aplicarDetalhePipeImob);
  return limparAuxiliares(imoveis);
};

// ======================================================================
// IC Informática (InfoCenter). A busca do site é montada em JavaScript; a lista de anúncios sai do
// sitemap (/sitemap): /imovel/{venda|locacao}/{tipo}-em-curitiba-pr[-no-bairro-{bairro}]-{id}.
// O anúncio traz o quadro "Detalhes do Imóvel" (Endereço, Bairro, Área, Dormitórios…) e a galeria.
// ======================================================================

const IC = [
  { id: "calluf", nome: "Calluf Imóveis", base: "https://www.callufimoveis.com.br", contato: "(41) 99544-3864" },
  { id: "casa722", nome: "Casa722 Imóveis", base: "https://www.casa722.com.br", contato: "(41) 99161-2611" },
  { id: "cielo", nome: "Cielo Imóveis", base: "https://www.cieloimoveis.com.br", contato: "(41) 99587-1430" },
  { id: "view", nome: "View Imóveis", base: "https://www.viewimoveis.com.br", contato: "(41) 3015-3023" },
];

function aplicarDetalheIC(im, html) {
  const t = textoPipes(html);
  const ini = t.indexOf("Detalhes do Imóvel");
  if (ini < 0) throw erroLayout("anúncio sem o quadro Detalhes do Imóvel");
  const quadro = t.slice(ini, ini + 3000);
  const campo = (rotulo) => campoPipes(quadro, rotulo);
  const m2 = (rotulo) => ouNulo(area((campo(rotulo) || "").replace(/\s*m²/, "")));
  const id = im.id.split("-").pop();
  // Galeria: a foto grande fica no href (/crm/fotosimovel/{id}/… ou /crm/cdn/{imob}/{id}/…; lançamentos usam o CDN da Órulo).
  const fotos = [...new Set([
    ...[...String(html).matchAll(/href="(https:\/\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]).filter((u) => u.includes(`/${id}/`) || /orulo\.com\.br\/images\/properties\/large\//.test(u)),
    ...(String(html).match(new RegExp(`https://[^"'\\s)]+/crm/cdn/\\d+/${id}/[0-9a-f]+\\.(?:jpe?g|png|webp)`, "gi")) || []),
  ])].filter((u) => !/_300\.\w+$/.test(u));
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  } else {
    const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
    if (og) {
      im.fotos = [og];
      im.foto_capa = og;
    }
  }
  const { logradouro, numero } = separarEndereco(campo("Endereço"));
  im.endereco = {
    logradouro: limparLogradouro(logradouro),
    numero,
    numero_informado: Boolean(numero),
    bairro: campo("Bairro") || im.endereco.bairro,
    cidade: campo("Município") || im.endereco.cidade,
    uf: campo("UF") || "PR",
  };
  const preco = campo("Valor total") || campo(im._locacao ? "Loca[çc][ãa]o" : "Venda");
  im.preco_total = ouNulo(numeroBR(preco)) ?? im.preco_total;
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("Área do terreno") ?? m2("Área terreno") ?? m2("Área total") ?? m2("Área privativa");
  } else {
    im.area_construida_m2 = m2("Área construída") ?? m2("Área privativa") ?? m2("Área útil") ?? (im.tipo === "apartamento" ? m2("Área total") : null);
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("Área do terreno") ?? m2("Área terreno") ?? m2("Área total");
    im.dormitorios = ouNulo(numeroBR(campo("Dormitórios")));
    im.suites = ouNulo(numeroBR(campo("Suítes")));
    im.banheiros = ouNulo(numeroBR(campo("Banheiros")));
    im.vagas_total = ouNulo(numeroBR(campo("Vagas de Garagens") || campo("Vagas")));
  }
  const titulo = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
  if (titulo) im.titulo = semEntidades(titulo).replace(/\s*(?:Refer[êe]ncia|Ref:).*$/i, "").trim() || im.titulo;
  if (/condom[ií]nio/i.test(`${im.titulo} ${t.slice(0, ini)}`) || im.tipo === "apartamento") im.condominio = true;
  const iniDesc = t.indexOf("| Descrição |");
  lerTextoAnuncio(im, iniDesc >= 0 && iniDesc < ini ? t.slice(iniDesc, ini) : "");
  im.detalhe_coletado = true;
}

const criarConectorIC = (def) => async function conectorIC({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const finalidade = ehLocacao(filtros) ? "locacao" : "venda";
  const xml = String(await get(`${def.base}/sitemap`, { headers: { "User-Agent": UA } }));
  const links = [...xml.matchAll(/<loc>(https?:\/\/[^<]+\/imovel\/(venda|locacao)\/([a-z0-9-]+)-(\d+))<\/loc>/g)];
  if (!/<urlset/.test(xml)) throw erroLayout("sitemap não reconhecido");
  const candidatos = links
    .filter(([, , fin, s]) => fin === finalidade && /-em-curitiba-pr(-|$)/.test(s))
    .map(([, url, , s, idAnuncio]) => {
      const [tipoTxt, resto] = s.split("-em-curitiba-pr");
      const bairroSlug = (resto.match(/^-no-bairro-(.+)$/) || [])[1] || "";
      return { url, idAnuncio, tipo: tipoDeTexto(tipoTxt), bairroSlug };
    })
    .filter((c) => c.tipo && filtros.tipos.includes(c.tipo) && bairroPedido(filtros, c.bairroSlug))
    .sort((a, b) => Number(b.idAnuncio) - Number(a.idAnuncio)); // mais recentes primeiro

  const imoveis = candidatos.map((c) =>
    imovelBase(
      { id: def.id, nome: def.nome, contato: def.contato, informante: null },
      {
        id: `${def.id}-${c.idAnuncio}`,
        url_anuncio: c.url,
        titulo: deSlug(c.url.split("/").pop().replace(/-\d+$/, "")),
        tipo: c.tipo,
        endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(c.bairroSlug), cidade: CIDADE, uf: "PR" },
        area_construida_m2: null,
        area_terreno_m2: null,
        preco_total: null,
        dormitorios: null,
        _locacao: finalidade === "locacao",
      },
    ),
  );
  log(`${def.id}: ${links.length} anúncios no sitemap, ${imoveis.length} de Curitiba do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(def, imoveis, { get, cfg, sinal, log }, aplicarDetalheIC);
  // Sem a página do anúncio não há preço nem área: fica de fora.
  return limparAuxiliares(imoveis.filter((i) => i.detalhe_coletado && ehCuritiba(i.endereco.cidade)));
};

// ======================================================================
// Tecimob (Next.js). A listagem /{comprar|alugar}/{casa|apartamento|terreno}?offset=N (21 por página)
// traz no __NEXT_DATA__ áreas, cômodos, bairro/cidade, preço e fotos. O anúncio acrescenta rua e descrição.
// ======================================================================

const TECIMOB = [
  { id: "sawasaki", nome: "Sawasaki Imóveis", base: "https://sawasakiimoveis.com.br", contato: "(41) 3296-9942" },
  { id: "gm2", nome: "GM2 Imóveis", base: "https://gm2imoveis.com.br", contato: "(41) 99997-6722" },
];

function estadoTecimob(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const d = m && parseJsonSeguro(m[1]);
  const st = d && d.props && d.props.initialState;
  if (!st) throw erroLayout("página sem __NEXT_DATA__ da Tecimob");
  return st;
}

const valorTecimob = (x) => (x && x.value != null ? ouNulo(area(String(x.value))) : null);

function imovelTecimob(def, p, locacao) {
  const tipoSite = (p.subtype && p.subtype.type && p.subtype.type.title) || "";
  const tipo = tipoDeTexto(`${tipoSite} ${(p.subtype && p.subtype.title) || ""}`) || tipoDeTexto(tipoSite);
  // "Uberaba - Curitiba/PR"
  const [, bairro, cidade, uf] = String((p.address && p.address.formatted) || "").match(/^(?:(.*?) - )?([^/]+)\/([A-Z]{2})$/) || [];
  const areas = p.areas || {};
  const rooms = p.rooms && !Array.isArray(p.rooms) ? p.rooms : {};
  const fotos = (p.images || []).map((i) => i.file_url && (i.file_url.large || i.file_url.medium)).filter(Boolean);
  const construida = valorTecimob(areas.built_area) ?? valorTecimob(areas.private_area) ?? valorTecimob(areas.primary_area && areas.primary_area.name !== "total_area" && areas.primary_area.name !== "ground_total_area" ? areas.primary_area : null);
  const terreno = valorTecimob(areas.ground_total_area) ?? valorTecimob(areas.total_area);
  const im = imovelBase(
    { id: def.id, nome: def.nome, contato: def.contato, informante: null },
    {
      id: `${def.id}-${p.reference || p.id}`,
      url_anuncio: `${def.base}/imovel/${p.url}`,
      titulo: p.title_formatted || p.meta_title || `${tipoSite} – ${bairro || ""}`,
      tipo,
      endereco: {
        logradouro: limparLogradouro(p.address && p.address.street) || null,
        numero: p.address && p.address.street_number ? String(p.address.street_number) : null,
        numero_informado: Boolean(p.address && p.address.street_number),
        bairro: bairro || null,
        cidade: cidade || CIDADE,
        uf: uf || "PR",
      },
      area_construida_m2: tipo === "terreno" ? null : construida,
      area_terreno_m2: tipo === "apartamento" ? null : terreno,
      preco_total: ouNulo(numeroBR(p.price)),
      dormitorios: tipo === "terreno" ? null : ouNulo(rooms.bedroom && rooms.bedroom.value),
      suites: tipo === "terreno" ? null : ouNulo(rooms.suite && rooms.suite.value),
      banheiros: tipo === "terreno" ? null : ouNulo(rooms.bathroom && rooms.bathroom.value),
      vagas_total: tipo === "terreno" ? null : ouNulo(rooms.garage && rooms.garage.value),
      condominio: tipo === "apartamento" || /condom/i.test(`${(p.subtype && p.subtype.title) || ""} ${p.title_formatted || ""}`) ? true : null,
      fotos,
      foto_capa: fotos[0] || null,
      detalhe_coletado: fotos.length > 1,
      _locacao: locacao,
    },
  );
  return im;
}

function aplicarDetalheTecimob(im, html) {
  const st = estadoTecimob(html);
  const p = st.property && (st.property.data || st.property);
  if (!p || !p.address) throw erroLayout("anúncio sem dados do imóvel");
  if (p.address.street) {
    im.endereco.logradouro = limparLogradouro(p.address.street);
    im.endereco.numero = p.address.street_number ? String(p.address.street_number) : null;
    im.endereco.numero_informado = Boolean(p.address.street_number);
  }
  if (p.condominium || p.is_condominium_shown) im.condominio = true;
  const caract = [...(p.characteristics || []), ...(p.condo_characteristics || [])].map((c) => c.title).join(" | ");
  lerTextoAnuncio(im, `${String(p.description || "").replace(/<[^>]+>/g, " ")} | ${caract}`);
  im.detalhe_coletado = true;
}

const TIPOS_TECIMOB = { casa: ["casa"], apartamento: ["apartamento"], terreno: ["terreno"] };

const criarConectorTecimob = (def) => async function conectorTecimob({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const locacao = ehLocacao(filtros);
  const vistos = new Map();
  let paginas = 0;
  for (const tipoSite of [...new Set(filtros.tipos.flatMap((t) => TIPOS_TECIMOB[t] || []))]) {
    for (let pag = 1; pag <= cfg.max_paginas; pag++) {
      const st = estadoTecimob(await get(`${def.base}/${locacao ? "alugar" : "comprar"}/${tipoSite}?offset=${pag}`, { headers: { "User-Agent": UA } }));
      paginas++;
      const lista = (st.properties && st.properties.data) || [];
      for (const p of lista) {
        const transacao = String(p.transaction || "").toUpperCase();
        if (locacao ? !/LOCA|ALUG/.test(transacao) : transacao !== "VENDA") continue;
        if (!vistos.has(p.id)) vistos.set(p.id, imovelTecimob(def, p, locacao));
      }
      const pg = (st.properties && st.properties.meta && st.properties.meta.pagination) || {};
      if (!lista.length || !pg.total_pages || pag >= pg.total_pages) break;
    }
  }
  const imoveis = [...vistos.values()].filter(
    (i) => i.tipo && filtros.tipos.includes(i.tipo) && ehCuritiba(i.endereco.cidade) && bairroPedido(filtros, i.endereco.bairro),
  );
  const paraDetalhar = priorizarDetalhes(imoveis, filtros, avaliar);
  log(`${def.id}: ${imoveis.length} imóveis de Curitiba em ${paginas} páginas; abrindo ${Math.min(paraDetalhar.length, cfg.max_detalhes)} detalhes`);
  await abrirDetalhes(def, paraDetalhar, { get, cfg, sinal, log }, aplicarDetalheTecimob);
  return limparAuxiliares(imoveis);
};

// ======================================================================
// Supremo CRM. Listagem /imoveis.php?para={vender|alugar}&cidade=6015&pagina=N (12 por página, 6015 = Curitiba)
// com tipo, quartos, banheiros, vagas e preço no card; o anúncio tem o endereço e o quadro "Detalhes do Imóvel".
// ======================================================================

const SUPREMO = [
  { id: "primesoho", nome: "Prime Soho Imóveis", base: "https://primesoho.com.br", contato: "(41) 3223-7200", cidadeId: "6015" },
  { id: "bembrasil", nome: "Bem Brasil Imóveis", base: "https://bembrasilimoveis.com.br", contato: "(41) 99988-0980", cidadeId: "6015" },
];

function cardsSupremo(html, base) {
  // Cada card tem mais de um link para o mesmo imóvel (foto, título, botão): junta os dados por id.
  const porId = new Map();
  const partes = String(html).split(`href="${base}/imovel/`);
  for (const p of partes.slice(1)) {
    const m = p.match(/^(\d+)\/([^"]+)"/);
    if (!m) continue;
    const trecho = p.slice(0, 3000);
    const num = (rotulo) => {
      const r = textoPipes(trecho).match(new RegExp(`(\\d+)\\s*${rotulo}`, "i"));
      return r ? Number(r[1]) : null;
    };
    const card = {
      id: m[1],
      url: `${base}/imovel/${m[1]}/${m[2]}`,
      foto: (trecho.match(/<img src="([^"]+)"/) || [])[1] || null,
      tipoTxt: textoPipes((trecho.match(/<span class="tag">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/\|/g, "").trim(),
      titulo: semEntidades((trecho.match(/alt="([^"]+)"/) || [])[1] || ""),
      quartos: num("Quartos?"),
      banheiros: num("Banheiros?"),
      vagas: num("Vagas?"),
      preco: numeroBR((trecho.match(/preco_imovel[^>]*>\s*<b>([^<]+)/) || [])[1]),
    };
    const atual = porId.get(card.id) || {};
    for (const [k, v] of Object.entries(card)) if (v != null && v !== "" && (atual[k] == null || atual[k] === "")) atual[k] = v;
    porId.set(card.id, atual);
  }
  return [...porId.values()];
}

function aplicarDetalheSupremo(im, html) {
  const t = textoPipes(html);
  const ini = t.indexOf("Detalhes do Imóvel");
  if (ini < 0) throw erroLayout("anúncio sem o quadro Detalhes do Imóvel");
  const quadro = t.slice(ini, ini + 2500);
  const campo = (rotulo) => campoPipes(quadro, rotulo);
  const m2 = (rotulo) => ouNulo(area((campo(rotulo) || "").replace(/\s*m²/, "")));
  const finalidade = campo("Finalidade") || "";
  if (im._locacao ? /vender|venda/i.test(finalidade) && !/alug|loca/i.test(finalidade) : /alug|loca/i.test(finalidade) && !/vend/i.test(finalidade))
    throw new Error("finalidade diferente da pedida");
  // "(COD: 187241) | Rua Professor Francisco Basseti Júnior, 351, Cascatinha, Curitiba/PR - Condomínio: …"
  const linha = (t.match(/\(COD:\s*\d+\)\s*\|\s*([^|]+?)\s*\|/) || [])[1] || "";
  const [, enderecoTxt = "", cidadeTxt = "", uf = "PR"] = linha.replace(/\s+-\s+Condom[ií]nio:.*$/i, "").match(/^(.*),\s*([^,/]+)\/([A-Z]{2})$/) || [];
  const partes = enderecoTxt.split(",").map((x) => x.trim()).filter(Boolean);
  const bairro = partes.length ? partes.pop() : null;
  const { logradouro, numero } = separarEndereco(partes.join(", "));
  im.endereco = {
    logradouro: limparLogradouro(logradouro),
    numero,
    numero_informado: Boolean(numero),
    bairro: bairro || im.endereco.bairro,
    cidade: cidadeTxt.trim() || im.endereco.cidade,
    uf,
  };
  const tipoQuadro = tipoDeTexto(campo("Tipo"));
  if (tipoQuadro) im.tipo = tipoQuadro;
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("Área Total") ?? m2("Área do Terreno") ?? m2("Área Privativa");
  } else {
    im.area_construida_m2 = m2("Área Construída") ?? m2("Área Privativa") ?? m2("Área Útil");
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("Área do Terreno") ?? m2("Área Total");
    im.dormitorios = ouNulo(numeroBR(campo("Quartos"))) ?? im.dormitorios;
    im.suites = ouNulo(numeroBR(campo("Suítes")));
    im.banheiros = ouNulo(numeroBR(campo("Banheiros"))) ?? im.banheiros;
    im.vagas_total = ouNulo(numeroBR(campo("Vagas"))) ?? im.vagas_total;
  }
  if (/condom[ií]nio/i.test(`${campo("Tipo") || ""} ${linha}`) || im.tipo === "apartamento") im.condominio = true;
  const id = im.id.split("-").pop();
  const fotos = [...new Set(String(html).match(new RegExp(`https://cdn\\.sistemasupremo\\.com\\.br/\\d+/imoveis/${id}/g_[^"'\\s)]+?\\.(?:jpe?g|png|webp)`, "gi")) || [])];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const iniDesc = t.indexOf("| DESCRIÇÃO |");
  lerTextoAnuncio(im, `${iniDesc >= 0 ? t.slice(iniDesc, ini) : ""} | ${t.slice(ini, ini + 4000)}`);
  im.detalhe_coletado = true;
}

const criarConectorSupremo = (def) => async function conectorSupremo({ filtros, http, cfg, sinal, avaliar, log }) {
  const get = cliente(http, cfg, sinal);
  const locacao = ehLocacao(filtros);
  const vistos = new Map();
  let paginas = 0;
  let reconhecida = false;
  for (let pag = 1; pag <= cfg.max_paginas; pag++) {
    const url = `${def.base}/imoveis.php?para=${locacao ? "alugar" : "vender"}&cidade=${def.cidadeId}&pagina=${pag}`;
    const html = String(await get(url, { headers: { "User-Agent": UA } }));
    paginas++;
    reconhecida ||= html.includes("preco_imovel") || html.includes("imov_caract") || /Nenhum im[óo]vel/i.test(html);
    let novos = 0;
    for (const c of cardsSupremo(html, def.base)) {
      if (vistos.has(c.id)) continue;
      novos++;
      const tipo = tipoDeTexto(c.tipoTxt) || tipoDeTexto(c.titulo);
      vistos.set(c.id, imovelBase(
        { id: def.id, nome: def.nome, contato: def.contato, informante: null },
        {
          id: `${def.id}-${c.id}`,
          url_anuncio: c.url,
          titulo: c.titulo || c.tipoTxt,
          tipo,
          endereco: { logradouro: null, numero: null, numero_informado: false, bairro: null, cidade: CIDADE, uf: "PR" },
          area_construida_m2: null,
          area_terreno_m2: null,
          preco_total: ouNulo(c.preco),
          dormitorios: tipo === "terreno" ? null : ouNulo(c.quartos),
          banheiros: tipo === "terreno" ? null : ouNulo(c.banheiros),
          vagas_total: tipo === "terreno" ? null : ouNulo(c.vagas),
          condominio: tipo === "apartamento" || /condom/i.test(c.tipoTxt) ? true : null,
          fotos: c.foto ? [c.foto] : [],
          foto_capa: c.foto,
          _locacao: locacao,
        },
      ));
    }
    if (!novos) break;
  }
  if (!reconhecida) throw erroLayout("listagem da Supremo não reconhecida");
  // O card não traz bairro nem área: o filtro de bairro vale depois do anúncio.
  const candidatos = [...vistos.values()].filter((i) => i.tipo && filtros.tipos.includes(i.tipo));
  const paraDetalhar = priorizarDetalhes(candidatos, filtros, avaliar);
  log(`${def.id}: ${candidatos.length} imóveis em ${paginas} páginas; abrindo ${Math.min(paraDetalhar.length, cfg.max_detalhes)} detalhes`);
  await abrirDetalhes(def, paraDetalhar, { get, cfg, sinal, log }, aplicarDetalheSupremo);
  return limparAuxiliares(
    candidatos.filter((i) => i.detalhe_coletado && i.tipo && filtros.tipos.includes(i.tipo) && ehCuritiba(i.endereco.cidade) && bairroPedido(filtros, i.endereco.bairro)),
  );
};

// ======================================================================
// Imobibrasil (Galo Imóveis). HTML em ISO-8859-1. A lista de anúncios sai do sitemap:
// /imovel/{id}/{tipo}-{venda|locacao}-curitiba-pr-{bairro}. O anúncio tem Product em JSON-LD,
// "Endereço:", "Bairro:", "Área Total:", "Área Útil:" e a galeria (fotos antes do mapa).
// ======================================================================

const IMOBIBRASIL = [{ id: "galo", nome: "Galo Imóveis", base: "https://www.galoimoveis.com.br", contato: "(41) 3342-1516" }];

function aplicarDetalheImobibrasil(im, html) {
  const fim = html.indexOf("Mapa de Localiza");
  const galeria = fim > 0 ? html.slice(0, fim) : html;
  const fotos = [...new Set((galeria.match(/https:\/\/[^"'\s)]+\/imagens\/imoveis\/\d+\.(?:jpe?g|png|webp)/gi) || []))];
  if (fotos.length) {
    im.fotos = fotos;
    im.foto_capa = fotos[0];
  }
  const produto = jsonLd(html).find((d) => d["@type"] === "Product");
  if (produto && produto.offers) im.preco_total = ouNulo(Number(produto.offers.price)) ?? im.preco_total;
  const t = textoPipes(html);
  const campo = (rotulo) => {
    const m = t.match(new RegExp(`\\|\\s*${rotulo}:\\s*\\|\\s*([^|]+?)\\s*\\|`, "i"));
    return m ? m[1].trim() : null;
  };
  const m2 = (rotulo) => ouNulo(area((campo(rotulo) || "").replace(/\s*m²/, "")));
  const { logradouro, numero } = separarEndereco(campo("Endereço"));
  im.endereco.logradouro = limparLogradouro(logradouro);
  im.endereco.numero = numero;
  im.endereco.numero_informado = Boolean(numero);
  im.endereco.bairro = campo("Bairro") || im.endereco.bairro;
  // Bloco de números: "R$ 950.000 | 4 | Dormitórios | 1 | Suíte | 1 | Banheiro | 3 | Vagas"
  const iniNums = t.indexOf("Compartilhar:");
  const nums = iniNums >= 0 ? t.slice(iniNums, iniNums + 400) : "";
  const antes = (rotulo) => {
    const m = nums.match(new RegExp(`(\\d+)\\s*\\|\\s*${rotulo}`, "i"));
    return m ? Number(m[1]) : null;
  };
  if (im.tipo === "terreno") {
    im.area_terreno_m2 = m2("Área Total") ?? m2("Área do Terreno") ?? m2("Área Terreno");
  } else {
    im.area_construida_m2 = m2("Área Construída") ?? m2("Área Útil") ?? m2("Área Privativa") ?? (im.tipo === "apartamento" ? m2("Área Total") : null);
    im.area_terreno_m2 = im.tipo === "apartamento" ? null : m2("Área do Terreno") ?? m2("Área Terreno") ?? m2("Área Total");
    im.dormitorios = ouNulo(antes("Dormit"));
    im.suites = ouNulo(antes("Su[ií]te"));
    im.banheiros = ouNulo(antes("Banheiro"));
    im.vagas_total = ouNulo(antes("Vaga"));
  }
  if (im.tipo === "apartamento" || /condom[ií]nio/i.test(im.titulo)) im.condominio = true;
  const titulo = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
  if (titulo) im.titulo = semEntidades(titulo);
  const ini = t.indexOf("Descrição do Imóvel");
  const fimDesc = t.indexOf("Mapa de Localiza", ini);
  if (ini >= 0) lerTextoAnuncio(im, t.slice(ini, fimDesc > ini ? fimDesc : ini + 6000));
  im.detalhe_coletado = true;
}

const criarConectorImobibrasil = (def) => async function conectorImobibrasil({ filtros, http, cfg, sinal, log }) {
  const get = cliente(http, cfg, sinal);
  const finalidade = ehLocacao(filtros) ? "locacao" : "venda";
  const xml = String(await get(`${def.base}/sitemap.xml`, { headers: { "User-Agent": UA } }));
  if (!/<urlset/.test(xml)) throw erroLayout("sitemap não reconhecido");
  const links = [...xml.matchAll(/<loc>(https?:\/\/[^<]+\/imovel\/(\d+)\/([a-z0-9-]+))<\/loc>/g)];
  const candidatos = links
    .map(([, url, idAnuncio, s]) => {
      const m = s.match(/^(.+?)-(venda|locacao)-([a-z0-9-]+?)-([a-z]{2})(?:-(.+))?$/);
      return m && { url, idAnuncio, tipo: tipoDeTexto(m[1]), fin: m[2], cidade: m[3], bairroSlug: m[5] || "" };
    })
    .filter((c) => c && c.fin === finalidade && c.cidade === "curitiba" && c.tipo && filtros.tipos.includes(c.tipo) && bairroPedido(filtros, c.bairroSlug))
    .sort((a, b) => Number(b.idAnuncio) - Number(a.idAnuncio));
  const imoveis = candidatos.map((c) =>
    imovelBase(
      { id: def.id, nome: def.nome, contato: def.contato, informante: null },
      {
        id: `${def.id}-${c.idAnuncio}`,
        url_anuncio: c.url,
        titulo: deSlug(c.url.split("/").pop()),
        tipo: c.tipo,
        endereco: { logradouro: null, numero: null, numero_informado: false, bairro: deSlug(c.bairroSlug), cidade: CIDADE, uf: "PR" },
        area_construida_m2: null,
        area_terreno_m2: null,
        preco_total: null,
        dormitorios: null,
      },
    ),
  );
  log(`${def.id}: ${links.length} anúncios no sitemap, ${imoveis.length} de Curitiba do tipo/bairro pedido; abrindo ${Math.min(imoveis.length, cfg.max_detalhes)}`);
  await abrirDetalhes(def, imoveis, { get, cfg, sinal, log }, aplicarDetalheImobibrasil, { binario: true });
  return imoveis.filter((i) => i.detalhe_coletado);
};

// ======================================================================
// Cadastro: id → { nome, conector }. Fora da lista: Favretto (CasaSoft; em Curitiba só anuncia áreas e
// barracões), Patrial e J Godoi (Code49; área e bairro só no texto livre), Hostert (certificado HTTPS inválido),
// Casa ao Lado e Andrade (rede UNA, mas fora do padrão de URLs da PipeImob).
// ======================================================================

const FONTES_CURITIBA = {};
for (const def of PIPEIMOB) FONTES_CURITIBA[def.id] = { nome: def.nome, conector: criarConectorPipeImob(def) };
for (const def of IC) FONTES_CURITIBA[def.id] = { nome: def.nome, conector: criarConectorIC(def) };
for (const def of TECIMOB) FONTES_CURITIBA[def.id] = { nome: def.nome, conector: criarConectorTecimob(def) };
for (const def of SUPREMO) FONTES_CURITIBA[def.id] = { nome: def.nome, conector: criarConectorSupremo(def) };
for (const def of IMOBIBRASIL) FONTES_CURITIBA[def.id] = { nome: def.nome, conector: criarConectorImobibrasil(def) };

export { FONTES_CURITIBA };
