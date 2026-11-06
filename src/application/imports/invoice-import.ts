/**
 * Importação de notas fiscais (etapa 3; SPEC seção 7 e job "Importar notas").
 *
 * - Idempotente pela chave de acesso (regra 3): reimportar não muda nada.
 * - Cada documento é gravado na sua transação; um arquivo ruim não derruba o lote.
 * - Nota de outra empresa, não autorizada, de homologação (em produção) ou
 *   inválida vai para os erros do lote.
 * - Faixa de cada item congelada na importação: margem do produto cadastrado
 *   com `band_min_margin_pct` vigente na emissão (R5.2).
 * - Nota sem cliente identificado: só o cabeçalho, para a métrica de vendas identificadas.
 * - Cancelamento que chega antes da nota fica pendente e é aplicado quando ela chega.
 * - Os ganchos de `InvoiceEventHandler` rodam na transação da nota (motor, etapa 4).
 */
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/infra/db/client";
import { assertCan } from "@/domain/auth/roles";
import { businessMonthOf } from "@/domain/business-time";
import { parseAccessKey } from "@/domain/invoice/access-key";
import { isReturnInvoice, itemBaseCents, type ParsedCancellation, type ParsedInvoice } from "@/domain/invoice/types";
import { bandForItem } from "@/domain/margin-band";
import { logger, redactText } from "@/infra/log/logger";
import type { SalesSource, SourceItem, SourceOutcome } from "@/infra/sales-source/sales-source";
import type { RawDocumentStore } from "@/infra/storage/raw-document-store";
import { DbParameterReader } from "../parameters";
import type { Actor } from "../actor";
import { type InvoiceEventHandler, noopInvoiceEvents } from "../invoice-events";

export interface InvoiceImportOptions {
  /** Aceitar notas de homologação (tpAmb 2). Só em ambiente local e de testes. */
  acceptHomologation: boolean;
  rawStore: RawDocumentStore;
  events?: InvoiceEventHandler;
  now?: () => Date;
}

/** Totais do lote (SPEC seção 7): lidas, novas, repetidas, cancelamentos, devoluções, erros. */
export interface InvoiceImportTotals {
  lidas: number;
  novas: number;
  repetidas: number;
  cancelamentos: number;
  devolucoes: number;
  erros: number;
  /** Notas novas sem cliente identificado (só cabeçalho). */
  semDestinatario: number;
  /** Eventos que não são cancelamento (ex.: carta de correção). */
  ignorados: number;
}

export interface ImportMessage {
  referencia: string;
  mensagem: string;
  nivel: "erro" | "aviso";
}

export interface InvoiceImportResult {
  batchId: string;
  status: "COMPLETED";
  totals: InvoiceImportTotals;
  messages: ImportMessage[];
}

const MAX_MESSAGES = 1000;

interface Ctx {
  db: Db;
  options: InvoiceImportOptions;
  events: InvoiceEventHandler;
  now: () => Date;
  batchId: string;
  storesByCnpj: Map<string, { id: string; code: string }>;
  params: DbParameterReader;
}

type Outcome = { outcome: SourceOutcome; message?: Omit<ImportMessage, "referencia">; counters?: Array<keyof InvoiceImportTotals> };

function emptyTotals(): InvoiceImportTotals {
  return { lidas: 0, novas: 0, repetidas: 0, cancelamentos: 0, devolucoes: 0, erros: 0, semDestinatario: 0, ignorados: 0 };
}

const err = (mensagem: string): Outcome => ({ outcome: "error", message: { mensagem, nivel: "erro" }, counters: ["erros"] });

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function importSales(
  db: Db,
  actor: Actor,
  source: SalesSource,
  options: InvoiceImportOptions,
): Promise<InvoiceImportResult> {
  if (actor.kind === "user") assertCan(actor.user.role, "imports.manage");
  const now = options.now ?? (() => new Date());
  const batch = await db.importBatch.create({
    data: {
      type: "XML",
      fileName: source.name,
      fileSha256: "",
      status: "RUNNING",
      startedAt: now(),
      createdById: actor.kind === "user" ? actor.user.id : null,
    },
  });
  const stores = await db.store.findMany({ select: { id: true, code: true, cnpj: true } });
  const ctx: Ctx = {
    db,
    options,
    events: options.events ?? noopInvoiceEvents,
    now,
    batchId: batch.id,
    storesByCnpj: new Map(stores.map((s) => [s.cnpj, { id: s.id, code: s.code }])),
    params: new DbParameterReader(db),
  };

  const totals = emptyTotals();
  const messages: ImportMessage[] = [];
  let truncated = 0;

  for await (const item of source.items()) {
    totals.lidas++;
    let result: Outcome;
    let retryLater = false;
    try {
      result = await processItem(ctx, item);
    } catch (e) {
      // Falha inesperada (ex.: banco fora): não confirma na origem, para tentar de novo na próxima rodada.
      logger.error("falha ao importar documento", { batchId: batch.id, reference: item.reference, error: e instanceof Error ? e.message : String(e) });
      result = err("falha interna ao gravar; o arquivo continua na entrada para nova tentativa");
      retryLater = true;
    }
    for (const c of result.counters ?? []) totals[c]++;
    if (result.message) {
      if (messages.length < MAX_MESSAGES) messages.push({ referencia: redactText(item.reference), ...result.message });
      else truncated++;
    }
    if (!retryLater) await source.acknowledge(item, result.outcome);
  }
  if (truncated) messages.push({ referencia: "-", mensagem: `mais ${truncated} mensagens omitidas`, nivel: "aviso" });

  await db.importBatch.update({
    where: { id: batch.id },
    data: { status: "COMPLETED", finishedAt: now(), totals: totals as never, errors: messages as never },
  });
  logger.info("importação de notas concluída", { batchId: batch.id, source: source.name, ...totals });
  return { batchId: batch.id, status: "COMPLETED", totals, messages };
}

async function processItem(ctx: Ctx, item: SourceItem): Promise<Outcome> {
  if (item.error || !item.document) return err(item.error ?? "documento ilegível");
  const doc = item.document;
  switch (doc.kind) {
    case "ignored":
      return { outcome: "ignored", counters: ["ignorados"] };
    case "invoice":
      return processInvoice(ctx, item, doc.invoice);
    case "cancellation":
      return processCancellation(ctx, item, doc.cancellation);
  }
}

async function processInvoice(ctx: Ctx, item: SourceItem, inv: ParsedInvoice): Promise<Outcome> {
  if (inv.environment === "HOMOLOGATION" && !ctx.options.acceptHomologation) {
    return err("nota emitida em homologação (sem valor fiscal) — recusada");
  }
  const store = ctx.storesByCnpj.get(inv.emitterCnpj);
  if (!store) return err("emitente não é uma loja cadastrada (nota de outra empresa)");

  const existing = await ctx.db.invoice.findUnique({ where: { accessKey: inv.accessKey }, select: { id: true } });
  if (existing) return { outcome: "repeated", counters: ["repetidas"] };

  const isReturn = isReturnInvoice(inv);
  const storeItems = inv.recipient !== null || isReturn;
  const thresholds = await ctx.params.get("band_min_margin_pct", inv.issuedAt);
  const codes = [...new Set(inv.items.map((i) => i.productCode))];
  const products = storeItems
    ? await ctx.db.product.findMany({ where: { code: { in: codes } }, select: { code: true, marginPct: true } })
    : [];
  const productByCode = new Map(products.map((p) => [p.code, { marginPct: p.marginPct.toString() }]));

  let raw: { path: string; sha256: string } | null = null;
  if (storeItems && item.raw) {
    raw = await ctx.options.rawStore.save({
      month: businessMonthOf(inv.issuedAt),
      name: `${inv.accessKey}.${item.raw.extension}`,
      content: item.raw.content,
    });
  }

  try {
    const created = await ctx.db.$transaction(async (tx) => {
      const pendingCancel = await tx.invoiceCancellation.findUnique({ where: { accessKey: inv.accessKey } });
      const invoice = await tx.invoice.create({
        data: {
          accessKey: inv.accessKey,
          model: inv.model,
          series: inv.series,
          number: inv.number,
          direction: inv.direction,
          purpose: inv.purpose,
          environment: inv.environment,
          issuedAt: inv.issuedAt,
          storeId: store.id,
          recipientDocument: inv.recipient?.value ?? null,
          recipientDocumentType: inv.recipient?.type ?? null,
          totalCents: inv.totalCents,
          discountCents: inv.discountCents,
          paymentTypes: inv.paymentTypes,
          additionalInfo: inv.additionalInfo,
          referencedKeys: inv.referencedKeys,
          itemCount: inv.items.length,
          itemsStored: storeItems,
          // Cancelamento que chegou antes: a nota já nasce cancelada.
          status: pendingCancel ? "CANCELED" : "AUTHORIZED",
          canceledAt: pendingCancel?.eventAt ?? null,
          authorizationStatus: inv.authorization.status,
          authorizationProtocol: inv.authorization.protocol,
          importBatchId: ctx.batchId,
          rawXmlPath: raw?.path ?? null,
          rawSha256: raw?.sha256 ?? null,
          items: storeItems
            ? {
                create: inv.items.map((i) => {
                  const product = productByCode.get(i.productCode);
                  return {
                    itemNumber: i.itemNumber,
                    productCode: i.productCode,
                    description: i.description,
                    cfop: i.cfop,
                    quantity: i.quantity,
                    grossCents: i.grossCents,
                    discountCents: i.discountCents,
                    baseCents: itemBaseCents(i),
                    band: bandForItem(product, thresholds),
                    productFound: product !== undefined,
                  };
                }),
              }
            : undefined,
        },
      });
      if (pendingCancel && !pendingCancel.appliedAt) {
        await tx.invoiceCancellation.update({ where: { id: pendingCancel.id }, data: { appliedAt: ctx.now() } });
      }
      await ctx.events.onInvoiceImported(tx, invoice.id);
      return { invoice, canceledOnArrival: Boolean(pendingCancel) };
    });
    const counters: Array<keyof InvoiceImportTotals> = ["novas"];
    if (isReturn) counters.push("devolucoes");
    if (!inv.recipient) counters.push("semDestinatario");
    return {
      outcome: "imported",
      counters,
      message: created.canceledOnArrival
        ? { mensagem: "nota importada já cancelada (o cancelamento tinha chegado antes)", nivel: "aviso" }
        : undefined,
    };
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: "repeated", counters: ["repetidas"] };
    throw e;
  }
}

async function processCancellation(ctx: Ctx, item: SourceItem, c: ParsedCancellation): Promise<Outcome> {
  if (c.environment === "HOMOLOGATION" && !ctx.options.acceptHomologation) {
    return err("evento emitido em homologação (sem valor fiscal) — recusado");
  }
  if (!ctx.storesByCnpj.has(c.emitterDocument)) return err("autor do cancelamento não é uma loja cadastrada");
  if (parseAccessKey(c.accessKey).emitterCnpj !== c.emitterDocument) {
    return err("autor do cancelamento diferente do emitente da nota");
  }
  const existing = await ctx.db.invoiceCancellation.findUnique({ where: { accessKey: c.accessKey }, select: { id: true } });
  if (existing) return { outcome: "repeated", counters: ["repetidas"] };

  const raw = item.raw
    ? await ctx.options.rawStore.save({
        month: businessMonthOf(c.eventAt),
        name: `${c.accessKey}-cancelamento.${item.raw.extension}`,
        content: item.raw.content,
      })
    : null;

  try {
    const applied = await ctx.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { accessKey: c.accessKey }, select: { id: true, status: true } });
      await tx.invoiceCancellation.create({
        data: {
          accessKey: c.accessKey,
          eventType: c.eventType,
          sequence: c.sequence,
          eventAt: c.eventAt,
          protocol: c.protocol,
          substituteKey: c.substituteKey,
          appliedAt: invoice ? ctx.now() : null,
          importBatchId: ctx.batchId,
          rawXmlPath: raw?.path ?? null,
        },
      });
      if (invoice && invoice.status === "AUTHORIZED") {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELED", canceledAt: c.eventAt } });
        await ctx.events.onInvoiceCanceled(tx, invoice.id);
      }
      return invoice !== null;
    });
    return {
      outcome: "imported",
      counters: ["cancelamentos"],
      message: applied
        ? undefined
        : { mensagem: "cancelamento recebido antes da nota; será aplicado quando a nota chegar", nivel: "aviso" },
    };
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: "repeated", counters: ["repetidas"] };
    throw e;
  }
}
