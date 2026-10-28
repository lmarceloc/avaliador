// Pesquisas salvas (nome + resultados + seleção), válidas por 30 dias desde a última alteração.
// Os resultados vêm da tabela buscas pelo requisicao_id: o site não precisa reenviar os imóveis.
import type { RequisicaoBusca, RespostaBusca } from "../../web/src/lib/contrato";
import {
  DIAS_VALIDADE, juntarRespostas, normalizarNome, substituirResultados, validarSelecao,
  type AlteracaoPesquisa, type NovaPesquisa, type OrigemResultados, type PesquisaSalva, type ResumoPesquisa, type Selecao,
} from "../../web/src/lib/pesquisas";
import type { Db } from "./db";

export class ErroPesquisa extends Error {
  constructor(readonly codigo: number, mensagem: string) {
    super(mensagem);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE = `interval '${DIAS_VALIDADE} days'`;
const NAO_ENCONTRADA = "Pesquisa não encontrada ou expirada";
const NOME_INVALIDO = "Dê um nome à pesquisa (até 80 caracteres)";
const NOME_REPETIDO = "Já existe uma pesquisa salva com esse nome";

const json = (v: unknown) => JSON.stringify(v);
const ehNomeRepetido = (e: unknown) => (e as { code?: string; constraint?: string }).code === "23505";

/** Lê o resultado de uma busca (e das repetições de fonte) que ainda está no cache. */
async function lerResultados(db: Db, origem: OrigemResultados): Promise<{ requisicao: RequisicaoBusca; resposta: RespostaBusca }> {
  const ids = [origem.requisicao_id, ...(origem.extras ?? [])];
  if (ids.some((id) => typeof id !== "string" || !UUID.test(id))) throw new ErroPesquisa(400, "requisicao_id inválido");
  const { rows } = await db.query<{ requisicao_id: string; status: string; requisicao: RequisicaoBusca; resposta: RespostaBusca | null }>(
    "select requisicao_id, status, requisicao, resposta from buscas where requisicao_id = any($1::uuid[])",
    [ids],
  );
  const porId = new Map(rows.map((r) => [r.requisicao_id, r]));
  const principal = porId.get(origem.requisicao_id);
  if (!principal?.resposta || principal.status === "processando")
    throw new ErroPesquisa(409, "Os resultados desta busca não estão mais disponíveis. Faça a busca de novo e salve em seguida.");
  let resposta = principal.resposta;
  for (const id of origem.extras ?? []) {
    const extra = porId.get(id)?.resposta;
    if (extra) resposta = juntarRespostas(resposta, extra);
  }
  return { requisicao: principal.requisicao, resposta };
}

async function lerSelecao(db: Db, id: string): Promise<Selecao> {
  const { rows } = await db.query<{ imovel_id: string; incluido: boolean }>(
    "select imovel_id, incluido from pesquisas_selecao where pesquisa_id = $1",
    [id],
  );
  return Object.fromEntries(rows.map((r) => [r.imovel_id, r.incluido]));
}

/** Vencidas ainda não apagadas pela limpeza não devem segurar o nome nem aparecer. */
export async function limparPesquisasExpiradas(db: Db): Promise<number> {
  const { rowCount } = await db.query("delete from pesquisas_salvas where expira_em < now()");
  return rowCount ?? 0;
}

export async function listarPesquisas(db: Db): Promise<ResumoPesquisa[]> {
  const { rows } = await db.query<ResumoPesquisa>(
    `select p.id, p.nome, p.criado_em, p.atualizado_em, p.expira_em,
            coalesce(jsonb_array_length(p.resposta -> 'imoveis'), 0) as total_imoveis,
            (select count(*)::int from pesquisas_selecao s where s.pesquisa_id = p.id and s.incluido) as selecionados
       from pesquisas_salvas p
      where p.expira_em > now()
      order by p.atualizado_em desc`,
  );
  return rows;
}

export async function lerPesquisa(db: Db, id: string): Promise<PesquisaSalva> {
  if (!UUID.test(id)) throw new ErroPesquisa(404, NAO_ENCONTRADA);
  const { rows } = await db.query<Omit<PesquisaSalva, "selecao">>(
    "select id, nome, criado_em, atualizado_em, expira_em, filtros, fontes, resposta from pesquisas_salvas where id = $1 and expira_em > now()",
    [id],
  );
  if (!rows[0]) throw new ErroPesquisa(404, NAO_ENCONTRADA);
  return { ...rows[0], selecao: await lerSelecao(db, id) };
}

export async function criarPesquisa(db: Db, corpo: Partial<NovaPesquisa> | null): Promise<PesquisaSalva> {
  const nome = normalizarNome(corpo?.nome);
  if (!nome) throw new ErroPesquisa(400, NOME_INVALIDO);
  const selecao = validarSelecao(corpo?.selecao);
  if (!selecao) throw new ErroPesquisa(400, "selecao deve ser { imovel_id: true | false }");
  const { requisicao, resposta } = await lerResultados(db, { requisicao_id: corpo!.requisicao_id!, extras: corpo!.extras });

  await limparPesquisasExpiradas(db);
  let id: string;
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into pesquisas_salvas (nome, filtros, fontes, resposta) values ($1, $2, $3, $4) returning id`,
      [nome, json(requisicao.filtros), json(requisicao.fontes), json(resposta)],
    );
    id = rows[0].id;
  } catch (e) {
    if (ehNomeRepetido(e)) throw new ErroPesquisa(409, NOME_REPETIDO);
    throw e;
  }
  if (Object.keys(selecao).length)
    await db.query(
      "insert into pesquisas_selecao (pesquisa_id, imovel_id, incluido) select $1, key, value::boolean from jsonb_each_text($2::jsonb)",
      [id, json(selecao)],
    );
  return lerPesquisa(db, id);
}

/** Renomear e/ou trocar os resultados. Toda alteração renova os 30 dias. */
export async function alterarPesquisa(db: Db, id: string, corpo: AlteracaoPesquisa | null): Promise<PesquisaSalva> {
  const atual = await lerPesquisa(db, id);
  const sets: string[] = [`atualizado_em = now()`, `expira_em = now() + ${VALIDADE}`];
  const valores: unknown[] = [id];

  if (corpo?.nome !== undefined) {
    const nome = normalizarNome(corpo.nome);
    if (!nome) throw new ErroPesquisa(400, NOME_INVALIDO);
    valores.push(nome);
    sets.push(`nome = $${valores.length}`);
  }
  if (corpo?.resultados) {
    const { modo } = corpo.resultados;
    if (modo !== "substituir" && modo !== "juntar") throw new ErroPesquisa(400, "modo deve ser substituir ou juntar");
    const { requisicao, resposta } = await lerResultados(db, corpo.resultados);
    const nova = modo === "juntar" ? juntarRespostas(atual.resposta, resposta) : substituirResultados(atual.resposta, resposta, atual.selecao);
    valores.push(json(nova));
    sets.push(`resposta = $${valores.length}`);
    if (modo === "substituir") {
      valores.push(json(requisicao.filtros), json(requisicao.fontes));
      sets.push(`filtros = $${valores.length - 1}`, `fontes = $${valores.length}`);
    }
  }
  try {
    await db.query(`update pesquisas_salvas set ${sets.join(", ")} where id = $1`, valores);
  } catch (e) {
    if (ehNomeRepetido(e)) throw new ErroPesquisa(409, NOME_REPETIDO);
    throw e;
  }
  return lerPesquisa(db, id);
}

/** Marca um imóvel na pesquisa: true = incluir, false = excluir, null = desfazer. Devolve a nova validade. */
export async function marcarImovel(db: Db, id: string, imovelId: unknown, incluido: unknown): Promise<{ expira_em: string }> {
  if (typeof imovelId !== "string" || !imovelId) throw new ErroPesquisa(400, "imovel_id é obrigatório");
  if (incluido !== null && typeof incluido !== "boolean") throw new ErroPesquisa(400, "incluido deve ser true, false ou null");
  if (!UUID.test(id)) throw new ErroPesquisa(404, NAO_ENCONTRADA);
  const { rows } = await db.query<{ expira_em: string }>(
    `update pesquisas_salvas set atualizado_em = now(), expira_em = now() + ${VALIDADE}
      where id = $1 and expira_em > now() returning expira_em`,
    [id],
  );
  if (!rows[0]) throw new ErroPesquisa(404, NAO_ENCONTRADA);
  if (incluido === null) await db.query("delete from pesquisas_selecao where pesquisa_id = $1 and imovel_id = $2", [id, imovelId]);
  else
    await db.query(
      `insert into pesquisas_selecao (pesquisa_id, imovel_id, incluido) values ($1, $2, $3)
       on conflict (pesquisa_id, imovel_id) do update set incluido = excluded.incluido, atualizado_em = now()`,
      [id, imovelId, incluido],
    );
  return rows[0];
}

export async function excluirPesquisa(db: Db, id: string): Promise<void> {
  if (!UUID.test(id)) throw new ErroPesquisa(404, NAO_ENCONTRADA);
  const { rowCount } = await db.query("delete from pesquisas_salvas where id = $1", [id]);
  if (!rowCount) throw new ErroPesquisa(404, NAO_ENCONTRADA);
}
