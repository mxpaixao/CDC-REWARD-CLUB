/**
 * Login de usuários internos com e-mail e senha (SPEC seção 3).
 * Um provedor de identidade do CPD pode substituir este módulo sem mudar quem
 * consome `SessionUser`.
 */
import type { Db } from "@/infra/db/client";
import type { AppConfig } from "@/infra/config";
import { hashToken, newSessionToken, verifyPassword } from "@/infra/security/password";
import { logger } from "@/infra/log/logger";
import { addHoursToInstant, addMinutesToInstant } from "@/domain/business-time";
import type { SessionUser } from "./actor";

export class LoginError extends Error {
  constructor(message = "E-mail ou senha incorretos.") {
    super(message);
    this.name = "LoginError";
  }
}

type AuthConfig = Pick<AppConfig, "SESSION_TTL_HOURS" | "LOGIN_MAX_ATTEMPTS" | "LOGIN_LOCK_MINUTES">;

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: SessionUser;
}

function toSessionUser(u: { id: string; name: string; email: string; role: SessionUser["role"]; storeId: string | null }): SessionUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, storeId: u.storeId };
}

export async function login(
  db: Db,
  config: AuthConfig,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await db.internalUser.findUnique({ where: { email } });

  if (!user || !user.active) {
    // Mesmo custo de verificação para não revelar se o e-mail existe.
    await verifyPassword(input.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
    throw new LoginError();
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new LoginError("Acesso bloqueado temporariamente por tentativas erradas. Tente mais tarde.");
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= config.LOGIN_MAX_ATTEMPTS;
    await db.internalUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? addMinutesToInstant(now, config.LOGIN_LOCK_MINUTES) : user.lockedUntil,
      },
    });
    logger.warn("login recusado", { userId: user.id, locked: lock });
    throw new LoginError();
  }

  const { token, tokenHash } = newSessionToken();
  const expiresAt = addHoursToInstant(now, config.SESSION_TTL_HOURS);
  await db.$transaction([
    db.session.create({ data: { tokenHash, userId: user.id, createdAt: now, expiresAt } }),
    db.internalUser.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } }),
  ]);
  logger.info("login", { userId: user.id });
  return { token, expiresAt, user: toSessionUser(user) };
}

/** Usuário da sessão, ou null se o token não existe, expirou, foi revogado ou o usuário foi desativado. */
export async function getSessionUser(db: Db, token: string | undefined, now: Date = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.active) return null;
  return toSessionUser(session.user);
}

export async function logout(db: Db, token: string | undefined, now: Date = new Date()): Promise<void> {
  if (!token) return;
  await db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } });
}
