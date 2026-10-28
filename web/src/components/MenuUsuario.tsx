"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialogo } from "./PesquisasSalvas";

const btnSecundario = "rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50";

function DialogoTrocarSenha({ onFechar }: { onFechar: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [estado, setEstado] = useState<"editando" | "salvando" | "pronto">("editando");
  const [erro, setErro] = useState<string | null>(null);
  const campo = "w-full rounded-md border border-line bg-surface px-2.5 py-1.5";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== confirmacao) return setErro("A confirmação não confere com a senha nova.");
    setEstado("salvando");
    setErro(null);
    const r = await fetch("/api/senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha_atual: atual, senha_nova: nova }) });
    const corpo = (await r.json().catch(() => ({}))) as { mensagem?: string };
    if (r.ok) return setEstado("pronto");
    setErro(r.status === 401 ? "A senha atual está errada." : corpo.mensagem ?? `Erro ${r.status}`);
    setEstado("editando");
  }

  return (
    <Dialogo titulo="Trocar senha" onFechar={onFechar}>
      {estado === "pronto" ? (
        <div className="mt-3">
          <p className="text-sm text-ok">Senha trocada. Use a nova no próximo login.</p>
          <div className="mt-4 flex justify-end"><button type="button" onClick={onFechar} className={btnSecundario}>Fechar</button></div>
        </div>
      ) : (
        <form onSubmit={salvar} className="mt-3 flex flex-col gap-3">
          <label className="text-sm"><span className="mb-1 block text-ink-2">Senha atual</span>
            <input type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} className={campo} /></label>
          <label className="text-sm"><span className="mb-1 block text-ink-2">Senha nova (mínimo 8 caracteres)</span>
            <input type="password" autoComplete="new-password" required minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} className={campo} /></label>
          <label className="text-sm"><span className="mb-1 block text-ink-2">Confirme a senha nova</span>
            <input type="password" autoComplete="new-password" required minLength={8} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className={campo} /></label>
          {erro && <p role="alert" className="rounded-md bg-bad-soft px-2.5 py-1.5 text-sm text-bad">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onFechar} className={btnSecundario}>Cancelar</button>
            <button type="submit" disabled={estado === "salvando"} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50">
              {estado === "salvando" ? "Salvando…" : "Trocar senha"}
            </button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

/** Nome de quem está logado, com "Trocar senha" e "Sair". */
export function MenuUsuario({ nome, email }: { nome: string; email: string }) {
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const router = useRouter();

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
      >
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{nome.trim().charAt(0).toUpperCase()}</span>
        <span className="hidden max-w-40 truncate sm:inline">{nome}</span>
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <p className="truncate px-3 py-2 text-xs text-ink-3">{email}</p>
            <button type="button" role="menuitem" onClick={() => { setAberto(false); setTrocando(true); }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2">Trocar senha</button>
            <button type="button" role="menuitem" onClick={sair} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2">Sair</button>
          </div>
        </>
      )}
      {trocando && <DialogoTrocarSenha onFechar={() => setTrocando(false)} />}
    </div>
  );
}
