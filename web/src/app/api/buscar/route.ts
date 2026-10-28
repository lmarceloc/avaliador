import type { RequisicaoBusca } from "@/lib/contrato";
import { consultarBusca, iniciarBusca, tempoTotal } from "@/lib/mock";
import { chamarBackend, usandoMock, validarRequisicao } from "@/lib/servidor";

// Modo síncrono até 2 fontes, assíncrono a partir de 3 (seção 6.4).
const LIMITE_SINCRONO = 2;

export async function POST(request: Request) {
  const req = (await request.json().catch(() => null)) as RequisicaoBusca | null;
  const erro = validarRequisicao(req ?? {});
  if (erro || !req) return Response.json({ status: "erro", mensagem: erro }, { status: 400 });

  if (!usandoMock()) {
    return chamarBackend("/buscas", { method: "POST", body: JSON.stringify(req) });
  }

  iniciarBusca(req);
  if (req.fontes.length <= LIMITE_SINCRONO) {
    await new Promise((r) => setTimeout(r, tempoTotal(req) + 50));
    return Response.json(consultarBusca(req.requisicao_id));
  }
  return Response.json({ requisicao_id: req.requisicao_id, status: "processando" });
}
