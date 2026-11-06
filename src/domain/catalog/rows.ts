/**
 * Layouts e validação das linhas dos CSVs auxiliares (SPEC seção 2 e etapa 2).
 * Funções puras: recebem a tabela lida e devolvem registros válidos e erros por linha.
 * Mensagens de erro nunca repetem CPF ou CNPJ (R13.5).
 */
import { tryParseDocument, type DocumentType } from "../document";
import { type CsvTable, CsvFormatError } from "../csv/parse";

export interface LineError {
  linha: number;
  mensagem: string;
}

export interface Validated<T> {
  records: Array<T & { line: number }>;
  errors: LineError[];
}

/** Nomes aceitos para cada coluna (já normalizados: sem acento, minúsculas, "_"). */
const ALIASES: Record<string, string[]> = {
  codigo: ["codigo", "cod", "cprod", "codigo_produto", "codigo_loja"],
  nome: ["nome", "nome_loja", "razao_social"],
  cnpj: ["cnpj"],
  piloto: ["piloto", "loja_piloto", "e_piloto"],
  descricao: ["descricao", "xprod", "descricao_produto"],
  categoria: ["categoria", "grupo", "departamento"],
  margem: ["margem_bruta_pct", "margem_bruta", "margem_pct", "margem", "margem_bruta_percentual"],
  documento: ["documento", "cpf_cnpj", "cpf", "cnpj"],
  motivo: ["motivo"],
  origem: ["origem", "fonte"],
};

/** Mapeia o nome canônico para a coluna presente no arquivo. */
function resolveColumns(table: CsvTable, canonical: readonly string[], required: readonly string[]) {
  const map: Record<string, string | undefined> = {};
  for (const c of canonical) map[c] = ALIASES[c]!.find((a) => table.headers.includes(a));
  const missing = required.filter((c) => !map[c]);
  if (missing.length) {
    throw new CsvFormatError(
      `faltam colunas no cabeçalho: ${missing.map((m) => ALIASES[m]![0]).join(", ")} (cabeçalho lido: ${table.headers.join(", ")})`,
    );
  }
  return (values: Record<string, string>, c: string) => (map[c] ? (values[map[c]!] ?? "") : "");
}

function parseBool(text: string): boolean | null {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["sim", "s", "true", "1", "x", "yes"].includes(t)) return true;
  if (["nao", "n", "false", "0", "", "no"].includes(t)) return false;
  return null;
}

/** "35", "35,5", "35.50", "-3,2", "35%" → "35.5". Texto decimal, nunca float. */
export function parsePercentText(text: string): string | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^-?\d{1,4}([.,]\d{1,4})?$/.test(t)) return null;
  const normalized = t.replace(",", ".");
  // remove zeros à direita na parte decimal para comparação estável
  return normalized.includes(".") ? normalized.replace(/0+$/, "").replace(/\.$/, "") : normalized;
}

function rejectDuplicate<T>(seen: Map<string, number>, key: string, line: number, errors: LineError[], label: string): boolean {
  const first = seen.get(key);
  if (first !== undefined) {
    errors.push({ linha: line, mensagem: `${label} repetido no arquivo (primeira ocorrência na linha ${first})` });
    return true;
  }
  seen.set(key, line);
  return false;
}

// ---------------------------------------------------------------------------

export interface StoreRecord {
  code: string;
  name: string;
  cnpj: string;
  isPilot: boolean;
}

export const STORE_LAYOUT = "codigo;nome;cnpj;piloto";

export function validateStoreRows(table: CsvTable): Validated<StoreRecord> {
  const get = resolveColumns(table, ["codigo", "nome", "cnpj", "piloto"], ["codigo", "nome", "cnpj"]);
  const records: Validated<StoreRecord>["records"] = [];
  const errors: LineError[] = [];
  const codes = new Map<string, number>();
  const cnpjs = new Map<string, number>();
  for (const { line, values } of table.rows) {
    const code = get(values, "codigo").toUpperCase();
    const name = get(values, "nome");
    const doc = tryParseDocument(get(values, "cnpj"));
    const pilot = parseBool(get(values, "piloto"));
    const problems: string[] = [];
    if (!/^[A-Z0-9-]{1,10}$/.test(code)) problems.push("código da loja inválido (até 10 letras, números ou hífen)");
    if (name.length < 2) problems.push("nome da loja vazio");
    if (!doc || doc.type !== "CNPJ") problems.push("CNPJ inválido");
    if (pilot === null) problems.push('coluna piloto deve ser "sim" ou "não"');
    if (problems.length) {
      errors.push({ linha: line, mensagem: problems.join("; ") });
      continue;
    }
    if (rejectDuplicate(codes, code, line, errors, "código de loja")) continue;
    if (rejectDuplicate(cnpjs, doc!.value, line, errors, "CNPJ")) continue;
    records.push({ line, code, name, cnpj: doc!.value, isPilot: pilot! });
  }
  return { records, errors };
}

// ---------------------------------------------------------------------------

export interface ProductRecord {
  code: string;
  description: string;
  category: string | null;
  /** Margem bruta em %, texto decimal normalizado. */
  marginPct: string;
}

export const PRODUCT_LAYOUT = "codigo;descricao;categoria;margem_bruta_pct";

export function validateProductRows(table: CsvTable): Validated<ProductRecord> {
  const get = resolveColumns(table, ["codigo", "descricao", "categoria", "margem"], ["codigo", "descricao", "margem"]);
  const records: Validated<ProductRecord>["records"] = [];
  const errors: LineError[] = [];
  const codes = new Map<string, number>();
  for (const { line, values } of table.rows) {
    const code = get(values, "codigo");
    const description = get(values, "descricao");
    const category = get(values, "categoria") || null;
    const margin = parsePercentText(get(values, "margem"));
    const problems: string[] = [];
    if (!code || code.length > 60) problems.push("código do produto vazio ou longo demais (até 60 caracteres, como o cProd)");
    if (!description) problems.push("descrição vazia");
    if (margin === null) problems.push("margem bruta inválida (use número, ex.: 35,5)");
    else if (Number(margin) > 100 || Number(margin) < -100) problems.push("margem bruta fora do intervalo de -100% a 100%");
    if (problems.length) {
      errors.push({ linha: line, mensagem: problems.join("; ") });
      continue;
    }
    if (rejectDuplicate(codes, code, line, errors, "código de produto")) continue;
    records.push({ line, code, description, category, marginPct: margin! });
  }
  return { records, errors };
}

// ---------------------------------------------------------------------------

export const EXCLUSION_REASONS = ["B2B_NEGOTIATED", "EMPLOYEE", "OTHER"] as const;
export type ExclusionReasonCode = (typeof EXCLUSION_REASONS)[number];

export const exclusionReasonLabels: Record<ExclusionReasonCode, string> = {
  B2B_NEGOTIATED: "B2B negociado",
  EMPLOYEE: "Funcionário",
  OTHER: "Outro",
};

export function parseExclusionReason(text: string): ExclusionReasonCode | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (["b2b", "b2b_negociado", "b2b_negotiated", "cliente_b2b", "preco_negociado"].includes(t)) return "B2B_NEGOTIATED";
  if (["funcionario", "funcionaria", "employee", "colaborador", "colaboradora"].includes(t)) return "EMPLOYEE";
  if (["outro", "outros", "other"].includes(t)) return "OTHER";
  return null;
}

export interface ExclusionRecord {
  document: string;
  documentType: DocumentType;
  reason: ExclusionReasonCode;
  /** Origem informada na linha; se vazia, vale a origem do lote. */
  source: string | null;
}

export const EXCLUSION_LAYOUT = "documento;motivo;origem";

export function validateExclusionRows(table: CsvTable): Validated<ExclusionRecord> {
  const get = resolveColumns(table, ["documento", "motivo", "origem"], ["documento", "motivo"]);
  const records: Validated<ExclusionRecord>["records"] = [];
  const errors: LineError[] = [];
  const docs = new Map<string, number>();
  for (const { line, values } of table.rows) {
    const doc = tryParseDocument(get(values, "documento"));
    const reason = parseExclusionReason(get(values, "motivo"));
    const source = get(values, "origem") || null;
    const problems: string[] = [];
    if (!doc) problems.push("CPF ou CNPJ inválido");
    if (!reason) problems.push('motivo deve ser "B2B negociado", "funcionário" ou "outro"');
    if (source && source.length > 40) problems.push("origem longa demais (até 40 caracteres)");
    if (problems.length) {
      errors.push({ linha: line, mensagem: problems.join("; ") });
      continue;
    }
    if (rejectDuplicate(docs, doc!.value, line, errors, "documento")) continue;
    records.push({ line, document: doc!.value, documentType: doc!.type, reason: reason!, source });
  }
  return { records, errors };
}
