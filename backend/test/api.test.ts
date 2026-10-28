// Testes da API contra um Postgres de verdade (descartável).
// Uso: DATABASE_URL_TESTE=postgres://postgres@localhost:5432/avaliador_teste npm test
// O banco indicado é APAGADO no início (drop schema public cascade).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import type { Imovel, RequisicaoBusca } from "../../web/src/lib/contrato";
import { encerrarBuscasInterrompidas, limparBuscasExpiradas } from "../src/buscas";
import { executarColeta, type ResultadoColeta } from "../src/coleta";
import { criarPool, migrar } from "../src/db";
import { criarServidor } from "../src/servidor";

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

  const chamar = (caminho: string, init: RequestInit = {}, chave: string | null = CHAVE) =>
    fetch(base + caminho, { ...init, headers: { "Content-Type": "application/json", ...(chave ? { "X-API-Key": chave } : {}), ...init.headers } });
  const esperarColetas = async () => {
    await Promise.all(pendentes.splice(0));
    // a gravação do resultado roda depois da resposta HTTP; dá um respiro para o update terminar
    await new Promise((r) => setTimeout(r, 50));
  };

  before(async () => {
    pool = criarPool(URL_TESTE!);
    await pool.query("drop schema public cascade; create schema public");
    const servidor = criarServidor({
      db: pool, apiKey: CHAVE,
      coletar: (req) => {
        const p = coletar(req);
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
    assert.deepEqual(await migrar(pool), ["001_inicial.sql"]);
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
      `insert into buscas (requisicao_id, chave_cache, status, requisicao, fontes_status) values ($1, 'x', 'processando', '{}', $2)`,
      [id, JSON.stringify([{ id: "flow", nome: "Flow", status: "buscando", itens: 0 }])],
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
});
