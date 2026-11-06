/**
 * Datas de negócio em America/Manaus (regra inviolável 5).
 *
 * Dois tipos de tempo convivem no motor:
 * - instante (Date): emissão da nota, criação de vínculo e de reserva;
 * - data de negócio (BusinessDate, "AAAA-MM-DD" no fuso de Manaus): carência,
 *   validade, mês do teto, trimestre.
 */
import { DateTime } from "luxon";

export const BUSINESS_ZONE = "America/Manaus";

/** Data civil em Manaus, no formato ISO "AAAA-MM-DD". */
export type BusinessDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BusinessTimeError extends Error {}

function zoned(instant: Date): DateTime {
  const dt = DateTime.fromJSDate(instant, { zone: BUSINESS_ZONE });
  if (!dt.isValid) throw new BusinessTimeError(`instante inválido: ${String(instant)}`);
  return dt;
}

function fromBusinessDate(date: BusinessDate): DateTime {
  if (!ISO_DATE.test(date)) throw new BusinessTimeError(`data de negócio inválida: "${date}"`);
  const dt = DateTime.fromISO(date, { zone: BUSINESS_ZONE });
  if (!dt.isValid) throw new BusinessTimeError(`data de negócio inválida: "${date}"`);
  return dt;
}

/** Data civil em Manaus do instante. */
export function businessDateOf(instant: Date): BusinessDate {
  return zoned(instant).toISODate()!;
}

/** Soma dias corridos a uma data de negócio. */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isInteger(days)) throw new BusinessTimeError(`dias deve ser inteiro: ${days}`);
  return fromBusinessDate(date).plus({ days }).toISODate()!;
}

/** Diferença em dias corridos (b − a). */
export function daysBetween(a: BusinessDate, b: BusinessDate): number {
  return Math.round(fromBusinessDate(b).diff(fromBusinessDate(a), "days").days);
}

/** Instante de 00:00 da data em Manaus. */
export function startOfBusinessDay(date: BusinessDate): Date {
  return fromBusinessDate(date).startOf("day").toJSDate();
}

/**
 * Soma dias corridos a um instante, mantendo a hora local de Manaus.
 * Usado no fim do vínculo (início + referral_link_days, fim exclusivo).
 */
export function addDaysToInstant(instant: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new BusinessTimeError(`dias deve ser inteiro: ${days}`);
  return zoned(instant).plus({ days }).toJSDate();
}

export function addHoursToInstant(instant: Date, hours: number): Date {
  if (!Number.isInteger(hours)) throw new BusinessTimeError(`horas deve ser inteiro: ${hours}`);
  return new Date(instant.getTime() + hours * 3_600_000);
}

export function addMinutesToInstant(instant: Date, minutes: number): Date {
  if (!Number.isInteger(minutes)) throw new BusinessTimeError(`minutos deve ser inteiro: ${minutes}`);
  return new Date(instant.getTime() + minutes * 60_000);
}

/** Mês civil em Manaus, "AAAA-MM" (teto mensal, R7.1). */
export function businessMonthOf(instant: Date): string {
  return zoned(instant).toFormat("yyyy-MM");
}

/** Intervalo [início, fim) do mês civil em Manaus que contém o instante. */
export function businessMonthRange(instant: Date): { start: Date; end: Date } {
  const start = zoned(instant).startOf("month");
  return { start: start.toJSDate(), end: start.plus({ months: 1 }).toJSDate() };
}

/** Primeiro dia de trimestre (1º de jan, abr, jul, out) — revisão trimestral R10.3. */
export function isQuarterStart(date: BusinessDate): boolean {
  const dt = fromBusinessDate(date);
  return dt.day === 1 && [1, 4, 7, 10].includes(dt.month);
}

/**
 * Interpreta um instante ISO 8601 com fuso (ex.: dhEmi "2027-02-10T15:30:00-04:00").
 * Exige o fuso explícito para não depender do relógio do servidor.
 */
export function parseInstantWithOffset(text: string): Date {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text.trim())) {
    throw new BusinessTimeError(`data e hora sem fuso: "${text}"`);
  }
  const dt = DateTime.fromISO(text.trim(), { setZone: true });
  if (!dt.isValid) throw new BusinessTimeError(`data e hora inválida: "${text}"`);
  return dt.toJSDate();
}

/** Instante a partir de data e hora locais de Manaus (útil em testes e telas). */
export function manausInstant(date: BusinessDate, time = "00:00"): Date {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) throw new BusinessTimeError(`hora inválida: "${time}"`);
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: BUSINESS_ZONE });
  if (!dt.isValid) throw new BusinessTimeError(`data e hora inválida: ${date} ${time}`);
  return dt.toJSDate();
}

/** "10/02/2027 15:30" em Manaus — formatação de tela. */
export function formatBusinessDateTime(instant: Date): string {
  return zoned(instant).toFormat("dd/MM/yyyy HH:mm");
}

export function formatBusinessDate(date: BusinessDate): string {
  return fromBusinessDate(date).toFormat("dd/MM/yyyy");
}
