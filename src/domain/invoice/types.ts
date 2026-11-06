/**
 * Documento de venda já interpretado, independente da origem (SPEC seção 7).
 * O XML da NF-e é uma das formas de chegar aqui; uma futura ShxApiSource entrega
 * o mesmo formato, e o importador e o motor não mudam.
 */
import type { Cents } from "../money";
import type { ParsedDocument } from "../document";

export type InvoiceDirection = "OUT" | "IN";
export type FiscalEnvironment = "PRODUCTION" | "HOMOLOGATION";

/** finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução. */
export const INVOICE_PURPOSE = { NORMAL: 1, COMPLEMENTARY: 2, ADJUSTMENT: 3, RETURN: 4 } as const;

export interface ParsedInvoiceItem {
  itemNumber: number;
  productCode: string;
  description: string;
  cfop: string;
  /** Quantidade comercial (qCom), texto decimal com até 4 casas. */
  quantity: string;
  /** vProd */
  grossCents: Cents;
  /** vDesc (0 quando ausente) */
  discountCents: Cents;
}

export interface ParsedInvoice {
  accessKey: string;
  model: 55 | 65;
  series: string;
  number: string;
  direction: InvoiceDirection;
  purpose: number;
  environment: FiscalEnvironment;
  issuedAt: Date;
  emitterCnpj: string;
  /** null quando o cliente não se identificou. */
  recipient: ParsedDocument | null;
  /** vNF */
  totalCents: Cents;
  /** ICMSTot/vDesc */
  discountCents: Cents;
  /** Códigos tPag de cada detPag. */
  paymentTypes: string[];
  additionalInfo: string | null;
  referencedKeys: string[];
  authorization: { status: number; protocol: string | null };
  items: ParsedInvoiceItem[];
}

/** Eventos de cancelamento: 110111 (cancelamento) e 110112 (cancelamento por substituição, NFC-e). */
export const CANCELLATION_EVENT_TYPES = ["110111", "110112"] as const;
export type CancellationEventType = (typeof CANCELLATION_EVENT_TYPES)[number];

export interface ParsedCancellation {
  accessKey: string;
  eventType: CancellationEventType;
  sequence: number;
  eventAt: Date;
  emitterDocument: string;
  environment: FiscalEnvironment;
  /** cStat do retorno do evento. */
  status: number;
  protocol: string | null;
  /** Chave da NFC-e substituta (110112). */
  substituteKey: string | null;
}

export type SalesDocument =
  | { kind: "invoice"; invoice: ParsedInvoice }
  | { kind: "cancellation"; cancellation: ParsedCancellation }
  | { kind: "ignored"; reason: string };

export class InvalidSalesDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSalesDocumentError";
  }
}

/** Valor base do item (R5.1): vProd − vDesc. Frete, seguro e outras despesas ficam fora. */
export function itemBaseCents(item: Pick<ParsedInvoiceItem, "grossCents" | "discountCents">): Cents {
  return item.grossCents - item.discountCents;
}

export function isReturnInvoice(inv: Pick<ParsedInvoice, "direction" | "purpose">): boolean {
  return inv.direction === "IN" && inv.purpose === INVOICE_PURPOSE.RETURN;
}
