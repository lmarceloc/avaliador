"use client";

import { useEffect, useRef, useState } from "react";
import { DIAS_VALIDADE, NOME_MAX, diasRestantes, type ResumoPesquisa } from "@/lib/pesquisas";

const btnPrimario = "rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50";
const btnSecundario = "rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50";

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const textoValidade = (expiraEm: string) => {
  const d = diasRestantes(expiraEm);
  return d <= 1 ? "expira hoje" : `expira em ${d} dias`;
};

/** Janela modal simples: Esc e clique fora fecham. */
function Dialogo({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

/** Pede o nome para salvar ou renomear uma pesquisa. */
export function DialogoNome({
  titulo, descricao, inicial = "", rotuloConfirmar, rotuloCancelar = "Cancelar", onConfirmar, onCancelar,
}: {
  titulo: string;
  descricao?: string;
  inicial?: string;
  rotuloConfirmar: string;
  rotuloCancelar?: string;
  onConfirmar: (nome: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.select(), []);

  return (
    <Dialogo titulo={titulo} onFechar={onCancelar}>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSalvando(true);
          setErro(null);
          try {
            await onConfirmar(nome);
          } catch (err) {
            setErro((err as Error).message);
            setSalvando(false);
          }
        }}
      >
        {descricao && <p className="text-sm text-ink-2">{descricao}</p>}
        <label className="text-sm">
          <span className="mb-1 block text-ink-2">Nome da pesquisa</span>
          <input
            ref={campo} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={NOME_MAX} required
            placeholder="Ex.: Casa Adriana" className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5"
          />
        </label>
        {erro && <p role="alert" className="rounded-md bg-bad-soft px-2.5 py-1.5 text-sm text-bad">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className={btnSecundario}>{rotuloCancelar}</button>
          <button type="submit" disabled={salvando || !nome.trim()} className={btnPrimario}>{salvando ? "Salvando…" : rotuloConfirmar}</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Nova busca com uma pesquisa aberta: atualizar a mesma pesquisa ou começar outra (evita misturar avaliações). */
export function DialogoNovaBusca({ nome, onAtualizar, onNova, onCancelar }: { nome: string; onAtualizar: () => void; onNova: () => void; onCancelar: () => void }) {
  return (
    <Dialogo titulo="Nova busca" onFechar={onCancelar}>
      <p className="mt-3 text-sm text-ink-2">
        A pesquisa <strong className="text-ink">{nome}</strong> está aberta. Os novos resultados são para ela ou para outra avaliação?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" onClick={onAtualizar} className={`${btnPrimario} py-2`}>Atualizar “{nome}” com os novos resultados</button>
        <button type="button" onClick={onNova} className={`${btnSecundario} py-2`}>Começar uma pesquisa nova (fecha “{nome}”)</button>
        <button type="button" onClick={onCancelar} className="py-1 text-sm text-ink-2 hover:text-ink">Cancelar</button>
      </div>
      <p className="mt-3 text-xs text-ink-3">Ao atualizar, os imóveis já incluídos ou excluídos continuam na pesquisa mesmo que não apareçam na nova busca.</p>
    </Dialogo>
  );
}

/** Lista das pesquisas salvas, aberta pelo botão do topo. */
export function ListaPesquisas({
  pesquisas, carregando, erro, idAtual, onAbrir, onExcluir, onFechar,
}: {
  pesquisas: ResumoPesquisa[];
  carregando: boolean;
  erro: string | null;
  idAtual: string | null;
  onAbrir: (id: string) => Promise<void>;
  onExcluir: (p: ResumoPesquisa) => Promise<void>;
  onFechar: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const agir = async (id: string, acao: () => Promise<void>) => {
    setOcupado(id);
    setFalha(null);
    try {
      await acao();
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Dialogo titulo="Pesquisas salvas" onFechar={onFechar}>
      <p className="mt-1 text-xs text-ink-3">Cada pesquisa guarda os imóveis, os filtros e a seleção de uma avaliação. Some depois de {DIAS_VALIDADE} dias sem alteração.</p>
      {(erro || falha) && <p role="alert" className="mt-3 rounded-md bg-bad-soft px-2.5 py-1.5 text-sm text-bad">{falha ?? erro}</p>}
      {carregando ? (
        <p className="mt-4 text-sm text-ink-2">Carregando…</p>
      ) : pesquisas.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">Nenhuma pesquisa salva. Depois de uma busca, use “Salvar pesquisa”.</p>
      ) : (
        <ul className="mt-3 max-h-[60dvh] divide-y divide-line overflow-y-auto">
          {pesquisas.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {p.nome}
                  {p.id === idAtual && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">aberta</span>}
                </p>
                <p className="text-xs text-ink-3">
                  {p.selecionados} de {p.total_imoveis} selecionados · alterada em {dataCurta(p.atualizado_em)} · {textoValidade(p.expira_em)}
                </p>
              </div>
              <button type="button" disabled={ocupado !== null} onClick={() => agir(p.id, () => onAbrir(p.id))} className={btnSecundario}>
                {ocupado === p.id ? "Abrindo…" : "Abrir"}
              </button>
              <button
                type="button" disabled={ocupado !== null} aria-label={`Excluir ${p.nome}`} title="Excluir"
                onClick={() => window.confirm(`Excluir a pesquisa “${p.nome}”? Isso não pode ser desfeito.`) && agir(p.id, () => onExcluir(p))}
                className="rounded-md px-2 py-1.5 text-sm text-ink-3 hover:bg-bad-soft hover:text-bad disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialogo>
  );
}

/** Faixa no topo dos resultados mostrando qual pesquisa salva está aberta. */
export function BarraPesquisa({
  nome, expiraEm, selecionados, onRenomear, onFechar,
}: {
  nome: string;
  expiraEm: string;
  selecionados: number;
  onRenomear: () => void;
  onFechar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5">
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-ink-2">Pesquisa salva:</span> <strong className="text-ink">{nome}</strong>
        <span className="text-ink-2"> · {selecionados} {selecionados === 1 ? "selecionado" : "selecionados"} · {textoValidade(expiraEm)} · salva automaticamente</span>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onRenomear} className={btnSecundario}>Renomear</button>
        <button type="button" onClick={onFechar} className={btnSecundario}>Fechar pesquisa</button>
      </div>
    </div>
  );
}

/** Aviso de seleção ainda não salva numa busca solta. */
export function AvisoNaoSalva({ onSalvar }: { onSalvar: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm">
      <span className="flex-1">A seleção desta busca ainda não foi salva. Dê um nome para guardar e não misturar com outra avaliação.</span>
      <button type="button" onClick={onSalvar} className={btnPrimario}>Salvar pesquisa</button>
    </div>
  );
}
