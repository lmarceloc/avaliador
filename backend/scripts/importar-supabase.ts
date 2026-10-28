// Copia os dados do Supabase antigo para o Postgres da VPS (uma vez, na troca).
// Lê pela API REST do Supabase com a service role e grava com "on conflict do nothing",
// então pode rodar de novo sem duplicar nada. A tabela buscas (cache de 6 h) não é copiada.
//
// Uso (no console do serviço backend no EasyPanel, onde DATABASE_URL já existe):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node dist/importar-supabase.mjs
import { criarPool, migrar } from "../src/db";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
if (!SUPABASE_URL || !CHAVE || !DATABASE_URL) {
  console.error("Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL.");
  process.exit(1);
}

// Ordem importa: logs e triagens referenciam analises_foto.
const TABELAS: { nome: string; chave: string; jsonb?: string[] }[] = [
  { nome: "avaliacoes_imovel", chave: "imovel_id" },
  { nome: "analises_foto", chave: "id" },
  { nome: "analises_foto_log", chave: "id" },
  { nome: "triagens_jev", chave: "id", jsonb: ["resposta_bruta"] },
];
const PAGINA = 1000;

async function lerTabela(nome: string, chave: string): Promise<Record<string, unknown>[]> {
  const linhas: Record<string, unknown>[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${nome}?select=*&order=${chave}.asc&limit=${PAGINA}&offset=${inicio}`, {
      headers: { apikey: CHAVE!, Authorization: `Bearer ${CHAVE}` },
    });
    if (!r.ok) throw new Error(`${nome}: Supabase respondeu ${r.status} ${await r.text()}`);
    const pagina = (await r.json()) as Record<string, unknown>[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) return linhas;
  }
}

const pool = criarPool(DATABASE_URL);
try {
  await migrar(pool);
  for (const { nome, chave, jsonb = [] } of TABELAS) {
    const linhas = await lerTabela(nome, chave);
    // Só as colunas que existem no Postgres novo.
    const { rows } = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1",
      [nome],
    );
    const colunas = rows.map((r) => r.column_name);
    let novas = 0;
    for (const l of linhas) {
      const cols = colunas.filter((c) => c in l);
      const valores = cols.map((c) => (jsonb.includes(c) && l[c] != null ? JSON.stringify(l[c]) : l[c]));
      const { rowCount } = await pool.query(
        `insert into ${nome} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (${chave}) do nothing`,
        valores,
      );
      novas += rowCount ?? 0;
    }
    console.log(`${nome}: ${linhas.length} no Supabase, ${novas} copiada(s) agora`);
  }
} finally {
  await pool.end();
}
