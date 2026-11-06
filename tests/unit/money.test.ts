import { describe, expect, it } from "vitest";
import {
  MoneyError,
  centsFromDecimalString,
  floorCents,
  formatBRL,
  parseBRL,
  percentOf,
  roundHalfUp,
  sumCents,
  toDecimal,
} from "@/domain/money";

describe("dinheiro em centavos (regra 1)", () => {
  it("converte valores do XML para centavos sem float", () => {
    expect(centsFromDecimalString("1000.00")).toBe(100000);
    expect(centsFromDecimalString("0.1")).toBe(10);
    expect(centsFromDecimalString("19.99")).toBe(1999);
    expect(centsFromDecimalString("0.29")).toBe(29); // 0.29 * 100 em float daria 28.999999999999996
  });

  it("rejeita mais de duas casas decimais em vez de perder centavo", () => {
    expect(() => centsFromDecimalString("10.005")).toThrow(MoneyError);
    expect(() => centsFromDecimalString("abc")).toThrow(MoneyError);
  });

  it("rejeita float em cálculo monetário", () => {
    expect(() => toDecimal(0.1)).toThrow(MoneyError);
    expect(() => sumCents([10, 0.5])).toThrow(MoneyError);
  });

  it("percentual com aritmética decimal", () => {
    // 2,75% de R$ 333,33 = 916,6575 centavos
    expect(percentOf(33333, "2.75").toString()).toBe("916.6575");
  });

  it("arredonda meio para cima uma única vez (R5.5)", () => {
    expect(roundHalfUp(toDecimal("916.5"))).toBe(917);
    expect(roundHalfUp(toDecimal("916.4999"))).toBe(916);
    expect(roundHalfUp(toDecimal("-0.5"))).toBe(-1);
  });

  it("arredonda para baixo no centavo (R8.2)", () => {
    expect(floorCents(toDecimal("16.6665"))).toBe(16);
    expect(floorCents(percentOf(40000, "50"))).toBe(20000);
  });

  it("formata e interpreta reais", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(-800)).toBe("-R$ 8,00");
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 50")).toBe(5000);
    expect(parseBRL("0,5")).toBe(50);
    expect(() => parseBRL("1,234")).toThrow(MoneyError);
  });
});
