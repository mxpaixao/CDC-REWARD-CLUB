import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
/** Cliente dentro de uma transação interativa. */
export type Tx = Prisma.TransactionClient;
/** Qualquer um dos dois: os casos de uso aceitam ambos para poder compor transações. */
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL não definida");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const globalForPrisma = globalThis as unknown as { __clubePrisma?: PrismaClient };

/** Cliente compartilhado do processo (app Next.js e worker). */
export function getPrisma(): PrismaClient {
  globalForPrisma.__clubePrisma ??= createPrismaClient();
  return globalForPrisma.__clubePrisma;
}
