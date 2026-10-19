// Simula o workflow fora do n8n: executa os nós Code do JSON gerado e as chamadas ao Supabase.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node simular.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const w = JSON.parse(readFileSync(new URL("./busca-imoveis.workflow.json", import.meta.url)));
const codigo = (nome) => w.nodes.find((n) => n.name === nome).parameters.jsCode;
const AF = Object.getPrototypeOf(async function () {}).constructor;
const saidas = {};
async function rodar(nome, $json) {
  const fn = new AF("$json", "$", codigo(nome));
  const ctx = {
    helpers: {
      async httpRequest({ url, headers, timeout, json, encoding }) {
        const binario = encoding === "arraybuffer";
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout ?? 20000) });
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { httpCode: String(r.status) });
        return binario ? new Uint8Array(await r.arrayBuffer()) : json ? r.json() : r.text();
      },
    },
  };
  const out = await fn.call(ctx, $json, (n) => ({ first: () => saidas[n][0] }));
  saidas[nome] = out;
  return out[0].json;
}

const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = (path, init = {}) =>
  fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal", ...init.headers } });

const id = randomUUID();
const body = {
  requisicao_id: id, cidade: "Ponta Grossa", uf: "PR", fontes: ["flow", "kikina", "adquira"], atualizar_cache: false, solicitado_em: new Date().toISOString(),
  filtros: { tipos: ["casa"], bairros: ["Órfãs"], area_construida: { min: 100, max: 300 }, area_terreno: { min: null, max: null }, preco_total: { min: null, max: 1500000 }, dormitorios_min: 3, suites_min: null, banheiros_min: null, vagas_min: null, condominio: "indiferente", pavimentos: { min: null, max: null } },
};

const t0 = Date.now();
const v = await rodar("Validar requisição", { body });
saidas["Webhook buscar"] = [{ json: { body } }];
console.log("validar:", v.valido, v.erro, "chave", v.chave_cache);

let r = await sb("buscas", { method: "POST", body: JSON.stringify({ requisicao_id: id, chave_cache: v.chave_cache, status: "processando", requisicao: v.requisicao, fontes_status: v.fontes_iniciais }) });
console.log("insert processando:", r.status, r.ok ? "" : await r.text());

const c = await rodar("Coletar e processar", {});
console.log(c.logs.join("\n"));
console.log("status:", c.status, "fontes:", c.fontes_status.map((f) => `${f.id}=${f.status}(${f.itens})`).join(" "), "resumo:", c.resposta.resumo);

r = await sb(`buscas?requisicao_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: c.status, resposta: c.resposta, fontes_status: c.fontes_status, concluido_em: new Date().toISOString() }) });
console.log("patch resultado:", r.status, r.ok ? "" : await r.text(), `· ${(JSON.stringify(c.resposta).length / 1024).toFixed(0)} KB`);

const linhas = await (await sb(`buscas?select=requisicao_id,status,resposta,fontes_status&requisicao_id=eq.${id}&limit=1`, { headers: { Prefer: "" } })).json();
saidas["Webhook resultados"] = [{ json: { query: { requisicao_id: id } } }];
const m = await rodar("Montar resposta", linhas[0] ?? {});
console.log("GET resultados:", m.codigo, m.corpo.status, m.corpo.imoveis?.length, "imóveis");

const cache = await (await sb(`buscas?select=requisicao_id&chave_cache=eq.${v.chave_cache}&status=in.(concluido,parcial)&expira_em=gt.${new Date().toISOString()}`, { headers: { Prefer: "" } })).json();
console.log("cache encontrado:", cache.length > 0);
console.log(`requisicao_id ${id} · ${(Date.now() - t0) / 1000}s`);
