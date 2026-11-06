/**
 * Faixa de margem (R5.2): margem ≥ A é A; ≥ B é B; ≥ C é C; abaixo disso, D.
 * Produto sem cadastro é D. Limites vêm do parâmetro band_min_margin_pct.
 */
import { toDecimal } from "./money";
import type { MarginBand, ParameterValue } from "./params/definitions";

export type BandThresholds = ParameterValue<"band_min_margin_pct">;

export function bandForMargin(marginPct: string, thresholds: BandThresholds): MarginBand {
  const margin = toDecimal(marginPct);
  if (margin.greaterThanOrEqualTo(toDecimal(thresholds.A))) return "A";
  if (margin.greaterThanOrEqualTo(toDecimal(thresholds.B))) return "B";
  if (margin.greaterThanOrEqualTo(toDecimal(thresholds.C))) return "C";
  return "D";
}

/** Faixa do item da nota: produto sem cadastro é D (R5.2). */
export function bandForItem(product: { marginPct: string } | null | undefined, thresholds: BandThresholds): MarginBand {
  return product ? bandForMargin(product.marginPct, thresholds) : "D";
}
