// Pesquisas salvas: tipos do contrato e as regras para juntar resultados. Funções puras, usadas pelo
// front, pelo backend da VPS (que embute este arquivo) e pelo modo local de desenvolvimento.
import type { Filtros, RespostaBusca, StatusBusca } from "./contrato";

/** Uma pesquisa salva some depois de 30 dias sem alteração (nome, resultados ou seleção). */
export const DIAS_VALIDADE = 30;
export const NOME_MAX = 80;

/** imovel_id → true (incluído na avaliação) ou false (excluído). Sem chave = não decidido. */
export type Selecao = Record<string, boolean>;

export interface ResumoPesquisa {
  id: string;
  nome: string;
  criado_em: string;
  atualizado_em: string;
  expira_em: string;
  total_imoveis: number;
  selecionados: number;
}

export interface PesquisaSalva {
  id: string;
  nome: string;
  criado_em: string;
  atualizado_em: string;
  expira_em: string;
  filtros: Filtros;
  fontes: string[];
  resposta: RespostaBusca;
  selecao: Selecao;
}

/** Resultados de uma busca já feita: a principal e as repetições de fonte ("Tentar novamente"). */
export interface OrigemResultados {
  requisicao_id: string;
  extras?: string[];
}

export interface NovaPesquisa extends OrigemResultados {
  nome: string;
  selecao?: Selecao;
}

export interface AlteracaoPesquisa {
  nome?: string;
  /** "substituir": nova busca na mesma pesquisa; "juntar": repetição de uma fonte. */
  resultados?: OrigemResultados & { modo: "substituir" | "juntar" };
}

/** Tira espaços sobrando. Devolve null se ficar vazio ou passar do limite. */
export function normalizarNome(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const n = nome.replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= NOME_MAX ? n : null;
}

/** Aceita só { [imovel_id]: boolean }. Devolve null se o formato estiver errado. */
export function validarSelecao(v: unknown): Selecao | null {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return Object.values(v).every((x) => typeof x === "boolean") ? (v as Selecao) : null;
}

const statusDe = (fontes: RespostaBusca["fontes"] = []): StatusBusca => {
  const ok = fontes.filter((f) => f.status === "ok").length;
  return ok === 0 ? "erro" : ok < fontes.length ? "parcial" : "concluido";
};

/**
 * Junta a repetição de uma ou mais fontes ao resultado: o resumo dessas fontes é trocado, os imóveis novos
 * entram no fim e os erros antigos delas saem.
 */
export function juntarRespostas(base: RespostaBusca, extra: RespostaBusca): RespostaBusca {
  const refeitas = new Map((extra.fontes ?? []).map((f) => [f.id, f]));
  const fontes = [...(base.fontes ?? []).map((f) => refeitas.get(f.id) ?? f)];
  for (const f of refeitas.values()) if (!fontes.some((x) => x.id === f.id)) fontes.push(f);
  const ids = new Set((base.imoveis ?? []).map((i) => i.id));
  return {
    ...base,
    status: statusDe(fontes),
    fontes,
    imoveis: [...(base.imoveis ?? []), ...(extra.imoveis ?? []).filter((i) => !ids.has(i.id))],
    erros: [...(base.erros ?? []).filter((e) => !refeitas.has(e.fonte)), ...(extra.erros ?? [])],
  };
}

/**
 * Nova busca dentro de uma pesquisa salva: vale o resultado novo, mas os imóveis em que a avaliadora já decidiu
 * (incluiu ou excluiu) e que não vieram desta vez continuam na pesquisa, para a seleção não se perder.
 */
export function substituirResultados(antiga: RespostaBusca, nova: RespostaBusca, selecao: Selecao): RespostaBusca {
  const ids = new Set((nova.imoveis ?? []).map((i) => i.id));
  const mantidos = (antiga.imoveis ?? []).filter((i) => i.id in selecao && !ids.has(i.id));
  return { ...nova, imoveis: [...(nova.imoveis ?? []), ...mantidos] };
}

export function diasRestantes(expiraEm: string, agora = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiraEm) - agora) / 86_400_000));
}
