// Login obrigatório (com backend configurado): sem sessão válida, páginas vão para /login e rotas de API
// respondem 401. A sessão é um cookie assinado (src/lib/sessao.ts); quem confere a senha é o backend.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerToken, loginObrigatorio, segredoSessao } from "@/lib/sessao";

const PUBLICAS = new Set(["/login", "/api/login"]);

export function proxy(request: NextRequest) {
  if (!loginObrigatorio()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const api = pathname.startsWith("/api/");

  const segredo = segredoSessao();
  if (!segredo) {
    // Falha fechada: com backend e sem segredo, ninguém entra até configurar.
    const mensagem = "Configuração incompleta: defina SESSAO_SEGREDO (32+ caracteres) no servidor.";
    return api ? NextResponse.json({ mensagem }, { status: 503 }) : new NextResponse(mensagem, { status: 503 });
  }

  const sessao = lerToken(request.cookies.get(COOKIE_SESSAO)?.value, segredo);
  if (PUBLICAS.has(pathname)) {
    return sessao && pathname === "/login" ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (sessao) return NextResponse.next();

  if (api) return NextResponse.json({ mensagem: "Sua sessão expirou. Entre de novo." }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("volta", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
