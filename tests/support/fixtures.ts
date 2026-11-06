/** Montagem comum dos testes com banco: seed, usuários e catálogo sintético. */
import type { Db, Tx } from "@/infra/db/client";
import { seedBase } from "@/synthetic/seed-base";
import { importCatalogCsv } from "@/application/imports/catalog-import";
import { ACCEPTANCE_PRODUCTS } from "@/synthetic/catalog-csv";
import type { SessionUser } from "@/application/actor";
import type { InvoiceEventHandler } from "@/application/invoice-events";
import { resetDb } from "./db";

export const TEST_PASSWORD = "senha-sintetica-123";

export async function sessionUser(db: Db, email: string): Promise<SessionUser> {
  const u = await db.internalUser.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, storeId: u.storeId };
}

/** Banco zerado com lojas, usuários, parâmetros e os produtos P-A, P-B, P-C e P-D. */
export async function freshDbWithCatalog(db: Db, now = new Date("2027-01-04T12:00:00Z")) {
  await resetDb(db);
  const { stores } = await seedBase(db, TEST_PASSWORD);
  const admin = await sessionUser(db, "admin@exemplo.test");
  const csv =
    "codigo;descricao;categoria;margem_bruta_pct\n" +
    ACCEPTANCE_PRODUCTS.map((p) => `${p.code};${p.description};${p.category};${p.marginPct}`).join("\n") +
    "\n";
  await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "produtos-teste.csv", content: new TextEncoder().encode(csv) }, now);
  const pilot = stores.find((s) => s.code === "L1")!;
  const other = stores.find((s) => s.code === "L2")!;
  return { admin, pilot, other, stores };
}

/** Gancho de eventos que só registra as chamadas. */
export function recordingEvents() {
  const calls: Array<{ event: "imported" | "canceled"; invoiceId: string }> = [];
  const handler: InvoiceEventHandler = {
    async onInvoiceImported(_tx: Tx, invoiceId: string) {
      calls.push({ event: "imported", invoiceId });
    },
    async onInvoiceCanceled(_tx: Tx, invoiceId: string) {
      calls.push({ event: "canceled", invoiceId });
    },
  };
  return { calls, handler };
}
