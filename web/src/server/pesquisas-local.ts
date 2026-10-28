// Pesquisas salvas sem backend (busca simulada): arquivo .data/pesquisas.json, só para desenvolvimento.
// Segue as mesmas regras de backend/src/pesquisas.ts.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { consultarBusca, requisicaoDaBusca } from "@/lib/mock";
import {
  DIAS_VALIDADE, juntarRespostas, normalizarNome, substituirResultados, validarSelecao,
  type AlteracaoPesquisa, type NovaPesquisa, type OrigemResultados, type PesquisaSalva, type ResumoPesquisa,
} from "@/lib/pesquisas";

const ARQUIVO = path.join(process.cwd(), ".data", "pesquisas.json");
const NAO_ENCONTRADA = "Pesquisa não encontrada ou expirada";
const NOME_INVALIDO = "Dê um nome à pesquisa (até 80 caracteres)";
const NOME_REPETIDO = "Já existe uma pesquisa salva com esse nome";

const erro = (status: number, mensagem: string) => Response.json({ mensagem }, { status });
const validade = () => new Date(Date.now() + DIAS_VALIDADE * 86_400_000).toISOString();

async function ler(): Promise<Record<string, PesquisaSalva>> {
  let todas: Record<string, PesquisaSalva> = {};
  try {
    todas = JSON.parse(await fs.readFile(ARQUIVO, "utf8"));
  } catch {
    return {};
  }
  const agora = new Date().toISOString();
  return Object.fromEntries(Object.entries(todas).filter(([, p]) => p.expira_em > agora));
}

async function gravar(todas: Record<string, PesquisaSalva>) {
  await fs.mkdir(path.dirname(ARQUIVO), { recursive: true });
  await fs.writeFile(ARQUIVO, JSON.stringify(todas, null, 2));
}

const nomeEmUso = (todas: Record<string, PesquisaSalva>, nome: string, exceto?: string) =>
  Object.values(todas).some((p) => p.id !== exceto && p.nome.toLowerCase() === nome.toLowerCase());

function resultados(origem: Partial<OrigemResultados> | undefined) {
  const req = origem?.requisicao_id ? requisicaoDaBusca(origem.requisicao_id) : null;
  let resposta = origem?.requisicao_id ? consultarBusca(origem.requisicao_id) : null;
  if (!req || !resposta || resposta.status === "processando") return null;
  for (const id of origem?.extras ?? []) {
    const extra = consultarBusca(id);
    if (extra && extra.status !== "processando") resposta = juntarRespostas(resposta, extra);
  }
  return { req, resposta };
}

export async function listar(): Promise<Response> {
  const lista: ResumoPesquisa[] = Object.values(await ler())
    .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))
    .map(({ id, nome, criado_em, atualizado_em, expira_em, resposta, selecao }) => ({
      id, nome, criado_em, atualizado_em, expira_em,
      total_imoveis: resposta.imoveis?.length ?? 0,
      selecionados: Object.values(selecao).filter(Boolean).length,
    }));
  return Response.json(lista);
}

export async function criar(corpo: Partial<NovaPesquisa> | null): Promise<Response> {
  const nome = normalizarNome(corpo?.nome);
  if (!nome) return erro(400, NOME_INVALIDO);
  const selecao = validarSelecao(corpo?.selecao);
  if (!selecao) return erro(400, "selecao deve ser { imovel_id: true | false }");
  const r = resultados(corpo ?? undefined);
  if (!r) return erro(409, "Os resultados desta busca não estão mais disponíveis. Faça a busca de novo e salve em seguida.");
  const todas = await ler();
  if (nomeEmUso(todas, nome)) return erro(409, NOME_REPETIDO);
  const agora = new Date().toISOString();
  const p: PesquisaSalva = {
    id: crypto.randomUUID(), nome, criado_em: agora, atualizado_em: agora, expira_em: validade(),
    filtros: r.req.filtros, fontes: r.req.fontes, resposta: r.resposta, selecao,
  };
  todas[p.id] = p;
  await gravar(todas);
  return Response.json(p, { status: 201 });
}

export async function abrir(id: string): Promise<Response> {
  const p = (await ler())[id];
  return p ? Response.json(p) : erro(404, NAO_ENCONTRADA);
}

export async function alterar(id: string, corpo: AlteracaoPesquisa | null): Promise<Response> {
  const todas = await ler();
  const p = todas[id];
  if (!p) return erro(404, NAO_ENCONTRADA);
  if (corpo?.nome !== undefined) {
    const nome = normalizarNome(corpo.nome);
    if (!nome) return erro(400, NOME_INVALIDO);
    if (nomeEmUso(todas, nome, id)) return erro(409, NOME_REPETIDO);
    p.nome = nome;
  }
  if (corpo?.resultados) {
    const { modo } = corpo.resultados;
    if (modo !== "substituir" && modo !== "juntar") return erro(400, "modo deve ser substituir ou juntar");
    const r = resultados(corpo.resultados);
    if (!r) return erro(409, "Os resultados desta busca não estão mais disponíveis.");
    if (modo === "juntar") p.resposta = juntarRespostas(p.resposta, r.resposta);
    else Object.assign(p, { resposta: substituirResultados(p.resposta, r.resposta, p.selecao), filtros: r.req.filtros, fontes: r.req.fontes });
  }
  Object.assign(p, { atualizado_em: new Date().toISOString(), expira_em: validade() });
  await gravar(todas);
  return Response.json(p);
}

export async function marcar(id: string, imovelId: unknown, incluido: unknown): Promise<Response> {
  if (typeof imovelId !== "string" || !imovelId) return erro(400, "imovel_id é obrigatório");
  if (incluido !== null && typeof incluido !== "boolean") return erro(400, "incluido deve ser true, false ou null");
  const todas = await ler();
  const p = todas[id];
  if (!p) return erro(404, NAO_ENCONTRADA);
  if (incluido === null) delete p.selecao[imovelId];
  else p.selecao[imovelId] = incluido;
  Object.assign(p, { atualizado_em: new Date().toISOString(), expira_em: validade() });
  await gravar(todas);
  return Response.json({ expira_em: p.expira_em });
}

export async function excluir(id: string): Promise<Response> {
  const todas = await ler();
  if (!todas[id]) return erro(404, NAO_ENCONTRADA);
  delete todas[id];
  await gravar(todas);
  return Response.json({ ok: true });
}
