// Regras compartilhadas (web/src/lib/regras.ts): térrea/sobrado e correções da avaliadora. Roda sem banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarCorrecoes, avaliarCriterios, casaGeminada, tipoCasa } from "../../web/src/lib/regras";
import { FILTROS_VAZIOS, type AvaliacaoImovel, type Filtros, type Imovel } from "../../web/src/lib/contrato";

const casa = (p: Partial<Imovel> = {}): Imovel => ({
  id: "x-1", fonte: { id: "x", nome: "X", contato: null, informante: null }, fontes_alternativas: [],
  url_anuncio: "https://imob.test/imovel/123", titulo: "Casa 3 quartos – Centro", tipo: "casa",
  endereco: { logradouro: null, numero: null, numero_informado: false, bairro: "Centro", cidade: "Ponta Grossa", uf: "PR" },
  area_construida_m2: 120, area_terreno_m2: null, preco_total: 500000, preco_m2: null, pavimentos: null, condominio: null,
  dormitorios: 3, suites: 1, banheiros: 2, vagas_cobertas: null, vagas_descobertas: null, vagas_total: 2,
  piscina: null, area_lazer: null, padrao_acabamento_anuncio: null, estado_conservacao_anuncio: null,
  fotos: [], foto_capa: null, data_anuncio: null, status: "normal", criterios: [], atende: true, resumo_filtro: "",
  campos_faltantes: [], coletado_em: "2026-11-07T00:00:00Z", ...p,
});

test("tipoCasa: palavra sobrado, depois pavimentos, depois térrea", () => {
  assert.equal(tipoCasa(casa({ titulo: "Sobrado 3 quartos" })), "sobrado");
  assert.equal(tipoCasa(casa({ url_anuncio: "https://imob.test/imovel/sobrado-orfas-99" })), "sobrado");
  assert.equal(tipoCasa(casa({ titulo: "Casa assobradada" })), "sobrado");
  assert.equal(tipoCasa(casa({ pavimentos: 2 })), "sobrado");
  assert.equal(tipoCasa(casa({ pavimentos: 1 })), "terrea");
  assert.equal(tipoCasa(casa({ titulo: "Casa térrea com quintal" })), "terrea");
  // 2 pavimentos sem a palavra "sobrado": sai da busca por térrea (decisão do cliente).
  assert.equal(tipoCasa(casa({ titulo: "Casa térrea", pavimentos: 2 })), "sobrado");
  // "Casa/Sobrado" é o nome da categoria do site, não diz nada.
  assert.equal(tipoCasa(casa({ titulo: "Casa/Sobrado – Uvaranas" })), null);
  assert.equal(tipoCasa(casa()), null);
  assert.equal(tipoCasa(casa({ tipo: "apartamento", titulo: "Apartamento térreo" })), null);
  assert.equal(tipoCasa(casa({ titulo: "Casa em terreno de esquina" })), null);
});

test("filtro térrea/sobrado: atende, não atende ou não verificado; não se aplica a apartamento", () => {
  const f: Filtros = { ...FILTROS_VAZIOS, tipos: ["casa", "apartamento"], tipo_casa: "terrea" };
  const crit = (i: Imovel) => avaliarCriterios(i, f).criterios.find((c) => c.campo === "tipo_casa")?.resultado;
  assert.equal(crit(casa({ pavimentos: 1 })), "atende");
  assert.equal(crit(casa({ titulo: "Sobrado" })), "nao_atende");
  assert.equal(crit(casa()), "nao_verificado");
  assert.equal(crit(casa({ tipo: "apartamento" })), undefined);
  assert.equal(avaliarCriterios(casa(), { ...f, tipo_casa: undefined }).criterios.some((c) => c.campo === "tipo_casa"), false);
});

test("aplicarCorrecoes: valores editados substituem os do anúncio e reavaliam os filtros", () => {
  const f: Filtros = { ...FILTROS_VAZIOS, area_terreno: { min: 150, max: null }, piscina: "sim", condominio: "nao" };
  const im = casa();
  assert.equal(aplicarCorrecoes(im, undefined, f).atende, false);

  const a: AvaliacaoImovel = {
    imovel_id: im.id, estado_conservacao: null, padrao_acabamento: null, observacoes: null, incluido_avaliacao: null,
    area_terreno_m2: 198, piscina: true, condominio: false,
  };
  const r = aplicarCorrecoes(im, a, f);
  assert.equal(r.area_terreno_m2, 198);
  assert.equal(r.piscina, true);
  assert.equal(r.condominio, false);
  assert.deepEqual(r.originais_anuncio, { area_terreno_m2: null, piscina: null, condominio: null });
  assert.equal(r.atende, true);
  assert.equal(r.campos_faltantes.includes("area_terreno_m2"), false);
  assert.equal(im.area_terreno_m2, null, "não altera o objeto original");

  // Sem correção salva: nada muda e não marca como editado.
  const sem = aplicarCorrecoes(casa({ area_terreno_m2: 300 }), { ...a, area_terreno_m2: null, piscina: null, condominio: null }, null);
  assert.equal(sem.area_terreno_m2, 300);
  assert.equal(sem.originais_anuncio, undefined);
});

test("casaGeminada: pela menção no anúncio", () => {
  assert.equal(casaGeminada(casa({ titulo: "Casa geminada 2 quartos" })), true);
  assert.equal(casaGeminada(casa({ url_anuncio: "https://imob.test/imovel/sobrado-geminado-orfas" })), true);
  assert.equal(casaGeminada(casa({ titulo: "Casa não geminada" })), false);
  assert.equal(casaGeminada(casa({ titulo: "Casa isolada no terreno" })), false);
  assert.equal(casaGeminada(casa()), null);
  assert.equal(casaGeminada(casa({ tipo: "apartamento", titulo: "Geminado" })), null);
});

test("correção à mão de térrea/sobrado e geminada vale no filtro", () => {
  const f: Filtros = { ...FILTROS_VAZIOS, tipo_casa: "terrea", geminada: "nao" };
  const base = casa({ titulo: "Sobrado geminado" });
  const sem = aplicarCorrecoes(base, undefined, f);
  assert.equal(sem.tipo_casa, "sobrado");
  assert.equal(sem.geminada, true);
  assert.equal(sem.atende, false);
  assert.equal(sem.originais_anuncio, undefined);

  const a: AvaliacaoImovel = {
    imovel_id: base.id, estado_conservacao: null, padrao_acabamento: null, observacoes: null, incluido_avaliacao: null,
    tipo_casa: "terrea", geminada: false,
  };
  const com = aplicarCorrecoes(base, a, f);
  assert.equal(com.tipo_casa, "terrea");
  assert.equal(com.geminada, false);
  assert.deepEqual(com.originais_anuncio, { tipo_casa: "sobrado", geminada: true });
  assert.equal(com.atende, true);
  // Apartamento: os campos de casa não se aplicam.
  assert.equal(aplicarCorrecoes(casa({ tipo: "apartamento" }), a, f).tipo_casa, undefined);
});
