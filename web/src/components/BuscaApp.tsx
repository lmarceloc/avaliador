"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FILTROS_VAZIOS,
  type AvaliacaoImovel,
  type FonteResumo,
  type Filtros,
  type Imovel,
  type RequisicaoBusca,
  type RespostaBusca,
  type TipoImovel,
} from "@/lib/contrato";
import { FONTES_ATIVAS, nomeFonte } from "@/lib/fontes";
import { exportarCsv, exportarXlsx, selecionarParaExportar } from "@/lib/exportar";
import { ROTULO_TIPO } from "@/lib/formatar";
import { juntarRespostas, type PesquisaSalva, type ResumoPesquisa, type Selecao } from "@/lib/pesquisas";
import { PainelFiltros } from "./PainelFiltros";
import { CardImovel, CardSkeleton } from "./CardImovel";
import { DetalheImovel } from "./DetalheImovel";
import { AvisoNaoSalva, BarraPesquisa, DialogoNome, DialogoNovaBusca, ListaPesquisas } from "./PesquisasSalvas";

const INTERVALO_POLLING = 3000;
const LIMITE_POLLING_MS = 5 * 60 * 1000;

type Estado = "ocioso" | "carregando" | "pronto" | "erro";
type Ordem = "padrao" | "preco" | "area" | "preco_m2" | "data";
type FiltroStatus = "todos" | "atende" | "nao_atende" | "repetido" | "outlier";
/** "selecionados": só os marcados para a planilha — exatamente o que vai para a exportação. */
type Aba = "todos" | "selecionados";

interface Rapidos {
  tipo: TipoImovel | "";
  bairro: string;
  fonte: string;
  status: FiltroStatus;
  precoMin: number | null;
  precoMax: number | null;
  mostrarFora: boolean;
}

const RAPIDOS_INICIAIS: Rapidos = { tipo: "", bairro: "", fonte: "", status: "todos", precoMin: null, precoMax: null, mostrarFora: false };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pesquisa salva aberta na tela: a seleção é dela e cada marcação é gravada na hora. */
interface PesquisaAberta {
  id: string;
  nome: string;
  expira_em: string;
}

type Dialogos =
  | { tipo: "salvar"; motivo: "botao" | "selecao" }
  | { tipo: "renomear" }
  | { tipo: "nova-busca"; atualizar: boolean }
  | { tipo: "lista" };

const enviarJson = (metodo: string, corpo: unknown): RequestInit => ({
  method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
});

async function json<T>(resp: Response): Promise<T> {
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((corpo as { mensagem?: string }).mensagem ?? `Erro ${resp.status}`);
  return corpo as T;
}

/** Envia a busca e acompanha o modo assíncrono (6.4) até um status final. */
async function executarBusca(req: RequisicaoBusca, onParcial: (r: RespostaBusca) => void, cancelado: () => boolean): Promise<RespostaBusca> {
  let r = await json<RespostaBusca>(
    await fetch("/api/buscar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }),
  );
  const inicio = Date.now();
  while (r.status === "processando") {
    if (cancelado()) throw new Error("cancelado");
    if (Date.now() - inicio > LIMITE_POLLING_MS) throw new Error("A busca demorou demais para responder.");
    onParcial(r);
    await espera(INTERVALO_POLLING);
    r = await json<RespostaBusca>(await fetch(`/api/resultados/${encodeURIComponent(req.requisicao_id)}`, { cache: "no-store" }));
  }
  return r;
}

function ProgressoFontes({ fontes }: { fontes: FonteResumo[] }) {
  const prontas = fontes.filter((f) => f.status === "ok" || f.status === "erro").length;
  const pct = fontes.length ? Math.max(6, Math.round((prontas / fontes.length) * 100)) : 6;
  const rotulo: Record<FonteResumo["status"], string> = { ok: "concluído", erro: "falhou", buscando: "buscando", aguardando: "na fila" };
  const cor: Record<FonteResumo["status"], string> = { ok: "text-ok", erro: "text-bad", buscando: "text-accent", aguardando: "text-ink-3" };
  return (
    <div className="rounded-lg border border-line bg-surface p-4" role="status" aria-live="polite">
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {fontes.map((f) => (
          <li key={f.id}>
            <span className="font-medium">{f.nome}:</span>{" "}
            <span className={cor[f.status]}>
              {f.status === "buscando" && <span className="mr-1 inline-block size-2 animate-pulse rounded-full bg-accent align-middle" />}
              {rotulo[f.status]}
              {f.status === "ok" && ` (${f.itens})`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function novaRequisicao(filtros: Filtros, fontes: string[], atualizar: boolean): RequisicaoBusca {
  return {
    requisicao_id: crypto.randomUUID(),
    cidade: "Ponta Grossa",
    uf: "PR",
    filtros,
    fontes,
    atualizar_cache: atualizar,
    solicitado_em: new Date().toISOString(),
  };
}

const fontesIniciais = (ids: string[]): FonteResumo[] =>
  ids.map((id) => ({ id, nome: nomeFonte(id), status: "buscando", itens: 0 }));

export function BuscaApp() {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [fontes, setFontes] = useState<string[]>(FONTES_ATIVAS.map((f) => f.id));
  const [estado, setEstado] = useState<Estado>("ocioso");
  const [resposta, setResposta] = useState<RespostaBusca | null>(null);
  const [progresso, setProgresso] = useState<FonteResumo[]>([]);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [repetindo, setRepetindo] = useState<string | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<Record<string, AvaliacaoImovel>>({});
  const [rapidos, setRapidos] = useState<Rapidos>(RAPIDOS_INICIAIS);
  const [aba, setAba] = useState<Aba>("todos");
  const [ordem, setOrdem] = useState<Ordem>("padrao");
  const [crescente, setCrescente] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [filtrosAbertosMobile, setFiltrosAbertosMobile] = useState(false);
  const buscaAtual = useRef<string | null>(null);
  const ultimaReq = useRef<RequisicaoBusca | null>(null);
  // Seleção da tela (incluir/excluir). Com pesquisa aberta, espelha a dela; sem, fica só na memória até salvar.
  const [selecao, setSelecao] = useState<Selecao>({});
  const [pesquisa, setPesquisa] = useState<PesquisaAberta | null>(null);
  const [pesquisas, setPesquisas] = useState<ResumoPesquisa[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogos | null>(null);
  // Já pedimos o nome nesta busca? (só pergunta uma vez ao marcar o primeiro imóvel)
  const [pediuNome, setPediuNome] = useState(false);
  // De onde vieram os resultados da tela, para salvar sem reenviar os imóveis: busca principal + repetições de fonte.
  const [origem, setOrigem] = useState<{ requisicao_id: string; extras: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/avaliacoes")
      .then((r) => json<AvaliacaoImovel[]>(r))
      .then((lista) => setAvaliacoes(Object.fromEntries(lista.map((a) => [a.imovel_id, a]))))
      .catch(() => {});
  }, []);

  const carregarPesquisas = useCallback(async () => {
    setCarregandoLista(true);
    setErroLista(null);
    try {
      setPesquisas(await json<ResumoPesquisa[]>(await fetch("/api/pesquisas", { cache: "no-store" })));
    } catch (e) {
      setErroLista((e as Error).message);
    } finally {
      setCarregandoLista(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/pesquisas", { cache: "no-store" })
      .then((r) => json<ResumoPesquisa[]>(r))
      .then(setPesquisas)
      .catch(() => {});
  }, []);

  const selecaoSolta = !pesquisa && Object.keys(selecao).length > 0;
  // Fechar a aba com seleção não salva perde o trabalho: o navegador pergunta antes.
  useEffect(() => {
    if (!selecaoSolta) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [selecaoSolta]);

  const podePerderSelecao = () =>
    !selecaoSolta || window.confirm("A seleção desta busca não foi salva e vai se perder. Continuar mesmo assim?");

  function aplicarPesquisa(p: PesquisaSalva) {
    setPesquisa({ id: p.id, nome: p.nome, expira_em: p.expira_em });
    setSelecao(p.selecao);
    setResposta(p.resposta);
    setProgresso(p.resposta.fontes ?? []);
    setOrigem(null);
  }

  function fecharPesquisa() {
    buscaAtual.current = null;
    setPesquisa(null);
    setSelecao({});
    setResposta(null);
    setEstado("ocioso");
    setErroGeral(null);
    setAba("todos");
    setOrigem(null);
  }

  async function abrirPesquisa(id: string) {
    if (!podePerderSelecao()) return;
    const p = await json<PesquisaSalva>(await fetch(`/api/pesquisas/${encodeURIComponent(id)}`, { cache: "no-store" }));
    buscaAtual.current = null;
    aplicarPesquisa(p);
    setFiltros(p.filtros);
    setFontes(p.fontes);
    ultimaReq.current = novaRequisicao(p.filtros, p.fontes, false);
    setEstado("pronto");
    setErroGeral(null);
    setRapidos(RAPIDOS_INICIAIS);
    setAba(Object.values(p.selecao).some(Boolean) ? "selecionados" : "todos");
    setDialogo(null);
  }

  async function salvarPesquisa(nome: string) {
    if (!origem) throw new Error("Faça uma busca antes de salvar.");
    const p = await json<PesquisaSalva>(
      await fetch("/api/pesquisas", enviarJson("POST", { nome, ...origem, selecao })),
    );
    aplicarPesquisa(p);
    setDialogo(null);
    void carregarPesquisas();
  }

  async function renomearPesquisa(nome: string) {
    if (!pesquisa) return;
    const p = await json<PesquisaSalva>(await fetch(`/api/pesquisas/${pesquisa.id}`, enviarJson("PATCH", { nome })));
    setPesquisa({ id: p.id, nome: p.nome, expira_em: p.expira_em });
    setDialogo(null);
    void carregarPesquisas();
  }

  async function excluirPesquisa(p: ResumoPesquisa) {
    await json(await fetch(`/api/pesquisas/${p.id}`, { method: "DELETE" }));
    if (pesquisa?.id === p.id) fecharPesquisa();
    await carregarPesquisas();
  }

  /** Botão Pesquisar: com pesquisa aberta, pergunta se os resultados são para ela ou para outra avaliação. */
  function pesquisar(atualizar: boolean) {
    if (pesquisa) return setDialogo({ tipo: "nova-busca", atualizar });
    if (!podePerderSelecao()) return;
    void rodarBusca(atualizar, null);
  }

  async function rodarBusca(atualizar: boolean, destino: PesquisaAberta | null) {
    const req = novaRequisicao(filtros, fontes, atualizar);
    buscaAtual.current = req.requisicao_id;
    ultimaReq.current = req;
    if (!destino) {
      // Busca solta nova: começa sem seleção (a anterior ou foi salva ou o usuário aceitou perder).
      setSelecao({});
      setPediuNome(false);
      setOrigem(null);
    }
    setEstado("carregando");
    setErroGeral(null);
    setResposta(null);
    setProgresso(fontesIniciais(fontes));
    setRapidos(RAPIDOS_INICIAIS);
    setAba("todos");
    setFiltrosAbertosMobile(false);
    try {
      const r = await executarBusca(
        req,
        (p) => p.fontes && setProgresso(p.fontes),
        () => buscaAtual.current !== req.requisicao_id,
      );
      if (buscaAtual.current !== req.requisicao_id) return;
      if (r.status === "erro") {
        setResposta(r);
        setProgresso(r.fontes ?? []);
        setEstado("erro");
        setErroGeral("Nenhuma fonte respondeu.");
        return;
      }
      if (destino) {
        // Nova busca dentro da pesquisa aberta: o backend troca os resultados e mantém os imóveis já decididos.
        const p = await json<PesquisaSalva>(
          await fetch(`/api/pesquisas/${destino.id}`, enviarJson("PATCH", { resultados: { requisicao_id: req.requisicao_id, modo: "substituir" } })),
        );
        aplicarPesquisa(p);
        void carregarPesquisas();
      } else {
        setResposta(r);
        setProgresso(r.fontes ?? []);
        setOrigem({ requisicao_id: req.requisicao_id, extras: [] });
      }
      setEstado("pronto");
    } catch (e) {
      if (buscaAtual.current !== req.requisicao_id) return;
      setEstado("erro");
      setErroGeral((e as Error).message);
    }
  }

  /** "Kikina não respondeu. [Tentar novamente]": refaz só aquela fonte e junta ao resultado. */
  async function repetirFonte(fonteId: string) {
    const base = ultimaReq.current;
    if (!base || !resposta) return;
    setRepetindo(fonteId);
    try {
      const req = novaRequisicao(base.filtros, [fonteId], true);
      const r = await executarBusca(req, () => {}, () => false);
      setResposta((atual) => (atual ? juntarRespostas(atual, r) : atual));
      if (pesquisa)
        await fetch(`/api/pesquisas/${pesquisa.id}`, enviarJson("PATCH", { resultados: { requisicao_id: req.requisicao_id, modo: "juntar" } }));
      else setOrigem((o) => o && { ...o, extras: [...o.extras, req.requisicao_id] });
    } catch {
      // mantém o aviso de erro da fonte
    } finally {
      setRepetindo(null);
    }
  }

  /** Incluir (true), excluir (false) ou desfazer (null). Com pesquisa aberta grava nela; sem, pede um nome. */
  async function marcar(id: string, valor: boolean | null) {
    const aplicar = (v: boolean | null | undefined) =>
      setSelecao((s) => {
        const n = { ...s };
        if (v === null || v === undefined) delete n[id];
        else n[id] = v;
        return n;
      });
    const anterior = selecao[id];
    aplicar(valor);
    if (!pesquisa) {
      if (valor === true && !pediuNome) {
        setPediuNome(true);
        setDialogo({ tipo: "salvar", motivo: "selecao" });
      }
      return;
    }
    try {
      const r = await json<{ expira_em: string }>(
        await fetch(`/api/pesquisas/${pesquisa.id}/selecao`, enviarJson("PUT", { imovel_id: id, incluido: valor })),
      );
      setPesquisa((p) => p && { ...p, expira_em: r.expira_em });
    } catch (e) {
      aplicar(anterior);
      throw e;
    }
  }

  // A análise (estado, padrão, observações) é do imóvel; "incluído/excluído" é da pesquisa.
  // As telas recebem as duas coisas juntas no formato de AvaliacaoImovel.
  const avaliacoesTela = useMemo(() => {
    const ids = new Set([...Object.keys(avaliacoes), ...Object.keys(selecao)]);
    return Object.fromEntries(
      [...ids].map((id) => [id, {
        ...(avaliacoes[id] ?? { imovel_id: id, estado_conservacao: null, padrao_acabamento: null, observacoes: null }),
        incluido_avaliacao: selecao[id] ?? null,
      }]),
    ) as Record<string, AvaliacaoImovel>;
  }, [avaliacoes, selecao]);

  async function salvarAvaliacao(a: AvaliacaoImovel) {
    const antes = avaliacoes[a.imovel_id];
    const analise = (x?: Partial<AvaliacaoImovel>) => JSON.stringify([x?.estado_conservacao ?? null, x?.padrao_acabamento ?? null, x?.observacoes ?? null]);
    if (analise(a) !== analise(antes)) {
      // incluido_avaliacao do banco não é mais usado pela tela: vai como estava.
      const salvo = await json<AvaliacaoImovel>(
        await fetch("/api/avaliacoes", enviarJson("PUT", { ...a, incluido_avaliacao: antes?.incluido_avaliacao ?? null })),
      );
      setAvaliacoes((atual) => ({ ...atual, [salvo.imovel_id]: salvo }));
    }
    if ((a.incluido_avaliacao ?? null) !== (selecao[a.imovel_id] ?? null)) await marcar(a.imovel_id, a.incluido_avaliacao ?? null);
  }

  // Desmarcar a caixinha do card volta para "não decidido" (null), não para "Excluído".
  const incluirNaPlanilha = (id: string, incluir: boolean) => marcar(id, incluir ? true : null);

  const imoveis = useMemo(() => resposta?.imoveis ?? [], [resposta]);
  const paraExportar = useMemo(() => selecionarParaExportar(imoveis, avaliacoesTela), [imoveis, avaliacoesTela]);

  const visiveis = useMemo(() => {
    const r = rapidos;
    // Na aba de selecionados os filtros rápidos não se aplicam: mostra tudo o que vai para a planilha.
    const lista = aba === "selecionados" ? paraExportar : imoveis.filter((i) => {
      const reprovado = i.criterios.some((c) => c.resultado === "nao_atende");
      if (!r.mostrarFora && reprovado && r.status !== "nao_atende") return false;
      if (r.tipo && i.tipo !== r.tipo) return false;
      if (r.bairro && i.endereco.bairro !== r.bairro) return false;
      if (r.fonte && i.fonte.id !== r.fonte && !i.fontes_alternativas.some((f) => f.id === r.fonte)) return false;
      if (r.status === "atende" && !i.atende) return false;
      if (r.status === "nao_atende" && i.atende) return false;
      if (r.status === "repetido" && i.fontes_alternativas.length === 0) return false;
      if (r.status === "outlier" && i.status !== "outlier") return false;
      if (r.precoMin !== null && (i.preco_total ?? -1) < r.precoMin) return false;
      if (r.precoMax !== null && (i.preco_total ?? Infinity) > r.precoMax) return false;
      return true;
    });

    const chave: Record<Exclude<Ordem, "padrao">, (i: Imovel) => number | null> = {
      preco: (i) => i.preco_total,
      area: (i) => i.area_construida_m2 ?? i.area_terreno_m2,
      preco_m2: (i) => i.preco_m2,
      data: (i) => (i.data_anuncio ? Date.parse(i.data_anuncio) : null),
    };
    // Nulos sempre no fim, independente da direção.
    const cmp = (a: number | null, b: number | null, asc: boolean) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1 : asc ? a - b : b - a;

    return [...lista].sort((a, b) => {
      if (ordem === "padrao") return Number(b.atende) - Number(a.atende) || cmp(a.preco_m2, b.preco_m2, true);
      return cmp(chave[ordem](a), chave[ordem](b), crescente);
    });
  }, [imoveis, paraExportar, aba, rapidos, ordem, crescente]);

  const ocultosForaDoFiltro = useMemo(
    () => (rapidos.mostrarFora ? 0 : imoveis.filter((i) => i.criterios.some((c) => c.resultado === "nao_atende")).length),
    [imoveis, rapidos.mostrarFora],
  );

  const bairrosResultado = useMemo(
    () => [...new Set(imoveis.map((i) => i.endereco.bairro).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [imoveis],
  );

  const indiceAberto = aberto ? visiveis.findIndex((i) => i.id === aberto) : -1;
  const imovelAberto = indiceAberto >= 0 ? visiveis[indiceAberto] : imoveis.find((i) => i.id === aberto);
  const fecharDetalhe = useCallback(() => setAberto(null), []);

  const incluidos = paraExportar.length;
  const idsVisiveis = new Set(visiveis.map((i) => i.id));
  // Incluídos que os filtros rápidos da tela estão escondendo (continuam indo para a planilha).
  const incluidosOcultos = aba === "selecionados" ? 0 : paraExportar.filter((i) => !idsVisiveis.has(i.id)).length;
  const falhas = (resposta?.fontes ?? []).filter((f) => f.status === "erro");
  const selCls = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="grid size-8 place-items-center rounded-md bg-accent text-sm font-bold text-accent-ink">BI</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">Busca de Imóveis</h1>
          </div>
          <button
            type="button" onClick={() => { setDialogo({ tipo: "lista" }); void carregarPesquisas(); }}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
          >
            Pesquisas salvas{pesquisas.length > 0 && <span className="ml-1 text-ink-3">({pesquisas.length})</span>}
          </button>
          <button
            type="button" onClick={() => setFiltrosAbertosMobile(true)}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium lg:hidden"
          >
            Filtros
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[320px_1fr]">
        <aside
          className={`${filtrosAbertosMobile ? "fixed inset-0 z-40 overflow-y-auto" : "hidden"} bg-surface lg:sticky lg:top-[73px] lg:block lg:max-h-[calc(100dvh-97px)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-line`}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Critérios de busca</h2>
            <button type="button" onClick={() => setFiltrosAbertosMobile(false)} className="text-lg text-ink-2 lg:hidden" aria-label="Fechar filtros">✕</button>
          </div>
          <div className="px-5 pt-5">
            <PainelFiltros
              filtros={filtros} onFiltros={setFiltros} fontes={fontes} onFontes={setFontes}
              buscando={estado === "carregando"} onPesquisar={pesquisar} temResultado={resposta !== null}
            />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          {pesquisa && (
            <BarraPesquisa
              nome={pesquisa.nome} expiraEm={pesquisa.expira_em} selecionados={Object.values(selecao).filter(Boolean).length}
              onRenomear={() => setDialogo({ tipo: "renomear" })} onFechar={fecharPesquisa}
            />
          )}
          {selecaoSolta && estado === "pronto" && <AvisoNaoSalva onSalvar={() => setDialogo({ tipo: "salvar", motivo: "botao" })} />}

          {estado === "ocioso" && (
            <div className="grid min-h-[50vh] place-items-center rounded-lg border border-dashed border-line bg-surface p-10 text-center">
              <div className="max-w-md">
                <p className="text-lg font-semibold">Defina os critérios e clique em Pesquisar</p>
                <p className="mt-2 text-sm text-ink-2">
                  A busca consulta as imobiliárias selecionadas, reúne os imóveis numa única grade e indica quais atendem a cada critério.
                </p>
              </div>
            </div>
          )}

          {estado === "carregando" && (
            <>
              <ProgressoFontes fontes={progresso} />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
                {Array.from({ length: 6 }, (_, k) => <CardSkeleton key={k} />)}
              </div>
            </>
          )}

          {estado === "erro" && (
            <div className="rounded-lg border border-bad/40 bg-bad-soft p-6">
              <p className="font-semibold text-bad">Não foi possível concluir a busca</p>
              <p className="mt-1 text-sm text-ink-2">{erroGeral}</p>
              {resposta?.erros?.map((e) => <p key={e.fonte} className="mt-1 text-sm text-ink-2">• {e.mensagem}</p>)}
              <button type="button" onClick={() => pesquisar(false)} className="mt-4 rounded-md bg-bad px-4 py-2 text-sm font-semibold text-white">
                Repetir a busca
              </button>
            </div>
          )}

          {estado === "pronto" && resposta && (
            <>
              {falhas.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
                  <span className="flex-1">
                    <strong>{f.nome}</strong> não respondeu
                    {f.mensagem ? ` (${f.mensagem.toLowerCase()})` : ""}. Os resultados abaixo vêm das demais fontes.
                  </span>
                  <button
                    type="button" disabled={repetindo !== null} onClick={() => repetirFonte(f.id)}
                    className="rounded-md border border-warn/50 bg-surface px-3 py-1 font-medium text-warn disabled:opacity-50"
                  >
                    {repetindo === f.id ? "Tentando…" : "Tentar novamente"}
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-ink-2">
                    <strong className="text-ink">{imoveis.length}</strong> imóveis ·{" "}
                    <span className="text-ok">{resposta.resumo?.atendem_todos ?? imoveis.filter((i) => i.atende).length} atendem todos</span>
                    {resposta.resumo && <> · {resposta.resumo.repetidos_removidos} repetidos agrupados</>}
                    {incluidos > 0 && <> · <span className="text-accent">{incluidos} {incluidos === 1 ? "incluído" : "incluídos"} na avaliação</span>
                      {incluidosOcultos > 0 && <span className="text-warn"> ({incluidosOcultos} {incluidosOcultos === 1 ? "oculto" : "ocultos"} pelos filtros da tela)</span>}</>}
                  </p>
                  <p className="text-xs text-ink-3">
                    {(resposta.fontes ?? []).filter((f) => f.status === "ok").map((f) => `${f.nome} (${f.itens})`).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {incluidos === 0 && <p className="text-xs text-ink-3">Marque “Incluir na avaliação” para exportar.</p>}
                  {!pesquisa && !selecaoSolta && origem && (
                    <button
                      type="button" onClick={() => setDialogo({ tipo: "salvar", motivo: "botao" })}
                      className="whitespace-nowrap rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
                    >
                      Salvar pesquisa
                    </button>
                  )}
                </div>
              </div>

              {imoveis.length > 0 && (
                <div role="tablist" aria-label="Resultados" className="flex gap-1 border-b border-line">
                  {([["todos", `Todos (${imoveis.length})`], ["selecionados", `Selecionados (${incluidos})`]] as const).map(([id, rotulo]) => (
                    <button
                      key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === id ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              )}

              {imoveis.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
                  {aba === "selecionados" ? (
                    <p className="text-sm text-ink-2">Só os imóveis marcados para a planilha. Desmarcar “Na planilha” tira o imóvel daqui.</p>
                  ) : (<>
                  <select aria-label="Tipo" className={selCls} value={rapidos.tipo} onChange={(e) => setRapidos({ ...rapidos, tipo: e.target.value as TipoImovel | "" })}>
                    <option value="">Todos os tipos</option>
                    {(Object.keys(ROTULO_TIPO) as TipoImovel[]).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                  </select>
                  <select aria-label="Bairro" className={selCls} value={rapidos.bairro} onChange={(e) => setRapidos({ ...rapidos, bairro: e.target.value })}>
                    <option value="">Todos os bairros</option>
                    {bairrosResultado.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <select aria-label="Fonte" className={selCls} value={rapidos.fonte} onChange={(e) => setRapidos({ ...rapidos, fonte: e.target.value })}>
                    <option value="">Todas as fontes</option>
                    {(resposta.fontes ?? []).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                  <select aria-label="Status" className={selCls} value={rapidos.status} onChange={(e) => setRapidos({ ...rapidos, status: e.target.value as FiltroStatus })}>
                    <option value="todos">Qualquer status</option>
                    <option value="atende">Atende todos</option>
                    <option value="nao_atende">Não atende</option>
                    <option value="repetido">Repetido</option>
                    <option value="outlier">Outlier</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <input type="number" placeholder="R$ mín." aria-label="Preço mínimo" className={`${selCls} w-28 tabular`} value={rapidos.precoMin ?? ""} onChange={(e) => setRapidos({ ...rapidos, precoMin: e.target.value ? Number(e.target.value) : null })} />
                    <span className="text-ink-3">–</span>
                    <input type="number" placeholder="R$ máx." aria-label="Preço máximo" className={`${selCls} w-28 tabular`} value={rapidos.precoMax ?? ""} onChange={(e) => setRapidos({ ...rapidos, precoMax: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                  <label className="ml-1 flex items-center gap-1.5 text-sm text-ink-2">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={rapidos.mostrarFora} onChange={(e) => setRapidos({ ...rapidos, mostrarFora: e.target.checked })} />
                    Mostrar fora do filtro{ocultosForaDoFiltro > 0 && ` (${ocultosForaDoFiltro})`}
                  </label>
                  </>)}
                  <div className="ml-auto flex items-center gap-1">
                    <select aria-label="Ordenar por" className={selCls} value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
                      <option value="padrao">Ordem: atende primeiro, preço/m²</option>
                      <option value="preco">Preço</option>
                      <option value="area">Área</option>
                      <option value="preco_m2">Preço/m²</option>
                      <option value="data">Data do anúncio</option>
                    </select>
                    {ordem !== "padrao" && (
                      <button type="button" onClick={() => setCrescente(!crescente)} className={selCls} aria-label={crescente ? "Crescente" : "Decrescente"} title={crescente ? "Crescente" : "Decrescente"}>
                        {crescente ? "↑" : "↓"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {visiveis.length === 0 && aba === "selecionados" ? (
                <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center">
                  <p className="font-semibold">Nenhum imóvel selecionado.</p>
                  <p className="mt-1 text-sm text-ink-2">Marque a caixinha “Planilha” nos cards da aba Todos.</p>
                </div>
              ) : visiveis.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center">
                  <p className="font-semibold">Nenhum imóvel atende aos critérios.</p>
                  <p className="mt-1 text-sm text-ink-2">
                    {imoveis.length > 0
                      ? "Ajuste os filtros rápidos ou marque “Mostrar fora do filtro”."
                      : "Tente ampliar a faixa de metragem ou o preço."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
                  {visiveis.map((i) => (
                    <CardImovel
                      key={i.id} imovel={i} avaliacao={avaliacoesTela[i.id]} onAbrir={() => setAberto(i.id)}
                      onIncluir={(incluir) => incluirNaPlanilha(i.id, incluir)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {incluidos > 0 && (
            <div role="region" aria-label="Exportar planilha" className="sticky bottom-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
              <p className="text-sm">
                <strong className="text-accent tabular">{incluidos}</strong> {incluidos === 1 ? "imóvel incluído" : "imóveis incluídos"} na avaliação
              </p>
              <div className="flex items-center gap-2">
                {estado === "pronto" && (
                  <button type="button" onClick={() => setAba(aba === "todos" ? "selecionados" : "todos")} className="hidden whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2 sm:block">
                    {aba === "todos" ? "Ver selecionados" : "Ver todos"}
                  </button>
                )}
                <button type="button" onClick={() => exportarCsv(paraExportar, avaliacoesTela, pesquisa?.nome)} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">Exportar CSV</button>
                <button type="button" onClick={() => exportarXlsx(paraExportar, avaliacoesTela, pesquisa?.nome)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-110">Exportar XLSX</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {imovelAberto && (
        <DetalheImovel
          key={imovelAberto.id}
          imovel={imovelAberto}
          avaliacao={avaliacoesTela[imovelAberto.id]}
          onFechar={fecharDetalhe}
          onSalvar={salvarAvaliacao}
          onAnterior={indiceAberto > 0 ? () => setAberto(visiveis[indiceAberto - 1].id) : undefined}
          onProximo={indiceAberto >= 0 && indiceAberto < visiveis.length - 1 ? () => setAberto(visiveis[indiceAberto + 1].id) : undefined}
        />
      )}

      {dialogo?.tipo === "lista" && (
        <ListaPesquisas
          pesquisas={pesquisas} carregando={carregandoLista} erro={erroLista} idAtual={pesquisa?.id ?? null}
          onAbrir={abrirPesquisa} onExcluir={excluirPesquisa} onFechar={() => setDialogo(null)}
        />
      )}
      {dialogo?.tipo === "salvar" && (
        <DialogoNome
          titulo="Salvar pesquisa"
          descricao={dialogo.motivo === "selecao"
            ? "Para guardar a seleção e não misturar com outra avaliação, dê um nome a esta pesquisa. Ela fica disponível por 30 dias."
            : "Os imóveis, os filtros e a seleção ficam guardados por 30 dias."}
          rotuloConfirmar="Salvar" rotuloCancelar={dialogo.motivo === "selecao" ? "Agora não" : "Cancelar"}
          onConfirmar={salvarPesquisa} onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo?.tipo === "renomear" && pesquisa && (
        <DialogoNome
          titulo="Renomear pesquisa" inicial={pesquisa.nome} rotuloConfirmar="Renomear"
          onConfirmar={renomearPesquisa} onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo?.tipo === "nova-busca" && pesquisa && (
        <DialogoNovaBusca
          nome={pesquisa.nome}
          onAtualizar={() => { setDialogo(null); void rodarBusca(dialogo.atualizar, pesquisa); }}
          onNova={() => { const atualizar = dialogo.atualizar; setDialogo(null); fecharPesquisa(); void rodarBusca(atualizar, null); }}
          onCancelar={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
