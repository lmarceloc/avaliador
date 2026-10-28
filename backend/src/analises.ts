// Registros da sugestão por fotos: analises_foto, analises_foto_log e triagens_jev.
// A análise roda no site (Vercel); aqui só se grava o que ela produziu.
import type { Db } from "./db";

type Linha = Record<string, unknown>;

const COLUNAS_ANALISE = [
  "id", "imovel_id", "status", "ec_classe", "padrao_codigo", "padrao_sisdia", "justificativa", "confianca",
  "modelo", "resposta_bruta", "criado_em", "aprovado_por", "aprovado_em",
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

export function gravarAnalise(db: Db, linha: Linha): Promise<void> {
  return inserir(db, "analises_foto", COLUNAS_ANALISE, [comData(linha)]);
}

export function gravarLogs(db: Db, linhas: Linha[]): Promise<void> {
  return inserir(db, "analises_foto_log", COLUNAS_LOG, linhas.map(comData));
}

export function gravarTriagens(db: Db, linhas: Linha[]): Promise<void> {
  return inserir(db, "triagens_jev", COLUNAS_TRIAGEM, linhas.map(comData), ["resposta_bruta"]);
}

/** Marca a análise como aprovada depois que o usuário confirmou e a avaliação foi gravada. Devolve false se não existe. */
export async function aprovarAnalise(db: Db, id: string, imovelId: string, por: string | null): Promise<boolean> {
  const { rowCount } = await db.query(
    "update analises_foto set aprovado_por = $3, aprovado_em = now() where id = $1 and imovel_id = $2",
    [id, imovelId, por],
  );
  return Boolean(rowCount);
}
