/**
 * Importa um CSV de cadastro auxiliar pela linha de comando.
 *
 *   npm run import:csv -- --tipo produtos --arquivo produtos.csv --usuario admin@exemplo.test
 *   npm run import:csv -- --tipo exclusao --arquivo rh.csv --modo completo --origem RH --usuario admin@exemplo.test
 *   (acrescente --simular para só validar e ver o que mudaria)
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/infra/db/client";
import { importCatalogCsv, type CatalogImportType } from "../src/application/imports/catalog-import";
import { BusinessRuleError } from "../src/application/actor";

const TYPES: Record<string, CatalogImportType> = { lojas: "STORES", produtos: "PRODUCTS", exclusao: "EXCLUSIONS" };

const { values } = parseArgs({
  options: {
    tipo: { type: "string" },
    arquivo: { type: "string" },
    usuario: { type: "string" },
    modo: { type: "string", default: "incremental" },
    origem: { type: "string" },
    simular: { type: "boolean", default: false },
  },
});

const type = TYPES[values.tipo ?? ""];
if (!type || !values.arquivo || !values.usuario) {
  console.error("uso: --tipo lojas|produtos|exclusao --arquivo <arquivo.csv> --usuario <e-mail do admin> [--modo incremental|completo] [--origem RH] [--simular]");
  process.exit(2);
}
if (values.modo !== "incremental" && values.modo !== "completo") {
  console.error("--modo deve ser incremental ou completo");
  process.exit(2);
}

const db = createPrismaClient();
try {
  const user = await db.internalUser.findUnique({ where: { email: values.usuario.toLowerCase() } });
  if (!user || !user.active) throw new BusinessRuleError("Usuário não encontrado ou inativo.", "USER");
  const content = await readFile(values.arquivo);
  const result = await importCatalogCsv(
    db,
    { id: user.id, name: user.name, email: user.email, role: user.role, storeId: user.storeId },
    { type, fileName: basename(values.arquivo), content, mode: values.modo, source: values.origem, dryRun: values.simular },
  );
  const t = result.totals;
  console.log(`${result.dryRun ? "SIMULAÇÃO — nada foi gravado" : `Lote ${result.batchId}`} · ${result.status}`);
  console.log(`lidas ${t.lidas} · novas ${t.novas} · atualizadas ${t.atualizadas} · sem mudança ${t.semMudanca} · removidas ${t.removidas} · erros ${t.erros}`);
  for (const e of result.errors.slice(0, 50)) console.log(`  linha ${e.linha}: ${e.mensagem}`);
  if (result.errors.length > 50) console.log(`  … e mais ${result.errors.length - 50} erros`);
  process.exitCode = result.status === "FAILED" ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
