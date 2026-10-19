"use client";

import { useState } from "react";
import { ESTADOS_CONSERVACAO, padraoDe, rotuloPadrao } from "@/config/avaliacao";

interface Triagem {
  status: "ok" | "indisponivel";
  revisao_humana: { probabilidade: number } | null;
  coerente: { probabilidade: number } | null;
  nota_coerencia: number | null;
  candidatos_padrao: { codigo: string; nome: string; probabilidade: number }[];
  modelo: string;
  revisao_obrigatoria: boolean;
  motivos: string[];
}

interface Resultado {
  triagem?: Triagem | null;
  analise_id: string;
  status: "sugerido" | "erro";
  ec_classe: string | null;
  depreciacao_percentual: number | null;
  padrao_codigo: string | null;
  padrao_nome: string | null;
  padrao_sisdia: number | null;
  sisdia_a_confirmar: boolean;
  justificativa: string | null;
  confianca: "baixa" | "media" | "alta" | null;
  fotos_lidas: number;
  fotos_total: number;
  pendencias: string[];
  log: { foto_url: string; status: "lida" | "ignorada" | "erro"; motivo_erro: string | null }[];
}

interface Props {
  imovelId: string;
  fotos: string[];
  tipo: "casa" | "apartamento" | "terreno";
  /** Copia a sugestão para a análise da avaliadora e salva (avaliacoes_imovel). Devolve false se falhar. */
  onAceitar: (campos: { estado_conservacao?: string | null; padrao_acabamento?: string | null }) => Promise<boolean>;
}

function BlocoTriagem({ t }: { t: Triagem }) {
  const cor = t.revisao_obrigatoria ? "border-bad text-bad" : "border-ok text-ok";
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cor}`} role="note">
      <p className="font-semibold">
        {t.revisao_obrigatoria ? "Revisão humana obrigatória" : "Triagem sem ressalvas"}
      </p>
      {t.motivos.map((m) => <p key={m} className="text-xs">{m}</p>)}
      {t.status === "ok" && (
        <p className="mt-1 text-xs text-ink-2">
          Precisa de revisão: {Math.round((t.revisao_humana?.probabilidade ?? 0) * 100)}% · Justificativa coerente:{" "}
          {Math.round((t.coerente?.probabilidade ?? 0) * 100)}% · Nota de coerência: {t.nota_coerencia?.toFixed(1)}/5
        </p>
      )}
      {t.candidatos_padrao.length > 0 && (
        <p className="mt-1 text-xs text-ink-2">
          Segunda opinião de padrão (não altera a sugestão):{" "}
          {t.candidatos_padrao.map((c) => `${c.codigo} ${c.nome} (${Math.round(c.probabilidade * 100)}%)`).join(", ")}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-3">Nada é gravado sem o seu OK.</p>
    </div>
  );
}

const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`;

export function SugestaoAvaliacao({ imovelId, fotos, tipo, onAceitar }: Props) {
  const [lendo, setLendo] = useState<{ lidas: number; total: number } | null>(null);
  const [triando, setTriando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aceitando, setAceitando] = useState(false);
  const [aceita, setAceita] = useState(false);

  async function sugerir() {
    setLendo({ lidas: 0, total: 0 }); // o total real chega no primeiro progresso (depende de FOTOS_MAX)
    setResultado(null);
    setErro(null);
    setAceita(false);
    try {
      const resp = await fetch("/api/analise-fotos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imovel_id: imovelId, fotos, tipo }),
      });
      if (!resp.ok || !resp.body) throw new Error((await resp.json().catch(() => null))?.mensagem ?? `HTTP ${resp.status}`);
      const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        const linhas = (resto + value).split("\n");
        resto = linhas.pop() ?? "";
        for (const l of linhas.filter(Boolean)) {
          const ev = JSON.parse(l);
          if (ev.tipo === "progresso") setLendo({ lidas: ev.lidas, total: ev.total });
          else if (ev.tipo === "triando") setTriando(true);
          else if (ev.tipo === "falha") throw new Error(ev.mensagem);
          else if (ev.tipo === "resultado") setResultado(ev.resultado as Resultado);
        }
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(null);
      setTriando(false);
    }
  }

  /** "OK" da avaliadora: replica a sugestão na análise dela, salva e marca a análise como aprovada. */
  async function aceitar() {
    if (!resultado) return;
    const p = padraoDe(resultado.padrao_codigo);
    const campos: { estado_conservacao?: string | null; padrao_acabamento?: string | null } = {};
    if (resultado.ec_classe) campos.estado_conservacao = resultado.ec_classe;
    if (p) campos.padrao_acabamento = rotuloPadrao(p);
    setAceitando(true);
    const ok = await onAceitar(campos);
    if (ok) {
      await fetch("/api/analise-fotos", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analise_id: resultado.analise_id, imovel_id: imovelId }),
      }).catch(() => null);
      setAceita(true);
    }
    setAceitando(false);
  }

  const classe = ESTADOS_CONSERVACAO.find((e) => e.classe === resultado?.ec_classe);
  const ignoradas = resultado?.log.filter((l) => l.status !== "lida") ?? [];
  const nada = !resultado?.ec_classe && !resultado?.padrao_codigo;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Avaliação da IA (fotos)</h3>
        <button
          type="button" onClick={sugerir} disabled={!!lendo || triando || fotos.length === 0}
          className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          {lendo || triando ? "Analisando…" : "Sugerir avaliação"}
        </button>
      </div>
      {fotos.length === 0 && <p className="text-sm text-ink-3">Este imóvel não tem fotos coletadas.</p>}
      {(lendo || triando) && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 px-3 py-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2.5 text-sm text-ink-2">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:animate-none" aria-hidden />
            <span>
              {triando
                ? "Fotos lidas. Conferindo a coerência da sugestão (Jev)…"
                : lendo && lendo.total > 0
                  ? `Lendo ${lendo.lidas} de ${lendo.total} fotos…`
                  : "Preparando as fotos…"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            {triando || (lendo && lendo.total > 0) ? (
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: triando ? "100%" : `${Math.max(8, ((lendo?.lidas ?? 0) / (lendo?.total || 1)) * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60 motion-reduce:animate-none" />
            )}
          </div>
          <p className="text-xs text-ink-3">Isso pode levar até um minuto. Pode manter esta janela aberta.</p>
        </div>
      )}
      {erro && <p className="text-sm text-bad">Erro na análise: {erro}</p>}

      {resultado && (
        <div className="flex flex-col gap-3">
          {resultado.status === "erro" && <p className="text-sm text-bad">A análise não foi concluída.</p>}
          {resultado.triagem && <BlocoTriagem t={resultado.triagem} />}
          {resultado.status === "sugerido" && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-3">Estado de conservação</dt>
                <dd>{classe ? `${classe.classe} – ${classe.nome} (depreciação ${pct(classe.depreciacao)})` : "—"}</dd>
                <dt className="text-ink-3">Padrão (VEIU)</dt>
                <dd>
                  {resultado.padrao_codigo ? `${resultado.padrao_codigo} ${resultado.padrao_nome}` : "—"}
                  {resultado.padrao_codigo && (
                    <span className="text-ink-3"> · Sisdia: {resultado.padrao_sisdia ?? "a confirmar"}</span>
                  )}
                </dd>
                <dt className="text-ink-3">Confiança</dt>
                <dd>{resultado.confianca ?? "—"}</dd>
              </dl>
              {resultado.justificativa && <p className="text-sm text-ink-2">{resultado.justificativa}</p>}
              <button
                type="button" onClick={aceitar} disabled={aceitando || aceita || nada}
                className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {aceita ? "✔ Aplicado na análise da avaliadora" : aceitando ? "Aplicando…" : "OK — usar na análise da avaliadora"}
              </button>
              <p className="text-xs text-ink-3">
                É só uma sugestão. Nada vai para a avaliação (nem para a planilha) até você dar o OK; para discordar,
                preencha os seus valores em “Análise da avaliadora” e salve.
              </p>
            </>
          )}
          <div className="border-t border-line pt-2 text-xs text-ink-3">
            <p>
              Fotos lidas: {resultado.fotos_lidas} de {resultado.fotos_total}
              {ignoradas.length > 0 && ` · ignoradas: ${ignoradas.length}`}
            </p>
            {ignoradas.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {ignoradas.map((l) => <li key={l.foto_url} className="truncate" title={l.foto_url}>{l.motivo_erro}</li>)}
              </ul>
            )}
            {resultado.pendencias.filter((p) => !p.startsWith("Foto ignorada")).map((p) => <p key={p} className="mt-1">⚠ {p}</p>)}
          </div>
        </div>
      )}
    </section>
  );
}
