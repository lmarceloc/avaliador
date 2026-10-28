// POST /buscas e GET /buscas/:id (seções 5 e 6.4). Era o fluxo "Busca de Imóveis" do n8n:
// valida, consulta o cache de 6 h, responde "processando" na hora e coleta em segundo plano.
import type { FonteResumo, RequisicaoBusca, RespostaBusca } from "../../web/src/lib/contrato";
import { NOMES } from "./conectores.js";
import type { Db } from "./db";
import type { ResultadoColeta } from "./coleta";

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

  const f = req.filtros || {};
  const filtros = {
    tipos: (f.tipos || []).slice().sort(),
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
    requisicao: { ...req, filtros: { ...filtros, tipos: f.tipos || [], bairros: f.bairros || [] } },
    chave_cache: hash(JSON.stringify({ cidade: req.cidade || "Ponta Grossa", fontes, filtros })),
    fontes_iniciais: (Array.isArray(req.fontes) ? req.fontes : []).map((id: string) => ({
      id, nome: (NOMES as Record<string, string>)[id] || id, status: "buscando", itens: 0,
    })),
  };
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Responde na hora: o resultado do cache (status concluido/parcial) ou "processando". No segundo caso
 * devolve também `coleta`, a promessa da coleta em segundo plano (o servidor não espera por ela).
 */
export async function iniciarBusca(
  db: Db,
  corpo: unknown,
  coletar: (req: RequisicaoBusca) => Promise<ResultadoColeta>,
): Promise<Resposta & { coleta?: Promise<void> }> {
  const v = validarRequisicao(corpo);
  if (v.erro) return { codigo: 400, corpo: { status: "erro", mensagem: v.erro } };
  const req = v.requisicao;

  // Mesmo requisicao_id de novo (ex.: o navegador repetiu o POST): devolve o estado atual, sem coletar duas vezes.
  const { rowCount } = await db.query("select 1 from buscas where requisicao_id = $1", [req.requisicao_id]);
  if (rowCount) return consultarBusca(db, req.requisicao_id);

  if (!req.atualizar_cache) {
    const { rows } = await db.query<{ resposta: RespostaBusca }>(
      `select resposta from buscas
        where chave_cache = $1 and status in ('concluido', 'parcial') and expira_em > now() and resposta is not null
        order by criado_em desc limit 1`,
      [v.chave_cache],
    );
    if (rows[0]) {
      const resposta = { ...rows[0].resposta, requisicao_id: req.requisicao_id };
      await db.query(
        `insert into buscas (requisicao_id, chave_cache, status, requisicao, resposta, fontes_status, concluido_em)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [req.requisicao_id, v.chave_cache, resposta.status, json(req), json(resposta), json(resposta.fontes ?? [])],
      );
      return { codigo: 200, corpo: resposta };
    }
  }

  await db.query(
    `insert into buscas (requisicao_id, chave_cache, status, requisicao, fontes_status) values ($1, $2, 'processando', $3, $4)`,
    [req.requisicao_id, v.chave_cache, json(req), json(v.fontes_iniciais)],
  );

  const coleta = (async () => {
    const r = await coletar(req);
    await db.query(
      `update buscas set status = $2, resposta = $3, fontes_status = $4, concluido_em = now(), expira_em = now() + interval '6 hours'
        where requisicao_id = $1`,
      [req.requisicao_id, r.status, json(r.resposta), json(r.fontes_status)],
    );
  })();
  return { codigo: 200, corpo: { requisicao_id: req.requisicao_id, status: "processando", fontes: v.fontes_iniciais }, coleta };
}

/** GET /buscas/:id: o resultado gravado ou o progresso da busca (6.4). */
export async function consultarBusca(db: Db, id: string): Promise<Resposta> {
  const naoEncontrada = { codigo: 404, corpo: { requisicao_id: id, status: "erro", mensagem: "Busca não encontrada ou expirada" } };
  if (!UUID.test(id)) return naoEncontrada;
  const { rows } = await db.query<{ status: string; resposta: RespostaBusca | null; fontes_status: FonteResumo[] | null }>(
    "select status, resposta, fontes_status from buscas where requisicao_id = $1",
    [id],
  );
  const linha = rows[0];
  if (!linha) return naoEncontrada;
  if (linha.status === "processando" || !linha.resposta)
    return { codigo: 200, corpo: { requisicao_id: id, status: "processando", fontes: linha.fontes_status || [] } };
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
    const fontes = (fontes_status ?? []).map((f) => ({ ...f, status: "erro" as const, mensagem }));
    const resposta: RespostaBusca = {
      requisicao_id, status: "erro", gerado_em: new Date().toISOString(), fontes, imoveis: [],
      erros: [{ fonte: "*", codigo: "INTERROMPIDA", mensagem }],
    };
    await db.query(
      "update buscas set status = 'erro', resposta = $2, fontes_status = $3, concluido_em = now() where requisicao_id = $1 and status = 'processando'",
      [requisicao_id, json(resposta), json(fontes)],
    );
  }
  return rows.length;
}

/** TTL de 6 h do cache: apaga as buscas vencidas. */
export async function limparBuscasExpiradas(db: Db): Promise<number> {
  const { rowCount } = await db.query("delete from buscas where expira_em < now() and status <> 'processando'");
  return rowCount ?? 0;
}
