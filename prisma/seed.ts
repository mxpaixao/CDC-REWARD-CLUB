/** `npm run db:seed` — dados sintéticos para o ambiente local. Nunca dados reais. */
import "dotenv/config";
import { createPrismaClient } from "../src/infra/db/client";
import { seedBase } from "../src/synthetic/seed-base";

const password = process.env.SEED_PASSWORD;
if (!password) throw new Error("defina SEED_PASSWORD no .env");

const db = createPrismaClient();
try {
  const { stores, parametersCreated } = await seedBase(db, password);
  console.log(`Seed concluído: ${stores.length} lojas sintéticas, ${parametersCreated} parâmetros novos.`);
  console.log("Usuários: admin@exemplo.test, gerente@exemplo.test, caixa@exemplo.test (senha = SEED_PASSWORD).");
} finally {
  await db.$disconnect();
}
