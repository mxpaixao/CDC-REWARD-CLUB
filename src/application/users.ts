/** Gestão de usuários internos (Admin). Toda mudança é auditada. */
import { z } from "zod";
import type { Db } from "@/infra/db/client";
import { INTERNAL_ROLES, assertCan } from "@/domain/auth/roles";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/infra/security/password";
import { BusinessRuleError, type SessionUser, userActor } from "./actor";
import { recordAudit } from "./audit";

const createSchema = z.object({
  name: z.string().trim().min(2, "informe o nome"),
  email: z.string().trim().toLowerCase().email("e-mail inválido"),
  role: z.enum(INTERNAL_ROLES),
  storeId: z.string().uuid().nullable().default(null),
  channelManagerId: z.string().uuid().nullable().default(null),
  password: z.string().min(MIN_PASSWORD_LENGTH, `a senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`),
});
export type CreateUserInput = z.input<typeof createSchema>;

const updateSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    role: z.enum(INTERNAL_ROLES).optional(),
    storeId: z.string().uuid().nullable().optional(),
    channelManagerId: z.string().uuid().nullable().optional(),
    active: z.boolean().optional(),
    password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  })
  .strict();
export type UpdateUserInput = z.input<typeof updateSchema>;

const publicFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  storeId: true,
  channelManagerId: true,
  active: true,
} as const;

async function assertChannelManager(db: Db, id: string | null | undefined) {
  if (!id) return;
  const manager = await db.internalUser.findUnique({ where: { id } });
  if (!manager || manager.role !== "CHANNEL_MANAGER") {
    throw new BusinessRuleError("O gerente de canal informado não existe ou não tem esse perfil.", "INVALID_CHANNEL_MANAGER");
  }
}

export async function createUser(db: Db, actor: SessionUser, input: CreateUserInput) {
  assertCan(actor.role, "users.manage");
  const data = createSchema.parse(input);
  await assertChannelManager(db, data.channelManagerId);
  if (await db.internalUser.findUnique({ where: { email: data.email } })) {
    throw new BusinessRuleError("Já existe um usuário com esse e-mail.", "EMAIL_TAKEN");
  }
  const passwordHash = await hashPassword(data.password);

  return db.$transaction(async (tx) => {
    const user = await tx.internalUser.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        storeId: data.storeId,
        channelManagerId: data.channelManagerId,
        passwordHash,
      },
      select: publicFields,
    });
    await recordAudit(tx, { actor: userActor(actor), action: "user.create", entity: "internal_user", entityId: user.id, after: user });
    return user;
  });
}

export async function updateUser(db: Db, actor: SessionUser, userId: string, input: UpdateUserInput) {
  assertCan(actor.role, "users.manage");
  const data = updateSchema.parse(input);
  await assertChannelManager(db, data.channelManagerId);
  if (userId === actor.id && (data.active === false || (data.role && data.role !== "ADMIN"))) {
    throw new BusinessRuleError("Você não pode desativar nem tirar o perfil Admin de si mesmo.", "SELF_LOCKOUT");
  }
  const { password, ...fields } = data;
  const passwordHash = password ? await hashPassword(password) : undefined;

  return db.$transaction(async (tx) => {
    const before = await tx.internalUser.findUnique({ where: { id: userId }, select: publicFields });
    if (!before) throw new BusinessRuleError("Usuário não encontrado.", "NOT_FOUND");
    const after = await tx.internalUser.update({
      where: { id: userId },
      data: { ...fields, ...(passwordHash ? { passwordHash, failedLoginAttempts: 0, lockedUntil: null } : {}) },
      select: publicFields,
    });
    if (fields.active === false) {
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit(tx, {
      actor: userActor(actor),
      action: passwordHash ? "user.update_with_password" : "user.update",
      entity: "internal_user",
      entityId: userId,
      before,
      after,
    });
    return after;
  });
}
