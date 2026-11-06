import { describe, expect, it } from "vitest";
import {
  InvalidDocumentError,
  formatDocument,
  isValidCnpj,
  isValidCpf,
  maskDocument,
  normalizeDocument,
  parseDocument,
} from "@/domain/document";
import { createRng, fakeAlphanumericCnpj, fakeCnpj, fakeCpf } from "@/synthetic/generators";

describe("CPF e CNPJ (regra 6)", () => {
  it("valida dígitos de CPF sintéticos e rejeita alterados", () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const cpf = fakeCpf(rng);
      expect(isValidCpf(cpf)).toBe(true);
      const tampered = cpf.slice(0, 10) + String((Number(cpf[10]) + 1) % 10);
      expect(isValidCpf(tampered)).toBe(false);
    }
  });

  it("rejeita CPF com todos os dígitos iguais e tamanhos errados", () => {
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("1234567890")).toBe(false);
  });

  it("valida CNPJ numérico e alfanumérico (IN RFB 2.229/2024)", () => {
    const rng = createRng(2);
    for (let i = 0; i < 100; i++) {
      expect(isValidCnpj(fakeCnpj(rng))).toBe(true);
      expect(isValidCnpj(fakeAlphanumericCnpj(rng))).toBe(true);
    }
    // Exemplo publicado pela Receita para o CNPJ alfanumérico
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
  });

  it("guarda só o valor normalizado", () => {
    expect(normalizeDocument(" 123.456.789-09 ")).toBe("12345678909");
    expect(normalizeDocument("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    const rng = createRng(3);
    const cpf = fakeCpf(rng);
    expect(parseDocument(formatDocument(cpf))).toEqual({ type: "CPF", value: cpf });
    expect(() => parseDocument("123")).toThrow(InvalidDocumentError);
  });

  it("mascara em telas de terceiros", () => {
    expect(maskDocument("12345678909")).toBe("***.456.789-**");
    expect(maskDocument("123.456.789-09")).toBe("***.456.789-**");
    expect(maskDocument("12345678000195")).toBe("**.345.678/****-**");
  });
});
