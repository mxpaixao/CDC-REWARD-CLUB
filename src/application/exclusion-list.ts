/**
 * Consulta à lista de exclusão numa data e hora (R1.2, R3.2, R5.4, R5.8).
 * Como cada entrada é um período [addedAt, removedAt), uma nota importada com
 * atraso é avaliada pela situação da lista na data de emissão.
 */
import type { DbOrTx } from "@/infra/db/client";
import { normalizeDocument } from "@/domain/document";

export async function findExclusionAt(db: DbOrTx, document: string, at: Date) {
  return db.exclusionEntry.findFirst({
    where: {
      document: normalizeDocument(document),
      addedAt: { lte: at },
      OR: [{ removedAt: null }, { removedAt: { gt: at } }],
    },
  });
}

export async function isExcludedAt(db: DbOrTx, document: string, at: Date): Promise<boolean> {
  return (await findExclusionAt(db, document, at)) !== null;
}
