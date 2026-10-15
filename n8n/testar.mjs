// Roda os conectores reais localmente, com o mesmo código que vai para o nó Code do n8n.
// Uso: node testar.mjs [arquivo-requisicao.json]
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const codigo = readFileSync(dir + "build/regras.js", "utf8") + "\n" + readFileSync(dir + "src/conectores-novos.js", "utf8") + "\n" + readFileSync(dir + "src/conectores.js", "utf8");
const carregar = new Function(`${codigo}\nreturn { Regras, coletarFontes };`);
const { Regras, coletarFontes } = carregar();

// Mesmo comportamento do this.helpers.httpRequest: lança erro com httpCode em status >= 400.
async function http(url, { timeout, headers, json, binario } = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout ?? 20000) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { httpCode: r.status });
  return binario ? new Uint8Array(await r.arrayBuffer()) : json ? r.json() : r.text();
}

const requisicao = process.argv[2]
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
      },
      fontes: (process.env.FONTES || "flow,kikina,adquira,conceito,casatop,classica,madol,tavarnaro,aspen").split(","),
      atualizar_cache: true,
    };

const t0 = Date.now();
const coleta = await coletarFontes({
  requisicao,
  http,
  timeoutFonteMs: 150000,
  avaliar: Regras.avaliarCriterios,
  log: (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`),
});
const { imoveis, resumo } = Regras.processarImoveis(coleta.imoveis, requisicao.filtros);
console.log("fontes:", coleta.fontes);
console.log("erros:", coleta.erros);
console.log("resumo:", resumo);
for (const i of imoveis.filter((x) => x.atende).slice(0, 6))
  console.log(`- ${i.id} | ${i.tipo} | ${i.endereco.bairro} | ${i.endereco.logradouro ?? "?"}, ${i.endereco.numero ?? "s/n"} | R$ ${i.preco_total} | ${i.area_construida_m2} m² | ${i.dormitorios}q | ${i.fotos.length} fotos | ${i.url_anuncio}`);
writeFileSync(dir + "build/ultimo-teste.json", JSON.stringify({ coleta: coleta.fontes, resumo, imoveis }, null, 2));
console.log(`total ${(Date.now() - t0) / 1000}s · resultado em build/ultimo-teste.json`);
