/**
 * Etapa 3 — importação de notas: idempotência, faixa congelada, cancelamentos,
 * devoluções, erros do lote, pasta monitorada e relatório de itens sem faixa.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../support/db";
import { freshDbWithCatalog, recordingEvents, sessionUser } from "../support/fixtures";
import { importSales, type InvoiceImportOptions } from "@/application/imports/invoice-import";
import { itemsWithoutBandReport } from "@/application/reports/items-without-band";
import { findReturnsOf } from "@/application/invoices";
import { createParameterVersion } from "@/application/parameters";
import { importCatalogCsv } from "@/application/imports/catalog-import";
import { jobActor, userActor, type SessionUser } from "@/application/actor";
import { ForbiddenError } from "@/domain/auth/roles";
import { manausInstant } from "@/domain/business-time";
import { UploadedXmlSource, XmlFolderSource } from "@/infra/sales-source/xml-sources";
import { InMemoryRawDocumentStore, LocalRawDocumentStore } from "@/infra/storage/raw-document-store";
import { syntheticCancellationXml, syntheticInvoiceXml, type SyntheticInvoiceInput } from "@/synthetic/nfe-xml";
import { acceptancePersonas, createRng, fakeCnpj } from "@/synthetic/generators";

const db = testDb();
const { ana, carlos } = acceptancePersonas();
const enc = (s: string) => new TextEncoder().encode(s);

let admin: SessionUser;
let pilot: { id: string; cnpj: string };
let other: { id: string; cnpj: string };
let rawStore: InMemoryRawDocumentStore;
let options: InvoiceImportOptions;
let events: ReturnType<typeof recordingEvents>;

beforeEach(async () => {
  const setup = await freshDbWithCatalog(db);
  admin = setup.admin;
  pilot = setup.pilot;
  other = setup.other;
  rawStore = new InMemoryRawDocumentStore();
  events = recordingEvents();
  options = { acceptHomologation: true, rawStore, events: events.handler };
});

function sale(overrides: Partial<SyntheticInvoiceInput> = {}) {
  return syntheticInvoiceXml({
    storeCnpj: pilot.cnpj,
    number: 1000,
    issuedAt: manausInstant("2027-02-10", "15:30"),
    recipient: { document: ana.cpf },
    items: [
      { code: "P-A", description: "Produto A", quantity: "10", grossCents: 100000 },
      { code: "P-C", description: "Produto C", quantity: "5", grossCents: 50000, discountCents: 5000 },
      { code: "NAO-CADASTRADO", description: "Sem cadastro", quantity: "1", grossCents: 2000 },
    ],
    ...overrides,
  });
}

const upload = (...docs: Array<{ fileName: string; xml: string }>) =>
  new UploadedXmlSource(docs.map((d) => ({ name: d.fileName, content: enc(d.xml) })));

describe("importação de NFC-e e NF-e", () => {
  it("grava nota identificada com itens, base, faixa congelada e XML bruto", async () => {
    const doc = sale({ payments: [{ type: "17" }], additionalInfo: "obs sintética" });
    const r = await importSales(db, userActor(admin), upload(doc), options);
    expect(r.totals).toMatchObject({ lidas: 1, novas: 1, repetidas: 0, erros: 0 });

    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: doc.accessKey }, include: { items: { orderBy: { itemNumber: "asc" } } } });
    expect(inv).toMatchObject({
      model: 65,
      direction: "OUT",
      purpose: 1,
      storeId: pilot.id,
      recipientDocument: ana.cpf,
      recipientDocumentType: "CPF",
      totalCents: 147000,
      discountCents: 5000,
      paymentTypes: ["17"],
      additionalInfo: "obs sintética",
      status: "AUTHORIZED",
      itemsStored: true,
      itemCount: 3,
      importBatchId: r.batchId,
    });
    expect(inv.items.map((i) => [i.productCode, i.baseCents, i.band, i.productFound, i.quantity.toString()])).toEqual([
      ["P-A", 100000, "A", true, "10"],
      ["P-C", 45000, "C", true, "5"],
      ["NAO-CADASTRADO", 2000, "D", false, "1"],
    ]);
    expect(inv.rawXmlPath).toBe(`2027-02/${doc.accessKey}.xml`);
    expect(rawStore.files.has(inv.rawXmlPath!)).toBe(true);
    expect(events.calls).toEqual([{ event: "imported", invoiceId: inv.id }]);
  });

  it("critério 19 (nota): o mesmo XML importado duas vezes gera uma nota só", async () => {
    const doc = sale();
    await importSales(db, userActor(admin), upload(doc), options);
    const second = await importSales(db, userActor(admin), upload(doc, doc), options);
    expect(second.totals).toMatchObject({ lidas: 2, novas: 0, repetidas: 2 });
    expect(await db.invoice.count({ where: { accessKey: doc.accessKey } })).toBe(1);
    expect(await db.invoiceItem.count()).toBe(3);
    // o gancho do motor rodou uma vez só — é ele que gera o crédito na etapa 4
    expect(events.calls.filter((c) => c.event === "imported")).toHaveLength(1);
  });

  it("nota sem cliente identificado guarda só o cabeçalho, para a métrica", async () => {
    const doc = sale({ recipient: null, number: 2000 });
    const r = await importSales(db, jobActor("importar-notas"), upload(doc), options);
    expect(r.totals).toMatchObject({ novas: 1, semDestinatario: 1 });
    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: doc.accessKey } });
    expect(inv).toMatchObject({ recipientDocument: null, itemsStored: false, itemCount: 3, rawXmlPath: null, totalCents: 147000 });
    expect(await db.invoiceItem.count()).toBe(0);
  });

  it("nota de outra loja CDC entra (métricas, volume e atividade) e de outra empresa vai para os erros", async () => {
    const otherStore = sale({ storeCnpj: other.cnpj, number: 3000 });
    const foreign = sale({ storeCnpj: fakeCnpj(createRng(123)), number: 3001 });
    const r = await importSales(db, userActor(admin), upload(otherStore, foreign), options);
    expect(r.totals).toMatchObject({ lidas: 2, novas: 1, erros: 1 });
    expect(r.messages).toEqual([
      { referencia: foreign.fileName, mensagem: "emitente não é uma loja cadastrada (nota de outra empresa)", nivel: "erro" },
    ]);
    expect((await db.invoice.findUniqueOrThrow({ where: { accessKey: otherStore.accessKey } })).storeId).toBe(other.id);
  });

  it("em produção recusa nota e evento de homologação", async () => {
    const doc = sale();
    const r = await importSales(db, userActor(admin), upload(doc), { ...options, acceptHomologation: false });
    expect(r.totals).toMatchObject({ novas: 0, erros: 1 });
    expect(r.messages[0]!.mensagem).toMatch(/homologação/);
  });

  it("XML inválido, não autorizado ou ilegível vai para os erros sem derrubar o lote", async () => {
    const ok = sale({ number: 4000 });
    const notAuthorized = sale({ number: 4001, authorizationStatus: 302 });
    const r = await importSales(
      db,
      userActor(admin),
      new UploadedXmlSource([
        { name: ok.fileName, content: enc(ok.xml) },
        { name: notAuthorized.fileName, content: enc(notAuthorized.xml) },
        { name: "lixo.xml", content: enc("isto não é xml") },
      ]),
      options,
    );
    expect(r.totals).toMatchObject({ lidas: 3, novas: 1, erros: 2 });
    expect(r.messages.map((m) => m.mensagem)).toEqual([expect.stringMatching(/cStat 302/), expect.stringMatching(/mal formado|não reconhecido/)]);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    expect(batch).toMatchObject({ type: "XML", status: "COMPLETED", fileName: "upload", createdById: admin.id });
    expect(batch.totals).toMatchObject({ lidas: 3, novas: 1, erros: 2 });
  });

  it("faixa usa o parâmetro vigente na emissão da nota", async () => {
    // A partir de 01/03/2027 a faixa A passa a exigir 45%: P-A (40%) vira B
    await createParameterVersion(
      db,
      admin,
      { key: "band_min_margin_pct", value: { A: "45", B: "20", C: "10" }, validFrom: manausInstant("2027-03-01") },
      manausInstant("2027-02-01"),
    );
    const before = sale({ number: 5000, issuedAt: manausInstant("2027-02-28", "23:59") });
    const after = sale({ number: 5001, issuedAt: manausInstant("2027-03-01", "00:01") });
    await importSales(db, userActor(admin), upload(before, after), options);
    const band = async (key: string) =>
      (await db.invoiceItem.findFirstOrThrow({ where: { invoice: { accessKey: key }, productCode: "P-A" } })).band;
    expect(await band(before.accessKey)).toBe("A");
    expect(await band(after.accessKey)).toBe("B");
  });

  it("mudança de margem depois da importação não muda a faixa do item (R5.2)", async () => {
    const doc = sale({ number: 5100 });
    await importSales(db, userActor(admin), upload(doc), options);
    await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "p.csv", content: enc("codigo;descricao;margem_bruta_pct\nP-A;Produto A;5\n") });
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoice: { accessKey: doc.accessKey }, productCode: "P-A" } });
    expect(item.band).toBe("A");
    await expect(db.$executeRawUnsafe(`UPDATE invoice_item SET band = 'D'`)).rejects.toThrow(/imutável/);
  });

  it("só Admin importa manualmente; o job importa como sistema", async () => {
    const manager = await sessionUser(db, "gerente@exemplo.test");
    await expect(importSales(db, userActor(manager), upload(sale()), options)).rejects.toThrow(ForbiddenError);
    const r = await importSales(db, jobActor("importar-notas"), upload(sale()), options);
    expect(r.totals.novas).toBe(1);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId } })).createdById).toBeNull();
  });
});

describe("cancelamentos", () => {
  it("cancelamento depois da nota marca a nota como cancelada e chama o motor uma vez", async () => {
    const doc = sale();
    await importSales(db, userActor(admin), upload(doc), options);
    const cancel = syntheticCancellationXml({ accessKey: doc.accessKey, storeCnpj: pilot.cnpj, eventAt: manausInstant("2027-02-12", "09:00") });
    const r = await importSales(db, userActor(admin), upload(cancel), options);
    expect(r.totals).toMatchObject({ cancelamentos: 1, erros: 0 });
    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: doc.accessKey } });
    expect(inv.status).toBe("CANCELED");
    expect(inv.canceledAt?.toISOString()).toBe(manausInstant("2027-02-12", "09:00").toISOString());
    expect(events.calls.map((c) => c.event)).toEqual(["imported", "canceled"]);

    const again = await importSales(db, userActor(admin), upload(cancel), options);
    expect(again.totals).toMatchObject({ cancelamentos: 0, repetidas: 1 });
    expect(events.calls).toHaveLength(2);
    await expect(db.$executeRawUnsafe(`UPDATE invoice SET status = 'AUTHORIZED'`)).rejects.toThrow(/não volta/);
  });

  it("cancelamento que chega antes da nota fica pendente; a nota nasce cancelada", async () => {
    const doc = sale();
    const cancel = syntheticCancellationXml({ accessKey: doc.accessKey, storeCnpj: pilot.cnpj, eventAt: manausInstant("2027-02-10", "16:00") });
    const first = await importSales(db, userActor(admin), upload(cancel), options);
    expect(first.messages[0]).toMatchObject({ nivel: "aviso", mensagem: expect.stringMatching(/antes da nota/) });
    expect((await db.invoiceCancellation.findUniqueOrThrow({ where: { accessKey: doc.accessKey } })).appliedAt).toBeNull();

    const second = await importSales(db, userActor(admin), upload(doc), options);
    expect(second.messages[0]).toMatchObject({ nivel: "aviso", mensagem: expect.stringMatching(/já cancelada/) });
    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: doc.accessKey } });
    expect(inv.status).toBe("CANCELED");
    expect((await db.invoiceCancellation.findUniqueOrThrow({ where: { accessKey: doc.accessKey } })).appliedAt).not.toBeNull();
    // o motor recebe a nota já cancelada e não gera crédito; nenhum estorno é necessário
    expect(events.calls).toEqual([{ event: "imported", invoiceId: inv.id }]);
  });

  it("cancelamento por substituição (110112) também cancela", async () => {
    const original = sale({ number: 6000 });
    const substitute = sale({ number: 6001 });
    await importSales(db, userActor(admin), upload(original, substitute), options);
    const ev = syntheticCancellationXml({
      accessKey: original.accessKey,
      storeCnpj: pilot.cnpj,
      eventAt: manausInstant("2027-02-10", "15:45"),
      eventType: "110112",
      substituteKey: substitute.accessKey,
    });
    await importSales(db, userActor(admin), upload(ev), options);
    expect((await db.invoice.findUniqueOrThrow({ where: { accessKey: original.accessKey } })).status).toBe("CANCELED");
    expect((await db.invoice.findUniqueOrThrow({ where: { accessKey: substitute.accessKey } })).status).toBe("AUTHORIZED");
    expect((await db.invoiceCancellation.findUniqueOrThrow({ where: { accessKey: original.accessKey } })).substituteKey).toBe(substitute.accessKey);
  });

  it("carta de correção é ignorada e evento de outra empresa vai para os erros", async () => {
    const doc = sale();
    const cce = syntheticCancellationXml({ accessKey: doc.accessKey, storeCnpj: pilot.cnpj, eventAt: new Date(), eventType: "110110" });
    const foreignCnpj = fakeCnpj(createRng(55));
    const foreignSale = sale({ storeCnpj: foreignCnpj, number: 7000 });
    const foreign = syntheticCancellationXml({ accessKey: foreignSale.accessKey, storeCnpj: foreignCnpj, eventAt: new Date() });
    const r = await importSales(db, userActor(admin), upload(cce, foreign), options);
    expect(r.totals).toMatchObject({ ignorados: 1, erros: 1, cancelamentos: 0 });
  });
});

describe("devoluções", () => {
  it("NF-e de entrada com finalidade devolução fica ligada à venda pela chave", async () => {
    const original = sale({ model: 55, number: 8000 });
    const ret = syntheticInvoiceXml({
      storeCnpj: pilot.cnpj,
      model: 55,
      number: 8001,
      issuedAt: manausInstant("2027-03-01", "10:00"),
      direction: "IN",
      purpose: 4,
      recipient: { document: ana.cpf },
      referencedKeys: [original.accessKey],
      items: [{ code: "P-A", description: "Produto A", quantity: "2", grossCents: 20000 }],
    });
    const r = await importSales(db, userActor(admin), upload(original, ret), options);
    expect(r.totals).toMatchObject({ novas: 2, devolucoes: 1 });
    const returns = await findReturnsOf(db, original.accessKey);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ accessKey: ret.accessKey, direction: "IN", purpose: 4 });
    expect(returns[0]!.items.map((i) => [i.productCode, i.quantity.toString(), i.baseCents])).toEqual([["P-A", "2", 20000]]);
  });

  it("devolução sem cliente identificado também guarda os itens (o estorno depende deles)", async () => {
    const original = sale({ number: 8100, recipient: { document: carlos.cpf } });
    const ret = syntheticInvoiceXml({
      storeCnpj: pilot.cnpj,
      model: 55,
      number: 8101,
      issuedAt: manausInstant("2027-03-01", "10:00"),
      direction: "IN",
      purpose: 4,
      recipient: null,
      referencedKeys: [original.accessKey],
      items: [{ code: "P-A", description: "Produto A", quantity: "1", grossCents: 10000 }],
    });
    await importSales(db, userActor(admin), upload(original, ret), options);
    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: ret.accessKey }, include: { items: true } });
    expect(inv.itemsStored).toBe(true);
    expect(inv.items).toHaveLength(1);
  });
});

describe("pasta monitorada e armazenamento restrito", () => {
  it("move cada arquivo para processados ou erros e guarda o XML com permissão restrita", async () => {
    const root = await mkdtemp(join(tmpdir(), "clube-cdc-"));
    const inbox = join(root, "entrada");
    const rawDir = join(root, "xml");
    await mkdir(inbox);
    const doc = sale();
    await writeFile(join(inbox, doc.fileName), doc.xml);
    await writeFile(join(inbox, "quebrado.xml"), "<nfeProc>");
    await writeFile(join(inbox, "leia-me.txt"), "não é xml");
    const today = "2027-02-11";
    const source = new XmlFolderSource({ inbox, afterImport: "move", now: () => manausInstant(today, "10:00") });
    const r = await importSales(db, jobActor("importar-notas"), source, { ...options, rawStore: new LocalRawDocumentStore(rawDir) });
    expect(r.totals).toMatchObject({ lidas: 2, novas: 1, erros: 1 });
    expect((await readdir(inbox)).sort()).toEqual(["erros", "leia-me.txt", "processados"]);
    expect(await readdir(join(inbox, "processados", today))).toEqual([doc.fileName]);
    expect(await readdir(join(inbox, "erros", today))).toEqual(["quebrado.xml"]);

    const inv = await db.invoice.findUniqueOrThrow({ where: { accessKey: doc.accessKey } });
    const fileMode = (await stat(join(rawDir, inv.rawXmlPath!))).mode & 0o777;
    const dirMode = (await stat(join(rawDir, "2027-02"))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);

    // segunda rodada: nada novo na entrada
    const again = await importSales(db, jobActor("importar-notas"), source, options);
    expect(again.totals.lidas).toBe(0);
  });

  it("modo manter deixa os arquivos e a reimportação é idempotente", async () => {
    const inbox = await mkdtemp(join(tmpdir(), "clube-cdc-"));
    const doc = sale();
    await writeFile(join(inbox, doc.fileName), doc.xml);
    const source = new XmlFolderSource({ inbox, afterImport: "keep" });
    await importSales(db, jobActor("importar-notas"), source, options);
    const again = await importSales(db, jobActor("importar-notas"), source, options);
    expect(again.totals).toMatchObject({ lidas: 1, novas: 0, repetidas: 1 });
    expect(await readdir(inbox)).toEqual([doc.fileName]);
  });
});

describe("relatório de itens sem faixa", () => {
  it("lista os produtos sem cadastro por período e indica os cadastrados depois", async () => {
    const a = sale({ number: 9000 });
    const b = sale({
      number: 9001,
      issuedAt: manausInstant("2027-02-11", "10:00"),
      items: [
        { code: "NAO-CADASTRADO", description: "Sem cadastro", quantity: "3", grossCents: 6000 },
        { code: "OUTRO-SEM", description: "Outro sem cadastro", quantity: "1", grossCents: 1000 },
      ],
    });
    const outOfRange = sale({ number: 9002, issuedAt: manausInstant("2027-04-01", "10:00") });
    await importSales(db, userActor(admin), upload(a, b, outOfRange), options);
    await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "p.csv", content: enc("codigo;descricao;margem_bruta_pct\nOUTRO-SEM;Agora cadastrado;30\n") });

    const rows = await itemsWithoutBandReport(db, { from: manausInstant("2027-02-01"), to: manausInstant("2027-03-01") });
    expect(rows.map((r) => [r.productCode, r.occurrences, r.invoices, r.baseCents, r.registeredLater])).toEqual([
      ["NAO-CADASTRADO", 2, 2, 8000, false],
      ["OUTRO-SEM", 1, 1, 1000, true],
    ]);
    const otherStoreRows = await itemsWithoutBandReport(db, { from: manausInstant("2027-02-01"), to: manausInstant("2027-03-01"), storeId: other.id });
    expect(otherStoreRows).toEqual([]);
  });
});
