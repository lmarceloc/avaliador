// Testes da API contra um Postgres de verdade (descartável).
// Uso: DATABASE_URL_TESTE=postgres://postgres@localhost:5432/avaliador_teste npm test
// O banco indicado é APAGADO no início (drop schema public cascade).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import type { Imovel, RequisicaoBusca } from "../../web/src/lib/contrato";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encerrarBuscasInterrompidas, horasCache, limparBuscasExpiradas } from "../src/buscas";
import { executarColeta, type ResultadoColeta } from "../src/coleta";
import { criarPool, migrar, PASTA_SQL } from "../src/db";
import { criarServidor } from "../src/servidor";
import {
  acharEmpresa, autenticar, conferirSenha, contextoDoUsuario, criarEmpresa, criarUsuario, definirAtivo, definirEmpresaAtiva, gerarHash,
  redefinirSenha,
} from "../src/usuarios";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json();
const CHAVE = "chave-de-teste-com-mais-de-24-caracteres";

function imovel(id: string, fonte: string, parcial: Partial<Imovel> = {}): Imovel {
  return {
    id, fonte: { id: fonte, nome: fonte, contato: null, informante: null }, fontes_alternativas: [],
    url_anuncio: `https://exemplo.com/${id}`, titulo: `Casa ${id}`, tipo: "casa",
    endereco: { logradouro: `Rua ${id}`, numero: "10", numero_informado: true, bairro: "Órfãs", cidade: "Ponta Grossa", uf: "PR" },
    area_construida_m2: 150, area_terreno_m2: 300, preco_total: 600000, preco_m2: null, pavimentos: 1, condominio: false,
    dormitorios: 3, suites: 1, banheiros: 2, vagas_cobertas: 1, vagas_descobertas: 1, vagas_total: 2,
    padrao_acabamento_anuncio: null, estado_conservacao_anuncio: null, fotos: ["https://exemplo.com/f.jpg"], foto_capa: null,
    data_anuncio: null, status: "normal", criterios: [], atende: false, resumo_filtro: "", campos_faltantes: [],
    coletado_em: new Date().toISOString(), ...parcial,
  };
}

function requisicao(parcial: Partial<RequisicaoBusca> = {}): RequisicaoBusca {
  return {
    requisicao_id: randomUUID(), cidade: "Ponta Grossa", uf: "PR", fontes: ["flow", "kikina"], atualizar_cache: false,
    solicitado_em: new Date().toISOString(),
    filtros: {
      tipos: ["casa"], bairros: ["Órfãs"], area_construida: { min: 100, max: 300 }, area_terreno: { min: null, max: null },
      preco_total: { min: null, max: 1500000 }, dormitorios_min: 3, suites_min: null, banheiros_min: null, vagas_min: null,
      condominio: "indiferente", pavimentos: { min: null, max: null }, area_lazer: "indiferente", piscina: "indiferente",
    },
    ...parcial,
  };
}

describe("backend", { skip: !URL_TESTE && "defina DATABASE_URL_TESTE para rodar contra um Postgres" }, () => {
  let pool: pg.Pool;
  let base: string;
  let fechar: () => Promise<void>;
  let coletas = 0;
  const pendentes: Promise<void>[] = [];
  // Empresa A ("Agência Byte", criada pela migração) e empresa B, com um usuário cada.
  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let usuarioB: string;
  // Enquanto houver portão, a coleta falsa espera por ele (simula uma coleta demorada em andamento).
  let portao: Promise<void> | null = null;

  // Coleta falsa: flow ok com 2 imóveis, kikina com erro. Passa pelo mesmo executarColeta do serviço.
  const coletar = (req: RequisicaoBusca): Promise<ResultadoColeta> => {
    coletas++;
    return executarColeta(req, {
      coletar: async ({ requisicao: r }) => ({
        fontes: r.fontes.map((id) => (id === "flow" ? { id, nome: "Flow", status: "ok" as const, itens: 2 } : { id, nome: id, status: "erro" as const, mensagem: "Tempo esgotado", itens: 0 })),
        imoveis: [imovel("flow-1", "flow"), imovel("flow-2", "flow", { dormitorios: 1 })],
        erros: r.fontes.filter((id) => id !== "flow").map((id) => ({ fonte: id, codigo: "TIMEOUT", mensagem: `${id}: Tempo esgotado` })),
      }),
    });
  };

  const chamar = (caminho: string, init: RequestInit = {}, chave: string | null = CHAVE, usuario: string | null = usuarioA) =>
    fetch(base + caminho, {
      ...init,
      headers: { "Content-Type": "application/json", ...(chave ? { "X-API-Key": chave } : {}), ...(usuario ? { "X-Usuario-Id": usuario } : {}), ...init.headers },
    });
  const comoB = (caminho: string, init: RequestInit = {}) => chamar(caminho, init, CHAVE, usuarioB);
  const esperarColetas = async () => {
    await Promise.all(pendentes.splice(0));
    // a gravação do resultado roda depois da resposta HTTP; dá um respiro para o update terminar
    await new Promise((r) => setTimeout(r, 50));
  };

  before(async () => {
    pool = criarPool(URL_TESTE!);
    await pool.query("drop schema public cascade; create schema public");
    await migrar(pool);
    empresaA = (await acharEmpresa(pool, "Agência Byte")).id;
    empresaB = (await criarEmpresa(pool, "Imobiliária B")).id;
    usuarioA = (await criarUsuario(pool, "ana@empresa-a.com", "Ana", "senha-da-ana", empresaA, "admin")).id;
    usuarioB = (await criarUsuario(pool, "bia@empresa-b.com", "Bia", "senha-da-bia", empresaB)).id;
    const servidor = criarServidor({
      db: pool, apiKey: CHAVE,
      coletar: (req) => {
        const p = (portao ?? Promise.resolve()).then(() => coletar(req));
        pendentes.push(p.then(() => undefined));
        return p;
      },
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    fechar = () => new Promise((r) => servidor.close(() => r()));
  });
  after(async () => {
    await fechar?.();
    await pool?.end();
  });

  test("migrações aplicam uma vez só", async () => {
    const { rows } = await pool.query("select arquivo from schema_migracoes order by arquivo");
    assert.deepEqual(rows.map((r) => r.arquivo), [
      "001_inicial.sql", "002_pesquisas_salvas.sql", "003_usuarios.sql", "004_correcoes_avaliacao.sql", "005_tipo_casa_geminada.sql", "006_empresas.sql",
    ]);
    assert.deepEqual(await migrar(pool), []);
  });

  test("saúde sem chave; o resto exige X-API-Key", async () => {
    assert.equal((await chamar("/saude", {}, null)).status, 200);
    assert.equal((await chamar("/avaliacoes", {}, null)).status, 401);
    assert.equal((await chamar("/avaliacoes", {}, "errada")).status, 401);
    assert.equal((await chamar("/nao-existe")).status, 404);
  });

  test("requisição inválida devolve 400 com a mensagem", async () => {
    const r = await chamar("/buscas", { method: "POST", body: JSON.stringify({ ...requisicao(), fontes: ["flow", "inventada"] }) });
    assert.equal(r.status, 400);
    assert.deepEqual(await json(r), { status: "erro", mensagem: "Fonte desconhecida: inventada" });
    const r2 = await chamar("/buscas", { method: "POST", body: "{nao é json" });
    assert.equal(r2.status, 400);
  });

  test("busca: processando → resultado; depois cache; atualizar_cache força nova coleta", async () => {
    const req = requisicao();
    let r = await chamar("/buscas", { method: "POST", body: JSON.stringify(req) });
    assert.equal(r.status, 200);
    const inicial = await json(r);
    assert.equal(inicial.status, "processando");
    assert.deepEqual(inicial.fontes.map((f: { id: string; status: string }) => `${f.id}:${f.status}`), ["flow:buscando", "kikina:buscando"]);

    await esperarColetas();
    r = await chamar(`/buscas/${req.requisicao_id}`);
    const final = await json(r);
    assert.equal(final.status, "parcial");
    assert.equal(final.requisicao_id, req.requisicao_id);
    assert.equal(final.imoveis.length, 2);
    assert.equal(final.resumo.atendem_todos, 1, "processarImoveis aplicou os filtros (flow-2 tem 1 dormitório)");
    assert.equal(final.erros[0].codigo, "TIMEOUT");

    // mesmos filtros, fontes em outra ordem: vem do cache, com o requisicao_id novo
    const antes = coletas;
    const req2 = requisicao({ fontes: ["kikina", "flow"], filtros: { ...req.filtros, bairros: ["Órfãs"] } });
    r = await chamar("/buscas", { method: "POST", body: JSON.stringify(req2) });
    const doCache = await json(r);
    assert.equal(doCache.status, "parcial");
    assert.equal(doCache.requisicao_id, req2.requisicao_id);
    assert.equal(coletas, antes);
    assert.equal((await json(await chamar(`/buscas/${req2.requisicao_id}`))).imoveis.length, 2);

    const req3 = requisicao({ atualizar_cache: true });
    r = await chamar("/buscas", { method: "POST", body: JSON.stringify(req3) });
    assert.equal((await json(r)).status, "processando");
    await esperarColetas();
    assert.equal(coletas, antes + 1);
  });

  test("o mesmo requisicao_id repetido não coleta de novo", async () => {
    const req = requisicao({ atualizar_cache: true });
    await chamar("/buscas", { method: "POST", body: JSON.stringify(req) });
    const antes = coletas;
    const r = await chamar("/buscas", { method: "POST", body: JSON.stringify(req) });
    assert.equal(r.status, 200);
    assert.equal(coletas, antes);
    await esperarColetas();
  });

  test("busca inexistente devolve 404 com a mensagem do front", async () => {
    for (const id of [randomUUID(), "nao-e-uuid"]) {
      const r = await chamar(`/buscas/${id}`);
      assert.equal(r.status, 404);
      assert.equal((await json(r)).mensagem, "Busca não encontrada ou expirada");
    }
  });

  test("buscas órfãs viram erro e as expiradas são apagadas", async () => {
    const id = randomUUID();
    await pool.query(
      `insert into buscas (requisicao_id, chave_cache, status, requisicao, fontes_status, empresa_id) values ($1, 'x', 'processando', '{}', $2, $3)`,
      [id, JSON.stringify([{ id: "flow", nome: "Flow", status: "buscando", itens: 0 }]), empresaA],
    );
    assert.equal(await encerrarBuscasInterrompidas(pool), 1);
    const corpo = await json(await chamar(`/buscas/${id}`));
    assert.equal(corpo.status, "erro");
    assert.equal(corpo.fontes[0].status, "erro");
    assert.equal(corpo.erros[0].codigo, "INTERROMPIDA");

    await pool.query("update buscas set expira_em = now() - interval '1 minute' where requisicao_id = $1", [id]);
    assert.equal(await limparBuscasExpiradas(pool), 1);
    assert.equal((await chamar(`/buscas/${id}`)).status, 404);
  });

  test("avaliações: grava, atualiza e valida o estado IBAPE", async () => {
    let r = await chamar("/avaliacoes", { method: "PUT", body: JSON.stringify({ imovel_id: "flow-1", estado_conservacao: "C", padrao_acabamento: "2.5 Médio", observacoes: null, incluido_avaliacao: true }) });
    assert.equal(r.status, 200);
    const primeira = await json(r);
    assert.equal(primeira.estado_conservacao, "C");
    r = await chamar("/avaliacoes", { method: "PUT", body: JSON.stringify({ imovel_id: "flow-1", estado_conservacao: "I", incluido_avaliacao: null }) });
    const segunda = await json(r);
    assert.equal(segunda.estado_conservacao, "I");
    assert.equal(segunda.padrao_acabamento, null);
    assert.ok(new Date(segunda.atualizado_em) >= new Date(primeira.atualizado_em));

    assert.equal((await chamar("/avaliacoes", { method: "PUT", body: JSON.stringify({ imovel_id: "x", estado_conservacao: "Z" }) })).status, 400);
    assert.equal((await chamar("/avaliacoes", { method: "PUT", body: JSON.stringify({}) })).status, 400);
    const todas = await json(await chamar("/avaliacoes"));
    assert.deepEqual(todas.map((a: { imovel_id: string }) => a.imovel_id), ["flow-1"]);
  });

  test("avaliações: correções à mão de área do terreno, piscina e condomínio", async () => {
    const put = (corpo: object) => chamar("/avaliacoes", { method: "PUT", body: JSON.stringify({ imovel_id: "flow-2", ...corpo }) });
    let r = await put({ area_terreno_m2: 198.5, piscina: true, condominio: false });
    assert.equal(r.status, 200);
    let a = await json(r);
    assert.equal(a.area_terreno_m2, 198.5);
    assert.equal(a.piscina, true);
    assert.equal(a.condominio, false);
    const lida = (await json(await chamar("/avaliacoes"))).find((x: { imovel_id: string }) => x.imovel_id === "flow-2");
    assert.equal(lida.area_terreno_m2, 198.5, "volta como número, não texto");

    r = await put({ area_terreno_m2: null, piscina: null, condominio: null });
    a = await json(r);
    assert.equal(a.area_terreno_m2, null);
    assert.equal(a.piscina, null);

    r = await put({ tipo_casa: "sobrado", geminada: true });
    a = await json(r);
    assert.equal(a.tipo_casa, "sobrado");
    assert.equal(a.geminada, true);

    for (const ruim of [{ area_terreno_m2: 0 }, { area_terreno_m2: -5 }, { area_terreno_m2: "198" }, { piscina: "sim" }, { condominio: 1 },
      { tipo_casa: "casa" }, { geminada: "sim" }])
      assert.equal((await put(ruim)).status, 400, JSON.stringify(ruim));
  });

  test("análise de fotos: análise, logs, triagens e aprovação", async () => {
    const analise = randomUUID();
    let r = await chamar("/analises-foto", {
      method: "POST",
      body: JSON.stringify({
        id: analise, imovel_id: "flow-1", status: "sugerido", ec_classe: "C", padrao_codigo: "2.5", padrao_sisdia: null,
        justificativa: "ok", confianca: "media", modelo: "m", resposta_bruta: null, criado_em: new Date().toISOString(),
        aprovado_por: null, aprovado_em: null, campo_desconhecido: "ignorado",
      }),
    });
    assert.equal(r.status, 201);
    r = await chamar("/analises-foto/logs", {
      method: "POST",
      body: JSON.stringify([1, 2].map((n) => ({
        id: randomUUID(), analise_id: analise, imovel_id: "flow-1", foto_url: `https://exemplo.com/${n}.jpg`, foto_sha256: null,
        bytes: 100, content_type: "image/jpeg", modelo: "m", provedor: "openrouter", status: "lida", motivo_erro: null,
        tokens_entrada: null, tokens_saida: null, latencia_ms: 10, criado_em: new Date().toISOString(),
      }))),
    });
    assert.equal(r.status, 201);
    r = await chamar("/analises-foto/triagens", {
      method: "POST",
      body: JSON.stringify([{
        id: randomUUID(), analise_id: analise, imovel_id: "flow-1", pergunta: "revisao", tipo: "boolean", probabilidade: 0.3,
        valor_escolhido: null, nota: null, modelo: "jev", status: "ok", motivo_erro: null, latencia_ms: 5,
        resposta_bruta: { qualquer: ["coisa"] },
      }]),
    });
    assert.equal(r.status, 201);
    const { rows } = await pool.query("select resposta_bruta from triagens_jev where analise_id = $1", [analise]);
    assert.deepEqual(rows[0].resposta_bruta, { qualquer: ["coisa"] });
    assert.equal((await pool.query("select count(*)::int as n from analises_foto_log where analise_id = $1", [analise])).rows[0].n, 2);

    r = await chamar(`/analises-foto/${analise}/aprovar`, { method: "POST", body: JSON.stringify({ imovel_id: "flow-1", aprovado_por: "carina" }) });
    assert.equal(r.status, 200);
    const aprovada = (await pool.query("select aprovado_por, aprovado_em from analises_foto where id = $1", [analise])).rows[0];
    assert.equal(aprovada.aprovado_por, "carina");
    assert.ok(aprovada.aprovado_em);
    r = await chamar(`/analises-foto/${analise}/aprovar`, { method: "POST", body: JSON.stringify({ imovel_id: "outro" }) });
    assert.equal(r.status, 404);
    assert.equal((await chamar("/analises-foto/logs", { method: "POST", body: JSON.stringify({ nao: "lista" }) })).status, 400);
  });
  // Faz uma busca pela API (coleta falsa: flow-1 e flow-2) e devolve o requisicao_id já concluído.
  async function buscaConcluida(parcial: Partial<RequisicaoBusca> = {}): Promise<string> {
    const req = requisicao({ atualizar_cache: true, ...parcial });
    await chamar("/buscas", { method: "POST", body: JSON.stringify(req) });
    await esperarColetas();
    return req.requisicao_id;
  }
  const criar = (corpo: unknown) => chamar("/pesquisas", { method: "POST", body: JSON.stringify(corpo) });

  test("pesquisas salvas: cria com resultados da busca, lista, abre e valida nome", async () => {
    const id = await buscaConcluida();
    let r = await criar({ nome: "  Casa   Adriana ", requisicao_id: id, selecao: { "flow-1": true, "flow-2": false } });
    assert.equal(r.status, 201);
    const p = await json(r);
    assert.equal(p.nome, "Casa Adriana");
    assert.equal(p.resposta.imoveis.length, 2);
    assert.deepEqual(p.filtros.bairros, ["Órfãs"]);
    assert.deepEqual(p.fontes, ["flow", "kikina"]);
    assert.deepEqual(p.selecao, { "flow-1": true, "flow-2": false });
    const dias = (Date.parse(p.expira_em) - Date.now()) / 86_400_000;
    assert.ok(dias > 29.9 && dias <= 30, `expira em 30 dias (veio ${dias})`);

    r = await criar({ nome: "casa adriana", requisicao_id: id });
    assert.equal(r.status, 409, "nome repetido, sem diferenciar maiúsculas");
    assert.equal((await json(r)).mensagem, "Já existe uma pesquisa salva com esse nome");
    assert.equal((await criar({ nome: "   ", requisicao_id: id })).status, 400);
    assert.equal((await criar({ nome: "x".repeat(81), requisicao_id: id })).status, 400);
    assert.equal((await criar({ nome: "Sem busca", requisicao_id: randomUUID() })).status, 409);
    assert.equal((await criar({ nome: "Seleção ruim", requisicao_id: id, selecao: { a: "sim" } })).status, 400);

    const lista = await json(await chamar("/pesquisas"));
    const item = lista.find((x: { id: string }) => x.id === p.id);
    assert.equal(item.total_imoveis, 2);
    assert.equal(item.selecionados, 1, "só conta os incluídos");
    assert.equal(item.resposta, undefined, "a lista não traz os resultados");

    const aberta = await json(await chamar(`/pesquisas/${p.id}`));
    assert.deepEqual(aberta.selecao, p.selecao);
    assert.equal((await chamar(`/pesquisas/${randomUUID()}`)).status, 404);
    assert.equal((await chamar("/pesquisas/nao-e-uuid")).status, 404);
  });

  test("pesquisas salvas: seleção separada por pesquisa e renovação dos 30 dias", async () => {
    const id = await buscaConcluida();
    const a = await json(await criar({ nome: "Casa A", requisicao_id: id }));
    const b = await json(await criar({ nome: "Apartamento B", requisicao_id: id }));
    const marcar = (pid: string, imovel_id: string, incluido: boolean | null) =>
      chamar(`/pesquisas/${pid}/selecao`, { method: "PUT", body: JSON.stringify({ imovel_id, incluido }) });

    await pool.query("update pesquisas_salvas set expira_em = now() + interval '1 day' where id = $1", [a.id]);
    assert.equal((await marcar(a.id, "flow-1", true)).status, 200);
    assert.equal((await marcar(b.id, "flow-2", false)).status, 200);
    let pa = await json(await chamar(`/pesquisas/${a.id}`));
    const pb = await json(await chamar(`/pesquisas/${b.id}`));
    assert.deepEqual(pa.selecao, { "flow-1": true });
    assert.deepEqual(pb.selecao, { "flow-2": false });
    assert.ok((Date.parse(pa.expira_em) - Date.now()) / 86_400_000 > 29.9, "marcar renova a validade");

    await marcar(a.id, "flow-1", null);
    pa = await json(await chamar(`/pesquisas/${a.id}`));
    assert.deepEqual(pa.selecao, {});
    assert.equal((await marcar(a.id, "", true)).status, 400);
    assert.equal((await marcar(a.id, "flow-1", "sim" as never)).status, 400);
    assert.equal((await marcar(randomUUID(), "flow-1", true)).status, 404);
  });

  test("pesquisas salvas: renomear, nova busca mantém os decididos, repetição junta, excluir", async () => {
    const id = await buscaConcluida();
    const p = await json(await criar({ nome: "Casa C", requisicao_id: id, selecao: { "flow-1": true } }));

    let r = await chamar(`/pesquisas/${p.id}`, { method: "PATCH", body: JSON.stringify({ nome: "Casa Carla" }) });
    assert.equal((await json(r)).nome, "Casa Carla");
    await criar({ nome: "Outra", requisicao_id: id });
    r = await chamar(`/pesquisas/${p.id}`, { method: "PATCH", body: JSON.stringify({ nome: "outra" }) });
    assert.equal(r.status, 409);

    // Nova busca que não traz flow-1: ele continua porque foi incluído; flow-2 (não decidido) vem da busca nova.
    await pool.query(
      "update buscas set resposta = jsonb_set(resposta, '{imoveis}', (select jsonb_agg(i) from jsonb_array_elements(resposta->'imoveis') i where i->>'id' <> 'flow-1')) where requisicao_id = $1",
      [id],
    );
    const id2 = await buscaConcluida({ filtros: { ...requisicao().filtros, bairros: ["Centro"] } });
    await pool.query(
      "update buscas set resposta = jsonb_set(resposta, '{imoveis}', (select jsonb_agg(i) from jsonb_array_elements(resposta->'imoveis') i where i->>'id' <> 'flow-1')) where requisicao_id = $1",
      [id2],
    );
    r = await chamar(`/pesquisas/${p.id}`, { method: "PATCH", body: JSON.stringify({ resultados: { requisicao_id: id2, modo: "substituir" } }) });
    let atual = await json(r);
    assert.deepEqual(atual.resposta.imoveis.map((i: { id: string }) => i.id).sort(), ["flow-1", "flow-2"]);
    assert.deepEqual(atual.filtros.bairros, ["Centro"], "filtros da busca nova");
    assert.deepEqual(atual.selecao, { "flow-1": true });

    // Repetição de uma fonte: kikina passa a ok e traz um imóvel novo.
    const extra = randomUUID();
    await pool.query(
      `insert into buscas (requisicao_id, chave_cache, status, requisicao, resposta, empresa_id) values ($1, 'x', 'concluido', $2, $3, $4)`,
      [extra, JSON.stringify(requisicao({ fontes: ["kikina"] })), JSON.stringify({
        requisicao_id: extra, status: "concluido", fontes: [{ id: "kikina", nome: "Kikina", status: "ok", itens: 1 }],
        imoveis: [imovel("kikina-9", "kikina")], erros: [],
      }), empresaA],
    );
    r = await chamar(`/pesquisas/${p.id}`, { method: "PATCH", body: JSON.stringify({ resultados: { requisicao_id: extra, modo: "juntar" } }) });
    atual = await json(r);
    assert.ok(atual.resposta.imoveis.some((i: { id: string }) => i.id === "kikina-9"));
    assert.equal(atual.resposta.status, "concluido");
    assert.deepEqual(atual.resposta.erros, []);
    assert.deepEqual(atual.filtros.bairros, ["Centro"], "juntar não troca os filtros");
    assert.equal((await chamar(`/pesquisas/${p.id}`, { method: "PATCH", body: JSON.stringify({ resultados: { requisicao_id: extra, modo: "outro" } }) })).status, 400);

    assert.equal((await chamar(`/pesquisas/${p.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await chamar(`/pesquisas/${p.id}`)).status, 404);
    assert.equal((await pool.query("select count(*)::int as n from pesquisas_selecao where pesquisa_id = $1", [p.id])).rows[0].n, 0);
    assert.equal((await chamar(`/pesquisas/${p.id}`, { method: "DELETE" })).status, 404);
  });

  test("pesquisas salvas: expiradas somem da lista e liberam o nome", async () => {
    const id = await buscaConcluida();
    const p = await json(await criar({ nome: "Vencida", requisicao_id: id }));
    await pool.query("update pesquisas_salvas set expira_em = now() - interval '1 minute' where id = $1", [p.id]);
    assert.ok(!(await json(await chamar("/pesquisas"))).some((x: { id: string }) => x.id === p.id));
    assert.equal((await chamar(`/pesquisas/${p.id}`)).status, 404);
    assert.equal((await criar({ nome: "vencida", requisicao_id: id })).status, 201, "o nome fica livre");
  });
  test("usuários: hash scrypt, login por e-mail, troca de senha e desativação", async () => {
    const hash = await gerarHash("segredo-123");
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!hash.includes("segredo-123"));
    assert.ok(await conferirSenha("segredo-123", hash));
    assert.ok(!(await conferirSenha("segredo-124", hash)));

    await criarUsuario(pool, " Carina@Exemplo.com ", "Carina Souza", "senha-inicial", empresaA);
    await assert.rejects(criarUsuario(pool, "carina@exemplo.com", "Outra", "senha-inicial", empresaB), /Já existe/, "e-mail único entre empresas");
    await assert.rejects(criarUsuario(pool, "sem-arroba", "X", "senha-inicial", empresaA), /E-mail inválido/);
    await assert.rejects(criarUsuario(pool, "curta@exemplo.com", "X", "1234567", empresaA), /8 caracteres/);

    const login = (email: string, senha: string) => chamar("/auth/login", { method: "POST", body: JSON.stringify({ email, senha }) });
    let r = await login("CARINA@exemplo.com", "senha-inicial");
    assert.equal(r.status, 200);
    const u = await json(r);
    assert.deepEqual(
      { email: u.email, nome: u.nome, papel: u.papel, empresa: u.empresa },
      { email: "carina@exemplo.com", nome: "Carina Souza", papel: "membro", empresa: { id: empresaA, nome: "Agência Byte" } },
    );
    assert.equal(u.senha_hash, undefined, "o hash nunca sai do backend");
    assert.ok((await pool.query("select ultimo_login from usuarios where email = 'carina@exemplo.com'")).rows[0].ultimo_login);

    r = await login("carina@exemplo.com", "errada");
    assert.equal(r.status, 401);
    assert.equal((await json(r)).mensagem, "E-mail ou senha inválidos");
    assert.equal((await login("ninguem@exemplo.com", "qualquer")).status, 401, "mesma resposta para e-mail inexistente");

    const trocar = (senha_atual: string, senha_nova: string) =>
      chamar("/auth/senha", { method: "POST", body: JSON.stringify({ email: "carina@exemplo.com", senha_atual, senha_nova }) });
    assert.equal((await trocar("senha-inicial", "curta")).status, 400);
    assert.equal((await trocar("errada", "nova-senha-123")).status, 401);
    assert.equal((await trocar("senha-inicial", "nova-senha-123")).status, 200);
    assert.equal((await login("carina@exemplo.com", "senha-inicial")).status, 401);
    assert.equal((await login("carina@exemplo.com", "nova-senha-123")).status, 200);

    await definirAtivo(pool, "carina@exemplo.com", false);
    assert.equal((await login("carina@exemplo.com", "nova-senha-123")).status, 401, "desativado não entra");
    await definirAtivo(pool, "carina@exemplo.com", true);
    await redefinirSenha(pool, "carina@exemplo.com", "redefinida-1");
    assert.equal((await login("carina@exemplo.com", "redefinida-1")).status, 200);
    await assert.rejects(redefinirSenha(pool, "ninguem@exemplo.com", "redefinida-1"), /não encontrado/);
  });

  test("usuários: 5 erros seguidos bloqueiam por 15 minutos", async () => {
    await criarUsuario(pool, "marcelo@exemplo.com", "Marcelo", "senha-certa-1", empresaA);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await assert.rejects(autenticar(pool, "marcelo@exemplo.com", "errada", t0), /inválidos/);
    await assert.rejects(autenticar(pool, "marcelo@exemplo.com", "senha-certa-1", t0 + 60_000), /Muitas tentativas/);
    const r = await chamar("/auth/login", { method: "POST", body: JSON.stringify({ email: "marcelo@exemplo.com", senha: "senha-certa-1" }) });
    assert.equal(r.status, 429);
    assert.equal((await autenticar(pool, "marcelo@exemplo.com", "senha-certa-1", t0 + 16 * 60_000)).email, "marcelo@exemplo.com", "passado o bloqueio, entra");
  });

  // ---------- Empresas: cada uma no seu ambiente; cache de buscas compartilhado ----------

  test("empresas: sem usuário, usuário desconhecido ou desativado, nada passa", async () => {
    assert.equal((await chamar("/avaliacoes", {}, CHAVE, null)).status, 401);
    assert.equal((await chamar("/avaliacoes", {}, CHAVE, randomUUID())).status, 401);
    assert.equal((await chamar("/avaliacoes", {}, CHAVE, "nao-e-uuid")).status, 401);
    assert.equal((await chamar("/pesquisas", {}, CHAVE, null)).status, 401);

    const temp = await criarUsuario(pool, "temp@empresa-b.com", "Temp", "senha-do-temp", empresaB);
    assert.equal((await chamar("/avaliacoes", {}, CHAVE, temp.id)).status, 200);
    await definirAtivo(pool, "temp@empresa-b.com", false);
    assert.equal((await chamar("/avaliacoes", {}, CHAVE, temp.id)).status, 401, "desativado perde o acesso na hora, mesmo com sessão válida no site");

    // Empresa desativada: ninguém dela entra nem usa a API.
    await definirEmpresaAtiva(pool, "Imobiliária B", false);
    assert.equal(await contextoDoUsuario(pool, usuarioB), null);
    const login = await chamar("/auth/login", { method: "POST", body: JSON.stringify({ email: "bia@empresa-b.com", senha: "senha-da-bia" }) }, CHAVE, null);
    assert.equal(login.status, 401);
    await definirEmpresaAtiva(pool, "Imobiliária B", true);
    assert.deepEqual(await contextoDoUsuario(pool, usuarioB), { usuarioId: usuarioB, empresaId: empresaB, papel: "membro" });
  });

  test("empresas: avaliações separadas, mesmo imóvel com análises diferentes", async () => {
    const put = (como: typeof chamar | typeof comoB, corpo: object) => como("/avaliacoes", { method: "PUT", body: JSON.stringify(corpo) });
    assert.equal((await put(chamar, { imovel_id: "flow-77", estado_conservacao: "B", observacoes: "da A" })).status, 200);
    assert.equal((await put(comoB, { imovel_id: "flow-77", estado_conservacao: "F", observacoes: "da B" })).status, 200);
    const daA = (await json(await chamar("/avaliacoes"))).find((a: { imovel_id: string }) => a.imovel_id === "flow-77");
    const daB = await json(await comoB("/avaliacoes"));
    assert.equal(daA.estado_conservacao, "B");
    assert.deepEqual(daB.map((a: { imovel_id: string; estado_conservacao: string }) => [a.imovel_id, a.estado_conservacao]), [["flow-77", "F"]], "B só vê a dela");
    const { rows } = await pool.query("select atualizado_por from avaliacoes_imovel where empresa_id = $1 and imovel_id = 'flow-77'", [empresaB]);
    assert.equal(rows[0].atualizado_por, usuarioB);
  });

  test("empresas: pesquisas salvas separadas, mesmo nome em empresas diferentes", async () => {
    const idA = await buscaConcluida();
    const pA = await json(await criar({ nome: "Casa Igual", requisicao_id: idA }));
    // B não lê, não altera, não marca e não apaga a pesquisa de A (responde como se não existisse).
    assert.equal((await comoB(`/pesquisas/${pA.id}`)).status, 404);
    assert.equal((await comoB(`/pesquisas/${pA.id}`, { method: "PATCH", body: JSON.stringify({ nome: "Roubada" }) })).status, 404);
    assert.equal((await comoB(`/pesquisas/${pA.id}/selecao`, { method: "PUT", body: JSON.stringify({ imovel_id: "flow-1", incluido: true }) })).status, 404);
    assert.equal((await comoB(`/pesquisas/${pA.id}`, { method: "DELETE" })).status, 404);
    assert.ok(!(await json(await comoB("/pesquisas"))).some((x: { id: string }) => x.id === pA.id));
    assert.equal((await json(await chamar(`/pesquisas/${pA.id}`))).nome, "Casa Igual", "continua intacta para A");

    // B também não salva uma pesquisa a partir da busca de A.
    assert.equal((await comoB("/pesquisas", { method: "POST", body: JSON.stringify({ nome: "Com busca alheia", requisicao_id: idA }) })).status, 409);

    // Com a busca dela, B pode usar o mesmo nome.
    const reqB = requisicao();
    await comoB("/buscas", { method: "POST", body: JSON.stringify(reqB) });
    await esperarColetas();
    const r = await comoB("/pesquisas", { method: "POST", body: JSON.stringify({ nome: "casa igual", requisicao_id: reqB.requisicao_id }) });
    assert.equal(r.status, 201, "nome único só dentro da empresa");
    const { rows } = await pool.query("select empresa_id, criado_por from pesquisas_salvas where id = $1", [(await json(r)).id]);
    assert.deepEqual(rows[0], { empresa_id: empresaB, criado_por: usuarioB });
  });

  test("empresas: análises de fotos separadas", async () => {
    const analise = randomUUID();
    await chamar("/analises-foto", {
      method: "POST",
      body: JSON.stringify({ id: analise, imovel_id: "flow-1", status: "sugerido", modelo: "m", empresa_id: empresaB, usuario_id: usuarioB }),
    });
    const { rows } = await pool.query("select empresa_id, usuario_id from analises_foto where id = $1", [analise]);
    assert.deepEqual(rows[0], { empresa_id: empresaA, usuario_id: usuarioA }, "empresa e usuário vêm da sessão, não do corpo");

    const log = { id: randomUUID(), analise_id: analise, imovel_id: "flow-1", foto_url: "https://exemplo.com/1.jpg", modelo: "m", provedor: "p", status: "lida" };
    assert.equal((await comoB("/analises-foto/logs", { method: "POST", body: JSON.stringify([log]) })).status, 404, "B não grava log na análise de A");
    assert.equal((await comoB(`/analises-foto/${analise}/aprovar`, { method: "POST", body: JSON.stringify({ imovel_id: "flow-1" }) })).status, 404);
    assert.equal((await chamar("/analises-foto/logs", { method: "POST", body: JSON.stringify([log]) })).status, 201);
  });

  test("cache compartilhado: B pesquisa o mesmo que A e recebe na hora, sem nova coleta", async () => {
    const filtros = { ...requisicao().filtros, bairros: ["Uvaranas"] };
    const reqA = requisicao({ filtros });
    await chamar("/buscas", { method: "POST", body: JSON.stringify(reqA) });
    await esperarColetas();
    const antes = coletas;

    const reqB = requisicao({ filtros, fontes: ["kikina", "flow"] });
    const r = await comoB("/buscas", { method: "POST", body: JSON.stringify(reqB) });
    const corpo = await json(r);
    assert.equal(corpo.status, "parcial");
    assert.equal(corpo.requisicao_id, reqB.requisicao_id);
    assert.equal(coletas, antes, "não abriu os sites de novo");

    // Cada empresa só lê a própria requisição, mesmo sendo o mesmo resultado.
    assert.equal((await comoB(`/buscas/${reqB.requisicao_id}`)).status, 200);
    assert.equal((await comoB(`/buscas/${reqA.requisicao_id}`)).status, 404);
    assert.equal((await chamar(`/buscas/${reqB.requisicao_id}`)).status, 404);

    // A cópia vence junto com o original: repetir a busca não estica a validade do dado.
    const { rows } = await pool.query(
      "select requisicao_id, expira_em, empresa_id from buscas where requisicao_id = any($1::uuid[])",
      [[reqA.requisicao_id, reqB.requisicao_id]],
    );
    const porId = Object.fromEntries(rows.map((l) => [l.requisicao_id, l]));
    assert.equal(porId[reqB.requisicao_id].expira_em.getTime(), porId[reqA.requisicao_id].expira_em.getTime());
    assert.equal(porId[reqB.requisicao_id].empresa_id, empresaB);
  });

  test("busca em andamento: B pega carona na coleta de A em vez de abrir os sites de novo", async () => {
    let abrir!: () => void;
    portao = new Promise<void>((r) => (abrir = r));
    const filtros = { ...requisicao().filtros, bairros: ["Oficinas"] };
    const reqA = requisicao({ filtros });
    const reqB = requisicao({ filtros });
    const reqB2 = requisicao({ filtros, atualizar_cache: true });
    try {
      assert.equal((await json(await chamar("/buscas", { method: "POST", body: JSON.stringify(reqA) }))).status, "processando");
      const antes = coletas;
      const [rB, rB2] = await Promise.all([
        comoB("/buscas", { method: "POST", body: JSON.stringify(reqB) }),
        comoB("/buscas", { method: "POST", body: JSON.stringify(reqB2) }),
      ]);
      assert.equal((await json(rB)).status, "processando");
      assert.equal((await json(rB2)).status, "processando", "atualizar_cache também aproveita a coleta que acabou de começar");
      const progresso = await json(await comoB(`/buscas/${reqB.requisicao_id}`));
      assert.equal(progresso.status, "processando");
      assert.deepEqual(progresso.fontes.map((f: { id: string }) => f.id), ["flow", "kikina"], "mostra o progresso da coleta seguida");
      assert.equal(coletas, antes, "nenhuma coleta nova enquanto a de A roda");
    } finally {
      abrir();
      portao = null;
    }
    await esperarColetas();
    for (const id of [reqB.requisicao_id, reqB2.requisicao_id]) {
      const final = await json(await comoB(`/buscas/${id}`));
      assert.equal(final.status, "parcial");
      assert.equal(final.requisicao_id, id, "o resultado vem com o requisicao_id de quem seguiu");
      assert.equal(final.imoveis.length, 2);
    }
    // B consegue salvar a pesquisa a partir da busca que seguiu a de A.
    const r = await comoB("/pesquisas", { method: "POST", body: JSON.stringify({ nome: "Carona", requisicao_id: reqB.requisicao_id }) });
    assert.equal(r.status, 201);
  });

  test("busca em andamento travada não segura a chave para sempre", async () => {
    const filtros = { ...requisicao().filtros, bairros: ["Ronda"] };
    const travada = requisicao({ filtros });
    // Simula uma coleta que começou há 20 minutos e nunca gravou o fim.
    let abrir!: () => void;
    portao = new Promise<void>((r) => (abrir = r));
    await chamar("/buscas", { method: "POST", body: JSON.stringify(travada) });
    await pool.query("update buscas set criado_em = now() - interval '20 minutes' where requisicao_id = $1", [travada.requisicao_id]);
    portao = null;
    const nova = requisicao({ filtros });
    const antes = coletas;
    assert.equal((await json(await comoB("/buscas", { method: "POST", body: JSON.stringify(nova) }))).status, "processando");
    assert.equal((await json(await chamar(`/buscas/${travada.requisicao_id}`))).status, "erro", "a travada vira erro para o front parar de esperar");
    abrir();
    await esperarColetas();
    // A nova abriu a coleta dela (em vez de seguir a travada); a travada, liberada agora, também termina.
    assert.equal(coletas, antes + 2);
    assert.equal((await json(await comoB(`/buscas/${nova.requisicao_id}`))).status, "parcial");
  });

  test("validade do cache: CACHE_BUSCAS_HORAS (padrão 24 h) e gravada no fim da coleta", async () => {
    assert.equal(horasCache({}), 24);
    assert.equal(horasCache({ CACHE_BUSCAS_HORAS: "48" }), 48);
    for (const ruim of ["0", "169", "abc", "1.5", ""]) assert.equal(horasCache({ CACHE_BUSCAS_HORAS: ruim }), 24, ruim);
    const id = await buscaConcluida({ filtros: { ...requisicao().filtros, bairros: ["Nova Rússia"] } });
    const { rows } = await pool.query("select extract(epoch from expira_em - concluido_em) / 3600 as horas from buscas where requisicao_id = $1", [id]);
    assert.ok(Math.abs(Number(rows[0].horas) - 24) < 0.01, `veio ${rows[0].horas}`);
  });

  test("migração 006: dados e usuários existentes vão para a Agência Byte", async () => {
    // Banco no estado anterior (001 a 005) num schema à parte, com dados de antes das empresas.
    const pasta = await fs.mkdtemp(path.join(tmpdir(), "migr-"));
    const todos = (await fs.readdir(PASTA_SQL)).filter((a) => a.endsWith(".sql")).sort();
    for (const a of todos) await fs.copyFile(new URL(a, PASTA_SQL), path.join(pasta, a));
    await fs.rename(path.join(pasta, "006_empresas.sql"), path.join(pasta, "006_empresas.sql.depois"));
    const schema = "migracao_teste";
    await pool.query(`drop schema if exists ${schema} cascade; create schema ${schema}`);
    const url = new URL(URL_TESTE!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const antigo = criarPool(url.toString());
    try {
      const pastaUrl = pathToFileURL(pasta + "/");
      assert.equal((await migrar(antigo, pastaUrl)).length, 5);
      const u = await antigo.query<{ id: string }>("insert into usuarios (email, nome, senha_hash) values ('velho@x.com', 'Velho', 'h') returning id");
      await antigo.query("insert into avaliacoes_imovel (imovel_id, estado_conservacao) values ('flow-1', 'C')");
      await antigo.query("insert into pesquisas_salvas (nome, filtros, fontes, resposta) values ('Antiga', '{}', '[]', '{}')");
      await antigo.query("insert into analises_foto (id, imovel_id, status, modelo) values ($1, 'flow-1', 'sugerido', 'm')", [randomUUID()]);
      await antigo.query("insert into buscas (requisicao_id, chave_cache, status, requisicao) values ($1, 'k', 'processando', '{}'), ($2, 'k', 'processando', '{}')", [randomUUID(), randomUUID()]);

      await fs.rename(path.join(pasta, "006_empresas.sql.depois"), path.join(pasta, "006_empresas.sql"));
      assert.deepEqual(await migrar(antigo, pastaUrl), ["006_empresas.sql"]);
      const empresas = (await antigo.query("select id, nome from empresas")).rows;
      assert.deepEqual(empresas.map((e) => e.nome), ["Agência Byte"]);
      const byte = empresas[0].id;
      assert.deepEqual((await antigo.query("select empresa_id, papel from usuarios where id = $1", [u.rows[0].id])).rows[0], { empresa_id: byte, papel: "admin" });
      for (const t of ["avaliacoes_imovel", "pesquisas_salvas", "analises_foto", "buscas"]) {
        const { rows } = await antigo.query(`select count(*)::int as n from ${t} where empresa_id is distinct from $1`, [byte]);
        assert.equal(rows[0].n, 0, t);
      }
      const { rows: proc } = await antigo.query("select status from buscas order by status");
      assert.deepEqual(proc.map((r) => r.status), ["erro", "processando"], "duas coletas iguais interrompidas: só uma fica em andamento");
    } finally {
      await antigo.end();
      await pool.query(`drop schema ${schema} cascade`);
      await fs.rm(pasta, { recursive: true, force: true });
    }
  });
});
