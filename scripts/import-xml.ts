/**
 * Roda a importação de notas manualmente (o job agendado chega na etapa 8).
 *
 *   npm run import:xml -- --usuario admin@exemplo.test                 # lê XML_INBOX_DIR e move para processados/erros
 *   npm run import:xml -- --pasta var/synthetic/xml --manter --usuario admin@exemplo.test
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/infra/db/client";
import { loadConfig } from "../src/infra/config";
import { XmlFolderSource } from "../src/infra/sales-source/xml-sources";
import { LocalRawDocumentStore } from "../src/infra/storage/raw-document-store";
import { importSales } from "../src/application/imports/invoice-import";
import { userActor } from "../src/application/actor";

const config = loadConfig();
const { values } = parseArgs({
  options: {
    pasta: { type: "string", default: config.XML_INBOX_DIR },
    manter: { type: "boolean", default: false },
    usuario: { type: "string" },
  },
});
if (!values.usuario) {
  console.error("uso: --usuario <e-mail do admin> [--pasta <pasta>] [--manter]");
  process.exit(2);
}

const db = createPrismaClient();
try {
  const user = await db.internalUser.findUnique({ where: { email: values.usuario.toLowerCase() } });
  if (!user || !user.active) throw new Error("Usuário não encontrado ou inativo.");
  const result = await importSales(
    db,
    userActor({ id: user.id, name: user.name, email: user.email, role: user.role, storeId: user.storeId }),
    new XmlFolderSource({ inbox: values.pasta, afterImport: values.manter ? "keep" : "move" }),
    { acceptHomologation: config.ACCEPT_HOMOLOGATION_XML, rawStore: new LocalRawDocumentStore(config.RAW_XML_DIR) },
  );
  const t = result.totals;
  console.log(`Lote ${result.batchId}`);
  console.log(`lidas ${t.lidas} · novas ${t.novas} · repetidas ${t.repetidas} · cancelamentos ${t.cancelamentos} · devoluções ${t.devolucoes} · erros ${t.erros} · sem destinatário ${t.semDestinatario} · ignorados ${t.ignorados}`);
  for (const m of result.messages.slice(0, 50)) console.log(`  [${m.nivel}] ${m.referencia}: ${m.mensagem}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
