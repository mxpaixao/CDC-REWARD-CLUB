/**
 * Gera CSVs sintéticos de lojas, produtos e lista de exclusão em var/synthetic/
 * (pasta fora do controle de versão).
 *
 *   npm run synthetic:csv
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syntheticExclusionCsv, syntheticProductsCsv, syntheticStoresCsv } from "../src/synthetic/catalog-csv";

const dir = join(process.cwd(), "var", "synthetic");
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "lojas.csv"), syntheticStoresCsv());
await writeFile(join(dir, "produtos.csv"), syntheticProductsCsv());
await writeFile(join(dir, "exclusao.csv"), syntheticExclusionCsv());
console.log(`CSVs sintéticos gravados em ${dir}: lojas.csv, produtos.csv, exclusao.csv`);
