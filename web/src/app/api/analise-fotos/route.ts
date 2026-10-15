// POST: roda a análise de fotos e devolve NDJSON ({tipo:"progresso"} … {tipo:"resultado"}).
// PATCH: marca a análise como aprovada depois que o usuário confirmou a avaliação.
import { analisarFotos, lerConfig } from "@/server/analise-fotos";
import { lerConfigJev, triarAnalise, type TipoImovelTriagem } from "@/server/triagem-jev";
import { aprovarAnalise, armazenamento, armazenamentoTriagem, urlPermitida } from "@/server/analise-armazenamento";

export const maxDuration = 120;

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { imovel_id?: unknown; fotos?: unknown; tipo?: unknown } | null;
  if (typeof corpo?.imovel_id !== "string" || !corpo.imovel_id)
    return Response.json({ mensagem: "imovel_id é obrigatório" }, { status: 400 });
  if (!Array.isArray(corpo.fotos) || corpo.fotos.length === 0 || corpo.fotos.some((f) => typeof f !== "string"))
    return Response.json({ mensagem: "fotos deve ser uma lista não vazia de URLs" }, { status: 400 });
  const tipo = (["casa", "apartamento", "terreno"] as const).find((t) => t === corpo.tipo);
  if (!tipo) return Response.json({ mensagem: "tipo deve ser casa, apartamento ou terreno" }, { status: 400 });
  const imovel_id = corpo.imovel_id;
  const fotos = (corpo.fotos as string[]).slice(0, 100);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const resultado = await analisarFotos(
          { imovel_id, fotos },
          {
            fetch, armazenamento, urlPermitida, config: lerConfig(),
            onProgresso: (lidas, total) => enviar({ tipo: "progresso", lidas, total }),
          },
        );
        // Camada 2: triagem em texto com o Jev. Só roda se a análise terminou como "sugerido".
        enviar({ tipo: "triando" });
        const triagem = await triarAnalise(resultado, tipo as TipoImovelTriagem, { config: lerConfigJev(), armazenamento: armazenamentoTriagem });
        enviar({ tipo: "resultado", resultado: { ...resultado, triagem } });
      } catch (e) {
        enviar({ tipo: "falha", mensagem: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const c = (await request.json().catch(() => null)) as { analise_id?: string; imovel_id?: string } | null;
  if (!c?.analise_id || !c.imovel_id) return Response.json({ mensagem: "analise_id e imovel_id são obrigatórios" }, { status: 400 });
  try {
    await aprovarAnalise(c.analise_id, c.imovel_id, process.env.APP_USUARIO || null);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ mensagem: (e as Error).message }, { status: 500 });
  }
}
