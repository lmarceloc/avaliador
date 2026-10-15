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

// Ajustes por fonte que valem sempre (CONFIG_FONTES no nó Code ainda pode sobrescrever).
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
// Plataforma SysOne (Flow, Adquira, Conceito) — HTML server-side
// Busca: /busca/venda/tipo_casa/cidade_ponta-grossa/bairro_orfas/valormin_X/valormax_Y/mostrar_100/pag_2
// ======================================================================

const SYSONE = {
  flow: { id: "flow", nome: "Flow Imobiliária", base: "https://flowimobiliaria.com.br" },
  adquira: { id: "adquira", nome: "Adquira Imóveis", base: "https://adquiraimoveis.net" },
  conceito: { id: "conceito", nome: "Conceito Imóveis", base: "https://conceitoimoveispg.com.br" },
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

  return imovelBase(
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
  kikina: conectorKikina,
  casatop: conectorCasaTop,
  classica: conectorClassica,
  madol: conectorMadol,
  tavarnaro: conectorTavarnaro,
  aspen: conectorAspen,
  torre_branca: conectorTorreBlanca,
};
const NOMES = {
  flow: SYSONE.flow.nome, adquira: SYSONE.adquira.nome, conceito: SYSONE.conceito.nome, kikina: KIKINA.nome,
  casatop: CASATOP.nome, classica: CLASSICA.nome, madol: MADOL.nome, tavarnaro: TAVARNARO.nome, aspen: ASPEN.nome,
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
