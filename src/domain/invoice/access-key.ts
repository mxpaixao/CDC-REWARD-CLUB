/**
 * Chave de acesso da NF-e e da NFC-e (44 posições).
 *
 *   cUF(2) AAMM(4) CNPJ do emitente(14) modelo(2) série(3) número(9) tpEmis(1) cNF(8) DV(1)
 *
 * DV: módulo 11 com pesos 2 a 9 da direita para a esquerda; resto 0 ou 1 dá DV 0.
 * Com o CNPJ alfanumérico, as 12 primeiras posições do CNPJ podem ter letras; o
 * valor de cada caractere no cálculo é o código ASCII − 48 (igual ao do CNPJ).
 */

export class InvalidAccessKeyError extends Error {}

const KEY_PATTERN = /^\d{6}[0-9A-Z]{12}\d{26}$/;

function charValue(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

export function accessKeyCheckDigit(first43: string): number {
  if (first43.length !== 43) throw new InvalidAccessKeyError("a base da chave precisa ter 43 posições");
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += charValue(first43[i]!) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidAccessKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  return accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

export interface AccessKeyParts {
  uf: string;
  yearMonth: string;
  emitterCnpj: string;
  model: number;
  series: string;
  number: string;
  emissionType: string;
  numericCode: string;
  checkDigit: number;
}

export function parseAccessKey(key: string): AccessKeyParts {
  if (!isValidAccessKey(key)) throw new InvalidAccessKeyError("chave de acesso inválida");
  return {
    uf: key.slice(0, 2),
    yearMonth: key.slice(2, 6),
    emitterCnpj: key.slice(6, 20),
    model: Number(key.slice(20, 22)),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
    emissionType: key.slice(34, 35),
    numericCode: key.slice(35, 43),
    checkDigit: Number(key[43]),
  };
}

export function buildAccessKey(parts: Omit<AccessKeyParts, "checkDigit">): string {
  const base =
    parts.uf.padStart(2, "0") +
    parts.yearMonth +
    parts.emitterCnpj +
    String(parts.model).padStart(2, "0") +
    parts.series.padStart(3, "0") +
    parts.number.padStart(9, "0") +
    parts.emissionType +
    parts.numericCode.padStart(8, "0");
  if (!/^\d{6}[0-9A-Z]{12}\d{25}$/.test(base)) throw new InvalidAccessKeyError("partes da chave em formato inválido");
  return base + String(accessKeyCheckDigit(base));
}
