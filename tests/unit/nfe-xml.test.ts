import { describe, expect, it } from "vitest";
import { accessKeyCheckDigit, buildAccessKey, isValidAccessKey, parseAccessKey } from "@/domain/invoice/access-key";
import { InvalidSalesDocumentError, isReturnInvoice, itemBaseCents } from "@/domain/invoice/types";
import { parseSalesXml } from "@/infra/sales-source/nfe-xml";
import { syntheticCancellationXml, syntheticInvoiceXml } from "@/synthetic/nfe-xml";
import { manausInstant } from "@/domain/business-time";
import { acceptancePersonas, createRng, fakeAlphanumericCnpj, syntheticStores } from "@/synthetic/generators";

const store = syntheticStores()[0]!;
const { ana, carlos } = acceptancePersonas();

function invoiceOf(xml: string) {
  const doc = parseSalesXml(xml);
  if (doc.kind !== "invoice") throw new Error("esperava nota");
  return doc.invoice;
}

describe("chave de acesso", () => {
  it("calcula o DV como no exemplo do Manual de Orientação do Contribuinte", () => {
    expect(accessKeyCheckDigit("5206043300991100250655012000000780026730161")).toBe(5);
    expect(isValidAccessKey("52060433009911002506550120000007800267301615")).toBe(true);
    expect(isValidAccessKey("52060433009911002506550120000007800267301614")).toBe(false);
    expect(isValidAccessKey("5206043300991100250655012000000780026730161")).toBe(false);
  });

  it("monta e desmonta a chave, inclusive com CNPJ alfanumérico", () => {
    const cnpj = fakeAlphanumericCnpj(createRng(8));
    const key = buildAccessKey({
      uf: "13",
      yearMonth: "2702",
      emitterCnpj: cnpj,
      model: 65,
      series: "1",
      number: "123",
      emissionType: "1",
      numericCode: "12345678",
    });
    expect(key).toHaveLength(44);
    expect(isValidAccessKey(key)).toBe(true);
    expect(parseAccessKey(key)).toMatchObject({ uf: "13", yearMonth: "2702", emitterCnpj: cnpj, model: 65, number: "000000123" });
  });
});

describe("leitura de XML de NFC-e e NF-e", () => {
  const issuedAt = manausInstant("2027-02-10", "15:30");

  it("lê NFC-e identificada com itens, descontos, pagamentos e observação", () => {
    const { xml, accessKey } = syntheticInvoiceXml({
      storeCnpj: store.cnpj,
      number: 1001,
      issuedAt,
      recipient: { document: ana.cpf },
      items: [
        { code: "P-A", description: "Disjuntor", quantity: "10", grossCents: 100000 },
        { code: "P-C", description: "Parafuso", quantity: "2.5", grossCents: 50000, discountCents: 1000 },
      ],
      payments: [{ type: "17", cents: 100000 }, { type: "03" }],
      additionalInfo: "Clube CDC R7K4M",
    });
    const inv = invoiceOf(xml);
    expect(inv).toMatchObject({
      accessKey,
      model: 65,
      direction: "OUT",
      purpose: 1,
      environment: "HOMOLOGATION",
      emitterCnpj: store.cnpj,
      recipient: { type: "CPF", value: ana.cpf },
      totalCents: 149000,
      discountCents: 1000,
      paymentTypes: ["17", "03"],
      additionalInfo: "Clube CDC R7K4M",
      referencedKeys: [],
      authorization: { status: 100 },
    });
    expect(inv.issuedAt.toISOString()).toBe(issuedAt.toISOString());
    expect(inv.items).toEqual([
      { itemNumber: 1, productCode: "P-A", description: "Disjuntor", cfop: "5102", quantity: "10", grossCents: 100000, discountCents: 0 },
      { itemNumber: 2, productCode: "P-C", description: "Parafuso", cfop: "5102", quantity: "2.5", grossCents: 50000, discountCents: 1000 },
    ]);
    expect(itemBaseCents(inv.items[1]!)).toBe(49000);
  });

  it("critério 4: vProd R$ 100 e vDesc R$ 10 dão base de R$ 90", () => {
    const { xml } = syntheticInvoiceXml({
      storeCnpj: store.cnpj,
      number: 4,
      issuedAt,
      recipient: { document: carlos.cpf },
      items: [{ code: "P-A", description: "Item A", quantity: "1", grossCents: 10000, discountCents: 1000 }],
    });
    expect(itemBaseCents(invoiceOf(xml).items[0]!)).toBe(9000);
  });

  it("nota sem destinatário identificado", () => {
    const { xml } = syntheticInvoiceXml({ storeCnpj: store.cnpj, number: 2, issuedAt, items: [{ code: "X", description: "X", quantity: "1", grossCents: 500 }] });
    expect(invoiceOf(xml).recipient).toBeNull();
  });

  it("NF-e de devolução de entrada com chave referenciada", () => {
    const sale = syntheticInvoiceXml({ storeCnpj: store.cnpj, model: 55, number: 10, issuedAt, recipient: { document: ana.cpf }, items: [{ code: "P-A", description: "A", quantity: "10", grossCents: 100000 }] });
    const ret = syntheticInvoiceXml({
      storeCnpj: store.cnpj,
      model: 55,
      number: 11,
      issuedAt: manausInstant("2027-03-01", "10:00"),
      direction: "IN",
      purpose: 4,
      recipient: { document: ana.cpf },
      referencedKeys: [sale.accessKey],
      items: [{ code: "P-A", description: "A", quantity: "2", grossCents: 20000 }],
    });
    const inv = invoiceOf(ret.xml);
    expect(inv).toMatchObject({ model: 55, direction: "IN", purpose: 4, referencedKeys: [sale.accessKey] });
    expect(isReturnInvoice(inv)).toBe(true);
    expect(inv.items[0]!.cfop).toBe("1202");
  });

  it("lê cancelamento, cancelamento por substituição e ignora carta de correção", () => {
    const sale = syntheticInvoiceXml({ storeCnpj: store.cnpj, number: 20, issuedAt, items: [{ code: "X", description: "X", quantity: "1", grossCents: 500 }] });
    const substitute = syntheticInvoiceXml({ storeCnpj: store.cnpj, number: 21, issuedAt, items: [{ code: "X", description: "X", quantity: "1", grossCents: 500 }] });
    const at = manausInstant("2027-02-12", "09:00");
    const cancel = parseSalesXml(syntheticCancellationXml({ accessKey: sale.accessKey, storeCnpj: store.cnpj, eventAt: at }).xml);
    expect(cancel).toMatchObject({ kind: "cancellation", cancellation: { accessKey: sale.accessKey, eventType: "110111", status: 135, emitterDocument: store.cnpj } });
    const subst = parseSalesXml(
      syntheticCancellationXml({ accessKey: sale.accessKey, storeCnpj: store.cnpj, eventAt: at, eventType: "110112", substituteKey: substitute.accessKey }).xml,
    );
    expect(subst).toMatchObject({ kind: "cancellation", cancellation: { eventType: "110112", substituteKey: substitute.accessKey } });
    const cce = parseSalesXml(syntheticCancellationXml({ accessKey: sale.accessKey, storeCnpj: store.cnpj, eventAt: at, eventType: "110110" }).xml);
    expect(cce.kind).toBe("ignored");
  });
});

describe("XML recusado com mensagem clara", () => {
  const issuedAt = manausInstant("2027-02-10", "15:30");
  const base = { storeCnpj: store.cnpj, number: 30, issuedAt, items: [{ code: "X", description: "X", quantity: "1", grossCents: 500 }] };

  const cases: Array<[string, string, RegExp]> = [
    ["não autorizada", syntheticInvoiceXml({ ...base, authorizationStatus: 110 }).xml, /não autorizada \(cStat 110\)/],
    ["sem protocolo", syntheticInvoiceXml({ ...base, omitProtocol: true }).xml, /sem protocolo/],
    ["mal formado", "<nfeProc><NFe>", /mal formado|não reconhecido|infNFe/],
    ["DOCTYPE", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><nfeProc/>', /DOCTYPE/],
    ["outro documento", "<recibo/>", /não reconhecido/],
  ];
  for (const [label, xml, message] of cases) {
    it(label, () => {
      expect(() => parseSalesXml(xml)).toThrow(InvalidSalesDocumentError);
      expect(() => parseSalesXml(xml)).toThrow(message);
    });
  }

  it("chave adulterada", () => {
    const { xml, accessKey } = syntheticInvoiceXml(base);
    const last = Number(accessKey[43]);
    const tampered = xml.replaceAll(accessKey, accessKey.slice(0, 43) + String((last + 1) % 10));
    expect(() => parseSalesXml(tampered)).toThrow(/chave de acesso inválida/);
  });

  it("valor com mais de duas casas e desconto maior que o item", () => {
    const { xml } = syntheticInvoiceXml(base);
    expect(() => parseSalesXml(xml.replace("<vProd>5.00</vProd>", "<vProd>5.005</vProd>"))).toThrow(/valor inválido em vProd/);
    const withDiscount = syntheticInvoiceXml({ ...base, items: [{ code: "X", description: "X", quantity: "1", grossCents: 500, discountCents: 100 }] }).xml;
    expect(() => parseSalesXml(withDiscount.replace("<vDesc>1.00</vDesc><indTot>", "<vDesc>9.00</vDesc><indTot>"))).toThrow(/desconto maior/);
  });

  it("mensagens não repetem o CPF do destinatário", () => {
    const bad = ana.cpf.slice(0, 10) + String((Number(ana.cpf[10]) + 1) % 10);
    const { xml } = syntheticInvoiceXml({ ...base, recipient: { document: ana.cpf } });
    try {
      parseSalesXml(xml.replace(`<CPF>${ana.cpf}</CPF>`, `<CPF>${bad}</CPF>`));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("documento do destinatário inválido");
    }
  });
});
