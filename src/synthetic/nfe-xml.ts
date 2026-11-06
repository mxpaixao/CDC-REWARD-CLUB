/**
 * Gerador de XMLs sintéticos de NFC-e, NF-e e eventos de cancelamento (SPEC seção 7).
 *
 * Os documentos saem em ambiente de HOMOLOGAÇÃO (tpAmb 2), sem valor fiscal e sem
 * assinatura digital, com chave de acesso e dígitos verificadores válidos. Em
 * produção o importador recusa notas de homologação, então um arquivo sintético
 * nunca se passa por venda real.
 */
import { DateTime } from "luxon";
import { BUSINESS_ZONE } from "@/domain/business-time";
import { buildAccessKey } from "@/domain/invoice/access-key";
import { normalizeDocument } from "@/domain/document";
import type { Cents } from "@/domain/money";

export const HOMOLOGATION_RECIPIENT_NAME = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
const UF_AM = "13";
const MANAUS_IBGE = "1302603";

export interface SyntheticItem {
  code: string;
  description: string;
  /** Quantidade comercial, texto decimal (ex.: "10" ou "2.5"). */
  quantity: string;
  grossCents: Cents;
  discountCents?: Cents;
  cfop?: string;
}

export interface SyntheticPayment {
  /** Código tPag: 01 dinheiro, 03 crédito, 04 débito, 05 crédito loja, 15 boleto, 17 PIX... */
  type: string;
  cents?: Cents;
}

export interface SyntheticInvoiceInput {
  storeCnpj: string;
  storeName?: string;
  model?: 55 | 65;
  series?: number;
  number: number;
  issuedAt: Date;
  /** OUT = saída (venda), IN = entrada (devolução). */
  direction?: "OUT" | "IN";
  /** finNFe: 1 normal, 4 devolução. */
  purpose?: 1 | 2 | 3 | 4;
  recipient?: { document: string } | null;
  items: SyntheticItem[];
  payments?: SyntheticPayment[];
  additionalInfo?: string;
  referencedKeys?: string[];
  environment?: "HOMOLOGATION" | "PRODUCTION";
  authorizationStatus?: number;
  /** Gera a NF-e sem protProt (não autorizada), para testar erro. */
  omitProtocol?: boolean;
}

export interface SyntheticDocument {
  accessKey: string;
  fileName: string;
  xml: string;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function centsToXml(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function xmlDateTime(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: BUSINESS_ZONE }).toISO({ suppressMilliseconds: true, includeOffset: true })!;
}

/** cNF determinístico a partir do número (diferente do nNF, como pede o manual). */
function numericCode(number: number, series: number): string {
  return String((number * 7919 + series * 104729 + 13) % 100_000_000).padStart(8, "0");
}

export function syntheticAccessKey(input: Pick<SyntheticInvoiceInput, "storeCnpj" | "model" | "series" | "number" | "issuedAt">): string {
  const dt = DateTime.fromJSDate(input.issuedAt, { zone: BUSINESS_ZONE });
  const series = input.series ?? 1;
  return buildAccessKey({
    uf: UF_AM,
    yearMonth: dt.toFormat("yyMM"),
    emitterCnpj: normalizeDocument(input.storeCnpj),
    model: input.model ?? 65,
    series: String(series),
    number: String(input.number),
    emissionType: "1",
    numericCode: numericCode(input.number, series),
  });
}

function recipientXml(input: SyntheticInvoiceInput, environment: "HOMOLOGATION" | "PRODUCTION"): string {
  if (!input.recipient) return "";
  const doc = normalizeDocument(input.recipient.document);
  const tag = doc.length === 11 ? "CPF" : "CNPJ";
  const name = environment === "HOMOLOGATION" ? HOMOLOGATION_RECIPIENT_NAME : "CLIENTE SINTETICO";
  return `<dest><${tag}>${doc}</${tag}><xNome>${name}</xNome><indIEDest>9</indIEDest></dest>`;
}

export function syntheticInvoiceXml(input: SyntheticInvoiceInput): SyntheticDocument {
  const model = input.model ?? 65;
  const series = input.series ?? 1;
  const environment = input.environment ?? "HOMOLOGATION";
  const direction = input.direction ?? "OUT";
  const purpose = input.purpose ?? (direction === "IN" ? 4 : 1);
  const accessKey = syntheticAccessKey({ ...input, model, series });
  const dhEmi = xmlDateTime(input.issuedAt);
  const cnpj = normalizeDocument(input.storeCnpj);
  const defaultCfop = direction === "IN" ? "1202" : "5102";

  let totalGross = 0;
  let totalDiscount = 0;
  const dets = input.items
    .map((item, idx) => {
      const discount = item.discountCents ?? 0;
      totalGross += item.grossCents;
      totalDiscount += discount;
      return (
        `<det nItem="${idx + 1}"><prod>` +
        `<cProd>${esc(item.code)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(item.description)}</xProd>` +
        `<NCM>73181500</NCM><CFOP>${item.cfop ?? defaultCfop}</CFOP><uCom>UN</uCom><qCom>${item.quantity}</qCom>` +
        `<vUnCom>0.00</vUnCom><vProd>${centsToXml(item.grossCents)}</vProd><cEANTrib>SEM GTIN</cEANTrib>` +
        `<uTrib>UN</uTrib><qTrib>${item.quantity}</qTrib><vUnTrib>0.00</vUnTrib>` +
        (discount ? `<vDesc>${centsToXml(discount)}</vDesc>` : "") +
        `<indTot>1</indTot></prod>` +
        `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>0.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS></imposto>` +
        `</det>`
      );
    })
    .join("");
  const total = totalGross - totalDiscount;
  // Pagamentos: quem não informa valor fica com o restante do total (o último) ou zero.
  const paymentList = input.payments ?? [{ type: "01" }];
  const informed = paymentList.reduce((acc, p) => acc + (p.cents ?? 0), 0);
  const payments = paymentList.map((p, i) => {
    const cents = p.cents ?? (i === paymentList.length - 1 ? total - informed : 0);
    return `<detPag><tPag>${p.type}</tPag><vPag>${centsToXml(cents)}</vPag></detPag>`;
  });
  const refs = (input.referencedKeys ?? []).map((k) => `<NFref><refNFe>${k}</refNFe></NFref>`).join("");
  const tpAmb = environment === "HOMOLOGATION" ? "2" : "1";

  const infNFe =
    `<infNFe Id="NFe${accessKey}" versao="4.00">` +
    `<ide><cUF>${UF_AM}</cUF><cNF>${accessKey.slice(35, 43)}</cNF><natOp>${direction === "IN" ? "DEVOLUCAO DE VENDA" : "VENDA"}</natOp>` +
    `<mod>${model}</mod><serie>${series}</serie><nNF>${input.number}</nNF><dhEmi>${dhEmi}</dhEmi>` +
    `<tpNF>${direction === "OUT" ? 1 : 0}</tpNF><idDest>1</idDest><cMunFG>${MANAUS_IBGE}</cMunFG>` +
    `<tpImp>${model === 65 ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${accessKey[43]}</cDV><tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>${purpose}</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>motor-clube-cdc-sintetico</verProc>` +
    refs +
    `</ide>` +
    `<emit><CNPJ>${cnpj}</CNPJ><xNome>${esc(input.storeName ?? "CASA DAS CORREIAS SINTETICA")}</xNome>` +
    `<enderEmit><xLgr>RUA SINTETICA</xLgr><nro>0</nro><xBairro>CENTRO</xBairro><cMun>${MANAUS_IBGE}</cMun><xMun>MANAUS</xMun><UF>AM</UF><CEP>69000000</CEP></enderEmit>` +
    `<IE>000000000</IE><CRT>3</CRT></emit>` +
    recipientXml(input, environment) +
    dets +
    `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>${centsToXml(totalGross)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>` +
    `<vDesc>${centsToXml(totalDiscount)}</vDesc><vOutro>0.00</vOutro><vNF>${centsToXml(total)}</vNF></ICMSTot></total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    `<pag>${payments.join("")}</pag>` +
    (input.additionalInfo ? `<infAdic><infCpl>${esc(input.additionalInfo)}</infCpl></infAdic>` : "") +
    `</infNFe>`;

  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;
  const status = input.authorizationStatus ?? 100;
  const prot =
    `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>SINTETICO</verAplic><chNFe>${accessKey}</chNFe>` +
    `<dhRecbto>${dhEmi}</dhRecbto><nProt>1${accessKey.slice(-14)}</nProt><digVal>SINTETICO</digVal>` +
    `<cStat>${status}</cStat><xMotivo>${status === 100 ? "Autorizado o uso da NF-e" : "Rejeicao sintetica"}</xMotivo></infProt></protNFe>`;

  const xml = input.omitProtocol
    ? `<?xml version="1.0" encoding="UTF-8"?>${nfe}`
    : `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}${prot}</nfeProc>`;
  return { accessKey, fileName: `${accessKey}-${model === 65 ? "nfce" : "nfe"}.xml`, xml };
}

export interface SyntheticCancellationInput {
  accessKey: string;
  storeCnpj: string;
  eventAt: Date;
  eventType?: "110111" | "110112" | "110110";
  substituteKey?: string;
  environment?: "HOMOLOGATION" | "PRODUCTION";
  status?: number;
}

export function syntheticCancellationXml(input: SyntheticCancellationInput): SyntheticDocument {
  const eventType = input.eventType ?? "110111";
  const tpAmb = (input.environment ?? "HOMOLOGATION") === "HOMOLOGATION" ? "2" : "1";
  const dh = xmlDateTime(input.eventAt);
  const desc =
    eventType === "110111" ? "Cancelamento" : eventType === "110112" ? "Cancelamento por substituicao" : "Carta de Correcao";
  const det =
    eventType === "110110"
      ? `<detEvento versao="1.00"><descEvento>${desc}</descEvento><xCorrecao>CORRECAO SINTETICA</xCorrecao></detEvento>`
      : `<detEvento versao="1.00"><descEvento>${desc}</descEvento>` +
        (eventType === "110112" ? `<cOrgaoAutor>13</cOrgaoAutor><tpAutor>1</tpAutor><verAplic>SINTETICO</verAplic>` : "") +
        `<nProt>1${input.accessKey.slice(-14)}</nProt><xJust>CANCELAMENTO SINTETICO PARA TESTE</xJust>` +
        (eventType === "110112" ? `<chNFeRef>${input.substituteKey ?? ""}</chNFeRef>` : "") +
        `</detEvento>`;
  const id = `ID${eventType}${input.accessKey}01`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<evento versao="1.00"><infEvento Id="${id}"><cOrgao>13</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${normalizeDocument(input.storeCnpj)}</CNPJ>` +
    `<chNFe>${input.accessKey}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>${eventType}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    det +
    `</infEvento></evento>` +
    `<retEvento versao="1.00"><infEvento><tpAmb>${tpAmb}</tpAmb><verAplic>SINTETICO</verAplic><cOrgao>13</cOrgao><cStat>${input.status ?? 135}</cStat>` +
    `<xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${input.accessKey}</chNFe><tpEvento>${eventType}</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento><dhRegEvento>${dh}</dhRegEvento><nProt>2${input.accessKey.slice(-14)}</nProt></infEvento></retEvento>` +
    `</procEventoNFe>`;
  return { accessKey: input.accessKey, fileName: `${input.accessKey}-evento-${eventType}.xml`, xml };
}
