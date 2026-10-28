import { test } from "node:test";
import assert from "node:assert/strict";
import { caminhoSeguro } from "./caminho-seguro.ts";
import { criarToken, DURACAO_SESSAO_S, lerToken, loginObrigatorio, segredoSessao } from "./sessao.ts";

const SEGREDO = "s".repeat(32);
const USUARIO = { id: "u1", email: "carina@exemplo.com", nome: "Carina" };

test("token assinado volta com os dados e expira em 7 dias", () => {
  const agora = Date.parse("2026-10-28T12:00:00Z");
  const token = criarToken(USUARIO, SEGREDO, agora);
  const s = lerToken(token, SEGREDO, agora);
  assert.deepEqual({ id: s?.id, email: s?.email, nome: s?.nome }, USUARIO);
  assert.equal(s?.exp, agora / 1000 + DURACAO_SESSAO_S);
  assert.ok(lerToken(token, SEGREDO, agora + (DURACAO_SESSAO_S - 60) * 1000));
  assert.equal(lerToken(token, SEGREDO, agora + (DURACAO_SESSAO_S + 1) * 1000), null, "vencido");
});

test("token alterado, com outro segredo ou malformado é recusado", () => {
  const token = criarToken(USUARIO, SEGREDO);
  const [dados, assinatura] = token.split(".");
  const outroUsuario = Buffer.from(JSON.stringify({ ...USUARIO, id: "admin", exp: 9e9 })).toString("base64url");
  assert.equal(lerToken(`${outroUsuario}.${assinatura}`, SEGREDO), null);
  assert.equal(lerToken(token, "t".repeat(32)), null);
  assert.equal(lerToken(`${dados}.`, SEGREDO), null);
  assert.equal(lerToken(`${token}.extra`, SEGREDO), null);
  assert.equal(lerToken(undefined, SEGREDO), null);
  assert.equal(lerToken("lixo", SEGREDO), null);
});

test("login só é obrigatório com backend; segredo precisa de 32+ caracteres", () => {
  assert.equal(loginObrigatorio({}), false);
  assert.equal(loginObrigatorio({ BACKEND_URL: "https://backend" }), true);
  assert.equal(segredoSessao({ SESSAO_SEGREDO: "curto" }), null);
  assert.equal(segredoSessao({ SESSAO_SEGREDO: SEGREDO }), SEGREDO);
});

test("caminhoSeguro só aceita caminhos internos", () => {
  assert.equal(caminhoSeguro("/?x=1"), "/?x=1");
  assert.equal(caminhoSeguro("https://outro.site"), "/");
  assert.equal(caminhoSeguro("//outro.site"), "/");
  assert.equal(caminhoSeguro("/\\outro.site"), "/");
  assert.equal(caminhoSeguro(undefined), "/");
});
