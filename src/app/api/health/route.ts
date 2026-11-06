import { getPrisma } from "@/infra/db/client";

export const dynamic = "force-dynamic";

/** Verificação de saúde para o monitoramento: app de pé e banco respondendo. */
export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "erro", detalhe: "banco indisponível" }, { status: 503 });
  }
}
