/** Lotes de importação recentes (Admin). ?tipo=PRODUCTS|EXCLUSIONS|STORES|XML */
import { getPrisma } from "@/infra/db/client";
import { can } from "@/domain/auth/roles";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";
const TYPES = ["XML", "PRODUCTS", "EXCLUSIONS", "STORES"] as const;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  if (!can(user.role, "imports.manage")) return Response.json({ erro: "sem permissão" }, { status: 403 });
  const tipo = new URL(request.url).searchParams.get("tipo");
  const type = TYPES.find((t) => t === tipo);
  const batches = await getPrisma().importBatch.findMany({
    where: type ? { type } : {},
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { createdBy: { select: { name: true } } },
  });
  return Response.json(batches);
}
