/**
 * Etapa 2 — importação por CSV de lojas, produtos com margem e faixa, e lista de exclusão.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../support/db";
import { seedBase } from "@/synthetic/seed-base";
import { importCatalogCsv } from "@/application/imports/catalog-import";
import { findExclusionAt, isExcludedAt } from "@/application/exclusion-list";
import { createParameterVersion } from "@/application/parameters";
import { BusinessRuleError, type SessionUser } from "@/application/actor";
import { ForbiddenError } from "@/domain/auth/roles";
import { formatDocument } from "@/domain/document";
import { manausInstant } from "@/domain/business-time";
import { acceptancePersonas, createRng, fakeCnpj, fakeCpf } from "@/synthetic/generators";
import { syntheticExclusionCsv, syntheticProductsCsv, syntheticStoresCsv } from "@/synthetic/catalog-csv";

const db = testDb();
const enc = (s: string) => new TextEncoder().encode(s);
let admin: SessionUser;
let manager: SessionUser;

async function sessionUser(email: string): Promise<SessionUser> {
  const u = await db.internalUser.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, storeId: u.storeId };
}

beforeEach(async () => {
  await resetDb(db);
  await seedBase(db, "senha-sintetica-123");
  admin = await sessionUser("admin@exemplo.test");
  manager = await sessionUser("gerente@exemplo.test");
});

const PRODUCTS_V1 = "codigo;descricao;categoria;margem_bruta_pct\nP-A;Disjuntor;Elétrica;40\nP-B;Registro;Hidráulica;25\nP-C;Parafuso;Ferragens;15\nP-D;Cimento;Cimento;5\n";

describe("importação de produtos", () => {
  it("cria produtos com a faixa calculada pelo parâmetro e registra o lote", async () => {
    const now = manausInstant("2027-01-04", "08:00");
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "produtos.csv", content: enc(PRODUCTS_V1) }, now);
    expect(r.status).toBe("COMPLETED");
    expect(r.totals).toMatchObject({ lidas: 4, novas: 4, atualizadas: 0, semMudanca: 0, erros: 0 });
    const bands = Object.fromEntries((await db.product.findMany()).map((p) => [p.code, p.band]));
    expect(bands).toEqual({ "P-A": "A", "P-B": "B", "P-C": "C", "P-D": "D" });

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect(batch).toMatchObject({ type: "PRODUCTS", status: "COMPLETED", fileName: "produtos.csv", createdById: admin.id });
    expect(batch.finishedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "product.import_create", userId: admin.id } })).toBe(4);
  });

  it("reimportar o mesmo arquivo não muda nada nem gera auditoria nova", async () => {
    await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "produtos.csv", content: enc(PRODUCTS_V1) });
    const auditsBefore = await db.auditLog.count();
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "produtos.csv", content: enc(PRODUCTS_V1) });
    expect(r.totals).toMatchObject({ novas: 0, atualizadas: 0, semMudanca: 4 });
    expect(await db.auditLog.count()).toBe(auditsBefore);
    expect(await db.importBatch.count()).toBe(2);
  });

  it("mudança de margem atualiza a faixa e audita antes e depois", async () => {
    await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "v1.csv", content: enc(PRODUCTS_V1) });
    const v2 = PRODUCTS_V1.replace("P-C;Parafuso;Ferragens;15", "P-C;Parafuso;Ferragens;21,5");
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "v2.csv", content: enc(v2) });
    expect(r.totals).toMatchObject({ atualizadas: 1, semMudanca: 3 });
    const pc = await db.product.findUniqueOrThrow({ where: { code: "P-C" } });
    expect(pc.band).toBe("B");
    expect(pc.marginPct.toString()).toBe("21.5");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "product.import_update", entityId: pc.id } });
    expect(audit.before).toMatchObject({ marginPct: "15", band: "C" });
    expect(audit.after).toMatchObject({ marginPct: "21.5", band: "B" });
  });

  it("usa a faixa do parâmetro vigente na importação", async () => {
    const now = manausInstant("2027-01-04", "08:00");
    await createParameterVersion(
      db,
      admin,
      { key: "band_min_margin_pct", value: { A: "45", B: "20", C: "10" }, validFrom: manausInstant("2027-02-01") },
      now,
    );
    await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "jan.csv", content: enc(PRODUCTS_V1) }, now);
    expect((await db.product.findUniqueOrThrow({ where: { code: "P-A" } })).band).toBe("A");
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "fev.csv", content: enc(PRODUCTS_V1) }, manausInstant("2027-02-02"));
    expect(r.totals.atualizadas).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { code: "P-A" } })).band).toBe("B");
  });

  it("linhas inválidas vão para os erros e as válidas entram", async () => {
    const csv = PRODUCTS_V1 + "P-X;;Elétrica;30\nP-Y;Fita;Elétrica;muito\n";
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "com-erros.csv", content: enc(csv) });
    expect(r.status).toBe("COMPLETED");
    expect(r.totals).toMatchObject({ lidas: 6, novas: 4, erros: 2 });
    expect(r.errors.map((e) => e.linha)).toEqual([6, 7]);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect(batch.errors).toHaveLength(2);
  });

  it("simulação mostra o que mudaria e não grava nada", async () => {
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "x.csv", content: enc(PRODUCTS_V1), dryRun: true });
    expect(r.status).toBe("SIMULATED");
    expect(r.batchId).toBeNull();
    expect(r.changes).toHaveLength(4);
    expect(await db.product.count()).toBe(0);
    expect(await db.importBatch.count()).toBe(0);
  });

  it("cabeçalho errado falha o lote inteiro com mensagem clara", async () => {
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "errado.csv", content: enc("sku;nome\n1;x\n") });
    expect(r.status).toBe("FAILED");
    expect(r.errors[0]!.mensagem).toMatch(/faltam colunas/);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId! } })).status).toBe("FAILED");
  });

  it("aguenta o arquivo sintético com dezenas de produtos", async () => {
    const r = await importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "sint.csv", content: enc(syntheticProductsCsv(500)) });
    expect(r.totals).toMatchObject({ novas: 504, erros: 0 });
  });

  it("só Admin importa", async () => {
    await expect(
      importCatalogCsv(db, manager, { type: "PRODUCTS", fileName: "x.csv", content: enc(PRODUCTS_V1) }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("importação de lojas", () => {
  it("atualiza as lojas do seed sem duplicar e recusa CNPJ de outra loja", async () => {
    const same = await importCatalogCsv(db, admin, { type: "STORES", fileName: "lojas.csv", content: enc(syntheticStoresCsv()) });
    expect(same.totals).toMatchObject({ lidas: 4, novas: 0, semMudanca: 4 });

    const l1 = await db.store.findUniqueOrThrow({ where: { code: "L1" } });
    const l2 = await db.store.findUniqueOrThrow({ where: { code: "L2" } });
    const newCnpj = fakeCnpj(createRng(77), "0005", l1.cnpj.slice(0, 8));
    const csv = `codigo;nome;cnpj;piloto\nL1;CDC Loja 1 Renomeada;${l1.cnpj};sim\nL5;CDC Loja 5;${formatDocument(newCnpj)};não\nL6;CDC Loja 6;${l2.cnpj};não\n`;
    const r = await importCatalogCsv(db, admin, { type: "STORES", fileName: "lojas2.csv", content: enc(csv) });
    expect(r.totals).toMatchObject({ novas: 1, atualizadas: 1, erros: 1 });
    expect(r.errors[0]).toMatchObject({ linha: 4, mensagem: "CNPJ já pertence à loja L2" });
    expect((await db.store.findUniqueOrThrow({ where: { code: "L1" } })).name).toBe("CDC Loja 1 Renomeada");
    expect(await db.store.count()).toBe(5);
    expect(await db.auditLog.count({ where: { action: "store.import_update" } })).toBe(1);
  });
});

describe("lista de exclusão", () => {
  const personas = acceptancePersonas();

  it("inclui funcionários e B2B e responde se o documento estava na lista numa data", async () => {
    const t0 = manausInstant("2027-01-04", "08:00");
    const r = await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "exclusao.csv", content: enc(syntheticExclusionCsv()) }, t0);
    expect(r.totals).toMatchObject({ novas: 12, erros: 0 });
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-01-05"))).toBe(true);
    expect(await isExcludedAt(db, formatDocument(personas.b2bCustomer.cnpj), manausInstant("2027-01-05"))).toBe(true);
    // antes de entrar na lista
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-01-03"))).toBe(false);
    expect(await isExcludedAt(db, personas.ana.cpf, manausInstant("2027-01-05"))).toBe(false);
    const entry = await findExclusionAt(db, personas.employee.cpf, manausInstant("2027-01-05"));
    expect(entry).toMatchObject({ reason: "EMPLOYEE", source: "RH" });
    // a auditoria não leva o documento para a mensagem do lote
    expect(JSON.stringify(r.changes)).not.toContain(personas.employee.cpf);
  });

  it("modo completo tira da lista só quem é da mesma origem e não veio no arquivo; histórico fica", async () => {
    const t0 = manausInstant("2027-01-04", "08:00");
    await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "inicial.csv", content: enc(syntheticExclusionCsv(0, 0)) }, t0);

    const rng = createRng(99);
    const newEmployee = fakeCpf(rng);
    const t1 = manausInstant("2027-02-01", "08:00");
    // RH manda a lista completa sem a funcionária antiga e com um funcionário novo
    const rh = `documento;motivo\n${formatDocument(newEmployee)};funcionário\n`;
    const r = await importCatalogCsv(
      db,
      admin,
      { type: "EXCLUSIONS", fileName: "rh-fev.csv", content: enc(rh), mode: "completo", source: "RH" },
      t1,
    );
    expect(r.totals).toMatchObject({ novas: 1, removidas: 1 });

    // a funcionária saiu da lista em t1, mas estava nela antes
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-01-20"))).toBe(true);
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-02-02"))).toBe(false);
    // o B2B é de outra origem e continua
    expect(await isExcludedAt(db, personas.b2bCustomer.cnpj, manausInstant("2027-02-02"))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "exclusion.remove" } })).toBe(1);

    // volta para a lista: novo período, o anterior fica intacto
    const t2 = manausInstant("2027-03-01", "08:00");
    const back = `documento;motivo\n${formatDocument(personas.employee.cpf)};funcionário\n${formatDocument(newEmployee)};funcionário\n`;
    await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "rh-mar.csv", content: enc(back), mode: "completo", source: "RH" }, t2);
    expect(await db.exclusionEntry.count({ where: { document: personas.employee.cpf } })).toBe(2);
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-02-15"))).toBe(false);
    expect(await isExcludedAt(db, personas.employee.cpf, manausInstant("2027-03-02"))).toBe(true);
  });

  it("modo incremental nunca remove", async () => {
    await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "a.csv", content: enc(syntheticExclusionCsv(0, 0)) });
    const r = await importCatalogCsv(db, admin, {
      type: "EXCLUSIONS",
      fileName: "b.csv",
      content: enc(`documento;motivo;origem\n${fakeCpf(createRng(3))};outro;manual\n`),
    });
    expect(r.totals).toMatchObject({ novas: 1, removidas: 0 });
    expect(await db.exclusionEntry.count({ where: { removedAt: null } })).toBe(3);
  });

  it("mudança de motivo atualiza o período aberto e é auditada", async () => {
    await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "a.csv", content: enc(syntheticExclusionCsv(0, 0)) });
    const csv = `documento;motivo;origem\n${personas.employee.cpf};outro;RH\n`;
    const r = await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "b.csv", content: enc(csv) });
    expect(r.totals.atualizadas).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "exclusion.update" } });
    expect(audit.before).toMatchObject({ reason: "EMPLOYEE" });
    expect(audit.after).toMatchObject({ reason: "OTHER" });
  });

  it("modo completo exige origem e linhas da mesma origem", async () => {
    const csv = `documento;motivo;origem\n${personas.employee.cpf};funcionário;SHX-B2B\n`;
    await expect(
      importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "x.csv", content: enc(csv), mode: "completo" }),
    ).rejects.toThrow(BusinessRuleError);
    const r = await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "x.csv", content: enc(csv), mode: "completo", source: "RH" });
    expect(r.totals).toMatchObject({ novas: 0, erros: 1 });
    await expect(
      importCatalogCsv(db, admin, { type: "PRODUCTS", fileName: "p.csv", content: enc(PRODUCTS_V1), mode: "completo", source: "RH" }),
    ).rejects.toThrow(/só existe para a lista de exclusão/);
  });

  it("período encerrado não pode ser alterado nem apagado no banco", async () => {
    await importCatalogCsv(db, admin, { type: "EXCLUSIONS", fileName: "a.csv", content: enc(syntheticExclusionCsv(0, 0)) });
    await expect(db.$executeRawUnsafe(`DELETE FROM exclusion_entry`)).rejects.toThrow(/DELETE não é permitido/);
    await db.$executeRawUnsafe(`UPDATE exclusion_entry SET removed_at = now() WHERE source = 'RH'`);
    await expect(db.$executeRawUnsafe(`UPDATE exclusion_entry SET removed_at = NULL WHERE source = 'RH'`)).rejects.toThrow(
      /encerrado/,
    );
  });
});
