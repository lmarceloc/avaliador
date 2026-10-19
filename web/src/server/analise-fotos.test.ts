import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analisarFotos, interpretarResposta, selecionarFotos,
  type ConfigAnalise, type LinhaAnalise, type LinhaLogFoto,
} from "./analise-fotos.ts";
import { ESTADOS_CONSERVACAO, MAPA_SISDIA, depreciacaoDe, sisdiaDe } from "../config/avaliacao.ts";
import { TORRE_BRANCA } from "../../test/fixtures/torre-branca.ts";

const CONFIG: ConfigAnalise = { fotosMax: 6, modelo: "openrouter/free", apiKey: "chave-de-teste", logRespostaBruta: false, endpoint: "https://or.test/chat" };
const PIXEL = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");

const resposta = (o: object) => ({ ec_classe: "B", padrao_codigo: "2.5", justificativa: "Acabamento em bom estado.", fotos_consideradas: [0, 1], confianca: "alta", ...o });

/** fetch simulado: fotos (conforme `fotos`) e o endpoint do modelo (respostas em sequência). */
function simular(opts: { fotos?: Record<string, { tipo?: string; bytes?: number; status?: number }>; modelo?: (string | number)[] } = {}) {
  type Parte = { type: string; text?: string };
  const chamadasModelo: { body: { messages: { content: Parte[] }[] } }[] = [];
  const modelo = [...(opts.modelo ?? [JSON.stringify(resposta({}))])];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === CONFIG.endpoint) {
      chamadasModelo.push({ body: JSON.parse(String(init?.body)) });
      const item = modelo.length > 1 ? modelo.shift()! : modelo[0];
      if (typeof item === "number") return new Response("{}", { status: item });
      return Response.json({ choices: [{ message: { content: item } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } });
    }
    const cfg = opts.fotos?.[u] ?? {};
    if (cfg.status) return new Response("x", { status: cfg.status });
    const corpo = cfg.bytes ? Buffer.alloc(cfg.bytes) : PIXEL;
    return new Response(corpo, { headers: { "content-type": cfg.tipo ?? "image/jpeg", "content-length": String(corpo.byteLength) } });
  }) as typeof fetch;
  return { fetch: f, chamadasModelo };
}

function armazenamentoMemoria() {
  const analises: LinhaAnalise[] = [];
  const logs: LinhaLogFoto[] = [];
  return {
    analises, logs,
    armazenamento: {
      async gravarAnalise(a: LinhaAnalise) { analises.push(a); },
      async gravarLogs(l: LinhaLogFoto[]) { logs.push(...l); },
    },
  };
}

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://f.test/${i}.jpg`);

test("tabela IBAPE: depreciação sempre vem da tabela", () => {
  assert.equal(ESTADOS_CONSERVACAO.length, 9);
  assert.deepEqual(ESTADOS_CONSERVACAO.map((e) => e.depreciacao), [0, 0.32, 2.52, 8.09, 18.1, 33.2, 52.6, 75.2, 100]);
  assert.equal(depreciacaoDe("E"), 18.1);
  assert.equal(depreciacaoDe("Z"), null);
  assert.equal(depreciacaoDe(null), null);
});

test("mapeamento Sisdia: só os confirmados; o resto fica null e a_confirmar", () => {
  assert.deepEqual(sisdiaDe("2.3"), { sisdia: 0, a_confirmar: false });
  assert.deepEqual(sisdiaDe("2.4"), { sisdia: 2, a_confirmar: false });
  assert.deepEqual(sisdiaDe("2.5"), { sisdia: 3, a_confirmar: false });
  assert.deepEqual(sisdiaDe("2.7"), { sisdia: 4, a_confirmar: false });
  for (const c of ["2.1", "2.2", "2.6", "2.8"] as const) assert.deepEqual(MAPA_SISDIA[c], { sisdia: null, a_confirmar: true });
});

for (const ref of TORRE_BRANCA) {
  test(`fixture ${ref.imovel_id}: classe ${ref.esperado.ec_classe} → depreciação ${ref.esperado.depreciacao_percentual}`, async () => {
    const mem = armazenamentoMemoria();
    const sim = simular({ modelo: [JSON.stringify(resposta({ ec_classe: ref.esperado.ec_classe, depreciacao_percentual: 99 }))] });
    const r = await analisarFotos({ imovel_id: ref.imovel_id, fotos: ref.fotos }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
    assert.equal(r.status, "sugerido");
    assert.equal(r.ec_classe, ref.esperado.ec_classe);
    assert.equal(r.depreciacao_percentual, ref.esperado.depreciacao_percentual);
    assert.equal(r.fotos_lidas, 3);
    assert.equal(mem.analises.length, 1);
    assert.equal(mem.analises[0].aprovado_em, null); // nunca grava/aprova sozinho
  });
}

test("resposta inválida: tenta de novo uma vez e aceita a segunda", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular({ modelo: ["não é json", JSON.stringify(resposta({}))] });
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(2) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(r.status, "sugerido");
  assert.equal(sim.chamadasModelo.length, 2);
});

test("resposta inválida duas vezes (classe fora da lista): status erro", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular({ modelo: [JSON.stringify(resposta({ ec_classe: "Z" }))] });
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(2) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(r.status, "erro");
  assert.equal(sim.chamadasModelo.length, 2);
  assert.equal(r.depreciacao_percentual, null);
  assert.equal(mem.logs.length, 2); // o log por foto existe mesmo no erro
});

test("interpretarResposta: aceita cerca de código, rejeita valores fora das listas", () => {
  assert.equal(interpretarResposta("```json\n" + JSON.stringify(resposta({})) + "\n```").ec_classe, "B");
  assert.throws(() => interpretarResposta(JSON.stringify(resposta({ padrao_codigo: "3.1" }))));
  assert.throws(() => interpretarResposta(JSON.stringify(resposta({ confianca: "enorme" }))));
  const nulo = interpretarResposta(JSON.stringify(resposta({ ec_classe: null, padrao_codigo: null })));
  assert.equal(nulo.ec_classe, null);
});

test("modelo sem condição de julgar: classes null viram pendência", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular({ modelo: [JSON.stringify(resposta({ ec_classe: null, padrao_codigo: null, confianca: "baixa" }))] });
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(1) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(r.status, "sugerido");
  assert.equal(r.ec_classe, null);
  assert.ok(r.pendencias.some((p) => p.includes("não conseguiu julgar")));
});

test("content-type errado e arquivo grande são ignorados com motivo, e vão para o log", async () => {
  const mem = armazenamentoMemoria();
  const f = urls(4);
  const sim = simular({ fotos: { [f[1]]: { tipo: "text/html" }, [f[2]]: { tipo: "image/png", bytes: 21 * 1024 * 1024 }, [f[3]]: { status: 404 } } });
  const r = await analisarFotos({ imovel_id: "X", fotos: f }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(r.fotos_lidas, 1);
  const porUrl = Object.fromEntries(mem.logs.map((l) => [l.foto_url, l]));
  assert.equal(porUrl[f[0]].status, "lida");
  assert.equal(porUrl[f[1]].status, "ignorada");
  assert.match(porUrl[f[1]].motivo_erro!, /content-type/);
  assert.equal(porUrl[f[2]].status, "ignorada");
  assert.match(porUrl[f[2]].motivo_erro!, /20 MB/);
  assert.equal(porUrl[f[3]].status, "erro");
  // só a foto válida foi enviada ao modelo
  const imagens = sim.chamadasModelo[0].body.messages[1].content.filter((c) => c.type === "image_url");
  assert.equal(imagens.length, 1);
});

test("FOTOS_MAX limita o envio, mantendo a capa e espaçando o resto", async () => {
  assert.deepEqual(selecionarFotos(urls(10), 4), [urls(10)[0], urls(10)[3], urls(10)[6], urls(10)[9]]);
  assert.equal(selecionarFotos(urls(3), 6).length, 3);
  const mem = armazenamentoMemoria();
  const sim = simular();
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(20) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: { ...CONFIG, fotosMax: 3 } });
  assert.equal(r.fotos_lidas, 3);
  assert.equal(r.fotos_total, 20);
  assert.equal(mem.logs.length, 3);
});

test("log: uma linha por foto com sha256, bytes, modelo e provedor; tokens na 1ª foto lida", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular();
  await analisarFotos({ imovel_id: "IMV", fotos: urls(3) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(mem.logs.length, 3);
  for (const l of mem.logs) {
    assert.equal(l.imovel_id, "IMV");
    assert.equal(l.analise_id, mem.analises[0].id);
    assert.equal(l.modelo, "openrouter/free");
    assert.equal(l.provedor, "openrouter");
    assert.match(l.foto_sha256!, /^[0-9a-f]{64}$/);
    assert.equal(l.bytes, PIXEL.byteLength);
    assert.equal(l.content_type, "image/jpeg");
    assert.equal(typeof l.latencia_ms, "number");
  }
  assert.equal(mem.logs[0].tokens_entrada, 1000);
  assert.equal(mem.logs[0].tokens_saida, 50);
  assert.equal(mem.logs[1].tokens_entrada, null);
});

test("não envia contato, preço nem nome ao modelo; resposta bruta só com LOG_RESPOSTA_BRUTA", async () => {
  const sim = simular();
  const mem = armazenamentoMemoria();
  await analisarFotos({ imovel_id: "IMV", fotos: urls(1) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(mem.analises[0].resposta_bruta, null);
  const texto = sim.chamadasModelo[0].body.messages[1].content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
  assert.match(texto, /^Imóvel IMV\./);
  const mem2 = armazenamentoMemoria();
  await analisarFotos({ imovel_id: "IMV", fotos: urls(1) }, { fetch: sim.fetch, armazenamento: mem2.armazenamento, config: { ...CONFIG, logRespostaBruta: true } });
  assert.ok(mem2.analises[0].resposta_bruta);
});

test("padrão sem Sisdia confirmado sai como null + a confirmar", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular({ modelo: [JSON.stringify(resposta({ padrao_codigo: "2.6" }))] });
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(1) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: CONFIG });
  assert.equal(r.padrao_nome, "Superior");
  assert.equal(r.padrao_sisdia, null);
  assert.equal(r.sisdia_a_confirmar, true);
  assert.ok(r.pendencias.some((p) => p.includes("a confirmar")));
});

test("sem chave/modelo configurados: erro sem chamar o modelo", async () => {
  const mem = armazenamentoMemoria();
  const sim = simular();
  const r = await analisarFotos({ imovel_id: "X", fotos: urls(1) }, { fetch: sim.fetch, armazenamento: mem.armazenamento, config: { ...CONFIG, apiKey: null } });
  assert.equal(r.status, "erro");
  assert.equal(sim.chamadasModelo.length, 0);
});
