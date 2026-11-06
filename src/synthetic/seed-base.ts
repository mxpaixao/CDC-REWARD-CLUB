/**
 * Carga sintética da etapa 1: lojas, usuários internos e parâmetros iniciais.
 * Idempotente — pode rodar várias vezes. Usada pelo `prisma db seed` e pelos testes.
 */
import type { Db } from "@/infra/db/client";
import { manausInstant } from "@/domain/business-time";
import { hashPassword } from "@/infra/security/password";
import { systemActor } from "@/application/actor";
import { recordAudit } from "@/application/audit";
import { seedInitialParameters } from "@/application/parameters";
import { syntheticStores } from "./generators";

/** Início da vigência dos parâmetros iniciais. Antes de qualquer venda sintética dos testes. */
export const INITIAL_PARAMETERS_VALID_FROM = manausInstant("2026-01-01");

export const SEED_USERS = [
  { email: "admin@exemplo.test", name: "Admin Sintético", role: "ADMIN" },
  { email: "gerente@exemplo.test", name: "Gerente de Canal Sintético", role: "CHANNEL_MANAGER" },
  { email: "caixa@exemplo.test", name: "Operador de Caixa Sintético", role: "CASHIER" },
] as const;

export async function seedBase(db: Db, password: string) {
  const stores = [];
  for (const s of syntheticStores()) {
    const existing = await db.store.findUnique({ where: { code: s.code } });
    if (existing) {
      stores.push(existing);
      continue;
    }
    const created = await db.$transaction(async (tx) => {
      const store = await tx.store.create({ data: s });
      await recordAudit(tx, { actor: systemActor, action: "store.seed", entity: "store", entityId: store.id, after: store });
      return store;
    });
    stores.push(created);
  }
  const pilot = stores.find((s) => s.isPilot)!;

  const passwordHash = await hashPassword(password);
  const manager = await upsertUser(db, SEED_USERS[1], passwordHash, null, null);
  await upsertUser(db, SEED_USERS[0], passwordHash, null, null);
  await upsertUser(db, SEED_USERS[2], passwordHash, pilot.id, manager.id);

  const parameters = await seedInitialParameters(db, systemActor, INITIAL_PARAMETERS_VALID_FROM);
  return { stores, parametersCreated: parameters };
}

async function upsertUser(
  db: Db,
  u: (typeof SEED_USERS)[number],
  passwordHash: string,
  storeId: string | null,
  channelManagerId: string | null,
) {
  const existing = await db.internalUser.findUnique({ where: { email: u.email } });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    const user = await tx.internalUser.create({
      data: { email: u.email, name: u.name, role: u.role, passwordHash, storeId, channelManagerId },
    });
    await recordAudit(tx, { actor: systemActor, action: "user.seed", entity: "internal_user", entityId: user.id, after: user });
    return user;
  });
}
