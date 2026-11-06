import { describe, expect, it } from "vitest";
import {
  BusinessTimeError,
  addBusinessDays,
  addDaysToInstant,
  businessDateOf,
  businessMonthOf,
  businessMonthRange,
  daysBetween,
  isQuarterStart,
  manausInstant,
  parseInstantWithOffset,
} from "@/domain/business-time";

describe("datas de negócio em America/Manaus (regra 5)", () => {
  it("usa a data civil de Manaus, não a de UTC", () => {
    // 23:30 em Manaus de 10/02 já é 11/02 em UTC
    const instant = parseInstantWithOffset("2027-02-10T23:30:00-04:00");
    expect(instant.toISOString()).toBe("2027-02-11T03:30:00.000Z");
    expect(businessDateOf(instant)).toBe("2027-02-10");
  });

  it("converte emissão em outro fuso para a data de Manaus", () => {
    const instant = parseInstantWithOffset("2027-03-01T01:00:00-03:00"); // 00:00 em Manaus
    expect(businessDateOf(instant)).toBe("2027-03-01");
    expect(businessDateOf(parseInstantWithOffset("2027-03-01T00:30:00-03:00"))).toBe("2027-02-28");
  });

  it("exige fuso explícito na data e hora da nota", () => {
    expect(() => parseInstantWithOffset("2027-02-10T10:00:00")).toThrow(BusinessTimeError);
  });

  it("soma dias corridos (carência e validade)", () => {
    expect(addBusinessDays("2027-02-10", 7)).toBe("2027-02-17");
    expect(addBusinessDays("2027-02-25", 7)).toBe("2027-03-04");
    expect(daysBetween("2027-02-10", "2027-02-17")).toBe(7);
  });

  it("janela de 120 dias do vínculo bate com os critérios 7 e 8", () => {
    const start = manausInstant("2027-02-01", "10:00");
    const end = addDaysToInstant(start, 120);
    expect(businessDateOf(end)).toBe("2027-06-01");
    expect(end.getTime() - start.getTime()).toBe(120 * 24 * 3_600_000); // Manaus não tem horário de verão
    expect(businessDateOf(addDaysToInstant(manausInstant("2027-05-01", "09:00"), 120))).toBe("2027-08-29");
  });

  it("mês civil e trimestre", () => {
    expect(businessMonthOf(parseInstantWithOffset("2027-03-31T23:59:00-04:00"))).toBe("2027-03");
    const { start, end } = businessMonthRange(manausInstant("2027-02-15", "12:00"));
    expect(start.toISOString()).toBe("2027-02-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2027-03-01T04:00:00.000Z");
    expect(isQuarterStart("2027-04-01")).toBe(true);
    expect(isQuarterStart("2027-05-01")).toBe(false);
  });
});
