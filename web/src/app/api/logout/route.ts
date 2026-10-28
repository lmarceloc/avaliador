import { apagarCookieSessao } from "@/server/sessao-atual";

export async function POST() {
  await apagarCookieSessao();
  return Response.json({ ok: true });
}
