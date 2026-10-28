// Pesquisas salvas: GET lista, POST cria a partir de uma busca concluída ({ nome, requisicao_id, extras?, selecao? }).
import { chamarBackend, usandoMock } from "@/lib/servidor";
import * as local from "@/server/pesquisas-local";

export async function GET() {
  return usandoMock() ? local.listar() : chamarBackend("/pesquisas");
}

export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null);
  return usandoMock() ? local.criar(corpo) : chamarBackend("/pesquisas", { method: "POST", body: JSON.stringify(corpo) });
}
