// Uma pesquisa salva: GET abre (resultados + seleção), PATCH renomeia ou troca os resultados, DELETE apaga.
import { chamarBackend, usandoMock } from "@/lib/servidor";
import * as local from "@/server/pesquisas-local";

type Ctx = RouteContext<"/api/pesquisas/[id]">;
const caminho = (id: string) => `/pesquisas/${encodeURIComponent(id)}`;

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return usandoMock() ? local.abrir(id) : chamarBackend(caminho(id));
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const corpo = await request.json().catch(() => null);
  return usandoMock() ? local.alterar(id, corpo) : chamarBackend(caminho(id), { method: "PATCH", body: JSON.stringify(corpo) });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return usandoMock() ? local.excluir(id) : chamarBackend(caminho(id), { method: "DELETE" });
}
