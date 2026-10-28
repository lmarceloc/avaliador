// Sessão do usuário logado, para rotas e páginas do servidor.
import "server-only";
import { cookies } from "next/headers";
import { COOKIE_SESSAO, DURACAO_SESSAO_S, lerToken, segredoSessao, type Sessao } from "@/lib/sessao";

export async function sessaoAtual(): Promise<Sessao | null> {
  // Lê o cookie antes de tudo: é isso que marca o trecho como "da requisição" para o Next, mesmo num
  // build feito sem SESSAO_SEGREDO (senão ele pré-renderiza o menu vazio).
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  const segredo = segredoSessao();
  return segredo ? lerToken(token, segredo) : null;
}

/** HttpOnly (o JavaScript da página não lê), Secure em produção, SameSite=Lax contra envio por outros sites. */
export async function gravarCookieSessao(token: string) {
  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DURACAO_SESSAO_S,
  });
}

export async function apagarCookieSessao() {
  (await cookies()).delete(COOKIE_SESSAO);
}
