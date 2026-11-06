import { afterAll } from "vitest";
import { createPrismaClient, type Db } from "@/infra/db/client";

let db: Db | undefined;

/** Cliente do banco de testes, compartilhado no arquivo de teste. */
export function testDb(): Db {
  if (!db) {
    db = createPrismaClient(process.env.TEST_DATABASE_URL);
    afterAll(async () => {
      await db?.$disconnect();
      db = undefined;
    });
  }
  return db;
}

/** Esvazia todas as tabelas (TRUNCATE não dispara os triggers de imutabilidade). */
export async function resetDb(client: Db): Promise<void> {
  const rows = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
