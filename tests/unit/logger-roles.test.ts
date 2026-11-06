import { afterEach, describe, expect, it } from "vitest";
import { logger, redact, redactText, setLogSink } from "@/infra/log/logger";
import { assertCan, can, ForbiddenError } from "@/domain/auth/roles";
import { createRng, fakeCnpj, fakeCpf } from "@/synthetic/generators";

describe("logs sem CPF ou CNPJ em claro (R13.5)", () => {
  afterEach(() => setLogSink((line) => process.stdout.write(line + "\n")));

  it("mascara CPF e CNPJ em qualquer formato", () => {
    const rng = createRng(9);
    const cpf = fakeCpf(rng);
    const cnpj = fakeCnpj(rng);
    const text = `cliente ${cpf} e ${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)} loja ${cnpj}`;
    const out = redactText(text);
    expect(out).not.toContain(cpf);
    expect(out).not.toContain(cnpj);
    expect(out).toContain(`***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`);
  });

  it("preserva a chave de acesso de 44 dígitos", () => {
    const key = "13270212345678000195650010000001231000001234";
    expect(redactText(`nota ${key}`)).toBe(`nota ${key}`);
  });

  it("mascara campos aninhados e oculta segredos", () => {
    const rng = createRng(10);
    const cpf = fakeCpf(rng);
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    logger.info(`vínculo criado para ${cpf}`, { member: { document: cpf }, password: "x", list: [cpf] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(cpf);
    expect(lines[0]).toContain("[oculto]");
    expect(redact({ n: Number(cpf) })).not.toEqual({ n: Number(cpf) });
  });
});

describe("perfis e permissões (SPEC seção 3)", () => {
  it("admin pode tudo", () => {
    expect(can("ADMIN", "parameters.manage")).toBe(true);
    expect(can("ADMIN", "redemption.create")).toBe(true);
  });

  it("gerente de canal aprova e revisa retidos, mas não mexe em parâmetros", () => {
    expect(can("CHANNEL_MANAGER", "provider.approve")).toBe(true);
    expect(can("CHANNEL_MANAGER", "credit.review_held")).toBe(true);
    expect(can("CHANNEL_MANAGER", "parameters.manage")).toBe(false);
    expect(can("CHANNEL_MANAGER", "ledger.adjust")).toBe(false);
  });

  it("operador de caixa vincula e reserva, mas não aprova", () => {
    expect(can("CASHIER", "referral.create")).toBe(true);
    expect(can("CASHIER", "redemption.cancel")).toBe(true);
    expect(can("CASHIER", "provider.approve")).toBe(false);
    expect(() => assertCan("CASHIER", "users.manage")).toThrow(ForbiddenError);
  });
});
