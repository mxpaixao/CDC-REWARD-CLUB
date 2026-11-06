/**
 * Relatório "itens sem faixa" (R5.2): itens de nota cujo produto não estava
 * cadastrado na importação — entraram como faixa D. Mostra se o produto foi
 * cadastrado depois (a faixa do item continua D; correção é por ajuste).
 */
import type { DbOrTx } from "@/infra/db/client";

export interface ItemsWithoutBandRow {
  productCode: string;
  description: string;
  occurrences: number;
  invoices: number;
  baseCents: number;
  firstSeen: Date;
  lastSeen: Date;
  /** O produto existe hoje no cadastro (foi cadastrado depois da nota). */
  registeredLater: boolean;
}

export async function itemsWithoutBandReport(
  db: DbOrTx,
  filter: { from: Date; to: Date; storeId?: string },
): Promise<ItemsWithoutBandRow[]> {
  const rows = await db.$queryRaw<
    Array<{
      product_code: string;
      description: string;
      occurrences: bigint;
      invoices: bigint;
      base_cents: bigint;
      first_seen: Date;
      last_seen: Date;
      registered_later: boolean;
    }>
  >`
    SELECT ii.product_code,
           max(ii.description)                AS description,
           count(*)                           AS occurrences,
           count(DISTINCT ii.invoice_id)      AS invoices,
           coalesce(sum(ii.base_cents), 0)    AS base_cents,
           min(i.issued_at)                   AS first_seen,
           max(i.issued_at)                   AS last_seen,
           bool_or(p.id IS NOT NULL)          AS registered_later
      FROM invoice_item ii
      JOIN invoice i ON i.id = ii.invoice_id
      LEFT JOIN product p ON p.code = ii.product_code
     WHERE ii.product_found = false
       AND i.issued_at >= ${filter.from}
       AND i.issued_at < ${filter.to}
       AND (${filter.storeId ?? null}::uuid IS NULL OR i.store_id = ${filter.storeId ?? null}::uuid)
     GROUP BY ii.product_code
     ORDER BY sum(ii.base_cents) DESC, ii.product_code`;
  return rows.map((r) => ({
    productCode: r.product_code,
    description: r.description,
    occurrences: Number(r.occurrences),
    invoices: Number(r.invoices),
    baseCents: Number(r.base_cents),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    registeredLater: r.registered_later,
  }));
}
