/**
 * Parâmetros com vigência (Admin).
 * GET  → valor vigente e versões agendadas de cada chave.
 * POST → { key, value, validFrom (ISO com fuso), note } cria nova versão.
 */
import { z } from "zod";
import { getPrisma } from "@/infra/db/client";
import { can, ForbiddenError } from "@/domain/auth/roles";
import { BusinessRuleError } from "@/application/actor";
import { createParameterVersion, listParameters } from "@/application/parameters";
import { parseInstantWithOffset } from "@/domain/business-time";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  if (!can(user.role, "parameters.manage")) return Response.json({ erro: "sem permissão" }, { status: 403 });
  return Response.json(await listParameters(getPrisma()));
}

const body = z.object({
  key: z.string(),
  value: z.unknown(),
  validFrom: z.string(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ erro: "corpo inválido" }, { status: 400 });
  try {
    const created = await createParameterVersion(getPrisma(), user, {
      key: parsed.data.key,
      value: parsed.data.value,
      validFrom: parseInstantWithOffset(parsed.data.validFrom),
      note: parsed.data.note,
    });
    return Response.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ erro: "sem permissão" }, { status: 403 });
    if (e instanceof BusinessRuleError) return Response.json({ erro: e.message, codigo: e.code }, { status: 422 });
    if (e instanceof Error && e.name === "BusinessTimeError") return Response.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
