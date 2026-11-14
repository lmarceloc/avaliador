// Registros da sugestão por fotos: analises_foto, analises_foto_log e triagens_jev.
// A análise roda no site (Vercel); aqui só se grava o que ela produziu.
import type { Db } from "./db";
import type { Contexto } from "./usuarios";

type Linha = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUNAS_ANALISE = [
  "id", "imovel_id", "status", "ec_classe", "padrao_codigo", "padrao_sisdia", "justificativa", "confianca",
  "modelo", "resposta_bruta", "criado_em", "aprovado_por", "aprovado_em", "empresa_id", "usuario_id",
] as const;
const COLUNAS_LOG = [
  "id", "analise_id", "imovel_id", "foto_url", "foto_sha256", "bytes", "content_type", "modelo", "provedor",
  "status", "motivo_erro", "tokens_entrada", "tokens_saida", "latencia_ms", "criado_em",
] as const;
const COLUNAS_TRIAGEM = [
  "id", "analise_id", "imovel_id", "pergunta", "tipo", "probabilidade", "valor_escolhido", "nota", "modelo",
  "status", "motivo_erro", "latencia_ms", "resposta_bruta", "criado_em",
] as const;

/** Insere várias linhas num só comando, só com as colunas conhecidas (o resto do objeto é ignorado). */
async function inserir(db: Db, tabela: string, colunas: readonly string[], linhas: Linha[], jsonb: string[] = []): Promise<void> {
  if (linhas.length === 0) return;
  const valores: unknown[] = [];
  const tuplas = linhas.map((l) => {
    const marcadores = colunas.map((c) => {
      const v = l[c] ?? null;
      valores.push(jsonb.includes(c) && v !== null ? JSON.stringify(v) : v);
      return `$${valores.length}`;
    });
    return `(${marcadores.join(", ")})`;
  });
  await db.query(`insert into ${tabela} (${colunas.join(", ")}) values ${tuplas.join(", ")}`, valores);
}

// criado_em é not null: se o site não mandar, vale o horário da gravação.
const comData = (l: Linha): Linha => ({ ...l, criado_em: l.criado_em ?? new Date().toISOString() });

/** A empresa e o usuário vêm sempre da sessão: o que o site mandar nesses campos é ignorado. */
export function gravarAnalise(db: Db, ctx: Contexto, linha: Linha): Promise<void> {
  return inserir(db, "analises_foto", COLUNAS_ANALISE, [{ ...comData(linha), empresa_id: ctx.empresaId, usuario_id: ctx.usuarioId }]);
}

/** Logs e triagens só podem apontar para análises da própria empresa. Devolve false se alguma não é. */
async function analisesDaEmpresa(db: Db, ctx: Contexto, linhas: Linha[]): Promise<boolean> {
  const ids = [...new Set(linhas.map((l) => l.analise_id))];
  if (ids.length === 0) return true;
  if (ids.some((id) => typeof id !== "string" || !UUID.test(id))) return false;
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from analises_foto where id = any($1::uuid[]) and empresa_id = $2",
    [ids, ctx.empresaId],
  );
  return rows[0].n === ids.length;
}

export async function gravarLogs(db: Db, ctx: Contexto, linhas: Linha[]): Promise<boolean> {
  if (!(await analisesDaEmpresa(db, ctx, linhas))) return false;
  await inserir(db, "analises_foto_log", COLUNAS_LOG, linhas.map(comData));
  return true;
}

export async function gravarTriagens(db: Db, ctx: Contexto, linhas: Linha[]): Promise<boolean> {
  if (!(await analisesDaEmpresa(db, ctx, linhas))) return false;
  await inserir(db, "triagens_jev", COLUNAS_TRIAGEM, linhas.map(comData), ["resposta_bruta"]);
  return true;
}

/** Marca a análise como aprovada depois que o usuário confirmou e a avaliação foi gravada. Devolve false se não existe. */
export async function aprovarAnalise(db: Db, ctx: Contexto, id: string, imovelId: string, por: string | null): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rowCount } = await db.query(
    "update analises_foto set aprovado_por = $3, aprovado_em = now() where id = $1 and imovel_id = $2 and empresa_id = $4",
    [id, imovelId, por, ctx.empresaId],
  );
  return Boolean(rowCount);
}
