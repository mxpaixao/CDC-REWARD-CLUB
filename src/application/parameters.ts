/**
 * Parâmetros com vigência no banco (SPEC seção 4).
 * - Leitura: versão com maior início de vigência que não passe do instante.
 * - Mudança: só Admin, sempre nova versão com início no presente ou no futuro
 *   (nunca retroativa — vendas já processadas não mudam), auditada.
 */
import type { DbOrTx, Db } from "@/infra/db/client";
import { assertCan } from "@/domain/auth/roles";
import {
  InvalidParameterError,
  PARAMETER_KEYS,
  initialParameterValues,
  isParameterKey,
  type ParameterKey,
  type ParameterSnapshot,
  type ParameterValue,
  validateParameter,
} from "@/domain/params/definitions";
import { ParameterNotFoundError, type ParameterReader } from "@/domain/params/resolve";
import { BusinessRuleError, type Actor, type SessionUser, userActor } from "./actor";
import { recordAudit } from "./audit";

export class DbParameterReader implements ParameterReader {
  constructor(private readonly db: DbOrTx) {}

  async get<K extends ParameterKey>(key: K, at: Date): Promise<ParameterValue<K>> {
    const version = await this.db.parameterVersion.findFirst({
      where: { key, validFrom: { lte: at } },
      orderBy: { validFrom: "desc" },
    });
    if (!version) throw new ParameterNotFoundError(key, at);
    return validateParameter(key, version.value);
  }

  async snapshot(at: Date): Promise<ParameterSnapshot> {
    const rows = await this.db.parameterVersion.findMany({
      where: { validFrom: { lte: at } },
      orderBy: { validFrom: "desc" },
      distinct: ["key"],
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out: Record<string, unknown> = {};
    for (const key of PARAMETER_KEYS) {
      if (!byKey.has(key)) throw new ParameterNotFoundError(key, at);
      out[key] = validateParameter(key, byKey.get(key));
    }
    return out as ParameterSnapshot;
  }
}

export interface ParameterRow {
  key: ParameterKey;
  current: { value: unknown; validFrom: Date } | null;
  scheduled: { value: unknown; validFrom: Date }[];
}

/** Valor vigente e versões agendadas de cada chave — para a tela de parâmetros. */
export async function listParameters(db: DbOrTx, now: Date = new Date()): Promise<ParameterRow[]> {
  const rows = await db.parameterVersion.findMany({ orderBy: [{ key: "asc" }, { validFrom: "asc" }] });
  return PARAMETER_KEYS.map((key) => {
    const versions = rows.filter((r) => r.key === key);
    const past = versions.filter((v) => v.validFrom <= now);
    const current = past.at(-1);
    return {
      key,
      current: current ? { value: current.value, validFrom: current.validFrom } : null,
      scheduled: versions.filter((v) => v.validFrom > now).map((v) => ({ value: v.value, validFrom: v.validFrom })),
    };
  });
}

export async function createParameterVersion(
  db: Db,
  actor: SessionUser,
  input: { key: string; value: unknown; validFrom: Date; note?: string },
  now: Date = new Date(),
) {
  assertCan(actor.role, "parameters.manage");
  if (!isParameterKey(input.key)) {
    throw new BusinessRuleError(`Parâmetro desconhecido: ${input.key}.`, "UNKNOWN_PARAMETER");
  }
  const key = input.key;
  let value: unknown;
  try {
    value = validateParameter(key, input.value);
  } catch (e) {
    if (e instanceof InvalidParameterError) throw new BusinessRuleError(e.message, "INVALID_PARAMETER");
    throw e;
  }
  if (input.validFrom.getTime() < now.getTime()) {
    throw new BusinessRuleError(
      "A vigência não pode começar no passado: vendas já processadas usam a versão da época.",
      "RETROACTIVE_PARAMETER",
    );
  }

  return db.$transaction(async (tx) => {
    const previous = await tx.parameterVersion.findFirst({
      where: { key, validFrom: { lte: input.validFrom } },
      orderBy: { validFrom: "desc" },
    });
    const created = await tx.parameterVersion.create({
      data: { key, value: value as never, validFrom: input.validFrom, createdById: actor.id, note: input.note ?? null },
    });
    await recordAudit(tx, {
      actor: userActor(actor),
      action: "parameter.new_version",
      entity: "parameter_version",
      entityId: created.id,
      before: previous ? { key, value: previous.value, validFrom: previous.validFrom } : null,
      after: { key, value: created.value, validFrom: created.validFrom },
      reason: input.note,
    });
    return created;
  });
}

/**
 * Carga inicial dos parâmetros (seed). Idempotente: só cria a chave que ainda
 * não tem nenhuma versão.
 */
export async function seedInitialParameters(db: Db, actor: Actor, validFrom: Date, values: ParameterSnapshot = initialParameterValues) {
  let created = 0;
  for (const key of PARAMETER_KEYS) {
    const exists = await db.parameterVersion.findFirst({ where: { key } });
    if (exists) continue;
    await db.$transaction(async (tx) => {
      const row = await tx.parameterVersion.create({
        data: { key, value: validateParameter(key, values[key]) as never, validFrom, note: "Valor inicial da SPEC" },
      });
      await recordAudit(tx, {
        actor,
        action: "parameter.seed",
        entity: "parameter_version",
        entityId: row.id,
        after: { key, value: row.value, validFrom },
      });
    });
    created++;
  }
  return created;
}
