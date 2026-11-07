// Análise da avaliadora (seção 7): uma linha por imóvel em avaliacoes_imovel.
import type { AvaliacaoImovel } from "../../web/src/lib/contrato";
import type { Db } from "./db";

// area_terreno_m2 é numeric: o pg devolve texto, por isso o cast para double precision.
const COLUNAS = `imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao,
  area_terreno_m2::double precision as area_terreno_m2, piscina, condominio, atualizado_em`;

export async function listarAvaliacoes(db: Db): Promise<AvaliacaoImovel[]> {
  const { rows } = await db.query<AvaliacaoImovel>(`select ${COLUNAS} from avaliacoes_imovel`);
  return rows;
}

export async function salvarAvaliacao(db: Db, a: AvaliacaoImovel): Promise<AvaliacaoImovel> {
  const { rows } = await db.query<AvaliacaoImovel>(
    `insert into avaliacoes_imovel (imovel_id, estado_conservacao, padrao_acabamento, observacoes, incluido_avaliacao, area_terreno_m2, piscina, condominio)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (imovel_id) do update set
       estado_conservacao = excluded.estado_conservacao,
       padrao_acabamento  = excluded.padrao_acabamento,
       observacoes        = excluded.observacoes,
       incluido_avaliacao = excluded.incluido_avaliacao,
       area_terreno_m2    = excluded.area_terreno_m2,
       piscina            = excluded.piscina,
       condominio         = excluded.condominio
     returning ${COLUNAS}`,
    [
      a.imovel_id, a.estado_conservacao ?? null, a.padrao_acabamento ?? null, a.observacoes ?? null, a.incluido_avaliacao ?? null,
      a.area_terreno_m2 ?? null, a.piscina ?? null, a.condominio ?? null,
    ],
  );
  return rows[0];
}
