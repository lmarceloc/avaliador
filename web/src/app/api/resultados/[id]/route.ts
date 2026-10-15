import { consultarBusca } from "@/lib/mock";
import { chamarN8n, usandoMock } from "@/lib/servidor";

export async function GET(_request: Request, ctx: RouteContext<"/api/resultados/[id]">) {
  const { id } = await ctx.params;
  if (!usandoMock()) return chamarN8n(`/webhook/resultados?requisicao_id=${encodeURIComponent(id)}`);

  const resultado = consultarBusca(id);
  if (!resultado) return Response.json({ requisicao_id: id, status: "erro", mensagem: "Busca não encontrada" }, { status: 404 });
  return Response.json(resultado);
}
