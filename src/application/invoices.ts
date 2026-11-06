/** Consultas de notas usadas pelo motor e pelos relatórios. */
import type { DbOrTx } from "@/infra/db/client";

/** Devoluções (NF-e de entrada, finalidade 4) que referenciam a chave da venda (R9.2). */
export async function findReturnsOf(db: DbOrTx, saleAccessKey: string) {
  return db.invoice.findMany({
    where: { referencedKeys: { has: saleAccessKey }, direction: "IN", purpose: 4 },
    include: { items: { orderBy: { itemNumber: "asc" } } },
    orderBy: { issuedAt: "asc" },
  });
}
