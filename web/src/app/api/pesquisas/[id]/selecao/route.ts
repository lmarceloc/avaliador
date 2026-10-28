// Marca um imóvel na pesquisa salva: { imovel_id, incluido: true | false | null }.
import { chamarBackend, usandoMock } from "@/lib/servidor";
import * as local from "@/server/pesquisas-local";

export async function PUT(request: Request, ctx: RouteContext<"/api/pesquisas/[id]/selecao">) {
  const { id } = await ctx.params;
  const corpo = (await request.json().catch(() => null)) as { imovel_id?: unknown; incluido?: unknown } | null;
  if (usandoMock()) return local.marcar(id, corpo?.imovel_id, corpo?.incluido ?? null);
  return chamarBackend(`/pesquisas/${encodeURIComponent(id)}/selecao`, { method: "PUT", body: JSON.stringify(corpo) });
}
