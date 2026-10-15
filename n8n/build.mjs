// Gera busca-imoveis.workflow.json para importar no n8n.
// Uso: node build.mjs  (antes: rebundle de regras.ts — ver README)
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
// regras.esm.js vem do esbuild (--format=esm). O formato IIFE do esbuild exporta via getters
// (Object.defineProperty), que o sandbox do nó Code do n8n não preserva; por isso convertemos o
// "export { ... }" final num objeto literal simples.
const esm = readFileSync(dir + "build/regras.esm.js", "utf8");
const exportFinal = /export\s*\{([^}]*)\};?\s*$/;
if (!exportFinal.test(esm)) throw new Error("build/regras.esm.js sem bloco export { } no final");
const regras = esm.replace(exportFinal, (_, nomes) => `var Regras = { ${nomes.split(",").map((x) => x.trim()).filter(Boolean).join(", ")} };\n`);
writeFileSync(dir + "build/regras.js", regras);
// conectores-novos.js vem antes: CONECTORES (no fim de conectores.js) referencia as constantes dele.
const conectores = readFileSync(dir + "src/conectores-novos.js", "utf8") + "\n" + readFileSync(dir + "src/conectores.js", "utf8");

const SUPABASE = process.env.SUPABASE_URL ?? "https://zbpgxziqmoupfpkbifla.supabase.co";
const REST = `${SUPABASE}/rest/v1`;
const CRED_SUPABASE = { supabaseApi: { id: "", name: "Supabase – Busca de Imóveis" } };
const CRED_WEBHOOK = { httpHeaderAuth: { id: "", name: "X-API-Key – Busca de Imóveis" } };

// ---------------------------------------------------------------- código dos nós Code

const codigoValidar = String.raw`// Regras da seção 5.1 + chave de cache (4.5)
const req = $json.body || {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FONTES_CADASTRADAS = ["flow", "kikina", "adquira", "conceito", "casatop", "classica", "madol", "tavarnaro", "aspen", "torre_branca", "quintoandar"];

let erro = null;
if (!req.requisicao_id || !UUID.test(req.requisicao_id)) erro = "requisicao_id deve ser um UUID";
else if (!req.filtros || !Array.isArray(req.filtros.tipos) || req.filtros.tipos.length === 0) erro = "filtros.tipos é obrigatório e não pode ser vazio";
else if (!Array.isArray(req.fontes) || req.fontes.length === 0) erro = "Selecione ao menos uma fonte";
else if (req.fontes.some((f) => !FONTES_CADASTRADAS.includes(f))) erro = "Fonte desconhecida: " + req.fontes.filter((f) => !FONTES_CADASTRADAS.includes(f)).join(", ");

const f = req.filtros || {};
const faixa = (x) => ({ min: x && x.min != null ? Number(x.min) : null, max: x && x.max != null ? Number(x.max) : null });
const filtros = {
  tipos: (f.tipos || []).slice().sort(),
  bairros: (f.bairros || []).slice().sort(),
  area_construida: faixa(f.area_construida),
  area_terreno: faixa(f.area_terreno),
  preco_total: faixa(f.preco_total),
  dormitorios_min: f.dormitorios_min ?? null,
  suites_min: f.suites_min ?? null,
  banheiros_min: f.banheiros_min ?? null,
  vagas_min: f.vagas_min ?? null,
  condominio: f.condominio || "indiferente",
  pavimentos: faixa(f.pavimentos),
};

// FNV-1a duplo (sem require('crypto'), que costuma estar bloqueado no nó Code)
function hash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const fontes = (req.fontes || []).slice().sort();
const chave_cache = hash(JSON.stringify({ cidade: req.cidade || "Ponta Grossa", fontes, filtros }));
const nomes = { flow: "Flow Imobiliária", kikina: "Kikina Imóveis", adquira: "Adquira Imóveis", conceito: "Conceito Imóveis", casatop: "Imobiliária Casa Top", classica: "Clássica Imóveis", madol: "Madol Imóveis", tavarnaro: "Tavarnaro Consultoria", aspen: "Imobiliária Aspen", torre_branca: "Torre Blanca", quintoandar: "QuintoAndar" };

return [{
  json: {
    valido: !erro,
    erro,
    requisicao: { ...req, filtros: { ...filtros, tipos: f.tipos || [], bairros: f.bairros || [] } },
    chave_cache,
    // Com atualizar_cache=true a consulta usa uma chave que nunca existe → força nova coleta.
    consulta_cache: req.atualizar_cache ? "ignorar-" + Date.now() : chave_cache,
    agora: new Date().toISOString(),
    fontes_iniciais: (req.fontes || []).map((id) => ({ id, nome: nomes[id] || id, status: "buscando", itens: 0 })),
  },
}];`;

const codigoColetar = `// Coleta em todas as fontes (em paralelo) + normalização, deduplicação, filtros e outliers.
// O código dos conectores e das regras é gerado a partir de n8n/src/conectores.js e web/src/lib/regras.ts.
const TIMEOUT_FONTE_MS = 120000; // a especificação pede 25 s; com a galeria completa a coleta real leva ~60 s
const CONFIG_FONTES = {
  // Ajustes por fonte (6.3). Ex.: flow: { max_paginas: 5, max_detalhes: 30, intervalo_ms: 1500 }
};

const entrada = $("Validar requisição").first().json;
const req = entrada.requisicao;
const helpers = this.helpers;
const http = (url, opcoes = {}) =>
  helpers.httpRequest({ method: "GET", url, headers: opcoes.headers, timeout: opcoes.timeout, json: Boolean(opcoes.json), ...(opcoes.binario ? { encoding: "arraybuffer" } : {}) });

${regras}

${conectores}

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
}`;

const codigoMontarResultado = String.raw`// GET /resultados: devolve o resultado gravado ou o progresso da busca (6.4)
const id = $("Webhook resultados").first().json.query.requisicao_id;
const linha = $json && $json.requisicao_id ? $json : null;
if (!linha) return [{ json: { codigo: 404, corpo: { requisicao_id: id, status: "erro", mensagem: "Busca não encontrada ou expirada" } } }];
if (linha.status === "processando" || !linha.resposta)
  return [{ json: { codigo: 200, corpo: { requisicao_id: id, status: "processando", fontes: linha.fontes_status || [] } } }];
return [{ json: { codigo: 200, corpo: linha.resposta } }];`;

// ---------------------------------------------------------------- nós

let n = 0;
const pos = (x, y) => [x * 240, y * 200];
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: `no-${++n}`,
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
});

const supabaseHttp = (name, position, { method = "GET", url, body, prefer }, extra = {}) =>
  node(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    position,
    {
      method,
      url,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          ...(prefer ? [{ name: "Prefer", value: prefer }] : []),
        ],
      },
      ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
      options: {},
    },
    { credentials: CRED_SUPABASE, ...extra },
  );

const responder = (name, position, corpo, codigo = 200) =>
  node(name, "n8n-nodes-base.respondToWebhook", 1.1, position, {
    respondWith: "json",
    responseBody: corpo,
    options: { responseCode: codigo },
  });

const nos = [
  node("Webhook buscar", "n8n-nodes-base.webhook", 2, pos(0, 0), {
    httpMethod: "POST",
    path: "buscar-imoveis",
    authentication: "headerAuth",
    responseMode: "responseNode",
    options: {},
  }, { credentials: CRED_WEBHOOK, webhookId: "6f1f3a52-8f0e-4c55-9d3e-2b7c1e0a9b01" }),

  node("Validar requisição", "n8n-nodes-base.code", 2, pos(1, 0), { jsCode: codigoValidar }),

  node("Requisição válida?", "n8n-nodes-base.if", 2, pos(2, 0), {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
      conditions: [{ id: "c1", leftValue: "={{ $json.valido }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and",
    },
    options: {},
  }),

  responder("Responder 400", pos(3, 1), "={{ { status: 'erro', mensagem: $json.erro } }}", 400),

  supabaseHttp("Consultar cache", pos(3, 0), {
    url: `=${REST}/buscas?select=resposta&chave_cache=eq.{{ $json.consulta_cache }}&status=in.(concluido,parcial)&expira_em=gt.{{ $json.agora }}&order=criado_em.desc&limit=1`,
  }, { alwaysOutputData: true }),

  node("Cache válido?", "n8n-nodes-base.if", 2, pos(4, 0), {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
      conditions: [{ id: "c2", leftValue: "={{ $json.resposta }}", rightValue: "", operator: { type: "object", operation: "notEmpty", singleValue: true } }],
      combinator: "and",
    },
    options: {},
  }),

  supabaseHttp("Gravar busca (do cache)", pos(5, -1), {
    method: "POST",
    url: `${REST}/buscas`,
    prefer: "return=minimal",
    body: `={{ JSON.stringify({
  requisicao_id: $('Validar requisição').first().json.requisicao.requisicao_id,
  chave_cache: $('Validar requisição').first().json.chave_cache,
  status: $json.resposta.status,
  requisicao: $('Validar requisição').first().json.requisicao,
  resposta: { ...$json.resposta, requisicao_id: $('Validar requisição').first().json.requisicao.requisicao_id },
  fontes_status: $json.resposta.fontes,
  concluido_em: $now.toISO()
}) }}`,
  }),

  responder("Responder com cache", pos(6, -1), "={{ { ...$('Cache válido?').first().json.resposta, requisicao_id: $('Validar requisição').first().json.requisicao.requisicao_id } }}"),

  supabaseHttp("Gravar busca (processando)", pos(5, 0.5), {
    method: "POST",
    url: `${REST}/buscas`,
    prefer: "return=minimal",
    body: `={{ JSON.stringify({
  requisicao_id: $('Validar requisição').first().json.requisicao.requisicao_id,
  chave_cache: $('Validar requisição').first().json.chave_cache,
  status: 'processando',
  requisicao: $('Validar requisição').first().json.requisicao,
  fontes_status: $('Validar requisição').first().json.fontes_iniciais
}) }}`,
  }),

  responder("Responder processando", pos(6, 0.5), "={{ { requisicao_id: $('Validar requisição').first().json.requisicao.requisicao_id, status: 'processando', fontes: $('Validar requisição').first().json.fontes_iniciais } }}"),

  node("Coletar e processar", "n8n-nodes-base.code", 2, pos(7, 0.5), { jsCode: codigoColetar }),

  supabaseHttp("Gravar resultado", pos(8, 0.5), {
    method: "PATCH",
    url: `=${REST}/buscas?requisicao_id=eq.{{ $json.requisicao_id }}`,
    prefer: "return=minimal",
    body: `={{ JSON.stringify({ status: $json.status, resposta: $json.resposta, fontes_status: $json.fontes_status, concluido_em: $now.toISO(), expira_em: $now.plus({ hours: 6 }).toISO() }) }}`,
  }),

  // ---- GET /webhook/resultados?requisicao_id=...
  node("Webhook resultados", "n8n-nodes-base.webhook", 2, pos(0, 3), {
    httpMethod: "GET",
    path: "resultados",
    authentication: "headerAuth",
    responseMode: "responseNode",
    options: {},
  }, { credentials: CRED_WEBHOOK, webhookId: "0b9a4c27-31d5-4e8f-a6c2-7d4e5f6a8b02" }),

  supabaseHttp("Ler busca", pos(1, 3), {
    url: `=${REST}/buscas?select=requisicao_id,status,resposta,fontes_status&requisicao_id=eq.{{ encodeURIComponent($json.query.requisicao_id || '00000000-0000-0000-0000-000000000000') }}&limit=1`,
  }, { alwaysOutputData: true }),

  node("Montar resposta", "n8n-nodes-base.code", 2, pos(2, 3), { jsCode: codigoMontarResultado }),

  node("Responder resultado", "n8n-nodes-base.respondToWebhook", 1.1, pos(3, 3), {
    respondWith: "json",
    responseBody: "={{ $json.corpo }}",
    options: { responseCode: "={{ $json.codigo }}" },
  }),
];

const liga = (de, para, saida = 0) => ({ de, para, saida });
const ligacoes = [
  liga("Webhook buscar", "Validar requisição"),
  liga("Validar requisição", "Requisição válida?"),
  liga("Requisição válida?", "Consultar cache", 0),
  liga("Requisição válida?", "Responder 400", 1),
  liga("Consultar cache", "Cache válido?"),
  liga("Cache válido?", "Gravar busca (do cache)", 0),
  liga("Cache válido?", "Gravar busca (processando)", 1),
  liga("Gravar busca (do cache)", "Responder com cache"),
  liga("Gravar busca (processando)", "Responder processando"),
  liga("Responder processando", "Coletar e processar"),
  liga("Coletar e processar", "Gravar resultado"),
  liga("Webhook resultados", "Ler busca"),
  liga("Ler busca", "Montar resposta"),
  liga("Montar resposta", "Responder resultado"),
];

const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] ??= { main: [] };
  const main = connections[de].main;
  while (main.length <= saida) main.push([]);
  main[saida].push({ node: para, type: "main", index: 0 });
}

const workflow = {
  name: "Busca de Imóveis – Ponta Grossa (fase 1)",
  nodes: nos,
  connections,
  active: false,
  settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", executionTimeout: 600 },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

writeFileSync(dir + "busca-imoveis.workflow.json", JSON.stringify(workflow, null, 2));
console.log(`ok: busca-imoveis.workflow.json (${nos.length} nós, ${(JSON.stringify(workflow).length / 1024).toFixed(0)} KB)`);
