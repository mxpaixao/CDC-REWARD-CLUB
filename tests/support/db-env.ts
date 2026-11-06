import "dotenv/config";

// Os testes de integração sempre usam o banco de testes.
if (!process.env.TEST_DATABASE_URL) throw new Error("defina TEST_DATABASE_URL");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Logs silenciosos nos testes; use TEST_LOG_LEVEL=debug para depurar.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";
