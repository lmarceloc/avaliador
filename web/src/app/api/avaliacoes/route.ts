import type { AvaliacaoImovel } from "@/lib/contrato";
import { CLASSES_EC } from "@/config/avaliacao";
import { listarAvaliacoes, salvarAvaliacao } from "@/lib/servidor";

const ESTADOS_IBAPE = new Set<string>(CLASSES_EC);

export async function GET() {
  try {
    return Response.json(await listarAvaliacoes());
  } catch (e) {
    return Response.json({ mensagem: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const a = (await request.json().catch(() => null)) as AvaliacaoImovel | null;
  if (!a?.imovel_id) return Response.json({ mensagem: "imovel_id é obrigatório" }, { status: 400 });
  if (a.estado_conservacao && !ESTADOS_IBAPE.has(a.estado_conservacao))
    return Response.json({ mensagem: "Estado de conservação deve ser de A a I (IBAPE)" }, { status: 400 });
  const area = a.area_terreno_m2;
  if (area != null && (typeof area !== "number" || !Number.isFinite(area) || area <= 0 || area >= 10_000_000))
    return Response.json({ mensagem: "Área do terreno deve ser um número de m² maior que zero" }, { status: 400 });
  if ([a.piscina, a.condominio, a.geminada].some((v) => v != null && typeof v !== "boolean"))
    return Response.json({ mensagem: "Piscina, condomínio e geminada devem ser sim, não ou vazio" }, { status: 400 });
  if (a.tipo_casa != null && a.tipo_casa !== "terrea" && a.tipo_casa !== "sobrado")
    return Response.json({ mensagem: "Térrea/sobrado deve ser térrea, sobrado ou vazio" }, { status: 400 });
  try {
    return Response.json(await salvarAvaliacao(a));
  } catch (e) {
    return Response.json({ mensagem: (e as Error).message }, { status: 500 });
  }
}
