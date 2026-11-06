/**
 * Dinheiro sempre em centavos, como inteiro (regra inviolável 1).
 * Percentuais e multiplicações usam aritmética decimal; o arredondamento
 * acontece uma única vez, no ponto que a regra de negócio define.
 */
import DecimalBase from "decimal.js";

export const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

/** Valor monetário em centavos. Sempre inteiro seguro. */
export type Cents = number;

export class MoneyError extends Error {}

export function assertCents(value: number, label = "valor"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} deve ser um inteiro em centavos (recebido: ${value})`);
  }
  return value;
}

/** Percentual como texto decimal, ex.: "4.00", "2.75", "50". Nunca float. */
export type PercentString = string;

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

export function toDecimal(value: string | number | Decimal): Decimal {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`número não inteiro não é aceito em cálculo monetário: ${value}`);
    }
    return new Decimal(value);
  }
  if (typeof value === "string" && !DECIMAL_TEXT.test(value)) {
    throw new MoneyError(`texto decimal inválido: "${value}"`);
  }
  return new Decimal(value);
}

/**
 * Converte um valor decimal com ponto (formato do XML da NF-e, ex.: "1000.00")
 * para centavos. Rejeita mais de 2 casas para não perder centavo em silêncio.
 */
export function centsFromDecimalString(text: string): Cents {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new MoneyError(`valor monetário inválido: "${text}"`);
  }
  return assertCents(new Decimal(trimmed).times(100).toNumber());
}

/** base (centavos) × percentual / 100, sem arredondar. */
export function percentOf(baseCents: Cents, pct: PercentString): Decimal {
  assertCents(baseCents, "base");
  return toDecimal(baseCents).times(toDecimal(pct)).dividedBy(100);
}

/** Arredonda para o centavo, meio para cima (R5.5). */
export function roundHalfUp(value: Decimal): Cents {
  return assertCents(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
}

/** Arredonda para baixo no centavo (R8.2 e boas-vindas). */
export function floorCents(value: Decimal): Cents {
  return assertCents(value.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber());
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total);
}

/** "R$ 1.234,56" — formatação de tela. */
export function formatBRL(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${reais},${centavos}`;
}

/** Converte texto digitado em tela ("1.234,56", "1234,5", "1234") para centavos. */
export function parseBRL(text: string): Cents {
  const cleaned = text.replace(/R\$\s?/i, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`valor inválido: "${text}"`);
  }
  return assertCents(new Decimal(cleaned).times(100).toNumber());
}
