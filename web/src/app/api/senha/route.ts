// POST { senha_atual, senha_nova }: troca a senha de quem está logado.
import { chamarBackend } from "@/lib/servidor";
import { sessaoAtual } from "@/server/sessao-atual";

export async function POST(request: Request) {
  const sessao = await sessaoAtual();
  if (!sessao) return Response.json({ mensagem: "Sua sessão expirou. Entre de novo." }, { status: 401 });
  const c = (await request.json().catch(() => null)) as { senha_atual?: unknown; senha_nova?: unknown } | null;
  return chamarBackend("/auth/senha", {
    method: "POST",
    body: JSON.stringify({ email: sessao.email, senha_atual: c?.senha_atual, senha_nova: c?.senha_nova }),
  });
}
