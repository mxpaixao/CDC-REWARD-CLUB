/**
 * Importação por CSV dos cadastros auxiliares (etapa 2): lojas, produtos com
 * margem e faixa, lista de exclusão.
 *
 * - Linhas inválidas vão para os erros do lote; as válidas são aplicadas.
 * - Tudo é gravado numa transação: ou o lote inteiro entra, ou nada entra.
 * - Reimportar o mesmo arquivo não muda nada (linhas "sem mudança").
 * - Cada mudança gera auditoria com antes e depois (regra 8).
 * - `dryRun` valida e mostra o que mudaria, sem gravar.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Db, Tx } from "@/infra/db/client";
import { assertCan } from "@/domain/auth/roles";
import { CsvFormatError, decodeCsvBytes, parseCsv } from "@/domain/csv/parse";
import {
  type LineError,
  type ExclusionRecord,
  type ProductRecord,
  type StoreRecord,
  validateExclusionRows,
  validateProductRows,
  validateStoreRows,
} from "@/domain/catalog/rows";
import { bandForMargin } from "@/domain/margin-band";
import { maskDocument } from "@/domain/document";
import { Decimal } from "@/domain/money";
import { logger } from "@/infra/log/logger";
import { DbParameterReader } from "../parameters";
import { type AuditInput, recordAuditMany } from "../audit";
import { type Actor, BusinessRuleError, type SessionUser, userActor } from "../actor";

export type CatalogImportType = "STORES" | "PRODUCTS" | "EXCLUSIONS";
export type ImportMode = "incremental" | "completo";

export interface CatalogImportInput {
  type: CatalogImportType;
  fileName: string;
  content: Uint8Array;
  /** Só para a lista de exclusão: "completo" encerra quem é da mesma origem e não veio no arquivo. */
  mode?: ImportMode;
  /** Origem do lote (lista de exclusão). Obrigatória no modo completo. */
  source?: string;
  dryRun?: boolean;
}

export interface ImportTotals {
  lidas: number;
  novas: number;
  atualizadas: number;
  semMudanca: number;
  removidas: number;
  erros: number;
}

export type ChangeAction = "nova" | "atualizada" | "removida";

export interface ImportChange {
  linha: number | null;
  /** Código da loja ou produto, ou documento mascarado. */
  chave: string;
  acao: ChangeAction;
}

export interface CatalogImportResult {
  batchId: string | null;
  type: CatalogImportType;
  mode: ImportMode;
  dryRun: boolean;
  status: "COMPLETED" | "FAILED" | "SIMULATED";
  totals: ImportTotals;
  errors: LineError[];
  /** Até 500 mudanças, para conferência em tela. */
  changes: ImportChange[];
}

const MAX_CHANGES_LISTED = 500;
const TX_OPTIONS = { timeout: 300_000, maxWait: 10_000 };

interface Plan {
  errors: LineError[];
  changes: ImportChange[];
  unchanged: number;
  apply: (tx: Tx, batchId: string, audits: AuditInput[]) => Promise<void>;
}

function emptyTotals(): ImportTotals {
  return { lidas: 0, novas: 0, atualizadas: 0, semMudanca: 0, removidas: 0, erros: 0 };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeSource(source: string | undefined): string | undefined {
  const s = source?.trim();
  return s ? s : undefined;
}

export async function importCatalogCsv(
  db: Db,
  actor: SessionUser,
  input: CatalogImportInput,
  now: Date = new Date(),
): Promise<CatalogImportResult> {
  assertCan(actor.role, "imports.manage");
  const mode: ImportMode = input.mode ?? "incremental";
  const source = normalizeSource(input.source);
  if (mode === "completo" && input.type !== "EXCLUSIONS") {
    throw new BusinessRuleError("O modo completo só existe para a lista de exclusão.", "INVALID_MODE");
  }
  if (mode === "completo" && !source) {
    throw new BusinessRuleError(
      "No modo completo, informe a origem do lote (ex.: RH, SHX-B2B): só quem é dessa origem e não veio no arquivo sai da lista.",
      "SOURCE_REQUIRED",
    );
  }
  if (source && source.length > 40) throw new BusinessRuleError("Origem longa demais (até 40 caracteres).", "INVALID_SOURCE");

  const totals = emptyTotals();
  const dryRun = Boolean(input.dryRun);
  let plan: Plan;
  let lidas = 0;
  try {
    const table = parseCsv(decodeCsvBytes(input.content));
    lidas = table.rows.length;
    plan = await buildPlan(db, input.type, table, { mode, source, now, actor: userActor(actor) });
  } catch (e) {
    if (!(e instanceof CsvFormatError)) throw e;
    const errors = [{ linha: 1, mensagem: e.message }];
    totals.erros = 1;
    const batchId = dryRun ? null : await saveFailedBatch(db, actor, input, mode, now, totals, errors);
    return { batchId, type: input.type, mode, dryRun, status: dryRun ? "SIMULATED" : "FAILED", totals, errors, changes: [] };
  }

  totals.lidas = lidas;
  totals.erros = plan.errors.length;
  totals.semMudanca = plan.unchanged;
  for (const c of plan.changes) {
    if (c.acao === "nova") totals.novas++;
    else if (c.acao === "atualizada") totals.atualizadas++;
    else totals.removidas++;
  }
  const changes = plan.changes.slice(0, MAX_CHANGES_LISTED);

  if (dryRun) {
    return { batchId: null, type: input.type, mode, dryRun, status: "SIMULATED", totals, errors: plan.errors, changes };
  }

  const batch = await db.importBatch.create({
    data: {
      type: input.type,
      fileName: input.fileName,
      fileSha256: sha256(input.content),
      mode,
      status: "RUNNING",
      startedAt: now,
      createdById: actor.id,
    },
  });

  try {
    await db.$transaction(async (tx) => {
      const audits: AuditInput[] = [];
      await plan.apply(tx, batch.id, audits);
      await recordAuditMany(tx, audits);
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          finishedAt: new Date(),
          totals: totals as never,
          errors: plan.errors as never,
        },
      });
    }, TX_OPTIONS);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("importação de cadastro falhou", { batchId: batch.id, type: input.type, error: message });
    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        totals: { ...totals, novas: 0, atualizadas: 0, removidas: 0 } as never,
        errors: [...plan.errors, { linha: 0, mensagem: "falha ao gravar; nada foi aplicado. Tente de novo ou acione o CPD." }] as never,
      },
    });
    throw e;
  }

  logger.info("importação de cadastro concluída", { batchId: batch.id, type: input.type, ...totals });
  return { batchId: batch.id, type: input.type, mode, dryRun, status: "COMPLETED", totals, errors: plan.errors, changes };
}

async function saveFailedBatch(
  db: Db,
  actor: SessionUser,
  input: CatalogImportInput,
  mode: ImportMode,
  now: Date,
  totals: ImportTotals,
  errors: LineError[],
): Promise<string> {
  const batch = await db.importBatch.create({
    data: {
      type: input.type,
      fileName: input.fileName,
      fileSha256: sha256(input.content),
      mode,
      status: "FAILED",
      startedAt: now,
      finishedAt: now,
      totals: totals as never,
      errors: errors as never,
      createdById: actor.id,
    },
  });
  return batch.id;
}

interface PlanContext {
  mode: ImportMode;
  source: string | undefined;
  now: Date;
  actor: Actor;
}

async function buildPlan(
  db: Db,
  type: CatalogImportType,
  table: ReturnType<typeof parseCsv>,
  ctx: PlanContext,
): Promise<Plan> {
  switch (type) {
    case "STORES":
      return planStores(db, validateStoreRows(table), ctx);
    case "PRODUCTS":
      return planProducts(db, validateProductRows(table), ctx);
    case "EXCLUSIONS":
      return planExclusions(db, validateExclusionRows(table), ctx);
  }
}

// ---------------------------------------------------------------------------
// Lojas
// ---------------------------------------------------------------------------

async function planStores(
  db: Db,
  validated: ReturnType<typeof validateStoreRows>,
  ctx: PlanContext,
): Promise<Plan> {
  const errors = [...validated.errors];
  const existing = await db.store.findMany();
  const byCode = new Map(existing.map((s) => [s.code, s]));
  const byCnpj = new Map(existing.map((s) => [s.cnpj, s]));
  const creates: Array<StoreRecord & { line: number }> = [];
  const updates: Array<{ rec: StoreRecord & { line: number }; before: (typeof existing)[number] }> = [];
  let unchanged = 0;

  for (const rec of validated.records) {
    const owner = byCnpj.get(rec.cnpj);
    if (owner && owner.code !== rec.code) {
      errors.push({ linha: rec.line, mensagem: `CNPJ já pertence à loja ${owner.code}` });
      continue;
    }
    const before = byCode.get(rec.code);
    if (!before) creates.push(rec);
    else if (before.name !== rec.name || before.cnpj !== rec.cnpj || before.isPilot !== rec.isPilot) updates.push({ rec, before });
    else unchanged++;
  }
  errors.sort((a, b) => a.linha - b.linha);

  const changes: ImportChange[] = [
    ...creates.map((r) => ({ linha: r.line, chave: r.code, acao: "nova" as const })),
    ...updates.map((u) => ({ linha: u.rec.line, chave: u.rec.code, acao: "atualizada" as const })),
  ];

  return {
    errors,
    changes,
    unchanged,
    apply: async (tx, batchId, audits) => {
      const reason = `importação de lojas, lote ${batchId}`;
      for (const r of creates) {
        const store = await tx.store.create({ data: { code: r.code, name: r.name, cnpj: r.cnpj, isPilot: r.isPilot } });
        audits.push({ actor: ctx.actor, action: "store.import_create", entity: "store", entityId: store.id, after: store, reason });
      }
      for (const { rec, before } of updates) {
        const after = await tx.store.update({
          where: { id: before.id },
          data: { name: rec.name, cnpj: rec.cnpj, isPilot: rec.isPilot, updatedAt: ctx.now },
        });
        audits.push({ actor: ctx.actor, action: "store.import_update", entity: "store", entityId: before.id, before, after, reason });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

async function planProducts(
  db: Db,
  validated: ReturnType<typeof validateProductRows>,
  ctx: PlanContext,
): Promise<Plan> {
  const thresholds = await new DbParameterReader(db).get("band_min_margin_pct", ctx.now);
  const codes = validated.records.map((r) => r.code);
  const existing = codes.length ? await db.product.findMany({ where: { code: { in: codes } } }) : [];
  const byCode = new Map(existing.map((p) => [p.code, p]));
  type Rec = ProductRecord & { line: number; band: ReturnType<typeof bandForMargin> };
  const creates: Rec[] = [];
  const updates: Array<{ rec: Rec; before: (typeof existing)[number] }> = [];
  let unchanged = 0;

  for (const r of validated.records) {
    const rec: Rec = { ...r, band: bandForMargin(r.marginPct, thresholds) };
    const before = byCode.get(r.code);
    if (!before) {
      creates.push(rec);
      continue;
    }
    const same =
      before.description === rec.description &&
      (before.category ?? null) === rec.category &&
      new Decimal(before.marginPct.toString()).equals(rec.marginPct) &&
      before.band === rec.band;
    if (same) unchanged++;
    else updates.push({ rec, before });
  }

  const changes: ImportChange[] = [
    ...creates.map((r) => ({ linha: r.line, chave: r.code, acao: "nova" as const })),
    ...updates.map((u) => ({ linha: u.rec.line, chave: u.rec.code, acao: "atualizada" as const })),
  ];

  return {
    errors: validated.errors,
    changes,
    unchanged,
    apply: async (tx, batchId, audits) => {
      const reason = `importação de produtos, lote ${batchId}`;
      const actor = ctx.actor;
      const rows = creates.map((r) => ({
        id: randomUUID(),
        code: r.code,
        description: r.description,
        category: r.category,
        marginPct: r.marginPct,
        band: r.band,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        lastImportBatchId: batchId,
      }));
      for (let i = 0; i < rows.length; i += 1000) {
        await tx.product.createMany({ data: rows.slice(i, i + 1000) });
      }
      for (const row of rows) {
        audits.push({ actor, action: "product.import_create", entity: "product", entityId: row.id, after: row, reason });
      }
      for (const { rec, before } of updates) {
        const after = await tx.product.update({
          where: { id: before.id },
          data: {
            description: rec.description,
            category: rec.category,
            marginPct: rec.marginPct,
            band: rec.band,
            updatedAt: ctx.now,
            lastImportBatchId: batchId,
          },
        });
        audits.push({
          actor,
          action: "product.import_update",
          entity: "product",
          entityId: before.id,
          before: { ...before, marginPct: before.marginPct.toString() },
          after: { ...after, marginPct: after.marginPct.toString() },
          reason,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Lista de exclusão
// ---------------------------------------------------------------------------

async function planExclusions(
  db: Db,
  validated: ReturnType<typeof validateExclusionRows>,
  ctx: PlanContext,
): Promise<Plan> {
  const errors = [...validated.errors];
  const batchSource = ctx.source ?? "manual";
  type Rec = ExclusionRecord & { line: number; finalSource: string };
  const records: Rec[] = [];
  for (const r of validated.records) {
    const finalSource = r.source ?? batchSource;
    if (ctx.mode === "completo" && finalSource !== batchSource) {
      errors.push({ linha: r.line, mensagem: `no modo completo, a origem da linha deve ser "${batchSource}"` });
      continue;
    }
    records.push({ ...r, finalSource });
  }
  errors.sort((a, b) => a.linha - b.linha);

  const open = await db.exclusionEntry.findMany({ where: { removedAt: null } });
  const openByDoc = new Map(open.map((e) => [e.document, e]));
  const creates: Rec[] = [];
  const updates: Array<{ rec: Rec; before: (typeof open)[number] }> = [];
  let unchanged = 0;
  for (const rec of records) {
    const before = openByDoc.get(rec.document);
    if (!before) creates.push(rec);
    else if (before.reason !== rec.reason || before.source !== rec.finalSource) updates.push({ rec, before });
    else unchanged++;
  }

  // Modo completo: quem é desta origem, está na lista e não veio no arquivo, sai da lista.
  const inFile = new Set(validated.records.map((r) => r.document));
  const removals =
    ctx.mode === "completo" ? open.filter((e) => e.source === batchSource && !inFile.has(e.document)) : [];

  const changes: ImportChange[] = [
    ...creates.map((r) => ({ linha: r.line, chave: maskDocument(r.document), acao: "nova" as const })),
    ...updates.map((u) => ({ linha: u.rec.line, chave: maskDocument(u.rec.document), acao: "atualizada" as const })),
    ...removals.map((e) => ({ linha: null, chave: maskDocument(e.document), acao: "removida" as const })),
  ];

  return {
    errors,
    changes,
    unchanged,
    apply: async (tx, batchId, audits) => {
      const reason = `importação da lista de exclusão (${ctx.mode}, origem ${batchSource}), lote ${batchId}`;
      const actor = ctx.actor;
      for (const r of creates) {
        const entry = await tx.exclusionEntry.create({
          data: {
            document: r.document,
            documentType: r.documentType,
            reason: r.reason,
            source: r.finalSource,
            addedAt: ctx.now,
            updatedAt: ctx.now,
            lastImportBatchId: batchId,
          },
        });
        audits.push({ actor, action: "exclusion.add", entity: "exclusion_entry", entityId: entry.id, after: entry, reason });
      }
      for (const { rec, before } of updates) {
        const after = await tx.exclusionEntry.update({
          where: { id: before.id },
          data: { reason: rec.reason, source: rec.finalSource, updatedAt: ctx.now, lastImportBatchId: batchId },
        });
        audits.push({ actor, action: "exclusion.update", entity: "exclusion_entry", entityId: before.id, before, after, reason });
      }
      for (const e of removals) {
        const after = await tx.exclusionEntry.update({
          where: { id: e.id },
          data: { removedAt: ctx.now, updatedAt: ctx.now, lastImportBatchId: batchId },
        });
        audits.push({ actor, action: "exclusion.remove", entity: "exclusion_entry", entityId: e.id, before: e, after, reason });
      }
    },
  };
}
