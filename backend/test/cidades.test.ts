// Cidade e finalidade (venda/locação): validação da requisição e filtro dos conectores. Não precisa de banco.
// Uso: npx tsx --test test/cidades.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import type { RequisicaoBusca } from "../../web/src/lib/contrato";
import { avaliarCriterios } from "../../web/src/lib/regras";
import { validarRequisicao } from "../src/buscas";
import { CIDADE_DA_FONTE, CIDADES, coletarFontes } from "../src/conectores.js";

function requisicao(parcial: Partial<RequisicaoBusca> = {}, filtros: Partial<RequisicaoBusca["filtros"]> = {}): RequisicaoBusca {
  return {
    requisicao_id: randomUUID(), cidade: "Curitiba", uf: "PR", fontes: ["kondor", "gm2"], atualizar_cache: false,
    solicitado_em: new Date().toISOString(),
    filtros: {
      tipos: ["casa"], bairros: [], area_construida: { min: null, max: null }, area_terreno: { min: null, max: null },
      preco_total: { min: null, max: null }, dormitorios_min: null, suites_min: null, banheiros_min: null, vagas_min: null,
      condominio: "indiferente", pavimentos: { min: null, max: null }, area_lazer: "indiferente", piscina: "indiferente",
      ...filtros,
    },
    ...parcial,
  };
}

describe("cadastro de fontes por cidade", () => {
  test("Ponta Grossa e Curitiba, com pelo menos 20 fontes em Curitiba", () => {
    assert.deepEqual(CIDADES, ["Ponta Grossa", "Curitiba"]);
    const curitiba = Object.values(CIDADE_DA_FONTE).filter((c) => c === "Curitiba").length;
    assert.ok(curitiba >= 20, `Curitiba tem ${curitiba} fontes`);
    assert.equal(CIDADE_DA_FONTE.flow, "Ponta Grossa");
  });
});

describe("validarRequisicao: cidade e finalidade", () => {
  test("busca de Curitiba com fontes de Curitiba é aceita; sem finalidade vale venda", () => {
    const v = validarRequisicao(requisicao());
    assert.equal(v.erro, null);
    assert.equal(v.requisicao.filtros.finalidade, "venda");
    assert.equal(v.requisicao.cidade, "Curitiba");
  });

  test("fonte de outra cidade é recusada", () => {
    const v = validarRequisicao(requisicao({ fontes: ["kondor", "flow"] }));
    assert.match(v.erro ?? "", /Fonte de outra cidade: flow/);
  });

  test("sem cidade vale Ponta Grossa (requisições antigas)", () => {
    const v = validarRequisicao(requisicao({ cidade: undefined as unknown as string, fontes: ["flow"] }));
    assert.equal(v.erro, null);
    assert.equal(v.requisicao.cidade, "Ponta Grossa");
    assert.match(validarRequisicao(requisicao({ cidade: undefined as unknown as string })).erro ?? "", /outra cidade/);
  });

  test("cidade não atendida e finalidade inválida são recusadas", () => {
    assert.match(validarRequisicao(requisicao({ cidade: "Londrina" })).erro ?? "", /Cidade não atendida/);
    assert.match(validarRequisicao(requisicao({}, { finalidade: "temporada" as never })).erro ?? "", /finalidade/);
  });

  test("venda e locação (e cidades diferentes) não compartilham cache", () => {
    const venda = validarRequisicao(requisicao({}, { finalidade: "venda" })).chave_cache;
    const locacao = validarRequisicao(requisicao({}, { finalidade: "locacao" })).chave_cache;
    assert.notEqual(venda, locacao);
    assert.equal(validarRequisicao(requisicao()).chave_cache, venda);
  });
});

// Página da Tecimob (GM2) com o estado do Next.js embutido.
function paginaTecimob(estado: unknown): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { initialState: estado } })}</script></html>`;
}

function imovelTecimob(id: string, transacao: string, local: string, preco: string) {
  return {
    id, reference: id, transaction: transacao, price: preco, url: `casa-${id}/${id}`, title_formatted: `Casa ${id}`,
    address: { formatted: local }, subtype: { title: "Padrão", type: { title: "Casa" } },
    areas: { built_area: { value: "150" }, total_area: { value: "300" } },
    rooms: { bedroom: { value: 3 }, bathroom: { value: 2 }, garage: { value: 2 } },
    images: [{ file_url: { large: `https://img/${id}-1.jpg` } }, { file_url: { large: `https://img/${id}-2.jpg` } }],
  };
}

describe("conector com finalidade e cidade (Tecimob, HTTP simulado)", () => {
  const listagem = [
    imovelTecimob("1", "VENDA", "Batel - Curitiba/PR", "R$900.000,00"),
    imovelTecimob("2", "VENDA", "Centro - Araucária/PR", "R$500.000,00"),
    imovelTecimob("3", "LOCAÇÃO", "Água Verde - Curitiba/PR", "R$3.500,00"),
  ];
  const pedidas: string[] = [];
  const http = async (url: string) => {
    pedidas.push(url);
    if (url.includes("/imovel/")) return paginaTecimob({ property: { data: { address: { street: "Rua Teste", street_number: "10" }, description: "Casa térrea com piscina aquecida e quintal amplo." } } });
    return paginaTecimob({ properties: { data: listagem, meta: { pagination: { total: 3, total_pages: 1 } } } });
  };
  const coletar = (finalidade: "venda" | "locacao") =>
    coletarFontes({
      requisicao: requisicao({ fontes: ["gm2"] }, { finalidade }),
      http, timeoutFonteMs: 10_000, config: { gm2: { intervalo_ms: 0 } }, avaliar: avaliarCriterios,
    });

  test("venda: só Curitiba e só VENDA, com a finalidade marcada", async () => {
    const r = await coletar("venda");
    assert.deepEqual(r.imoveis.map((i) => i.id), ["gm2-1"]);
    assert.equal(r.imoveis[0].finalidade, "venda");
    assert.equal(r.imoveis[0].preco_total, 900000);
    assert.equal(r.imoveis[0].endereco.logradouro, "Rua Teste");
    assert.equal(r.imoveis[0].piscina, true);
    assert.ok(pedidas.some((u) => u.includes("/comprar/casa")));
  });

  test("locação: usa /alugar e o preço é o aluguel", async () => {
    const r = await coletar("locacao");
    assert.deepEqual(r.imoveis.map((i) => i.id), ["gm2-3"]);
    assert.equal(r.imoveis[0].finalidade, "locacao");
    assert.equal(r.imoveis[0].preco_total, 3500);
    assert.ok(pedidas.some((u) => u.includes("/alugar/casa")));
  });
});
