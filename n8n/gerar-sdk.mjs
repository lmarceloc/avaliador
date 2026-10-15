// Converte busca-imoveis.workflow.json em código do n8n Workflow SDK, para atualizar o workflow pelo MCP.
// Uso: node gerar-sdk.mjs <workflowId> [nomeCredSupabase] [nomeCredHeaderAuth]
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const [workflowId = "busca-imoveis", credSupabase = "Imob", credHeader = "Header Auth account"] = process.argv.slice(2);
const w = JSON.parse(readFileSync(dir + "busca-imoveis.workflow.json", "utf8"));

const nomeVar = (nome) => "n_" + nome.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Strings "=..." são expressões do n8n: no SDK viram expr("...").
function valor(v) {
  if (typeof v === "string") return v.startsWith("=") ? `expr(${JSON.stringify(v.slice(1))})` : JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(valor).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${valor(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

const linhas = ['import { workflow, node, trigger, newCredential, expr } from "@n8n/workflow-sdk";', ""];
for (const n of w.nodes) {
  const ehGatilho = n.type === "n8n-nodes-base.webhook";
  const credenciais = n.credentials
    ? n.credentials.supabaseApi
      ? `{ supabaseApi: newCredential(${JSON.stringify(credSupabase)}) }`
      : `{ httpHeaderAuth: newCredential(${JSON.stringify(credHeader)}) }`
    : null;
  const config = [
    `name: ${JSON.stringify(n.name)}`,
    `parameters: ${valor(n.parameters)}`,
    credenciais && `credentials: ${credenciais}`,
    n.alwaysOutputData && "alwaysOutputData: true",
    n.webhookId && `webhookId: ${JSON.stringify(n.webhookId)}`,
    `position: ${JSON.stringify(n.position)}`,
  ].filter(Boolean);
  linhas.push(`const ${nomeVar(n.name)} = ${ehGatilho ? "trigger" : "node"}({ type: ${JSON.stringify(n.type)}, version: ${n.typeVersion}, config: { ${config.join(", ")} }, output: [{}] });`);
}

const arestas = [];
for (const [de, { main }] of Object.entries(w.connections))
  main.forEach((saidas, i) => saidas.forEach(({ node: para }) => arestas.push([de, i, para])));
const multiSaida = new Set(arestas.filter(([, i]) => i > 0).map(([de]) => de));

let fluxo = `export default workflow(${JSON.stringify(workflowId)}, ${JSON.stringify(w.name)})`;
for (const [de, i, para] of arestas) {
  // Nós IF: a saída 0 é "verdadeiro" e a 1 é "falso".
  fluxo += multiSaida.has(de)
    ? `\n  .add(${nomeVar(de)}.output(${i}).to(${nomeVar(para)}))`
    : `\n  .add(${nomeVar(de)})\n  .to(${nomeVar(para)})`;
}
linhas.push("", fluxo + ";");
writeFileSync(dir + "build/workflow-sdk.js", linhas.join("\n"));
console.log(`ok: build/workflow-sdk.js (${(linhas.join("\n").length / 1024).toFixed(0)} KB, ${w.nodes.length} nós, ${arestas.length} ligações)`);
