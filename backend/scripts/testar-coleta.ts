// Roda os conectores reais localmente, sem banco, com o mesmo código do serviço.
// Uso: npm run testar-coleta [arquivo-requisicao.json]   (FONTES=flow,kikina para limitar as fontes)
import { readFileSync, writeFileSync } from "node:fs";
import type { RequisicaoBusca } from "../../web/src/lib/contrato";
import { executarColeta } from "../src/coleta";

const requisicao: RequisicaoBusca = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], "utf8"))
  : {
      requisicao_id: "teste-local",
      cidade: "Ponta Grossa",
      uf: "PR",
      filtros: {
        tipos: ["casa"],
        bairros: ["Órfãs", "Uvaranas"],
        area_construida: { min: 100, max: 300 },
        area_terreno: { min: null, max: null },
        preco_total: { min: null, max: 1500000 },
        dormitorios_min: 3,
        suites_min: null,
        banheiros_min: null,
        vagas_min: null,
        condominio: "indiferente",
        pavimentos: { min: null, max: null },
        area_lazer: "indiferente",
        piscina: "indiferente",
      },
      fontes: (process.env.FONTES || "flow,kikina,adquira,conceito,casatop,classica,madol,tavarnaro,aspen,torre_branca,taques,montoro").split(","),
      atualizar_cache: true,
      solicitado_em: new Date().toISOString(),
    };

const t0 = Date.now();
const r = await executarColeta(requisicao, { timeoutFonteMs: 150_000 });
console.log(r.logs.join("\n"));
console.log("fontes:", r.fontes_status);
console.log("erros:", r.resposta.erros);
console.log("resumo:", r.resposta.resumo);
for (const i of (r.resposta.imoveis ?? []).filter((x) => x.atende).slice(0, 6))
  console.log(`- ${i.id} | ${i.tipo} | ${i.endereco.bairro} | ${i.endereco.logradouro ?? "?"}, ${i.endereco.numero ?? "s/n"} | R$ ${i.preco_total} | ${i.area_construida_m2} m² | ${i.dormitorios}q | ${i.fotos.length} fotos | ${i.url_anuncio}`);
writeFileSync("ultimo-teste.json", JSON.stringify(r.resposta, null, 2));
console.log(`total ${(Date.now() - t0) / 1000}s · resultado em ultimo-teste.json`);
