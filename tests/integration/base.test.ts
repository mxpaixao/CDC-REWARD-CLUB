/**
 * Etapa 1 — base: login, perfis, auditoria, parâmetros com vigência e seed sintético.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../support/db";
import { seedBase, INITIAL_PARAMETERS_VALID_FROM } from "@/synthetic/seed-base";
import { login, getSessionUser, logout, LoginError } from "@/application/auth";
import { createUser, updateUser } from "@/application/users";
import { DbParameterReader, createParameterVersion, listParameters } from "@/application/parameters";
import { BusinessRuleError, type SessionUser } from "@/application/actor";
import { ForbiddenError } from "@/domain/auth/roles";
import { PARAMETER_KEYS } from "@/domain/params/definitions";
import { manausInstant } from "@/domain/business-time";

const PASSWORD = "senha-sintetica-123";
const config = { SESSION_TTL_HOURS: 12, LOGIN_MAX_ATTEMPTS: 3, LOGIN_LOCK_MINUTES: 15 };
const db = testDb();

async function sessionUser(email: string): Promise<SessionUser> {
  const u = await db.internalUser.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, storeId: u.storeId };
}

beforeEach(async () => {
  await resetDb(db);
  await seedBase(db, PASSWORD);
});

describe("seed sintético", () => {
  it("cria 4 lojas, 3 usuários e todos os parâmetros, e é idempotente", async () => {
    const again = await seedBase(db, PASSWORD);
    expect(again.parametersCreated).toBe(0);
    expect(await db.store.count()).toBe(4);
    expect(await db.store.count({ where: { isPilot: true } })).toBe(1);
    expect(await db.internalUser.count()).toBe(3);
    expect(await db.parameterVersion.count()).toBe(PARAMETER_KEYS.length);
  });
});

describe("login de usuários internos", () => {
  it("entra com e-mail e senha e a sessão identifica o usuário e o perfil", async () => {
    const now = new Date("2027-01-10T12:00:00Z");
    const result = await login(db, config, { email: " Caixa@Exemplo.test ", password: PASSWORD }, now);
    expect(result.user.role).toBe("CASHIER");
    const user = await getSessionUser(db, result.token, now);
    expect(user?.email).toBe("caixa@exemplo.test");
    // guarda só o hash do token
    expect(await db.session.count({ where: { tokenHash: result.token } })).toBe(0);
  });

  it("sessão expira e logout revoga", async () => {
    const now = new Date("2027-01-10T12:00:00Z");
    const { token } = await login(db, config, { email: "admin@exemplo.test", password: PASSWORD }, now);
    expect(await getSessionUser(db, token, new Date("2027-01-11T00:00:01Z"))).toBeNull();
    const second = await login(db, config, { email: "admin@exemplo.test", password: PASSWORD }, now);
    await logout(db, second.token, now);
    expect(await getSessionUser(db, second.token, now)).toBeNull();
  });

  it("senha errada falha com mensagem genérica e bloqueia após o limite", async () => {
    const now = new Date("2027-01-10T12:00:00Z");
    for (let i = 0; i < 3; i++) {
      await expect(login(db, config, { email: "gerente@exemplo.test", password: "errada-errada" }, now)).rejects.toThrow(
        "E-mail ou senha incorretos.",
      );
    }
    await expect(login(db, config, { email: "gerente@exemplo.test", password: PASSWORD }, now)).rejects.toThrow(/bloqueado/);
    const later = new Date("2027-01-10T12:16:00Z");
    await expect(login(db, config, { email: "gerente@exemplo.test", password: PASSWORD }, later)).resolves.toBeTruthy();
  });

  it("e-mail inexistente e usuário desativado não entram", async () => {
    await expect(login(db, config, { email: "ninguem@exemplo.test", password: PASSWORD })).rejects.toThrow(LoginError);
    const admin = await sessionUser("admin@exemplo.test");
    const cashier = await sessionUser("caixa@exemplo.test");
    const { token } = await login(db, config, { email: cashier.email, password: PASSWORD });
    await updateUser(db, admin, cashier.id, { active: false });
    expect(await getSessionUser(db, token)).toBeNull();
    await expect(login(db, config, { email: cashier.email, password: PASSWORD })).rejects.toThrow(LoginError);
  });
});

describe("usuários e auditoria", () => {
  it("só Admin cria usuário, e a criação é auditada sem o hash da senha", async () => {
    const admin = await sessionUser("admin@exemplo.test");
    const manager = await sessionUser("gerente@exemplo.test");
    await expect(
      createUser(db, manager, { name: "X Teste", email: "x@exemplo.test", role: "CASHIER", password: PASSWORD }),
    ).rejects.toThrow(ForbiddenError);

    const created = await createUser(db, admin, {
      name: "Vendedora Teste",
      email: "vendedora@exemplo.test",
      role: "CASHIER",
      channelManagerId: manager.id,
      password: PASSWORD,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "internal_user", entityId: created.id } });
    expect(audit.userId).toBe(admin.id);
    expect(audit.action).toBe("user.create");
    expect(audit.before).toBeNull();
    expect(JSON.stringify(audit.after)).not.toContain("scrypt");
    expect((audit.after as Record<string, unknown>).email).toBe("vendedora@exemplo.test");
  });

  it("alteração guarda antes e depois", async () => {
    const admin = await sessionUser("admin@exemplo.test");
    const cashier = await sessionUser("caixa@exemplo.test");
    await updateUser(db, admin, cashier.id, { name: "Operador Renomeado" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.update", entityId: cashier.id } });
    expect((audit.before as Record<string, unknown>).name).toBe("Operador de Caixa Sintético");
    expect((audit.after as Record<string, unknown>).name).toBe("Operador Renomeado");
  });

  it("Admin não consegue se trancar para fora", async () => {
    const admin = await sessionUser("admin@exemplo.test");
    await expect(updateUser(db, admin, admin.id, { active: false })).rejects.toThrow(BusinessRuleError);
  });

  it("auditoria e versões de parâmetro são imutáveis no banco", async () => {
    await expect(db.$executeRawUnsafe(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/imutável/);
    await expect(db.$executeRawUnsafe(`DELETE FROM audit_log`)).rejects.toThrow(/imutável/);
    await expect(db.$executeRawUnsafe(`UPDATE parameter_version SET note = 'x'`)).rejects.toThrow(/imutável/);
  });
});

describe("parâmetros com vigência", () => {
  it("lê o valor inicial da SPEC", async () => {
    const params = new DbParameterReader(db);
    const at = manausInstant("2027-02-10", "15:00");
    expect(await params.get("holding_days", at)).toBe(7);
    expect(await params.get("held_approval_holding_days", at)).toBe(14);
    expect((await params.get("referral_rate_pct", at)).PROFISSIONAL.A).toBe("4.00");
    const snap = await params.snapshot(at);
    expect(snap.referral_monthly_cap_cents.PARCEIRO).toBe(250000);
  });

  it("nova versão vale a partir do início; antes continua a anterior", async () => {
    const admin = await sessionUser("admin@exemplo.test");
    const now = manausInstant("2027-02-01", "09:00");
    await createParameterVersion(
      db,
      admin,
      { key: "holding_days", value: 10, validFrom: manausInstant("2027-03-01"), note: "teste" },
      now,
    );
    const params = new DbParameterReader(db);
    expect(await params.get("holding_days", manausInstant("2027-02-28", "23:59"))).toBe(7);
    expect(await params.get("holding_days", manausInstant("2027-03-01"))).toBe(10);

    const rows = await listParameters(db, now);
    const holding = rows.find((r) => r.key === "holding_days")!;
    expect(holding.current?.value).toBe(7);
    expect(holding.scheduled).toHaveLength(1);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "parameter.new_version" } });
    expect(audit.userId).toBe(admin.id);
    expect((audit.before as Record<string, unknown>).value).toBe(7);
    expect((audit.after as Record<string, unknown>).value).toBe(10);
  });

  it("não aceita vigência no passado, valor inválido nem quem não é Admin", async () => {
    const admin = await sessionUser("admin@exemplo.test");
    const manager = await sessionUser("gerente@exemplo.test");
    const now = manausInstant("2027-02-01", "09:00");
    await expect(
      createParameterVersion(db, admin, { key: "holding_days", value: 10, validFrom: manausInstant("2027-01-31") }, now),
    ).rejects.toThrow(/passado/);
    await expect(
      createParameterVersion(db, admin, { key: "provider_redemption_cap_pct", value: 50.5, validFrom: now }, now),
    ).rejects.toThrow(BusinessRuleError);
    await expect(
      createParameterVersion(db, admin, { key: "retroactive_link_hours", value: 24, validFrom: now }, now),
    ).rejects.toThrow(/desconhecido/);
    await expect(
      createParameterVersion(db, manager, { key: "holding_days", value: 10, validFrom: now }, now),
    ).rejects.toThrow(ForbiddenError);
  });

  it("parâmetros iniciais valem desde o início da vigência do seed", async () => {
    const params = new DbParameterReader(db);
    await expect(params.get("holding_days", new Date(INITIAL_PARAMETERS_VALID_FROM.getTime() - 1))).rejects.toThrow(
      /nenhuma versão vigente/,
    );
  });
});
