import { test } from "node:test";
import assert from "node:assert/strict";
import type { Imovel, RespostaBusca } from "./contrato.ts";
import { diasRestantes, juntarRespostas, normalizarNome, substituirResultados, validarSelecao } from "./pesquisas.ts";

const im = (id: string) => ({ id }) as Imovel;
const resposta = (o: Partial<RespostaBusca>): RespostaBusca => ({ requisicao_id: "r", status: "concluido", ...o });

test("normalizarNome tira espaços e limita a 80 caracteres", () => {
  assert.equal(normalizarNome("  Casa   Adriana "), "Casa Adriana");
  assert.equal(normalizarNome("   "), null);
  assert.equal(normalizarNome(42), null);
  assert.equal(normalizarNome("x".repeat(80)), "x".repeat(80));
  assert.equal(normalizarNome("x".repeat(81)), null);
});

test("validarSelecao só aceita { id: boolean }", () => {
  assert.deepEqual(validarSelecao(undefined), {});
  assert.deepEqual(validarSelecao({ a: true, b: false }), { a: true, b: false });
  assert.equal(validarSelecao({ a: "sim" }), null);
  assert.equal(validarSelecao([true]), null);
  assert.equal(validarSelecao(null), null);
});

test("juntarRespostas troca o resumo da fonte refeita, acrescenta imóveis novos e limpa o erro dela", () => {
  const base = resposta({
    status: "parcial",
    fontes: [{ id: "flow", nome: "Flow", status: "ok", itens: 1 }, { id: "kikina", nome: "Kikina", status: "erro", itens: 0 }],
    imoveis: [im("flow-1")],
    erros: [{ fonte: "kikina", codigo: "TIMEOUT", mensagem: "Kikina: tempo esgotado" }],
  });
  const extra = resposta({ fontes: [{ id: "kikina", nome: "Kikina", status: "ok", itens: 2 }], imoveis: [im("kikina-1"), im("flow-1")], erros: [] });
  const r = juntarRespostas(base, extra);
  assert.equal(r.status, "concluido");
  assert.deepEqual(r.fontes?.map((f) => `${f.id}:${f.status}`), ["flow:ok", "kikina:ok"]);
  assert.deepEqual(r.imoveis?.map((i) => i.id), ["flow-1", "kikina-1"], "sem duplicar flow-1");
  assert.deepEqual(r.erros, []);

  const falhouDeNovo = juntarRespostas(base, resposta({
    fontes: [{ id: "kikina", nome: "Kikina", status: "erro", itens: 0 }], imoveis: [],
    erros: [{ fonte: "kikina", codigo: "BLOQUEADO", mensagem: "Kikina: anti-robô" }],
  }));
  assert.equal(falhouDeNovo.status, "parcial");
  assert.deepEqual(falhouDeNovo.erros?.map((e) => e.codigo), ["BLOQUEADO"]);
});

test("substituirResultados mantém só os imóveis já decididos que sumiram da busca nova", () => {
  const antiga = resposta({ imoveis: [im("a"), im("b"), im("c"), im("d")] });
  const nova = resposta({ imoveis: [im("b"), im("e")] });
  const r = substituirResultados(antiga, nova, { a: true, b: true, c: false });
  assert.deepEqual(r.imoveis?.map((i) => i.id), ["b", "e", "a", "c"], "d (não decidido) sai; a e c (decididos) ficam");
});

test("diasRestantes arredonda para cima e nunca fica negativo", () => {
  const agora = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(diasRestantes("2026-11-27T12:00:00Z", agora), 30);
  assert.equal(diasRestantes("2026-10-28T13:00:00Z", agora), 1);
  assert.equal(diasRestantes("2026-10-27T12:00:00Z", agora), 0);
});
