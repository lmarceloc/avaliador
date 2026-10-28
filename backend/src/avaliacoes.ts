// Análise da avaliadora (seção 7): uma linha por imóvel em avaliacoes_imovel.
import type { AvaliacaoImovel } from "../../web/src/lib/contrato";
import type { Db } from "./db";

const COLUNAS = "imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao, atualizado_em";

export async function listarAvaliacoes(db: Db): Promise<AvaliacaoImovel[]> {
  const { rows } = await db.query<AvaliacaoImovel>(`select ${COLUNAS} from avaliacoes_imovel`);
  return rows;
}

export async function salvarAvaliacao(db: Db, a: AvaliacaoImovel): Promise<AvaliacaoImovel> {
  const { rows } = await db.query<AvaliacaoImovel>(
    `insert into avaliacoes_imovel (imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao)
     values ($1, $2, $3, $4, $5)
     on conflict (imovel_id) do update set
       estado_conservacao = excluded.estado_conservacao,
       padrao_acabamento  = excluded.padrao_acabamento,
       observacoes        = excluded.observacoes,
       incluido_avaliacao = excluded.incluido_avaliacao
     returning ${COLUNAS}`,
    [a.imovel_id, a.estado_conservacao ?? null, a.padrao_acabamento ?? null, a.observacoes ?? null, a.incluido_avaliacao ?? null],
  );
  return rows[0];
}
