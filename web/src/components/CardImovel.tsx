/* eslint-disable @next/next/no-img-element -- fotos vêm de domínios variados das imobiliárias */
"use client";

import { useState } from "react";
import type { AvaliacaoImovel, Imovel } from "@/lib/contrato";
import { data, enderecoCompleto, m2, moeda, numero, ROTULO_TIPO } from "@/lib/formatar";

export function BadgeFiltro({ imovel }: { imovel: Imovel }) {
  const reprovado = imovel.criterios.some((c) => c.resultado === "nao_atende");
  const cls = imovel.atende
    ? "bg-ok-soft text-ok"
    : reprovado
      ? "bg-bad-soft text-bad"
      : "bg-warn-soft text-warn";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <span aria-hidden>{imovel.atende ? "✔" : reprovado ? "✖" : "?"}</span>
      {imovel.resumo_filtro}
    </span>
  );
}

export function BadgeStatus({ imovel }: { imovel: Imovel }) {
  return (
    <>
      {imovel.status === "outlier" && (
        <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info" title="Preço/m² fora de 1,5 desvio padrão da mediana da busca">
          Outlier
        </span>
      )}
      {imovel.fontes_alternativas.length > 0 && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2 ring-1 ring-line" title={imovel.fontes_alternativas.map((f) => f.nome).join(", ")}>
          Repetido +{imovel.fontes_alternativas.length}
        </span>
      )}
    </>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{rotulo}</dt>
      <dd className="truncate text-sm font-medium tabular">{valor}</dd>
    </div>
  );
}

interface Props {
  imovel: Imovel;
  avaliacao?: AvaliacaoImovel;
  onAbrir: () => void;
  onIncluir: (incluir: boolean) => Promise<void>;
}

/** Caixinha "Planilha" no canto da foto: inclui/retira da exportação sem abrir o detalhe. */
function CaixaPlanilha({ incluido, onIncluir }: { incluido: boolean; onIncluir: (incluir: boolean) => Promise<void> }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <label
      title={erro ?? (incluido ? "Retirar da planilha" : "Incluir na planilha")}
      className={`absolute left-2 top-2 z-10 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold shadow-sm ${incluido ? "bg-accent text-accent-ink" : "bg-surface/90 text-ink backdrop-blur"} ${erro ? "ring-2 ring-bad" : ""} ${salvando ? "opacity-70" : ""}`}
    >
      <input
        type="checkbox" className="size-4 cursor-pointer accent-[var(--accent)]" checked={incluido} disabled={salvando}
        onChange={async (e) => {
          setSalvando(true);
          setErro(null);
          try {
            await onIncluir(e.target.checked);
          } catch (err) {
            setErro(`Erro ao salvar: ${(err as Error).message}`);
          } finally {
            setSalvando(false);
          }
        }}
      />
      {incluido ? "Na planilha" : "Planilha"}
    </label>
  );
}

export function CardImovel({ imovel: i, avaliacao, onAbrir, onIncluir }: Props) {
  const incluido = avaliacao?.incluido_avaliacao;
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-lg border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${incluido === true ? "border-accent ring-1 ring-accent" : "border-line"} ${incluido === false ? "opacity-60" : ""}`}
    >
      <div className="relative">
        <CaixaPlanilha incluido={incluido === true} onIncluir={onIncluir} />
        <button type="button" onClick={onAbrir} className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-2 text-left" aria-label={`Abrir detalhes: ${i.titulo}`}>
          {i.foto_capa ? (
            <img
              src={i.foto_capa} alt="" loading="lazy" decoding="async"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
              className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid size-full place-items-center text-sm text-ink-3">Sem fotos</div>
          )}
          <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {i.fotos.length} foto{i.fotos.length === 1 ? "" : "s"}
          </span>
          {incluido === false && (
            <span className="absolute right-2 top-2 rounded bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-bg">Excluído</span>
          )}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <BadgeFiltro imovel={i} />
          <BadgeStatus imovel={i} />
        </div>

        <button type="button" onClick={onAbrir} className="text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {ROTULO_TIPO[i.tipo]} · {i.endereco.bairro ?? "Bairro não informado"}
          </p>
          <p className="mt-0.5 line-clamp-1 text-sm text-ink-2">{enderecoCompleto(i)}</p>
        </button>

        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xl font-semibold tabular">{moeda(i.preco_total)}</p>
          <p className="text-sm text-ink-2 tabular">{i.preco_m2 !== null ? `${moeda(i.preco_m2)}/m²` : "— /m²"}</p>
        </div>

        <dl className="grid grid-cols-4 gap-2 border-y border-line py-2.5">
          <Dado rotulo={i.tipo === "terreno" ? "Terreno" : "Área"} valor={m2(i.tipo === "terreno" ? i.area_terreno_m2 : i.area_construida_m2)} />
          <Dado rotulo="Dorm." valor={numero(i.dormitorios)} />
          <Dado rotulo="Banh." valor={numero(i.banheiros)} />
          <Dado rotulo="Vagas" valor={numero(i.vagas_total)} />
        </dl>

        {(i.area_lazer || i.piscina) && (
          <div className="flex flex-wrap gap-1.5">
            {i.area_lazer && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">Lazer / churrasqueira</span>}
            {i.piscina && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">Piscina</span>}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="min-w-0 text-xs text-ink-3">
            <p className="truncate font-medium text-ink-2">{i.fonte.nome}</p>
            <p>Anúncio: {data(i.data_anuncio)}</p>
          </div>
          <a
            href={i.url_anuncio} target="_blank" rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Ver anúncio ↗
          </a>
        </div>
      </div>
    </article>
  );
}

export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="skeleton aspect-[4/3]" />
      <div className="space-y-3 p-4">
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-4 w-1/2 rounded" />
        <div className="skeleton h-6 w-1/3 rounded" />
        <div className="skeleton h-10 rounded" />
      </div>
    </div>
  );
}
