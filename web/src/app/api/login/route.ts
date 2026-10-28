// POST { email, senha }: o backend confere; se der certo, grava o cookie de sessão.
import { criarToken, loginObrigatorio, segredoSessao } from "@/lib/sessao";
import { chamarBackend } from "@/lib/servidor";
import { gravarCookieSessao } from "@/server/sessao-atual";

export async function POST(request: Request) {
  const segredo = segredoSessao();
  if (!loginObrigatorio() || !segredo) return Response.json({ mensagem: "Login não configurado neste servidor" }, { status: 503 });
  const corpo = (await request.json().catch(() => null)) as { email?: unknown; senha?: unknown } | null;
  const resp = await chamarBackend("/auth/login", { method: "POST", body: JSON.stringify({ email: corpo?.email, senha: corpo?.senha }) });
  const dados = (await resp.json().catch(() => ({}))) as { id?: string; email?: string; nome?: string; mensagem?: string };
  if (!resp.ok || !dados.id || !dados.email) return Response.json({ mensagem: dados.mensagem ?? "Não foi possível entrar" }, { status: resp.ok ? 502 : resp.status });
  await gravarCookieSessao(criarToken({ id: dados.id, email: dados.email, nome: dados.nome ?? dados.email }, segredo));
  return Response.json({ nome: dados.nome });
}
