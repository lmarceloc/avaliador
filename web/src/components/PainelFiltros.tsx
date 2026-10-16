"use client";

import { useMemo, useState } from "react";
import type { Condominio, Faixa, Filtros, TipoImovel } from "@/lib/contrato";
import { BAIRROS_PONTA_GROSSA, semAcento } from "@/lib/bairros";
import { FONTES } from "@/lib/fontes";

interface Props {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  fontes: string[];
  onFontes: (f: string[]) => void;
  buscando: boolean;
  onPesquisar: (forcarAtualizacao: boolean) => void;
  temResultado: boolean;
}

const TIPOS: { id: TipoImovel; rotulo: string }[] = [
  { id: "casa", rotulo: "Casa" },
  { id: "apartamento", rotulo: "Apartamento" },
  { id: "terreno", rotulo: "Terreno" },
];

const rotuloCls = "block text-xs font-medium uppercase tracking-wide text-ink-3 mb-1.5";
const inputCls =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-ink-3";

function lerNumero(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const formatarMoeda = (n: number | null) =>
  n === null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Máscara de reais enquanto digita: "1800000" → "1.800.000"; a vírgula abre os centavos (máx. 2 casas). */
function mascararMoeda(texto: string): { texto: string; valor: number | null } {
  const [inteiroBruto, ...resto] = texto.replace(/[^\d,]/g, "").split(",");
  const inteiro = inteiroBruto.replace(/^0+(?=\d)/, "");
  const centavos = resto.join("").slice(0, 2);
  const formatado = inteiro.replace(/\B(?=(\d{3})+$)/g, ".") + (resto.length > 0 ? "," + centavos : "");
  if (inteiro === "" && centavos === "") return { texto: formatado, valor: null };
  return { texto: formatado, valor: Number(`${inteiro || "0"}.${centavos.padEnd(2, "0")}`) };
}

function InputMoeda({ valor, onChange, placeholder, rotulo }: { valor: number | null; onChange: (v: number | null) => void; placeholder: string; rotulo: string }) {
  const [digitando, setDigitando] = useState<string | null>(null);
  return (
    <input
      type="text" inputMode="decimal" placeholder={placeholder} aria-label={rotulo} className={inputCls}
      value={digitando ?? formatarMoeda(valor)}
      onChange={(e) => {
        const m = mascararMoeda(e.target.value);
        setDigitando(m.texto);
        onChange(m.valor);
      }}
      onBlur={() => setDigitando(null)} // volta ao formato completo: 1.800.000,00
    />
  );
}

function CampoFaixa({ rotulo, faixa, onChange, unidade, moeda }: { rotulo: string; faixa: Faixa; onChange: (f: Faixa) => void; unidade?: string; moeda?: boolean }) {
  return (
    <div>
      <span className={rotuloCls}>
        {rotulo}
        {unidade && <span className="normal-case tracking-normal"> ({unidade})</span>}
      </span>
      <div className="flex items-center gap-2">
        {moeda ? (
          <InputMoeda rotulo={`${rotulo} mínimo`} placeholder="0,00" valor={faixa.min} onChange={(v) => onChange({ ...faixa, min: v })} />
        ) : (
          <input
            type="number" inputMode="numeric" min={0} placeholder="mín." aria-label={`${rotulo} mínimo`}
            className={inputCls} value={faixa.min ?? ""}
            onChange={(e) => onChange({ ...faixa, min: lerNumero(e.target.value) })}
          />
        )}
        <span className="text-ink-3">–</span>
        {moeda ? (
          <InputMoeda rotulo={`${rotulo} máximo`} placeholder="0,00" valor={faixa.max} onChange={(v) => onChange({ ...faixa, max: v })} />
        ) : (
          <input
            type="number" inputMode="numeric" min={0} placeholder="máx." aria-label={`${rotulo} máximo`}
            className={inputCls} value={faixa.max ?? ""}
            onChange={(e) => onChange({ ...faixa, max: lerNumero(e.target.value) })}
          />
        )}
      </div>
    </div>
  );
}

function CampoMinimo({ rotulo, valor, onChange }: { rotulo: string; valor: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="block">
      <span className={rotuloCls}>{rotulo}</span>
      <input
        type="number" inputMode="numeric" min={0} placeholder="mín." className={inputCls}
        value={valor ?? ""} onChange={(e) => onChange(lerNumero(e.target.value))}
      />
    </label>
  );
}

function SeletorBairros({ selecionados, onChange }: { selecionados: string[]; onChange: (b: string[]) => void }) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const opcoes = useMemo(() => {
    const t = semAcento(termo);
    return BAIRROS_PONTA_GROSSA.filter((b) => semAcento(b).includes(t));
  }, [termo]);

  const alternar = (b: string) =>
    onChange(selecionados.includes(b) ? selecionados.filter((x) => x !== b) : [...selecionados, b]);

  return (
    <div>
      <span className={rotuloCls}>Bairros</span>
      {selecionados.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selecionados.map((b) => (
            <button
              key={b} type="button" onClick={() => alternar(b)}
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent hover:opacity-80"
              aria-label={`Remover ${b}`}
            >
              {b} <span aria-hidden>×</span>
            </button>
          ))}
          <button type="button" onClick={() => onChange([])} className="text-xs text-ink-3 underline-offset-2 hover:underline">
            limpar
          </button>
        </div>
      )}
      <div className="relative">
        <input
          className={inputCls} placeholder={selecionados.length ? "Adicionar bairro…" : "Todos os bairros"}
          value={termo} onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)}
          role="combobox" aria-expanded={aberto} aria-controls="lista-bairros"
        />
        {aberto && (
          <ul id="lista-bairros" role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
            {opcoes.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">Nenhum bairro encontrado</li>}
            {opcoes.map((b) => (
              <li key={b}>
                <button
                  type="button" role="option" aria-selected={selecionados.includes(b)}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => alternar(b)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <span className={`grid size-4 place-items-center rounded border text-[10px] ${selecionados.includes(b) ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>
                    {selecionados.includes(b) && "✓"}
                  </span>
                  {b}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PainelFiltros({ filtros, onFiltros, fontes, onFontes, buscando, onPesquisar, temResultado }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onFiltros({ ...filtros, [k]: v });
  const semTipo = filtros.tipos.length === 0;
  const semFonte = fontes.length === 0;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => { e.preventDefault(); if (!semTipo && !semFonte) onPesquisar(false); }}
    >
      <fieldset>
        <legend className={rotuloCls}>Tipo de imóvel <span className="text-bad">*</span></legend>
        <div className="flex flex-wrap gap-1.5">
          {TIPOS.map((t) => {
            const ativo = filtros.tipos.includes(t.id);
            return (
              <button
                key={t.id} type="button" aria-pressed={ativo}
                onClick={() => set("tipos", ativo ? filtros.tipos.filter((x) => x !== t.id) : [...filtros.tipos, t.id])}
                className={`flex-1 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${ativo ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`}
              >
                {t.rotulo}
              </button>
            );
          })}
        </div>
        {semTipo && <p className="mt-1 text-xs text-bad">Escolha pelo menos um tipo.</p>}
      </fieldset>

      <SeletorBairros selecionados={filtros.bairros} onChange={(b) => set("bairros", b)} />

      <CampoFaixa rotulo="Área construída" unidade="m²" faixa={filtros.area_construida} onChange={(f) => set("area_construida", f)} />
      <CampoFaixa rotulo="Área do terreno" unidade="m²" faixa={filtros.area_terreno} onChange={(f) => set("area_terreno", f)} />
      <CampoFaixa rotulo="Preço total" unidade="R$" moeda faixa={filtros.preco_total} onChange={(f) => set("preco_total", f)} />

      <div className="grid grid-cols-2 gap-3">
        <CampoMinimo rotulo="Dormitórios" valor={filtros.dormitorios_min} onChange={(v) => set("dormitorios_min", v)} />
        <CampoMinimo rotulo="Suítes" valor={filtros.suites_min} onChange={(v) => set("suites_min", v)} />
        <CampoMinimo rotulo="Banheiros" valor={filtros.banheiros_min} onChange={(v) => set("banheiros_min", v)} />
        <CampoMinimo rotulo="Vagas" valor={filtros.vagas_min} onChange={(v) => set("vagas_min", v)} />
      </div>

      <CampoFaixa rotulo="Pavimentos" faixa={filtros.pavimentos} onChange={(f) => set("pavimentos", f)} />

      <fieldset>
        <legend className={rotuloCls}>Condomínio</legend>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-line">
          {(["indiferente", "sim", "nao"] as Condominio[]).map((c) => (
            <button
              key={c} type="button" aria-pressed={filtros.condominio === c} onClick={() => set("condominio", c)}
              className={`px-2 py-1.5 text-sm ${filtros.condominio === c ? "bg-ink text-bg font-medium" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              {c === "indiferente" ? "Indiferente" : c === "sim" ? "Sim" : "Não"}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={rotuloCls}>Fontes <span className="text-bad">*</span></legend>
        <div className="flex flex-col gap-1">
          {FONTES.map((f) => (
            <label key={f.id} className={`flex items-center gap-2 text-sm ${f.ativa ? "" : "opacity-50"}`}>
              <input
                type="checkbox" className="size-4 accent-[var(--accent)]" disabled={!f.ativa}
                checked={fontes.includes(f.id)}
                onChange={(e) => onFontes(e.target.checked ? [...fontes, f.id] : fontes.filter((x) => x !== f.id))}
              />
              {f.nome}
              {f.observacao && <span className="text-xs text-ink-3">({f.observacao})</span>}
            </label>
          ))}
        </div>
        {semFonte && <p className="mt-1 text-xs text-bad">Escolha pelo menos uma fonte.</p>}
      </fieldset>

      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-surface px-5 py-4">
        <button
          type="submit" disabled={buscando || semTipo || semFonte}
          className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buscando ? "Pesquisando…" : "Pesquisar"}
        </button>
        {temResultado && (
          <button
            type="button" disabled={buscando || semTipo || semFonte} onClick={() => onPesquisar(true)}
            title="Ignora o cache e coleta de novo nos sites"
            className="rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
          >
            Atualizar
          </button>
        )}
      </div>
    </form>
  );
}
