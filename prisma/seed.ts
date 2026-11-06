/** `npm run db:seed` — dados sintéticos para o ambiente local. Nunca dados reais. */
import "dotenv/config";
import { createPrismaClient } from "../src/infra/db/client";
import { seedBase } from "../src/synthetic/seed-base";
import { importCatalogCsv } from "../src/application/imports/catalog-import";
import { syntheticExclusionCsv, syntheticProductsCsv } from "../src/synthetic/catalog-csv";

const password = process.env.SEED_PASSWORD;
if (!password) throw new Error("defina SEED_PASSWORD no .env");

const db = createPrismaClient();
try {
  const { stores, parametersCreated } = await seedBase(db, password);
  console.log(`Base: ${stores.length} lojas sintéticas, ${parametersCreated} parâmetros novos.`);

  // Cadastros auxiliares sintéticos, pelo mesmo importador usado em produção (auditado como o admin sintético).
  const admin = await db.internalUser.findUniqueOrThrow({ where: { email: "admin@exemplo.test" } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role, storeId: admin.storeId };
  const enc = new TextEncoder();
  const products = await importCatalogCsv(db, actor, { type: "PRODUCTS", fileName: "produtos-sinteticos.csv", content: enc.encode(syntheticProductsCsv()) });
  const exclusions = await importCatalogCsv(db, actor, { type: "EXCLUSIONS", fileName: "exclusao-sintetica.csv", content: enc.encode(syntheticExclusionCsv()) });
  console.log(`Produtos: ${products.totals.novas} novos, ${products.totals.semMudanca} sem mudança.`);
  console.log(`Lista de exclusão: ${exclusions.totals.novas} novos, ${exclusions.totals.semMudanca} sem mudança.`);
  console.log("Usuários: admin@exemplo.test, gerente@exemplo.test, caixa@exemplo.test (senha = SEED_PASSWORD).");
} finally {
  await db.$disconnect();
}
