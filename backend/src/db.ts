// Conexão com o Postgres da VPS e aplicação das migrações de sql/ na subida do serviço.
import { promises as fs } from "node:fs";
import pg from "pg";

/** O mínimo que o resto do código usa do pool; nos testes pode ser um Client avulso. */
export type Db = Pick<pg.Pool, "query">;

export function criarPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}

/** Pasta das migrações: ../sql a partir de src/ (tsx) ou de dist/ (build). */
export const PASTA_SQL = new URL("../sql/", import.meta.url);

/**
 * Aplica, em ordem, os arquivos .sql ainda não aplicados. Cada arquivo roda numa transação e fica
 * registrado em schema_migracoes, então reiniciar o serviço não reaplica nada.
 */
export async function migrar(pool: pg.Pool, pasta: URL = PASTA_SQL): Promise<string[]> {
  await pool.query(`create table if not exists schema_migracoes (arquivo text primary key, aplicado_em timestamptz not null default now())`);
  const arquivos = (await fs.readdir(pasta)).filter((a) => a.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ arquivo: string }>("select arquivo from schema_migracoes");
  const aplicados = new Set(rows.map((r) => r.arquivo));
  const novos: string[] = [];
  for (const arquivo of arquivos) {
    if (aplicados.has(arquivo)) continue;
    const sql = await fs.readFile(new URL(arquivo, pasta), "utf8");
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query("insert into schema_migracoes (arquivo) values ($1)", [arquivo]);
      await cliente.query("commit");
      novos.push(arquivo);
    } catch (e) {
      await cliente.query("rollback");
      throw new Error(`Migração ${arquivo} falhou: ${(e as Error).message}`);
    } finally {
      cliente.release();
    }
  }
  return novos;
}
