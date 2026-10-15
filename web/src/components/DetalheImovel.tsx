/* eslint-disable @next/next/no-img-element -- fotos vêm de domínios variados das imobiliárias */
"use client";

import { useEffect, useRef, useState } from "react";
import type { AvaliacaoImovel, Imovel } from "@/lib/contrato";
import { data, descreverCriterio, enderecoCompleto, m2, moeda, numero, ROTULO_CAMPO, ROTULO_TIPO } from "@/lib/formatar";
import { ESTADOS_CONSERVACAO, PADROES_ACABAMENTO, rotuloPadrao } from "@/config/avaliacao";
import { SugestaoAvaliacao } from "./SugestaoAvaliacao";
import { BadgeFiltro, BadgeStatus } from "./CardImovel";

function Galeria({ fotos, parcial }: { fotos: string[]; parcial: boolean }) {
  const [atual, setAtual] = useState(0);
  const miniaturas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") setAtual((a) => (a + 1) % fotos.length);
      if (e.key === "ArrowLeft") setAtual((a) => (a - 1 + fotos.length) % fotos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fotos.length]);

  useEffect(() => {
    miniaturas.current?.children[atual]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [atual]);

  if (fotos.length === 0) {
    return (
      <div className="grid h-48 place-items-center rounded-lg bg-surface-2 p-6 text-center text-sm text-ink-3">
        {parcial ? "A galeria deste imóvel não foi coletada. Veja as fotos no anúncio original." : "A imobiliária não publicou fotos deste imóvel. Confira no anúncio original."}
      </div>
    );
  }

  const seta = "absolute top-1/2 -translate-y-1/2 grid size-10 place-items-center rounded-full bg-black/55 text-xl text-white hover:bg-black/75";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Altura presa à tela (e não à largura) para a foto inteira caber sem rolar o modal. */}
      <div className="relative h-[40dvh] overflow-hidden rounded-lg bg-black sm:h-[52dvh] sm:max-h-[560px]">
        <img key={fotos[atual]} src={fotos[atual]} alt={`Foto ${atual + 1} de ${fotos.length}`} className="size-full object-contain" />
        {fotos.length > 1 && (
          <>
            <button type="button" className={`${seta} left-3`} onClick={() => setAtual((atual - 1 + fotos.length) % fotos.length)} aria-label="Foto anterior">‹</button>
            <button type="button" className={`${seta} right-3`} onClick={() => setAtual((atual + 1) % fotos.length)} aria-label="Próxima foto">›</button>
          </>
        )}
        <span className="absolute bottom-3 left-3 rounded bg-black/65 px-2 py-0.5 text-xs font-medium text-white tabular">
          {atual + 1} / {fotos.length}
        </span>
      </div>
      {parcial && (
        <p className="text-xs text-warn">Só a foto de capa foi coletada (limite de páginas por fonte). A galeria completa está no anúncio original.</p>
      )}
      <div ref={miniaturas} className="flex gap-1.5 overflow-x-auto pb-1">
        {fotos.map((f, k) => (
          <button
            key={f} type="button" onClick={() => setAtual(k)} aria-label={`Ver foto ${k + 1}`}
            className={`h-14 w-20 shrink-0 overflow-hidden rounded ring-2 transition ${k === atual ? "ring-accent" : "ring-transparent opacity-70 hover:opacity-100"}`}
          >
            <img src={f} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0">
      <dt className="text-ink-2">{rotulo}</dt>
      <dd className="text-right font-medium tabular">{valor}</dd>
    </div>
  );
}

const simNao = (v: boolean | null) => (v === null ? "—" : v ? "Sim" : "Não");

interface Props {
  imovel: Imovel;
  avaliacao?: AvaliacaoImovel;
  onFechar: () => void;
  onSalvar: (a: AvaliacaoImovel) => Promise<void>;
  onAnterior?: () => void;
  onProximo?: () => void;
}

export function DetalheImovel({ imovel: i, avaliacao, onFechar, onSalvar, onAnterior, onProximo }: Props) {
  const [form, setForm] = useState<AvaliacaoImovel>(
    avaliacao ?? { imovel_id: i.id, estado_conservacao: null, padrao_acabamento: null, observacoes: null, incluido_avaliacao: null },
  );
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    painel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onFechar]);

  async function salvar(parcial: Partial<AvaliacaoImovel>): Promise<boolean> {
    const novo = { ...form, ...parcial };
    setForm(novo);
    setSalvando(true);
    setMensagem(null);
    try {
      await onSalvar(novo);
      setMensagem("Salvo");
      return true;
    } catch (e) {
      setMensagem(`Erro ao salvar: ${(e as Error).message}`);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  const verificados = i.criterios;
  const iconeCriterio = { atende: ["✔", "text-ok"], nao_atende: ["✖", "text-bad"], nao_verificado: ["?", "text-warn"] } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div
        ref={painel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titulo-detalhe"
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden bg-bg shadow-2xl outline-none sm:rounded-xl"
      >
        <header className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="titulo-detalhe" className="truncate text-base font-semibold">{i.titulo}</h2>
            <p className="truncate text-xs text-ink-3">{i.fonte.nome} · coletado em {new Date(i.coletado_em).toLocaleString("pt-BR")}</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" disabled={!onAnterior} onClick={onAnterior} className="rounded-md px-2 py-1 text-ink-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Imóvel anterior">←</button>
            <button type="button" disabled={!onProximo} onClick={onProximo} className="rounded-md px-2 py-1 text-ink-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Próximo imóvel">→</button>
            <button type="button" onClick={onFechar} className="ml-2 rounded-md px-2 py-1 text-lg text-ink-2 hover:bg-surface-2" aria-label="Fechar">✕</button>
          </div>
        </header>

        <div className="grid flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Galeria fotos={i.fotos} parcial={i.detalhe_coletado === false} />

            <section>
              <div className="flex flex-wrap items-center gap-1.5">
                <BadgeFiltro imovel={i} />
                <BadgeStatus imovel={i} />
              </div>
              <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Critérios de filtro</h3>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {verificados.map((c) => {
                  const [icone, cor] = iconeCriterio[c.resultado];
                  return (
                    <li key={c.campo} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <span className={`w-4 font-bold ${cor}`} aria-label={c.resultado.replace("_", " ")}>{icone}</span>
                      <span className="w-36 shrink-0 text-ink-2">{ROTULO_CAMPO[c.campo] ?? c.campo}</span>
                      <span className="tabular">{descreverCriterio(c.campo, c.exigido, c.encontrado)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {i.campos_faltantes.length > 0 && (
              <section className="rounded-lg border border-warn/40 bg-warn-soft p-4">
                <h3 className="text-sm font-semibold text-warn">Conferir no anúncio</h3>
                <p className="mt-0.5 text-xs text-ink-2">A imobiliária não publicou estes dados:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {i.campos_faltantes.map((c) => (
                    <span key={c} className="rounded bg-surface px-2 py-0.5 text-xs font-medium">{ROTULO_CAMPO[c] ?? c}</span>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-lg border border-line bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{ROTULO_TIPO[i.tipo]} · {i.endereco.bairro ?? "Bairro não informado"}</p>
              <p className="mt-1 text-2xl font-semibold tabular">{moeda(i.preco_total)}</p>
              <p className="text-sm text-ink-2 tabular">{i.preco_m2 !== null ? `${moeda(i.preco_m2)}/m²` : "Preço/m² indisponível (sem área construída)"}</p>
              <a
                href={i.url_anuncio} target="_blank" rel="noopener noreferrer"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110"
              >
                Abrir anúncio original ↗
              </a>
              {i.fontes_alternativas.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="text-xs text-ink-3">Também anunciado em:</p>
                  <ul className="mt-1 space-y-0.5">
                    {i.fontes_alternativas.map((f) => (
                      <li key={f.url_anuncio}>
                        <a href={f.url_anuncio} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{f.nome} ↗</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Dados do anúncio</h3>
              <dl>
                <Linha rotulo="Endereço" valor={enderecoCompleto(i)} />
                <Linha rotulo="Bairro" valor={i.endereco.bairro ?? "—"} />
                <Linha rotulo="Área construída" valor={m2(i.area_construida_m2)} />
                <Linha rotulo="Área do terreno" valor={m2(i.area_terreno_m2)} />
                <Linha rotulo="Preço total" valor={moeda(i.preco_total)} />
                <Linha rotulo="Preço/m²" valor={moeda(i.preco_m2)} />
                <Linha rotulo="Pavimentos" valor={numero(i.pavimentos)} />
                <Linha rotulo="Condomínio" valor={simNao(i.condominio)} />
                <Linha rotulo="Dormitórios" valor={numero(i.dormitorios)} />
                <Linha rotulo="Suítes" valor={numero(i.suites)} />
                <Linha rotulo="Banheiros" valor={numero(i.banheiros)} />
                <Linha rotulo="Vagas cobertas" valor={numero(i.vagas_cobertas)} />
                <Linha rotulo="Vagas descobertas" valor={numero(i.vagas_descobertas)} />
                <Linha rotulo="Vagas (total)" valor={numero(i.vagas_total)} />
                <Linha rotulo="Padrão (anúncio)" valor={i.padrao_acabamento_anuncio ?? "—"} />
                <Linha rotulo="Data do anúncio" valor={data(i.data_anuncio)} />
                <Linha rotulo="Informante" valor={i.fonte.informante ?? "—"} />
                <Linha rotulo="Contato" valor={i.fonte.contato ?? "—"} />
              </dl>
            </section>

            <SugestaoAvaliacao
              imovelId={i.id} fotos={i.fotos} tipo={i.tipo}
              onAceitar={(campos) => salvar(campos)}
            />

            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Análise da avaliadora</h3>
                {mensagem && <span className={`text-xs ${mensagem.startsWith("Erro") ? "text-bad" : "text-ok"}`}>{mensagem}</span>}
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-ink-2">Estado de conservação (IBAPE)</span>
                  <select
                    className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5"
                    value={form.estado_conservacao ?? ""}
                    onChange={(e) => setForm({ ...form, estado_conservacao: e.target.value || null })}
                  >
                    <option value="">Não avaliado</option>
                    {ESTADOS_CONSERVACAO.map((e) => <option key={e.classe} value={e.classe}>{e.classe} – {e.nome}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-ink-2">Padrão de acabamento (VEIU)</span>
                  <select
                    className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5"
                    value={form.padrao_acabamento ?? ""}
                    onChange={(e) => setForm({ ...form, padrao_acabamento: e.target.value || null })}
                  >
                    <option value="">{i.padrao_acabamento_anuncio ? `Não avaliado (anúncio: ${i.padrao_acabamento_anuncio})` : "Não avaliado"}</option>
                    {form.padrao_acabamento && !PADROES_ACABAMENTO.some((p) => rotuloPadrao(p) === form.padrao_acabamento) && (
                      <option value={form.padrao_acabamento}>{form.padrao_acabamento}</option>
                    )}
                    {PADROES_ACABAMENTO.map((p) => <option key={p.codigo} value={rotuloPadrao(p)}>{rotuloPadrao(p)}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-ink-2">Observações</span>
                  <textarea
                    rows={3} className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5"
                    value={form.observacoes ?? ""}
                    onChange={(e) => setForm({ ...form, observacoes: e.target.value || null })}
                  />
                </label>
                <button
                  type="button" disabled={salvando} onClick={() => salvar({})}
                  className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
                >
                  {salvando ? "Salvando…" : "Salvar análise"}
                </button>
                <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                  <button
                    type="button" disabled={salvando} aria-pressed={form.incluido_avaliacao === true}
                    onClick={() => salvar({ incluido_avaliacao: form.incluido_avaliacao === true ? null : true })}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${form.incluido_avaliacao === true ? "bg-accent text-accent-ink" : "border border-accent text-accent hover:bg-accent-soft"}`}
                  >
                    {form.incluido_avaliacao === true ? "✔ Incluído" : "Incluir na avaliação"}
                  </button>
                  <button
                    type="button" disabled={salvando} aria-pressed={form.incluido_avaliacao === false}
                    onClick={() => salvar({ incluido_avaliacao: form.incluido_avaliacao === false ? null : false })}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${form.incluido_avaliacao === false ? "bg-ink text-bg" : "border border-line text-ink-2 hover:bg-surface-2"}`}
                  >
                    {form.incluido_avaliacao === false ? "✖ Excluído" : "Excluir da avaliação"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
