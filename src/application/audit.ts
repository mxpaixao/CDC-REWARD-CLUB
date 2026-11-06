/**
 * Auditoria (regra inviolável 8). Deve ser chamada dentro da mesma transação
 * que muda o dado, para que a mudança e o registro existam juntos ou não existam.
 */
import type { DbOrTx } from "@/infra/db/client";
import type { Actor } from "./actor";

const SECRET_KEYS = /^(passwordHash|password|tokenHash|token|accessCode|accessCodeHash)$/;

/** Converte para JSON seguro: datas em ISO, BigInt em texto, segredos removidos. */
export function toAuditJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) continue;
      out[k] = toAuditJson(v);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  actor: Actor;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "user":
      return "user";
    case "job":
      return `job:${actor.name}`;
    case "system":
      return "system";
  }
}

function auditRow(input: AuditInput) {
  return {
    userId: input.actor.kind === "user" ? input.actor.user.id : null,
    actor: actorLabel(input.actor),
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    before: (toAuditJson(input.before) ?? undefined) as never,
    after: (toAuditJson(input.after) ?? undefined) as never,
    reason: input.reason ?? null,
  };
}

export async function recordAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.auditLog.create({ data: auditRow(input) });
}

/** Vários registros de uma vez (importações grandes), em blocos. */
export async function recordAuditMany(db: DbOrTx, inputs: readonly AuditInput[], chunkSize = 1000): Promise<void> {
  for (let i = 0; i < inputs.length; i += chunkSize) {
    await db.auditLog.createMany({ data: inputs.slice(i, i + chunkSize).map(auditRow) });
  }
}
