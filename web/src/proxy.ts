// Acesso restrito (ponto em aberto nº 5): se APP_USUARIO e APP_SENHA estiverem definidos,
// exige autenticação básica em todas as páginas e rotas de API.
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const usuario = process.env.APP_USUARIO;
  const senha = process.env.APP_SENHA;
  if (!usuario || !senha) return NextResponse.next();

  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Basic ")) {
    const [u, s] = atob(auth.slice(6)).split(":");
    if (u === usuario && s === senha) return NextResponse.next();
  }
  return new NextResponse("Acesso restrito", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Busca de Imóveis"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
