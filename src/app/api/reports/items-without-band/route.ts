/** Relatório "itens sem faixa" (Admin). ?de=AAAA-MM-DD&ate=AAAA-MM-DD (inclusive, datas de Manaus)&loja=L1 */
import { getPrisma } from "@/infra/db/client";
import { can } from "@/domain/auth/roles";
import { addBusinessDays, startOfBusinessDay, businessDateOf } from "@/domain/business-time";
import { itemsWithoutBandReport } from "@/application/reports/items-without-band";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  if (!can(user.role, "imports.manage")) return Response.json({ erro: "sem permissão" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const today = businessDateOf(new Date());
  const de = params.get("de") ?? addBusinessDays(today, -30);
  const ate = params.get("ate") ?? today;
  if (!DATE.test(de) || !DATE.test(ate)) return Response.json({ erro: "use datas no formato AAAA-MM-DD" }, { status: 400 });
  const db = getPrisma();
  const lojaCode = params.get("loja");
  const store = lojaCode ? await db.store.findUnique({ where: { code: lojaCode.toUpperCase() } }) : null;
  if (lojaCode && !store) return Response.json({ erro: "loja não encontrada" }, { status: 404 });
  const rows = await itemsWithoutBandReport(db, {
    from: startOfBusinessDay(de),
    to: startOfBusinessDay(addBusinessDays(ate, 1)),
    storeId: store?.id,
  });
  return Response.json({ de, ate, loja: store?.code ?? null, itens: rows });
}
