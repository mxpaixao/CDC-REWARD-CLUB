/**
 * Critério 19 — Idempotência: o mesmo XML importado duas vezes → uma nota e um crédito.
 * Etapa 3 fecha a parte da nota. A parte do crédito é verificada na etapa 4,
 * quando o motor se pendura no gancho `onInvoiceImported` (que aqui roda uma vez só).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../support/db";
import { freshDbWithCatalog, recordingEvents } from "../support/fixtures";
import { importSales } from "@/application/imports/invoice-import";
import { jobActor } from "@/application/actor";
import { manausInstant } from "@/domain/business-time";
import { XmlFolderSource } from "@/infra/sales-source/xml-sources";
import { InMemoryRawDocumentStore } from "@/infra/storage/raw-document-store";
import { syntheticInvoiceXml } from "@/synthetic/nfe-xml";
import { acceptancePersonas } from "@/synthetic/generators";

const db = testDb();
let pilotCnpj: string;

beforeEach(async () => {
  pilotCnpj = (await freshDbWithCatalog(db)).pilot.cnpj;
});

describe("Critério 19 — idempotência da importação", () => {
  it("o mesmo XML chega duas vezes na pasta → uma nota, e o motor é acionado uma vez", async () => {
    const { ana } = acceptancePersonas();
    const doc = syntheticInvoiceXml({
      storeCnpj: pilotCnpj,
      number: 19,
      issuedAt: manausInstant("2027-02-10", "11:00"),
      recipient: { document: ana.cpf },
      items: [{ code: "P-A", description: "Produto A", quantity: "1", grossCents: 100000 }],
    });
    const events = recordingEvents();
    const options = { acceptHomologation: true, rawStore: new InMemoryRawDocumentStore(), events: events.handler };
    const inbox = await mkdtemp(join(tmpdir(), "clube-c19-"));
    const source = new XmlFolderSource({ inbox, afterImport: "move" });

    await writeFile(join(inbox, doc.fileName), doc.xml);
    const first = await importSales(db, jobActor("importar-notas"), source, options);
    // o SHX exporta o mesmo arquivo de novo (com outro nome)
    await writeFile(join(inbox, `copia-${doc.fileName}`), doc.xml);
    const second = await importSales(db, jobActor("importar-notas"), source, options);

    expect(first.totals).toMatchObject({ novas: 1, repetidas: 0 });
    expect(second.totals).toMatchObject({ novas: 0, repetidas: 1 });
    expect(await db.invoice.count()).toBe(1);
    expect(events.calls.filter((c) => c.event === "imported")).toHaveLength(1);
  });
});
