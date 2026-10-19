// Referência de teste: os dois imóveis Torre Branca já analisados manualmente pelo Manus.
// Servem só para checar o pipeline (resposta do modelo → tabela de depreciação); não são verdade absoluta.
// As URLs são fictícias: os testes simulam o download e a resposta do modelo.
export const TORRE_BRANCA = [
  { imovel_id: "CA3039_TB", esperado: { ec_classe: "B", depreciacao_percentual: 0.32 } },
  { imovel_id: "CA2709_TB", esperado: { ec_classe: "C", depreciacao_percentual: 2.52 } },
].map((i) => ({ ...i, fotos: [1, 2, 3].map((n) => `https://fotos.exemplo.test/${i.imovel_id}/${n}.jpg`) }));
