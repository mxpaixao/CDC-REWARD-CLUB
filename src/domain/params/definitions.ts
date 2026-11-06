/**
 * Parâmetros do programa (SPEC seção 4). Todo número de regra vem daqui
 * (regra inviolável 4). Cada chave tem um esquema de validação; o valor inicial
 * é o da SPEC, com as decisões registradas na seção 13.
 *
 * Percentuais são texto decimal ("4.00") para nunca passarem por float.
 */
import { z } from "zod";

export const TIERS = ["PROFISSIONAL", "PARCEIRO", "PARCEIRO_OURO"] as const;
export type Tier = (typeof TIERS)[number];

export const MARGIN_BANDS = ["A", "B", "C", "D"] as const;
export type MarginBand = (typeof MARGIN_BANDS)[number];

const pct = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, "percentual deve ser texto decimal, ex.: \"4.00\"")
  .refine((v) => Number(v) <= 100, "percentual acima de 100");
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();
const ratesByBand = z.object({ A: pct, B: pct, C: pct, D: pct }).strict();

export const parameterSchemas = {
  /** Códigos das lojas cujas notas geram crédito (R5.7). */
  enabled_store_ids: z.array(z.string().min(1)).min(0),
  /** Carência entre a venda e a liberação, em dias (R6.1). */
  holding_days: nonNegativeInt,
  /** Carência mínima, contada da venda, para crédito retido aprovado pelo gerente (decisão 06/11/2026). */
  held_approval_holding_days: nonNegativeInt,
  /** Validade do crédito liberado, em dias (R6.3). */
  provider_credit_validity_days: positiveInt,
  /** Teto de uso do bônus, em % do valor da compra (R8.2). */
  provider_redemption_cap_pct: pct,
  /** Duração do vínculo cliente–prestador, em dias (R3.3). */
  referral_link_days: positiveInt,
  /** Desconto de boas-vindas, em % (R4.1). */
  welcome_discount_pct: pct,
  /** Teto do desconto de boas-vindas, em centavos (R4.1). */
  welcome_discount_cap_cents: cents,
  /** Margem bruta mínima de cada faixa; abaixo de C é D (R5.2). */
  band_min_margin_pct: z.object({ A: pct, B: pct, C: pct }).strict(),
  /** Bônus sobre compras próprias, por faixa (R5.3). */
  own_purchase_rate_pct: ratesByBand,
  /** Bônus sobre compras indicadas, por nível e faixa (R5.4). */
  referral_rate_pct: z.object({ PROFISSIONAL: ratesByBand, PARCEIRO: ratesByBand, PARCEIRO_OURO: ratesByBand }).strict(),
  /** Teto mensal de crédito de indicação por nível, em centavos (R7.1). */
  referral_monthly_cap_cents: z.object({ PROFISSIONAL: cents, PARCEIRO: cents, PARCEIRO_OURO: cents }).strict(),
  /** Volume de 90 dias para cada nível, em centavos. null = ainda não definido: ninguém é promovido (R10.2). */
  tier_threshold_cents: z.object({ PARCEIRO: cents.nullable(), PARCEIRO_OURO: cents.nullable() }).strict(),
  /** Janela do volume para nível, em dias (R10.1). */
  tier_volume_window_days: positiveInt,
  /** Dias sem compra própria e sem venda indicada até inativar (R10.4). */
  inactivity_days: positiveInt,
  /** Prazo até a revalidação anual (R1.6). */
  revalidation_days: positiveInt,
  /** Prazo para revalidar antes da suspensão (R1.6). */
  revalidation_grace_days: nonNegativeInt,
  /** Trocas de prestador no mesmo cliente que geram alerta (R3.6). */
  code_switch_alert: z.object({ switches: positiveInt, window_days: positiveInt }).strict(),
  /** Validade de uma reserva de resgate sem nota (R8.6). */
  hold_expiry_hours: positiveInt,
  /** Tolerância na conciliação de resgate e de boas-vindas, em centavos (R4.3, R8.5). */
  reconciliation_tolerance_cents: cents,
  /** Códigos tPag de venda a prazo: a nota não gera bônus (decisão 06/11/2026). */
  deferred_payment_types: z.array(z.string().regex(/^\d{2}$/)),
  /** Dias antes do vencimento para avisar (R6.6). */
  expiry_notice_days: z.array(positiveInt).min(1),
  /** Janela do saldo "a vencer", em dias (seção 5). */
  expiring_soon_days: positiveInt,
  /** Validade do bônus devolvido por devolução de compra (R9.4, a confirmar). */
  returned_redemption_validity_days: positiveInt,
  /** Validade do código de acesso ao portal, em minutos (seção 3). */
  portal_access_code_ttl_minutes: positiveInt,
  /** Tentativas por código de acesso ao portal (seção 3). */
  portal_access_code_max_attempts: positiveInt,
} as const;

export type ParameterKey = keyof typeof parameterSchemas;
export type ParameterValue<K extends ParameterKey> = z.infer<(typeof parameterSchemas)[K]>;
export type ParameterSnapshot = { [K in ParameterKey]: ParameterValue<K> };

export const PARAMETER_KEYS = Object.keys(parameterSchemas) as ParameterKey[];

export function isParameterKey(key: string): key is ParameterKey {
  return Object.prototype.hasOwnProperty.call(parameterSchemas, key);
}

export class InvalidParameterError extends Error {}

export function validateParameter<K extends ParameterKey>(key: K, value: unknown): ParameterValue<K> {
  const result = parameterSchemas[key].safeParse(value);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "valor"}: ${i.message}`).join("; ");
    throw new InvalidParameterError(`parâmetro ${key} inválido — ${detail}`);
  }
  return result.data as ParameterValue<K>;
}

/** Descrições em português, para a tela de parâmetros. */
export const parameterDescriptions: Record<ParameterKey, string> = {
  enabled_store_ids: "Lojas cujas notas geram crédito; as demais entram só nas métricas",
  holding_days: "Carência entre a venda e a liberação do crédito (dias)",
  held_approval_holding_days: "Carência mínima, desde a venda, de crédito retido aprovado (dias)",
  provider_credit_validity_days: "Validade do crédito liberado (dias)",
  provider_redemption_cap_pct: "Teto de uso do bônus, em % do valor da compra",
  referral_link_days: "Duração do vínculo cliente–prestador (dias)",
  welcome_discount_pct: "Desconto na primeira compra com código (%)",
  welcome_discount_cap_cents: "Teto do desconto de boas-vindas (centavos)",
  band_min_margin_pct: "Margem bruta mínima de cada faixa (%)",
  own_purchase_rate_pct: "Bônus sobre compras próprias do prestador, por faixa (%)",
  referral_rate_pct: "Bônus sobre compras indicadas, por nível e faixa (%)",
  referral_monthly_cap_cents: "Teto mensal de crédito de indicação, por nível (centavos)",
  tier_threshold_cents: "Volume de 90 dias para cada nível (centavos); vazio = não definido",
  tier_volume_window_days: "Janela do volume para nível (dias)",
  inactivity_days: "Dias sem compra própria e sem venda indicada até inativar",
  revalidation_days: "Prazo até a revalidação anual (dias)",
  revalidation_grace_days: "Prazo para revalidar antes da suspensão (dias)",
  code_switch_alert: "Trocas de prestador no mesmo cliente que geram alerta",
  hold_expiry_hours: "Validade de uma reserva de resgate sem nota (horas)",
  reconciliation_tolerance_cents: "Tolerância na conciliação (centavos)",
  deferred_payment_types: "Códigos tPag de venda a prazo (nota não gera bônus)",
  expiry_notice_days: "Avisos antes do vencimento de um lote (dias)",
  expiring_soon_days: "Janela do saldo \"a vencer\" (dias)",
  returned_redemption_validity_days: "Validade do bônus devolvido por devolução de compra (dias)",
  portal_access_code_ttl_minutes: "Validade do código de acesso ao portal (minutos)",
  portal_access_code_max_attempts: "Tentativas por código de acesso ao portal",
};

/**
 * Valores iniciais (SPEC seção 4 + decisões de 06/11/2026). A loja piloto
 * ainda não foi definida (questão aberta 4); "L1" é a loja sintética.
 */
export const initialParameterValues: ParameterSnapshot = {
  enabled_store_ids: ["L1"],
  holding_days: 7,
  held_approval_holding_days: 14,
  provider_credit_validity_days: 180,
  provider_redemption_cap_pct: "50",
  referral_link_days: 120,
  welcome_discount_pct: "5",
  welcome_discount_cap_cents: 5000,
  band_min_margin_pct: { A: "35", B: "20", C: "10" },
  own_purchase_rate_pct: { A: "1", B: "1", C: "0", D: "0" },
  referral_rate_pct: {
    PROFISSIONAL: { A: "4.00", B: "2.50", C: "1.00", D: "0" },
    PARCEIRO: { A: "4.50", B: "2.75", C: "1.25", D: "0" },
    PARCEIRO_OURO: { A: "5.00", B: "3.00", C: "1.50", D: "0" },
  },
  referral_monthly_cap_cents: { PROFISSIONAL: 100000, PARCEIRO: 250000, PARCEIRO_OURO: 500000 },
  tier_threshold_cents: { PARCEIRO: null, PARCEIRO_OURO: null },
  tier_volume_window_days: 90,
  inactivity_days: 180,
  revalidation_days: 365,
  revalidation_grace_days: 30,
  code_switch_alert: { switches: 3, window_days: 90 },
  hold_expiry_hours: 24,
  reconciliation_tolerance_cents: 5,
  deferred_payment_types: ["05", "15"],
  expiry_notice_days: [15, 3],
  expiring_soon_days: 15,
  returned_redemption_validity_days: 30,
  portal_access_code_ttl_minutes: 10,
  portal_access_code_max_attempts: 5,
};
