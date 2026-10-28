// Busca simulada: imita o backend seguindo o contrato da seção 5, para rodar o front sem a VPS.
// Ativo quando BACKEND_URL não está definido. Nada aqui é dado real.

import type { FonteResumo, Imovel, RequisicaoBusca, RespostaBusca, TipoImovel } from "./contrato";
import { nomeFonte } from "./fontes";
import { processarImoveis } from "./regras";
import { normalizarBairro, semAcento } from "./bairros";

const ATRASO_MS: Record<string, number> = { flow: 2500, kikina: 4500, adquira: 3500, torre_branca: 5500 };

function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const BAIRROS = ["Órfãs", "Chapada", "Jd. Carvalho", "Oficinas", "Centro", "Estrela", "Uvaranas", "Olarias", "Colonia Dona Luiza", "Nova Rússia", "Ronda", "Boa Vista"];
const RUAS = ["Rua Balduíno Taques", "Rua Ermelino de Leão", "Av. Visconde de Taunay", "Rua Comendador Miró", "Rua Tiradentes", "Rua Paula Xavier", "Av. Ernesto Vilela", "Rua XV de Novembro", "Rua Rodrigues Alves", "Rua Enfermeiro Paulino"];
const PADROES = ["2.4 Simples", "2.5 Médio", "2.6 Superior", null];
const CONTATOS: Record<string, [string, string]> = {
  flow: ["Corretor Flow (simulado)", "(42) 0000-0001"],
  kikina: ["Corretor Kikina (simulado)", "(42) 0000-0002"],
  adquira: ["Corretor Adquira (simulado)", "(42) 0000-0003"],
  torre_branca: ["Corretor Torre Branca (simulado)", "(42) 0000-0004"],
};

interface Base {
  tipo: TipoImovel;
  bairro: string;
  rua: string | null;
  numero: string | null;
  area: number | null;
  terreno: number | null;
  preco: number;
  dorm: number | null;
  suites: number | null;
  ban: number | null;
  vagas: number | null;
  pav: number | null;
  cond: boolean | null;
  lazer: boolean | null;
  piscina: boolean | null;
}

function gerarBase(r: () => number): Base {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const tipo = pick<TipoImovel>(["casa", "casa", "casa", "apartamento", "apartamento", "terreno"]);
  const temEndereco = r() > 0.35;
  if (tipo === "terreno") {
    const terreno = Math.round(250 + r() * 900);
    return {
      tipo, bairro: pick(BAIRROS), rua: temEndereco ? pick(RUAS) : null, numero: null,
      area: null, terreno, preco: Math.round((terreno * (450 + r() * 700)) / 1000) * 1000,
      dorm: null, suites: null, ban: null, vagas: null, pav: null, cond: r() > 0.8, lazer: null, piscina: null,
    };
  }
  const area = r() > 0.15 ? Math.round(55 + r() * (tipo === "casa" ? 320 : 140)) : null;
  const dorm = 1 + Math.floor(r() * 4);
  const precoM2 = 3800 + r() * 4200 + (r() > 0.93 ? 9000 : 0); // alguns outliers propositais
  return {
    tipo,
    bairro: pick(BAIRROS),
    rua: temEndereco ? pick(RUAS) : null,
    numero: temEndereco && r() > 0.3 ? String(100 + Math.floor(r() * 1900)) : null,
    area,
    terreno: tipo === "casa" ? Math.round(200 + r() * 600) : null,
    preco: Math.round(((area ?? 150) * precoM2) / 1000) * 1000,
    dorm: r() > 0.05 ? dorm : null,
    suites: r() > 0.25 ? Math.floor(r() * Math.min(dorm, 3)) : null,
    ban: r() > 0.1 ? 1 + Math.floor(r() * 3) : null,
    vagas: r() > 0.1 ? Math.floor(r() * 4) : null,
    pav: tipo === "casa" ? (r() > 0.3 ? 1 + Math.floor(r() * 2) : null) : 1,
    cond: tipo === "apartamento" ? true : r() > 0.75 ? true : r() > 0.2 ? false : null,
    lazer: r() > 0.3 ? r() > 0.45 : null,
    piscina: r() > 0.3 ? r() > 0.75 : null,
  };
}

function montarImovel(fonte: string, codigo: string, b: Base, r: () => number, variacaoPreco = 0): Imovel {
  const [informante, contato] = CONTATOS[fonte] ?? ["Corretor (simulado)", null];
  const nFotos = r() > 0.08 ? 4 + Math.floor(r() * 12) : 0;
  const fotos = Array.from({ length: nFotos }, (_, k) => `https://picsum.photos/seed/${fonte}-${codigo}-${k}/960/640`);
  const rotulo = { casa: "Casa", apartamento: "Apartamento", terreno: "Terreno" }[b.tipo];
  const dias = Math.floor(r() * 90);
  const data = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const cobertas = b.vagas !== null && r() > 0.5 ? Math.min(b.vagas, 1 + Math.floor(r() * 2)) : null;
  return {
    id: `${fonte}-${codigo}`,
    fonte: { id: fonte, nome: nomeFonte(fonte), contato, informante },
    fontes_alternativas: [],
    url_anuncio: `https://example.com/simulado/${fonte}/imovel/${codigo}`,
    titulo: `${rotulo}${b.dorm ? ` ${b.dorm} dormitórios` : ""} – ${b.bairro}`,
    tipo: b.tipo,
    endereco: { logradouro: b.rua, numero: b.numero, numero_informado: Boolean(b.numero), bairro: b.bairro, cidade: "Ponta Grossa", uf: "PR" },
    area_construida_m2: b.area,
    area_terreno_m2: b.terreno,
    preco_total: Math.round(b.preco * (1 + variacaoPreco)),
    preco_m2: null,
    pavimentos: b.pav,
    condominio: b.cond,
    dormitorios: b.dorm,
    suites: b.suites,
    banheiros: b.ban,
    vagas_cobertas: cobertas,
    vagas_descobertas: cobertas !== null && b.vagas !== null ? b.vagas - cobertas : null,
    vagas_total: b.vagas,
    area_lazer: b.lazer,
    piscina: b.piscina,
    padrao_acabamento_anuncio: PADROES[Math.floor(r() * PADROES.length)],
    estado_conservacao_anuncio: null,
    fotos,
    foto_capa: fotos[0] ?? null,
    data_anuncio: r() > 0.1 ? data : null,
    status: "normal",
    criterios: [],
    atende: false,
    resumo_filtro: "",
    campos_faltantes: [],
    coletado_em: new Date().toISOString(),
  };
}

// Imóveis anunciados em mais de uma fonte, para exercitar a deduplicação (critério de aceite 5).
const COMPARTILHADOS: { fontes: string[]; seed: number }[] = [
  { fontes: ["flow", "adquira"], seed: 11 },
  { fontes: ["flow", "adquira"], seed: 12 },
  { fontes: ["flow", "kikina"], seed: 13 },
  { fontes: ["adquira", "kikina"], seed: 14 },
];

function coletarFonte(fonte: string, req: RequisicaoBusca): Imovel[] {
  const r = prng(hash(fonte));
  const itens: Imovel[] = [];
  for (let k = 0; k < 28; k++) itens.push(montarImovel(fonte, String(1000 + k), gerarBase(r), r));

  for (const c of COMPARTILHADOS) {
    if (!c.fontes.includes(fonte)) continue;
    const rb = prng(c.seed);
    const base = { ...gerarBase(rb), tipo: "casa" as const, rua: RUAS[c.seed % RUAS.length], numero: String(200 + c.seed) };
    base.area = base.area ?? 180;
    const rf = prng(hash(fonte) + c.seed);
    itens.push(montarImovel(fonte, `C${c.seed}`, base, rf, fonte === c.fontes[0] ? 0 : 0.004));
  }

  // O site já filtra por tipo e bairro na URL de busca; o resto é avaliado depois.
  const bairros = new Set(req.filtros.bairros.map(semAcento));
  return itens.filter(
    (i) =>
      req.filtros.tipos.includes(i.tipo) &&
      (bairros.size === 0 || i.endereco.bairro === null || bairros.has(semAcento(normalizarBairro(i.endereco.bairro) ?? ""))),
  );
}

function fontesComFalha(): Set<string> {
  return new Set((process.env.MOCK_FONTES_COM_FALHA ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

// ---------- Jobs (modo assíncrono, 6.4) ----------

interface Job {
  req: RequisicaoBusca;
  inicio: number;
  falhas: Set<string>;
}

const g = globalThis as unknown as { __jobsImob?: Map<string, Job> };
const jobs = (g.__jobsImob ??= new Map());

export function iniciarBusca(req: RequisicaoBusca): void {
  jobs.set(req.requisicao_id, { req, inicio: Date.now(), falhas: fontesComFalha() });
}

export function tempoTotal(req: RequisicaoBusca): number {
  return Math.max(...req.fontes.map((f) => ATRASO_MS[f] ?? 3000));
}

export function consultarBusca(id: string): RespostaBusca | null {
  const job = jobs.get(id);
  if (!job) return null;
  const { req, inicio, falhas } = job;
  const decorrido = Date.now() - inicio;

  const fontes: FonteResumo[] = [];
  const brutos: Imovel[] = [];
  const erros: RespostaBusca["erros"] = [];
  for (const f of req.fontes) {
    const pronto = decorrido >= (ATRASO_MS[f] ?? 3000);
    if (!pronto) {
      fontes.push({ id: f, nome: nomeFonte(f), status: decorrido > 300 ? "buscando" : "aguardando", itens: 0 });
    } else if (falhas.has(f)) {
      fontes.push({ id: f, nome: nomeFonte(f), status: "erro", mensagem: "Tempo esgotado", itens: 0 });
      erros.push({ fonte: f, codigo: "TIMEOUT", mensagem: `${nomeFonte(f)} não respondeu em 25 segundos` });
    } else {
      const itens = coletarFonte(f, req);
      brutos.push(...itens);
      fontes.push({ id: f, nome: nomeFonte(f), status: "ok", itens: itens.length });
    }
  }

  const emAndamento = fontes.some((f) => f.status === "buscando" || f.status === "aguardando");
  if (emAndamento) return { requisicao_id: id, status: "processando", fontes };

  const { imoveis, resumo } = processarImoveis(brutos, req.filtros);
  const ok = fontes.filter((f) => f.status === "ok").length;
  return {
    requisicao_id: id,
    status: ok === 0 ? "erro" : ok < fontes.length ? "parcial" : "concluido",
    gerado_em: new Date().toISOString(),
    fontes,
    resumo,
    imoveis,
    erros,
  };
}
