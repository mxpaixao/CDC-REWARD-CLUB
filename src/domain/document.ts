/**
 * CPF e CNPJ (regra inviolável 6): validar dígitos, guardar só o valor
 * normalizado, nunca escrever em log em claro e mascarar em telas de terceiros.
 *
 * CNPJ alfanumérico: a partir de julho de 2026 a Receita emite CNPJs com
 * letras nas 12 primeiras posições (IN RFB 2.229/2024). O cálculo do dígito
 * verificador usa o código ASCII − 48 de cada caractere, o que mantém os CNPJs
 * numéricos válidos como antes. Guardamos o CNPJ em maiúsculas, sem pontuação.
 */

export type DocumentType = "CPF" | "CNPJ";

export interface ParsedDocument {
  type: DocumentType;
  /** Só dígitos (CPF) ou 14 caracteres alfanuméricos em maiúsculas (CNPJ). */
  value: string;
}

export class InvalidDocumentError extends Error {
  constructor(message = "CPF ou CNPJ inválido") {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

/** Remove pontuação e espaços; letras ficam em maiúsculas. */
export function normalizeDocument(input: string): string {
  return input.replace(/[\s.\-/]/g, "").toUpperCase();
}

function allSameChar(value: string): boolean {
  return /^(.)\1*$/.test(value);
}

function cpfCheckDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

export function isValidCpf(input: string): boolean {
  const cpf = normalizeDocument(input);
  if (!/^\d{11}$/.test(cpf) || allSameChar(cpf)) return false;
  return cpfCheckDigit(cpf, 9) === Number(cpf[9]) && cpfCheckDigit(cpf, 10) === Number(cpf[10]);
}

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function cnpjCharValue(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

export function cnpjCheckDigits(base12: string): string {
  const d1Sum = CNPJ_WEIGHTS_1.reduce((acc, w, i) => acc + cnpjCharValue(base12[i]!) * w, 0);
  const r1 = d1Sum % 11;
  const d1 = r1 < 2 ? 0 : 11 - r1;
  const base13 = base12 + String(d1);
  const d2Sum = CNPJ_WEIGHTS_2.reduce((acc, w, i) => acc + cnpjCharValue(base13[i]!) * w, 0);
  const r2 = d2Sum % 11;
  const d2 = r2 < 2 ? 0 : 11 - r2;
  return `${d1}${d2}`;
}

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeDocument(input);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || allSameChar(cnpj)) return false;
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
}

export function cpfCheckDigits(base9: string): string {
  const d1 = cpfCheckDigit(base9 + "00", 9);
  const d2 = cpfCheckDigit(base9 + String(d1) + "0", 10);
  return `${d1}${d2}`;
}

/** Valida e normaliza. Lança InvalidDocumentError se não for CPF nem CNPJ válido. */
export function parseDocument(input: string): ParsedDocument {
  const value = normalizeDocument(input);
  if (value.length === 11 && isValidCpf(value)) return { type: "CPF", value };
  if (value.length === 14 && isValidCnpj(value)) return { type: "CNPJ", value };
  throw new InvalidDocumentError();
}

export function tryParseDocument(input: string): ParsedDocument | null {
  try {
    return parseDocument(input);
  } catch {
    return null;
  }
}

export function parseCpf(input: string): string {
  const value = normalizeDocument(input);
  if (!isValidCpf(value)) throw new InvalidDocumentError("CPF inválido");
  return value;
}

/**
 * Máscara para telas de terceiros e logs.
 * CPF  12345678909     → ***.456.789-**
 * CNPJ 12345678000195  → **.345.678/****-**
 */
export function maskDocument(value: string): string {
  const v = normalizeDocument(value);
  if (v.length === 11) return `***.${v.slice(3, 6)}.${v.slice(6, 9)}-**`;
  if (v.length === 14) return `**.${v.slice(2, 5)}.${v.slice(5, 8)}/****-**`;
  return "***";
}

/** Formatação completa, só para telas do próprio titular ou de uso interno autorizado. */
export function formatDocument(value: string): string {
  const v = normalizeDocument(value);
  if (v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if (v.length === 14) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  return v;
}
