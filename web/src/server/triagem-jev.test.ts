import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerConfigJev, montarEstado, triarAnalise, type ConfigJev, type LinhaTriagem } from "./triagem-jev.ts";
import type { ResultadoAnalise } from "./analise-fotos.ts";

const CONFIG: ConfigJev = { ...lerConfigJev({}), apiKey: "chave-de-teste", timeoutMs: 200 };
const RAPIDO = { compression: false as const, retry: { maxRetries: 1, backoffInitialMs: 1, backoffMaxMs: 2, backoffJitter: 0 } };

const analise = (o: Partial<ResultadoAnalise> = {}): ResultadoAnalise => ({
  analise_id: "a1", imovel_id: "IMV-1", status: "sugerido", ec_classe: "B", depreciacao_percentual: 0.32,
  padrao_codigo: "2.5", padrao_nome: "Médio", padrao_sisdia: 3, sisdia_a_confirmar: false,
  justificativa: "Pintura nova e pisos sem desgaste.", confianca: "alta", fotos_lidas: 5, fotos_total: 12, pendencias: [],
  log: [{ foto_url: "https://cdn.exemplo.test/privada/foto1.jpg", status: "lida", motivo_erro: null }],
  analise_id_extra: undefined, ...o,
} as ResultadoAnalise);

const respostaOk = (o: { revisao?: number; coerente?: number; score?: number; candidatos?: boolean } = {}) => ({
  model: "jev-1.13.0",
  answers: {
    revisao_humana: { type: "noul", noul: o.revisao ?? 0.1 },
    justificativa_coerente: { type: "noul", noul: o.coerente ?? 0.9 },
    confianca_triagem: { type: "score", score: o.score ?? 3.4, confidence: 0.8, legend: {}, probabilities: {} },
    ...(o.candidatos ? { candidatos_padrao: { type: "choice", choice: "2.4", confidence: 0.6, probabilities: { "2.1": 0.01, "2.2": 0.02, "2.3": 0.1, "2.4": 0.6, "2.5": 0.2, "2.6": 0.04, "2.7": 0.02, "2.8": 0.01 } } } : {}),
  },
  usage: { input_tokens: 10, output_tokens: 2 },
});

type Passo = (init: RequestInit | undefined) => Promise<Response> | Response;
function simular(passos: Passo[]) {
  const corpos: string[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    corpos.push(String(init?.body ?? ""));
    const passo = passos[Math.min(corpos.length - 1, passos.length - 1)];
    return passo(init);
  }) as typeof fetch;
  return { fetch: f, corpos };
}
const ok = (o?: Parameters<typeof respostaOk>[0]): Passo => () => Response.json(respostaOk(o));
const http = (status: number): Passo => () => new Response(JSON.stringify({ error: "x" }), { status, headers: { "content-type": "application/json" } });
const pendurar: Passo = (init) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("abort", "AbortError"))));

function mem() {
  const linhas: LinhaTriagem[] = [];
  return { linhas, armazenamento: { async gravarTriagens(l: LinhaTriagem[]) { linhas.push(...l); } } };
}
const rodar = (a: ResultadoAnalise, passos: Passo[], config = CONFIG) => {
  const s = simular(passos);
  const m = mem();
  return triarAnalise(a, "casa", { config, armazenamento: m.armazenamento, clienteOpcoes: { ...RAPIDO, fetch: s.fetch } }).then((t) => ({ t, s, m }));
};

test("sucesso: sem ressalvas, 3 perguntas, 1 linha de log por pergunta", async () => {
  const { t, s, m } = await rodar(analise(), [ok()]);
  assert.equal(t?.status, "ok");
  assert.equal(t?.revisao_obrigatoria, false);
  assert.equal(t?.revisao_humana?.probabilidade, 0.1);
  assert.equal(t?.nota_coerencia, 4.4); // score 3.4 (0 a 4) → nota 1 a 5
  assert.equal(t?.modelo, "jev-1.13.0");
  assert.equal(s.corpos.length, 1);
  assert.equal(JSON.parse(s.corpos[0]).model, "jev-1.13.0");
  assert.deepEqual(m.linhas.map((l) => l.pergunta), ["revisao_humana", "justificativa_coerente", "confianca_triagem"]);
  assert.ok(m.linhas.every((l) => l.status === "ok" && l.analise_id === "a1" && l.modelo === "jev-1.13.0"));
});

test("confiança baixa pede candidatos de padrão como segunda opinião, sem sobrescrever", async () => {
  const entrada = analise({ confianca: "baixa" });
  const { t, m } = await rodar(entrada, [ok({ candidatos: true })]);
  assert.equal(t?.candidatos_padrao[0].codigo, "2.4");
  assert.equal(t?.candidatos_padrao.length, 3);
  assert.equal(entrada.padrao_codigo, "2.5"); // a sugestão original não muda
  assert.equal(m.linhas.length, 4);
  assert.equal(m.linhas[3].valor_escolhido, "2.4");
  const sem = await rodar(analise({ padrao_codigo: null }), [ok({ candidatos: true })]);
  assert.equal(sem.m.linhas.length, 4);
});

test("recomendação de revisão acima do limite → revisão obrigatória", async () => {
  const { t } = await rodar(analise(), [ok({ revisao: 0.8 })]);
  assert.equal(t?.revisao_obrigatoria, true);
});

test("limites e modelo vêm de variáveis de ambiente", async () => {
  const c = lerConfigJev({ JEV_LIMITE_REVISAO: "0,9", JEV_NOTA_MINIMA: "2", JEV_LIMITE_COERENCIA: "0.3", JEV_MODEL: "jev-1.14.0", JEV_TIMEOUT_MS: "5000" });
  assert.deepEqual([c.limiteRevisao, c.notaMinima, c.limiteCoerencia, c.modelo, c.timeoutMs], [0.9, 2, 0.3, "jev-1.14.0", 5000]);
  const padrao = lerConfigJev({});
  assert.deepEqual([padrao.limiteRevisao, padrao.modelo, padrao.timeoutMs], [0.5, "jev-1.13.0", 20000]);
  assert.equal(lerConfigJev({ JEV_LIMITE_REVISAO: "abc" }).limiteRevisao, 0.5);
  // 0,7 de chance de revisão: passa com limite 0,9 e é obrigatória com o padrão 0,5
  const alto = await rodar(analise(), [ok({ revisao: 0.7 })], { ...CONFIG, ...c, apiKey: "k" });
  assert.equal(alto.t?.revisao_obrigatoria, false);
  assert.equal(alto.t?.modelo, "jev-1.14.0");
  assert.equal((await rodar(analise(), [ok({ revisao: 0.7 })])).t?.revisao_obrigatoria, true);
});

test("erro 5xx seguido de sucesso: uma nova tentativa", async () => {
  const { t, s } = await rodar(analise(), [http(503), ok()]);
  assert.equal(t?.status, "ok");
  assert.equal(s.corpos.length, 2);
});

test("timeout seguido de sucesso: uma nova tentativa", async () => {
  const { t, s } = await rodar(analise(), [pendurar, ok()], { ...CONFIG, timeoutMs: 30 });
  assert.equal(t?.status, "ok");
  assert.equal(s.corpos.length, 2);
});

test("5xx persistente → indisponível e revisão obrigatória, com log de erro por pergunta", async () => {
  const { t, s, m } = await rodar(analise(), [http(503)]);
  assert.equal(t?.status, "indisponivel");
  assert.equal(t?.revisao_obrigatoria, true);
  assert.equal(t?.revisao_humana, null);
  assert.equal(s.corpos.length, 2); // 1 + 1 nova tentativa
  assert.equal(m.linhas.length, 3);
  assert.ok(m.linhas.every((l) => l.status === "erro" && l.motivo_erro === "HTTP 503"));
});

test("timeout persistente → indisponível e revisão obrigatória", async () => {
  const { t } = await rodar(analise(), [pendurar], { ...CONFIG, timeoutMs: 30 });
  assert.equal(t?.status, "indisponivel");
  assert.equal(t?.revisao_obrigatoria, true);
});

test("resposta fora do formato é falha de triagem (nunca aprovação)", async () => {
  for (const ruim of [
    { ...respostaOk(), answers: { ...respostaOk().answers, revisao_humana: { type: "noul", noul: 1.7 } } },
    { ...respostaOk(), answers: { ...respostaOk().answers, confianca_triagem: { type: "score", score: 9 } } },
    { ...respostaOk(), answers: {} },
  ]) {
    const { t, m } = await rodar(analise(), [() => Response.json(ruim)]);
    assert.equal(t?.status, "indisponivel");
    assert.equal(t?.revisao_obrigatoria, true);
    assert.ok(m.linhas.every((l) => l.status === "erro"));
  }
});

test("sem chave: indisponível, sem chamada de rede", async () => {
  const { t, s } = await rodar(analise(), [ok()], { ...CONFIG, apiKey: null });
  assert.equal(t?.revisao_obrigatoria, true);
  assert.equal(s.corpos.length, 0);
});

test("só roda quando a análise terminou como sugerido", async () => {
  const { t, s, m } = await rodar(analise({ status: "erro" }), [ok()]);
  assert.equal(t, null);
  assert.equal(s.corpos.length, 0);
  assert.equal(m.linhas.length, 0);
});

test("o estado enviado tem só os campos explícitos e nada de contato, preço, endereço ou URL de foto", async () => {
  const suja = analise({ ...({ preco_total: 450000, telefone: "(42) 99999-0000", endereco: "Rua XV, 10", contato: "Maria" } as object) });
  const estado = montarEstado(suja, "casa");
  assert.deepEqual(Object.keys(estado).sort(), [
    "confianca", "depreciacao_percentual", "ec_classe", "fotos_lidas", "fotos_total", "justificativa", "padrao_codigo", "padrao_nome", "tipo_imovel",
  ]);
  const { s } = await rodar(suja, [ok()]);
  const corpo = s.corpos[0];
  for (const proibido of ["450000", "99999", "Rua XV", "Maria", "http", "cdn.exemplo", "foto1.jpg", "preco", "telefone", "endereco", "contato"])
    assert.ok(!corpo.toLowerCase().includes(proibido.toLowerCase()), `corpo contém "${proibido}"`);
});

test("resposta bruta só é gravada com LOG_RESPOSTA_BRUTA=true", async () => {
  const sem = await rodar(analise(), [ok()]);
  assert.ok(sem.m.linhas.every((l) => l.resposta_bruta === null));
  const com = await rodar(analise(), [ok()], { ...CONFIG, logRespostaBruta: true });
  assert.ok(com.m.linhas.every((l) => l.resposta_bruta !== null));
});

test("falha ao gravar o log da triagem também força revisão", async () => {
  const s = simular([ok()]);
  const t = await triarAnalise(analise(), "casa", {
    config: CONFIG, armazenamento: { async gravarTriagens() { throw new Error("db"); } }, clienteOpcoes: { ...RAPIDO, fetch: s.fetch },
  });
  assert.equal(t?.revisao_obrigatoria, true);
});

test("a sugestão só chega à avaliação com o OK (clique) da avaliadora", () => {
  const front = readFileSync(new URL("../components/SugestaoAvaliacao.tsx", import.meta.url), "utf8");
  // onAceitar (que grava em avaliacoes_imovel) só é chamado dentro de aceitar(), ligada a um onClick.
  assert.equal(front.match(/onAceitar\(/g)?.length, 1);
  assert.match(front, /async function aceitar\(\)[\s\S]*?await onAceitar\(/);
  assert.match(front, /onClick=\{aceitar\}/);
  assert.equal(front.match(/aceitar\(\)/g)?.length, 1); // só a definição, nenhuma chamada direta
  // o bloco da IA é só leitura: nenhum campo editável
  assert.ok(!/<select|<input|<textarea/.test(front));
  // a rota de análise/triagem não toca na tabela de avaliações
  const rota = readFileSync(new URL("../app/api/analise-fotos/route.ts", import.meta.url), "utf8");
  assert.ok(!/salvarAvaliacao|avaliacoes_imovel/.test(rota));
  const triagem = readFileSync(new URL("./triagem-jev.ts", import.meta.url), "utf8");
  assert.ok(!/salvarAvaliacao|avaliacoes_imovel/.test(triagem.replace(/\/\/.*$/gm, "")));
});
