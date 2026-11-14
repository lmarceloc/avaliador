// POST /buscas e GET /buscas/:id (seções 5 e 6.4). Era o fluxo "Busca de Imóveis" do n8n:
// valida, consulta o cache (compartilhado entre empresas), responde "processando" na hora e coleta em segundo plano.
import type { FonteResumo, RequisicaoBusca, RespostaBusca } from "../../web/src/lib/contrato";
import { CIDADE_DA_FONTE, CIDADES, NOMES } from "./conectores.js";
import type { Db } from "./db";
import type { ResultadoColeta } from "./coleta";
import type { Contexto } from "./usuarios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FONTES_CADASTRADAS: string[] = Object.keys(NOMES);

export interface Resposta {
  codigo: number;
  corpo: unknown;
}

interface Validada {
  erro: string | null;
  requisicao: RequisicaoBusca;
  chave_cache: string;
  fontes_iniciais: FonteResumo[];
}

type Faixa = { min: number | null; max: number | null };
const faixa = (x: Partial<Faixa> | null | undefined): Faixa => ({
  min: x && x.min != null ? Number(x.min) : null,
  max: x && x.max != null ? Number(x.max) : null,
});

// FNV-1a duplo: o mesmo hash do n8n, para a chave de cache não mudar com a troca de backend.
function hash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Regras da seção 5.1 + chave de cache (4.5). */
export function validarRequisicao(corpo: unknown): Validada {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = corpo && typeof corpo === "object" ? corpo : {};
  let erro: string | null = null;
  if (!req.requisicao_id || !UUID.test(req.requisicao_id)) erro = "requisicao_id deve ser um UUID";
  else if (!req.filtros || !Array.isArray(req.filtros.tipos) || req.filtros.tipos.length === 0) erro = "filtros.tipos é obrigatório e não pode ser vazio";
  else if (!Array.isArray(req.fontes) || req.fontes.length === 0) erro = "Selecione ao menos uma fonte";
  else if (req.fontes.some((f: unknown) => !FONTES_CADASTRADAS.includes(f as string)))
    erro = "Fonte desconhecida: " + req.fontes.filter((f: unknown) => !FONTES_CADASTRADAS.includes(f as string)).join(", ");
  else if (req.cidade != null && !CIDADES.includes(req.cidade)) erro = `Cidade não atendida: ${req.cidade}. Cidades: ${CIDADES.join(", ")}`;
  else if (req.fontes.some((f: string) => CIDADE_DA_FONTE[f] !== (req.cidade || "Ponta Grossa")))
    erro = `Fonte de outra cidade: ${req.fontes.filter((f: string) => CIDADE_DA_FONTE[f] !== (req.cidade || "Ponta Grossa")).join(", ")}`;
  else if (req.filtros.tipo_casa != null && !["indiferente", "terrea", "sobrado"].includes(req.filtros.tipo_casa))
    erro = 'filtros.tipo_casa deve ser "indiferente", "terrea" ou "sobrado"';
  else if (req.filtros.geminada != null && !["indiferente", "sim", "nao"].includes(req.filtros.geminada))
    erro = 'filtros.geminada deve ser "indiferente", "sim" ou "nao"';
  else if (req.filtros.finalidade != null && !["venda", "locacao"].includes(req.filtros.finalidade))
    erro = 'filtros.finalidade deve ser "venda" ou "locacao"';

  const f = req.filtros || {};
  const filtros = {
    // Pesquisas e requisições antigas não têm o campo: valem como venda.
    finalidade: f.finalidade === "locacao" ? "locacao" : "venda",
    tipos: (f.tipos || []).slice().sort(),
    // Antigas não têm o campo; só entra na chave quando escolhido (o cache das buscas sem ele continua valendo).
    ...(f.tipo_casa === "terrea" || f.tipo_casa === "sobrado" ? { tipo_casa: f.tipo_casa } : {}),
    ...(f.geminada === "sim" || f.geminada === "nao" ? { geminada: f.geminada } : {}),
    bairros: (f.bairros || []).slice().sort(),
    area_construida: faixa(f.area_construida),
    area_terreno: faixa(f.area_terreno),
    preco_total: faixa(f.preco_total),
    dormitorios_min: f.dormitorios_min ?? null,
    suites_min: f.suites_min ?? null,
    banheiros_min: f.banheiros_min ?? null,
    vagas_min: f.vagas_min ?? null,
    condominio: f.condominio || "indiferente",
    pavimentos: faixa(f.pavimentos),
    area_lazer: f.area_lazer || "indiferente",
    piscina: f.piscina || "indiferente",
  };
  const fontes: string[] = Array.isArray(req.fontes) ? req.fontes.slice().sort() : [];
  return {
    erro,
    requisicao: { ...req, cidade: req.cidade || "Ponta Grossa", uf: req.uf || "PR", filtros: { ...filtros, tipos: f.tipos || [], bairros: f.bairros || [] } },
    chave_cache: hash(JSON.stringify({ cidade: req.cidade || "Ponta Grossa", fontes, filtros })),
    fontes_iniciais: (Array.isArray(req.fontes) ? req.fontes : []).map((id: string) => ({
      id, nome: (NOMES as Record<string, string>)[id] || id, status: "buscando", itens: 0,
    })),
  };
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Por quanto tempo o resultado de uma busca serve de cache para qualquer empresa (CACHE_BUSCAS_HORAS,
 * de 1 a 168; padrão 24). Depois disso a próxima busca igual vai de novo aos sites. Quem precisa de dado
 * fresco antes disso usa "atualizar" no site (atualizar_cache).
 */
export function horasCache(env: Record<string, string | undefined> = process.env): number {
  const h = Number(env.CACHE_BUSCAS_HORAS);
  return Number.isInteger(h) && h >= 1 && h <= 168 ? h : 24;
}

/** Coleta "processando" há mais tempo que isto travou (o serviço não gravou o fim): deixa de servir de carona. */
const COLETA_TRAVADA = "15 minutes";

function respostaErro(requisicao_id: string, fontes: FonteResumo[], codigo: string, mensagem: string): RespostaBusca {
  return {
    requisicao_id, status: "erro", gerado_em: new Date().toISOString(),
    fontes: fontes.map((f) => ({ ...f, status: "erro" as const, mensagem })), imoveis: [],
    erros: [{ fonte: "*", codigo, mensagem }],
  };
}

/**
 * Buscas que pegaram carona numa coleta em andamento (origem_id) recebem o resultado assim que ela termina,
 * com o próprio requisicao_id. Chamado antes de ler uma busca.
 */
export async function sincronizarSeguidoras(db: Db, ids: string[]): Promise<void> {
  await db.query(
    `update buscas b
        set status = o.status, resposta = jsonb_set(o.resposta, '{requisicao_id}', to_jsonb(b.requisicao_id::text)),
            fontes_status = o.fontes_status, concluido_em = now(), expira_em = o.expira_em
       from buscas o
      where b.requisicao_id = any($1::uuid[]) and b.origem_id = o.requisicao_id and b.status = 'processando'
        and o.status <> 'processando' and o.resposta is not null`,
    [ids],
  );
}

/**
 * Responde na hora: o resultado do cache (status concluido/parcial) ou "processando". No segundo caso
 * devolve também `coleta`, a promessa da coleta em segundo plano (o servidor não espera por ela).
 *
 * O cache é compartilhado entre as empresas: a chave não tem empresa, só cidade + fontes + filtros. Se a
 * mesma busca já está sendo coletada (por qualquer empresa), esta pega carona nela em vez de abrir os
 * sites de novo. Cada linha de buscas guarda a empresa e o usuário que pediram, e só essa empresa lê a linha.
 */
export async function iniciarBusca(
  db: Db,
  ctx: Contexto,
  corpo: unknown,
  coletar: (req: RequisicaoBusca) => Promise<ResultadoColeta>,
  horas = horasCache(),
): Promise<Resposta & { coleta?: Promise<void> }> {
  const v = validarRequisicao(corpo);
  if (v.erro) return { codigo: 400, corpo: { status: "erro", mensagem: v.erro } };
  const req = v.requisicao;

  // Mesmo requisicao_id de novo (ex.: o navegador repetiu o POST): devolve o estado atual, sem coletar duas vezes.
  const { rows: existentes } = await db.query<{ empresa_id: string }>("select empresa_id from buscas where requisicao_id = $1", [req.requisicao_id]);
  if (existentes[0]) {
    if (existentes[0].empresa_id !== ctx.empresaId) return { codigo: 409, corpo: { status: "erro", mensagem: "requisicao_id já usado" } };
    return consultarBusca(db, ctx, req.requisicao_id);
  }

  // Coleta que travou não pode segurar a vaga de "em andamento" desta chave.
  const { rows: travadas } = await db.query<{ requisicao_id: string; fontes_status: FonteResumo[] | null }>(
    `select requisicao_id, fontes_status from buscas
      where chave_cache = $1 and status = 'processando' and origem_id is null and criado_em < now() - interval '${COLETA_TRAVADA}'`,
    [v.chave_cache],
  );
  for (const t of travadas) {
    const resposta = respostaErro(t.requisicao_id, t.fontes_status ?? [], "INTERROMPIDA", "A busca não terminou a tempo. Faça a busca de novo.");
    await db.query(
      "update buscas set status = 'erro', resposta = $2, fontes_status = $3, concluido_em = now() where requisicao_id = $1 and status = 'processando'",
      [t.requisicao_id, json(resposta), json(resposta.fontes)],
    );
  }

  // Duas voltas no máximo: se a coleta em andamento terminar bem no meio, a segunda volta acha o cache dela.
  for (let volta = 0; volta < 2; volta++) {
    if (!req.atualizar_cache) {
      const { rows } = await db.query<{ resposta: RespostaBusca; expira_em: Date }>(
        `select resposta, expira_em from buscas
          where chave_cache = $1 and status in ('concluido', 'parcial') and expira_em > now() and resposta is not null
          order by criado_em desc limit 1`,
        [v.chave_cache],
      );
      if (rows[0]) {
        const resposta = { ...rows[0].resposta, requisicao_id: req.requisicao_id };
        // A cópia vence junto com o original: repetir a busca não estica a validade de um dado velho.
        await db.query(
          `insert into buscas (requisicao_id, chave_cache, status, requisicao, resposta, fontes_status, concluido_em, expira_em, empresa_id, usuario_id)
           values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9)`,
          [req.requisicao_id, v.chave_cache, resposta.status, json(req), json(resposta), json(resposta.fontes ?? []), rows[0].expira_em, ctx.empresaId, ctx.usuarioId],
        );
        return { codigo: 200, corpo: resposta };
      }
    }

    // Tenta ser a coleta da chave. O índice buscas_em_andamento_idx deixa só uma "processando" por chave.
    const { rowCount } = await db.query(
      `insert into buscas (requisicao_id, chave_cache, status, requisicao, fontes_status, expira_em, empresa_id, usuario_id)
       values ($1, $2, 'processando', $3, $4, now() + make_interval(hours => $5), $6, $7)
       on conflict do nothing`,
      [req.requisicao_id, v.chave_cache, json(req), json(v.fontes_iniciais), horas, ctx.empresaId, ctx.usuarioId],
    );
    if (rowCount) {
      const coleta = (async () => {
        const r = await coletar(req);
        await db.query(
          `update buscas set status = $2, resposta = $3, fontes_status = $4, concluido_em = now(), expira_em = now() + make_interval(hours => $5)
            where requisicao_id = $1`,
          [req.requisicao_id, r.status, json(r.resposta), json(r.fontes_status), horas],
        );
      })();
      return { codigo: 200, corpo: { requisicao_id: req.requisicao_id, status: "processando", fontes: v.fontes_iniciais }, coleta };
    }

    // Já há uma coleta igual em andamento: esta segue aquela.
    const { rows: andamento } = await db.query<{ requisicao_id: string; fontes_status: FonteResumo[] | null }>(
      "select requisicao_id, fontes_status from buscas where chave_cache = $1 and status = 'processando' and origem_id is null",
      [v.chave_cache],
    );
    if (andamento[0]) {
      await db.query(
        `insert into buscas (requisicao_id, chave_cache, status, requisicao, fontes_status, origem_id, empresa_id, usuario_id)
         values ($1, $2, 'processando', $3, $4, $5, $6, $7)`,
        [req.requisicao_id, v.chave_cache, json(req), json(andamento[0].fontes_status ?? v.fontes_iniciais), andamento[0].requisicao_id, ctx.empresaId, ctx.usuarioId],
      );
      return { codigo: 200, corpo: { requisicao_id: req.requisicao_id, status: "processando", fontes: andamento[0].fontes_status ?? v.fontes_iniciais } };
    }
  }
  return { codigo: 503, corpo: { status: "erro", mensagem: "Não foi possível iniciar a busca agora. Tente de novo." } };
}

/** GET /buscas/:id: o resultado gravado ou o progresso da busca (6.4). Só a empresa que pediu lê. */
export async function consultarBusca(db: Db, ctx: Contexto, id: string): Promise<Resposta> {
  const naoEncontrada = { codigo: 404, corpo: { requisicao_id: id, status: "erro", mensagem: "Busca não encontrada ou expirada" } };
  if (!UUID.test(id)) return naoEncontrada;
  await sincronizarSeguidoras(db, [id]);
  const { rows } = await db.query<{ status: string; resposta: RespostaBusca | null; fontes_status: FonteResumo[] | null; fontes_origem: FonteResumo[] | null }>(
    `select b.status, b.resposta, b.fontes_status, o.fontes_status as fontes_origem
       from buscas b left join buscas o on o.requisicao_id = b.origem_id
      where b.requisicao_id = $1 and b.empresa_id = $2`,
    [id, ctx.empresaId],
  );
  const linha = rows[0];
  if (!linha) return naoEncontrada;
  if (linha.status === "processando" || !linha.resposta)
    return { codigo: 200, corpo: { requisicao_id: id, status: "processando", fontes: linha.fontes_origem || linha.fontes_status || [] } };
  return { codigo: 200, corpo: linha.resposta };
}

/**
 * Buscas que ficaram "processando" quando o serviço caiu nunca vão terminar: marca como erro
 * para o front parar de esperar e mostrar o motivo.
 */
export async function encerrarBuscasInterrompidas(db: Db): Promise<number> {
  const { rows } = await db.query<{ requisicao_id: string; fontes_status: FonteResumo[] | null }>(
    "select requisicao_id, fontes_status from buscas where status = 'processando'",
  );
  const mensagem = "A busca foi interrompida porque o serviço reiniciou. Faça a busca de novo.";
  for (const { requisicao_id, fontes_status } of rows) {
    const resposta = respostaErro(requisicao_id, fontes_status ?? [], "INTERROMPIDA", mensagem);
    await db.query(
      "update buscas set status = 'erro', resposta = $2, fontes_status = $3, concluido_em = now() where requisicao_id = $1 and status = 'processando'",
      [requisicao_id, json(resposta), json(resposta.fontes)],
    );
  }
  return rows.length;
}

/** Validade do cache (horasCache): apaga as buscas vencidas. */
export async function limparBuscasExpiradas(db: Db): Promise<number> {
  const { rowCount } = await db.query("delete from buscas where expira_em < now() and status <> 'processando'");
  return rowCount ?? 0;
}
