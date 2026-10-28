"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { caminhoSeguro } from "@/lib/caminho-seguro";

export function FormLogin() {
  const volta = caminhoSeguro(useSearchParams().get("volta"));
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro(null);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
      const corpo = (await r.json().catch(() => ({}))) as { mensagem?: string };
      if (!r.ok) throw new Error(corpo.mensagem ?? `Erro ${r.status}`);
      // Navegação completa: a página inicial é renderizada de novo já com a sessão.
      window.location.assign(volta);
    } catch (err) {
      setErro((err as Error).message);
      setEntrando(false);
    }
  }

  const campo = "w-full rounded-md border border-line bg-surface px-3 py-2";
  return (
    <form onSubmit={entrar} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-accent text-sm font-bold text-accent-ink">BI</div>
        <div>
          <h1 className="text-base font-semibold leading-tight">Busca de Imóveis</h1>
          <p className="text-sm text-ink-2">Entre com seu e-mail e senha</p>
        </div>
      </div>
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-ink-2">E-mail</span>
        <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={campo} />
      </label>
      <label className="mb-4 block text-sm">
        <span className="mb-1 block text-ink-2">Senha</span>
        <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className={campo} />
      </label>
      {erro && <p role="alert" className="mb-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{erro}</p>}
      <button type="submit" disabled={entrando} className="w-full rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:brightness-110 disabled:opacity-60">
        {entrando ? "Entrando…" : "Entrar"}
      </button>
      <p className="mt-4 text-center text-xs text-ink-3">Esqueceu a senha? Fale com quem administra o sistema.</p>
    </form>
  );
}
