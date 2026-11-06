/**
 * Leitura de CSV dos cadastros auxiliares.
 * - Codificação: UTF-8 (com ou sem BOM); se não for UTF-8 válido, Windows-1252
 *   (comum em exportações de ERP no Windows).
 * - Separador: ";" (padrão do Excel em português) ou ",", detectado pelo cabeçalho.
 * - Aspas duplas para campos com separador, quebra de linha ou aspas ("" escapa).
 * - Cabeçalho comparado sem acento, sem diferença de maiúsculas e com espaços viram "_".
 */

export class CsvFormatError extends Error {}

export interface CsvRow {
  /** Linha no arquivo, contando o cabeçalho como linha 1. */
  line: number;
  values: Record<string, string>;
}

export interface CsvTable {
  delimiter: ";" | ",";
  headers: string[];
  rows: CsvRow[];
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function detectDelimiter(firstLine: string): ";" | "," {
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons >= commas && semicolons > 0 ? ";" : ",";
}

/** Divide o texto em registros, respeitando aspas. Devolve [linha inicial, campos]. */
function tokenize(text: string, delimiter: string): Array<[number, string[]]> {
  const records: Array<[number, string[]]> = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStart = 1;
  let i = 0;
  const pushRecord = () => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0] === "")) records.push([recordStart, fields]);
    fields = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      fields.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      pushRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      recordStart = line;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new CsvFormatError(`aspas sem fechamento a partir da linha ${recordStart}`);
  if (field !== "" || fields.length > 0) pushRecord();
  return records;
}

export function parseCsv(text: string): CsvTable {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim() === "") throw new CsvFormatError("arquivo vazio ou sem cabeçalho");
  const delimiter = detectDelimiter(firstLine);
  const records = tokenize(text, delimiter);
  const [, rawHeaders] = records[0]!;
  const headers = rawHeaders.map(normalizeHeader);
  const seen = new Set<string>();
  for (const h of headers) {
    if (h && seen.has(h)) throw new CsvFormatError(`coluna repetida no cabeçalho: ${h}`);
    seen.add(h);
  }
  const rows: CsvRow[] = [];
  for (const [line, fields] of records.slice(1)) {
    if (fields.every((f) => f.trim() === "")) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) values[h] = (fields[idx] ?? "").trim();
    });
    if (fields.length > headers.length && fields.slice(headers.length).some((f) => f.trim() !== "")) {
      values.__extra = "1";
    }
    rows.push({ line, values });
  }
  return { delimiter, headers, rows };
}

/** Garante que as colunas obrigatórias existem no cabeçalho. */
export function requireColumns(table: CsvTable, required: readonly string[]): void {
  const missing = required.filter((c) => !table.headers.includes(c));
  if (missing.length) throw new CsvFormatError(`faltam colunas no cabeçalho: ${missing.join(", ")}`);
}
