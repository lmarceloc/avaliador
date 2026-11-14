// Análise da avaliadora (seção 7): uma linha por imóvel e por empresa em avaliacoes_imovel.
import type { AvaliacaoImovel } from "../../web/src/lib/contrato";
import type { Db } from "./db";
import type { Contexto } from "./usuarios";

// area_terreno_m2 é numeric: o pg devolve texto, por isso o cast para double precision.
const COLUNAS = `imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao,
  area_terreno_m2::double precision as area_terreno_m2, piscina, condominio, tipo_casa, geminada, atualizado_em`;

export async function listarAvaliacoes(db: Db, ctx: Contexto): Promise<AvaliacaoImovel[]> {
  const { rows } = await db.query<AvaliacaoImovel>(`select ${COLUNAS} from avaliacoes_imovel where empresa_id = $1`, [ctx.empresaId]);
  return rows;
}

export async function salvarAvaliacao(db: Db, ctx: Contexto, a: AvaliacaoImovel): Promise<AvaliacaoImovel> {
  const { rows } = await db.query<AvaliacaoImovel>(
    `insert into avaliacoes_imovel (imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao, area_terreno_m2, piscina, condominio, tipo_casa, geminada, empresa_id, atualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (empresa_id, imovel_id) do update set
       estado_conservacao = excluded.estado_conservacao,
       padrao_acabamento  = excluded.padrao_acabamento,
       observacoes        = excluded.observacoes,
       incluido_avaliacao = excluded.incluido_avaliacao,
       area_terreno_m2    = excluded.area_terreno_m2,
       piscina            = excluded.piscina,
       condominio         = excluded.condominio,
       tipo_casa          = excluded.tipo_casa,
       geminada           = excluded.geminada,
       atualizado_por     = excluded.atualizado_por
     returning ${COLUNAS}`,
    [
      a.imovel_id, a.estado_conservacao ?? null, a.padrao_acabamento ?? null, a.observacoes ?? null, a.incluido_avaliacao ?? null,
      a.area_terreno_m2 ?? null, a.piscina ?? null, a.condominio ?? null, a.tipo_casa ?? null, a.geminada ?? null,
      ctx.empresaId, ctx.usuarioId,
    ],
  );
  return rows[0];
}
