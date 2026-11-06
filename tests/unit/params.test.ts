import { describe, expect, it } from "vitest";
import {
  InvalidParameterError,
  PARAMETER_KEYS,
  initialParameterValues,
  parameterDescriptions,
  validateParameter,
} from "@/domain/params/definitions";
import { InMemoryParameterReader, ParameterNotFoundError } from "@/domain/params/resolve";
import { manausInstant } from "@/domain/business-time";

const start = manausInstant("2026-01-01");

describe("parâmetros com vigência (SPEC seção 4)", () => {
  it("todos os valores iniciais passam na validação e têm descrição", () => {
    for (const key of PARAMETER_KEYS) {
      expect(() => validateParameter(key, initialParameterValues[key])).not.toThrow();
      expect(parameterDescriptions[key]).toBeTruthy();
    }
  });

  it("valores iniciais seguem a SPEC e as decisões de 06/11/2026", () => {
    expect(initialParameterValues.holding_days).toBe(7);
    expect(initialParameterValues.held_approval_holding_days).toBe(14);
    expect(initialParameterValues.referral_rate_pct.PARCEIRO.B).toBe("2.75");
    expect(initialParameterValues.welcome_discount_cap_cents).toBe(5000);
    expect(initialParameterValues).not.toHaveProperty("retroactive_link_hours");
  });

  it("rejeita percentual como float e valores fora do formato", () => {
    expect(() => validateParameter("provider_redemption_cap_pct", 50)).toThrow(InvalidParameterError);
    expect(() => validateParameter("provider_redemption_cap_pct", "150")).toThrow(InvalidParameterError);
    expect(() => validateParameter("holding_days", 7.5)).toThrow(InvalidParameterError);
    expect(() => validateParameter("deferred_payment_types", ["5"])).toThrow(InvalidParameterError);
  });

  it("cada consulta usa a versão vigente no instante", async () => {
    const params = InMemoryParameterReader.fromSnapshot(initialParameterValues, start);
    params.addVersion("holding_days", 10, manausInstant("2027-03-01"));

    expect(await params.get("holding_days", manausInstant("2027-02-28", "23:59"))).toBe(7);
    expect(await params.get("holding_days", manausInstant("2027-03-01", "00:00"))).toBe(10);
    expect((await params.snapshot(manausInstant("2027-06-01"))).holding_days).toBe(10);
  });

  it("falha se não houver versão vigente", async () => {
    const params = InMemoryParameterReader.fromSnapshot(initialParameterValues, start);
    await expect(params.get("holding_days", manausInstant("2025-12-31"))).rejects.toThrow(ParameterNotFoundError);
  });
});
