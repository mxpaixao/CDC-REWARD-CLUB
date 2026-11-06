/**
 * Gera XMLs sintéticos (homologação, sem valor fiscal) de alguns dias de venda
 * nas lojas sintéticas: clientes identificados (personas dos critérios), vendas
 * sem identificação, um cancelamento e uma devolução.
 *
 *   npm run synthetic:xml -- --inicio 2027-02-01 --dias 3 --saida var/inbox
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { addBusinessDays, businessDateOf, manausInstant } from "../src/domain/business-time";
import { acceptancePersonas, createRng, fakeCpf, pick, randomInt, syntheticStores } from "../src/synthetic/generators";
import { syntheticCancellationXml, syntheticInvoiceXml, type SyntheticItem } from "../src/synthetic/nfe-xml";
import { ACCEPTANCE_PRODUCTS } from "../src/synthetic/catalog-csv";

const { values } = parseArgs({
  options: {
    inicio: { type: "string", default: businessDateOf(new Date()) },
    dias: { type: "string", default: "3" },
    saida: { type: "string", default: "var/synthetic/xml" },
    semente: { type: "string", default: "42" },
  },
});

const rng = createRng(Number(values.semente));
const stores = syntheticStores();
const personas = acceptancePersonas();
const identified = [personas.carlos.cpf, personas.bruno.cpf, personas.ana.cpf, ...Array.from({ length: 10 }, () => fakeCpf(rng))];
const catalog = [
  ...ACCEPTANCE_PRODUCTS.map((p) => ({ code: p.code, description: p.description })),
  ...Array.from({ length: 20 }, (_, i) => ({ code: `SINT-${String(i + 1).padStart(5, "0")}`, description: `Item sintético ${i + 1}` })),
  { code: "SEM-CADASTRO-1", description: "Item sem cadastro de margem" },
];

function randomItems(): SyntheticItem[] {
  const n = randomInt(rng, 1, 4);
  return Array.from({ length: n }, () => {
    const p = pick(rng, catalog);
    const qty = randomInt(rng, 1, 10);
    const unit = randomInt(rng, 5, 300) * 100;
    const gross = qty * unit;
    const discount = rng() < 0.2 ? Math.floor(gross * 0.05) : 0;
    return { code: p.code, description: p.description, quantity: String(qty), grossCents: gross, discountCents: discount };
  });
}

await mkdir(values.saida, { recursive: true });
const days = Number(values.dias);
let number = 1;
let files = 0;
const sales: Array<{ key: string; store: string; recipient: string | null; items: SyntheticItem[]; at: Date }> = [];
for (let d = 0; d < days; d++) {
  const date = addBusinessDays(values.inicio, d);
  for (const store of stores) {
    const perDay = store.isPilot ? 25 : 8;
    for (let i = 0; i < perDay; i++) {
      const at = manausInstant(date, `${String(randomInt(rng, 8, 19)).padStart(2, "0")}:${String(randomInt(rng, 0, 59)).padStart(2, "0")}`);
      const recipient = rng() < 0.6 ? pick(rng, identified) : null;
      const items = randomItems();
      const model = rng() < 0.85 ? 65 : 55;
      const payments = [{ type: pick(rng, ["01", "03", "04", "17", "17", "17", "15"]) }];
      const doc = syntheticInvoiceXml({ storeCnpj: store.cnpj, storeName: store.name, model, number: number++, issuedAt: at, recipient: recipient ? { document: recipient } : null, items, payments });
      await writeFile(join(values.saida, doc.fileName), doc.xml);
      files++;
      sales.push({ key: doc.accessKey, store: store.cnpj, recipient, items, at });
    }
  }
}
// Um cancelamento e uma devolução, sobre vendas identificadas
const withRecipient = sales.filter((s) => s.recipient);
const toCancel = withRecipient[0]!;
const cancel = syntheticCancellationXml({ accessKey: toCancel.key, storeCnpj: toCancel.store, eventAt: new Date(toCancel.at.getTime() + 20 * 60_000) });
await writeFile(join(values.saida, cancel.fileName), cancel.xml);
const toReturn = withRecipient[1]!;
const first = toReturn.items[0]!;
const ret = syntheticInvoiceXml({
  storeCnpj: toReturn.store,
  model: 55,
  number: number++,
  issuedAt: new Date(toReturn.at.getTime() + 2 * 86_400_000),
  direction: "IN",
  purpose: 4,
  recipient: { document: toReturn.recipient! },
  referencedKeys: [toReturn.key],
  items: [{ ...first, quantity: "1", grossCents: Math.round(first.grossCents / Number(first.quantity)), discountCents: 0 }],
});
await writeFile(join(values.saida, ret.fileName), ret.xml);
console.log(`${files + 2} XMLs sintéticos (homologação) gravados em ${values.saida}: ${files} vendas, 1 cancelamento, 1 devolução.`);
