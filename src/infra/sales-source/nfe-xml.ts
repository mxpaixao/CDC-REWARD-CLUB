/**
 * Leitura de XML de NF-e (modelo 55) e NFC-e (modelo 65), layout 4.00, e dos
 * eventos de cancelamento (SPEC seção 7). Transforma o XML em `SalesDocument`.
 *
 * Segurança: XML com DOCTYPE ou ENTITY é recusado antes de ler (NF-e nunca tem),
 * o que fecha a porta para expansão de entidades e referências externas.
 * Os valores são lidos como texto, nunca como número de ponto flutuante.
 */
import { XMLParser } from "fast-xml-parser";
import { parseInstantWithOffset } from "@/domain/business-time";
import { centsFromDecimalString, MoneyError } from "@/domain/money";
import { InvalidDocumentError, normalizeDocument, parseDocument, type ParsedDocument } from "@/domain/document";
import { isValidAccessKey, parseAccessKey } from "@/domain/invoice/access-key";
import {
  CANCELLATION_EVENT_TYPES,
  type CancellationEventType,
  type FiscalEnvironment,
  InvalidSalesDocumentError,
  type ParsedCancellation,
  type ParsedInvoice,
  type ParsedInvoiceItem,
  type SalesDocument,
} from "@/domain/invoice/types";

/** cStat de NF-e autorizada: 100 (autorizado o uso) e 150 (autorizado fora de prazo). */
export const AUTHORIZED_STATUSES = [100, 150] as const;
/** cStat de evento registrado: 135 (vinculado à NF-e) e 155 (cancelamento homologado fora de prazo). */
export const EVENT_REGISTERED_STATUSES = [135, 155] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  isArray: (name) => ["det", "detPag", "NFref"].includes(name),
});

type Node = Record<string, unknown>;

function fail(message: string): never {
  throw new InvalidSalesDocumentError(message);
}

function child(node: unknown, name: string): Node | undefined {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as Node)[name];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined;
}

function text(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as Node)[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Node)) return String((v as Node)["#text"]);
  return undefined;
}

function req(node: unknown, path: string): string {
  const parts = path.split("/");
  let cur: unknown = node;
  for (const p of parts.slice(0, -1)) cur = child(cur, p);
  const v = text(cur, parts.at(-1)!);
  if (v === undefined || v === "") fail(`campo obrigatório ausente: ${path}`);
  return v;
}

function opt(node: unknown, path: string): string | undefined {
  const parts = path.split("/");
  let cur: unknown = node;
  for (const p of parts.slice(0, -1)) cur = child(cur, p);
  const v = text(cur, parts.at(-1)!);
  return v === "" ? undefined : v;
}

function money(value: string | undefined, label: string): number {
  if (value === undefined) return 0;
  try {
    return centsFromDecimalString(value);
  } catch (e) {
    if (e instanceof MoneyError) fail(`valor inválido em ${label}`);
    throw e;
  }
}

function instant(value: string, label: string): Date {
  try {
    return parseInstantWithOffset(value);
  } catch {
    fail(`data e hora inválida em ${label}`);
  }
}

function environment(tpAmb: string): FiscalEnvironment {
  if (tpAmb === "1") return "PRODUCTION";
  if (tpAmb === "2") return "HOMOLOGATION";
  fail("tpAmb inválido");
}

function decodeXml(content: Uint8Array | string): string {
  const xml = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XML com DOCTYPE ou ENTITY não é aceito");
  return xml;
}

/** Interpreta um arquivo XML. Lança InvalidSalesDocumentError com mensagem clara (sem CPF/CNPJ). */
export function parseSalesXml(content: Uint8Array | string): SalesDocument {
  const xml = decodeXml(content);
  let root: Node;
  try {
    root = parser.parse(xml, true) as Node;
  } catch {
    fail("XML mal formado");
  }
  if (child(root, "nfeProc")) return { kind: "invoice", invoice: parseNfeProc(child(root, "nfeProc")!) };
  if (child(root, "NFe")) fail("NF-e sem protocolo de autorização (protNFe): exporte o XML autorizado");
  if (child(root, "procEventoNFe")) return parseEvent(child(root, "procEventoNFe")!);
  fail("documento não reconhecido: esperado nfeProc ou procEventoNFe");
}

function parseRecipient(dest: Node | undefined): ParsedDocument | null {
  if (!dest) return null;
  const raw = text(dest, "CPF") ?? text(dest, "CNPJ");
  if (!raw) return null; // idEstrangeiro ou sem documento
  try {
    return parseDocument(raw);
  } catch (e) {
    if (e instanceof InvalidDocumentError) fail("documento do destinatário inválido");
    throw e;
  }
}

function parseNfeProc(proc: Node): ParsedInvoice {
  const nfe = child(proc, "NFe");
  const inf = child(nfe, "infNFe");
  if (!inf) fail("infNFe ausente");
  const prot = child(child(proc, "protNFe"), "infProt");
  if (!prot) fail("NF-e sem protocolo de autorização (protNFe)");

  const id = text(inf, "@_Id") ?? "";
  const keyFromId = id.replace(/^NFe/, "");
  const keyFromProt = text(prot, "chNFe");
  if (!isValidAccessKey(keyFromId)) fail("chave de acesso inválida no atributo Id de infNFe");
  if (keyFromProt && keyFromProt !== keyFromId) fail("chave do protocolo diferente da chave da nota");
  const key = parseAccessKey(keyFromId);

  const status = Number(req(prot, "cStat"));
  if (!AUTHORIZED_STATUSES.includes(status as (typeof AUTHORIZED_STATUSES)[number])) {
    fail(`nota não autorizada (cStat ${status})`);
  }

  const ide = child(inf, "ide");
  const model = Number(req(ide, "mod"));
  if (model !== 55 && model !== 65) fail(`modelo ${model} não suportado (esperado 55 ou 65)`);
  if (model !== key.model) fail("modelo da nota diferente do modelo na chave");

  const emitterRaw = req(inf, "emit/CNPJ");
  const emitterCnpj = normalizeDocument(emitterRaw);
  if (emitterCnpj !== key.emitterCnpj) fail("CNPJ do emitente diferente do CNPJ na chave");

  const tpNF = req(ide, "tpNF");
  if (tpNF !== "0" && tpNF !== "1") fail("tpNF inválido");
  const finNFe = Number(req(ide, "finNFe"));
  if (![1, 2, 3, 4].includes(finNFe)) fail("finNFe inválido");

  const referencedKeys: string[] = [];
  for (const ref of (ide?.NFref as Node[] | undefined) ?? []) {
    const k = text(ref, "refNFe");
    if (k === undefined) continue; // outras referências (NF modelo 1, cupom) não interessam
    if (!isValidAccessKey(k)) fail("chave referenciada (refNFe) inválida");
    referencedKeys.push(k);
  }

  const items: ParsedInvoiceItem[] = [];
  const seen = new Set<number>();
  for (const det of (inf.det as Node[] | undefined) ?? []) {
    const itemNumber = Number(text(det, "@_nItem"));
    if (!Number.isInteger(itemNumber) || itemNumber < 1) fail("nItem inválido");
    if (seen.has(itemNumber)) fail(`nItem ${itemNumber} repetido`);
    seen.add(itemNumber);
    const prod = child(det, "prod");
    const quantity = req(prod, "qCom");
    if (!/^\d{1,11}(\.\d{1,4})?$/.test(quantity)) fail(`qCom inválido no item ${itemNumber}`);
    const grossCents = money(req(prod, "vProd"), `vProd do item ${itemNumber}`);
    const discountCents = money(opt(prod, "vDesc"), `vDesc do item ${itemNumber}`);
    if (discountCents > grossCents) fail(`desconto maior que o valor no item ${itemNumber}`);
    const cfop = req(prod, "CFOP");
    if (!/^\d{4}$/.test(cfop)) fail(`CFOP inválido no item ${itemNumber}`);
    items.push({
      itemNumber,
      productCode: req(prod, "cProd"),
      description: req(prod, "xProd"),
      cfop,
      quantity,
      grossCents,
      discountCents,
    });
  }
  if (items.length === 0) fail("nota sem itens");

  const tot = child(child(inf, "total"), "ICMSTot");
  const paymentTypes = ((child(inf, "pag")?.detPag as Node[] | undefined) ?? []).map((p) => {
    const t = text(p, "tPag");
    if (!t || !/^\d{2}$/.test(t)) fail("tPag inválido");
    return t;
  });

  return {
    accessKey: keyFromId,
    model: model as 55 | 65,
    series: req(ide, "serie"),
    number: req(ide, "nNF"),
    direction: tpNF === "1" ? "OUT" : "IN",
    purpose: finNFe,
    environment: environment(req(ide, "tpAmb")),
    issuedAt: instant(req(ide, "dhEmi"), "ide/dhEmi"),
    emitterCnpj,
    recipient: parseRecipient(child(inf, "dest")),
    totalCents: money(req(tot, "vNF"), "ICMSTot/vNF"),
    discountCents: money(opt(tot, "vDesc"), "ICMSTot/vDesc"),
    paymentTypes,
    additionalInfo: opt(inf, "infAdic/infCpl") ?? null,
    referencedKeys,
    authorization: { status, protocol: opt(prot, "nProt") ?? null },
    items,
  };
}

function parseEvent(proc: Node): SalesDocument {
  const inf = child(child(proc, "evento"), "infEvento");
  if (!inf) fail("evento sem infEvento");
  const eventType = req(inf, "tpEvento");
  if (!CANCELLATION_EVENT_TYPES.includes(eventType as CancellationEventType)) {
    return { kind: "ignored", reason: `evento ${eventType} não é cancelamento` };
  }
  const accessKey = req(inf, "chNFe");
  if (!isValidAccessKey(accessKey)) fail("chave de acesso inválida no evento");
  const ret = child(child(proc, "retEvento"), "infEvento");
  if (!ret) fail("evento sem retorno da SEFAZ (retEvento)");
  const status = Number(req(ret, "cStat"));
  if (!EVENT_REGISTERED_STATUSES.includes(status as (typeof EVENT_REGISTERED_STATUSES)[number])) {
    fail(`evento de cancelamento não registrado (cStat ${status})`);
  }
  const emitter = text(inf, "CNPJ") ?? text(inf, "CPF");
  if (!emitter) fail("evento sem CNPJ do autor");
  const substituteKey = opt(inf, "detEvento/chNFeRef") ?? null;
  if (eventType === "110112" && (!substituteKey || !isValidAccessKey(substituteKey))) {
    fail("cancelamento por substituição sem chave da nota substituta válida");
  }
  const cancellation: ParsedCancellation = {
    accessKey,
    eventType: eventType as CancellationEventType,
    sequence: Number(req(inf, "nSeqEvento")),
    eventAt: instant(req(inf, "dhEvento"), "infEvento/dhEvento"),
    emitterDocument: normalizeDocument(emitter),
    environment: environment(req(inf, "tpAmb")),
    status,
    protocol: opt(ret, "nProt") ?? null,
    substituteKey,
  };
  return { kind: "cancellation", cancellation };
}
