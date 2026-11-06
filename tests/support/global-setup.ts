/**
 * Prepara o banco de testes: apaga e recria o banco de TEST_DATABASE_URL e
 * aplica as migrações. Nunca aponte TEST_DATABASE_URL para um banco com dados.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("defina TEST_DATABASE_URL (veja .env.example)");
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`por segurança, o banco de testes precisa terminar em _test (recebido: ${dbName})`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
