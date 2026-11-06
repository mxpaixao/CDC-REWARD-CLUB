/**
 * CSVs sintéticos dos cadastros auxiliares, no layout que o importador aceita.
 * Produtos P-A, P-B, P-C e P-D são os dos critérios de aceite (SPEC seção 10).
 */
import { formatDocument } from "@/domain/document";
import { acceptancePersonas, createRng, fakeCpf, fakeCnpj, pick, randomInt, syntheticStores } from "./generators";

function toCsv(header: string[], rows: string[][]): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

export function syntheticStoresCsv(): string {
  return toCsv(
    ["codigo", "nome", "cnpj", "piloto"],
    syntheticStores().map((s) => [s.code, s.name, formatDocument(s.cnpj), s.isPilot ? "sim" : "não"]),
  );
}

/** Produtos dos critérios de aceite, com margem bem dentro de cada faixa. */
export const ACCEPTANCE_PRODUCTS = [
  { code: "P-A", description: "Produto sintético faixa A", category: "Elétrica", marginPct: "40" },
  { code: "P-B", description: "Produto sintético faixa B", category: "Hidráulica", marginPct: "25" },
  { code: "P-C", description: "Produto sintético faixa C", category: "Ferragens", marginPct: "15" },
  { code: "P-D", description: "Produto sintético faixa D", category: "Cimento", marginPct: "5" },
] as const;

const CATEGORIES = ["Elétrica", "Hidráulica", "Ferragens", "Tintas", "Ferramentas", "Cimento", "Pisos"] as const;

export function syntheticProductsCsv(extra = 50, seed = 7): string {
  const rng = createRng(seed);
  const rows: string[][] = ACCEPTANCE_PRODUCTS.map((p) => [p.code, p.description, p.category, p.marginPct.replace(".", ",")]);
  for (let i = 1; i <= extra; i++) {
    const margin = `${randomInt(rng, -5, 60)},${randomInt(rng, 0, 9)}`;
    rows.push([`SINT-${String(i).padStart(5, "0")}`, `Item sintético ${i}`, pick(rng, CATEGORIES), margin]);
  }
  return toCsv(["codigo", "descricao", "categoria", "margem_bruta_pct"], rows);
}

/** Lista de exclusão com a funcionária e o cliente B2B dos critérios 6 e 23, mais alguns sorteados. */
export function syntheticExclusionCsv(extraEmployees = 5, extraB2b = 5, seed = 11): string {
  const rng = createRng(seed);
  const personas = acceptancePersonas();
  const rows: string[][] = [
    [formatDocument(personas.employee.cpf), "funcionário", "RH"],
    [formatDocument(personas.b2bCustomer.cnpj), "B2B negociado", "SHX-B2B"],
  ];
  for (let i = 0; i < extraEmployees; i++) rows.push([formatDocument(fakeCpf(rng)), "funcionário", "RH"]);
  for (let i = 0; i < extraB2b; i++) rows.push([formatDocument(fakeCnpj(rng)), "B2B negociado", "SHX-B2B"]);
  return toCsv(["documento", "motivo", "origem"], rows);
}
