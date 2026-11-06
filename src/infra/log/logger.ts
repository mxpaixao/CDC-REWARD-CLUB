/**
 * Logger estruturado (JSON por linha) que mascara CPF e CNPJ antes de
 * escrever (regra inviolável 6 e R13.5). Toda saída de log do motor passa aqui.
 */
import { maskDocument } from "@/domain/document";

// CPF: 11 dígitos, com ou sem pontuação. CNPJ: 14 posições (12 alfanuméricas + 2 dígitos), com ou sem pontuação.
const CNPJ_PATTERN = /(?<![0-9A-Za-z])[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}(?![0-9A-Za-z])/g;
const CPF_PATTERN = /(?<![0-9A-Za-z])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![0-9A-Za-z])/g;
// Chave de acesso (44 dígitos) contém o CNPJ do emitente, mas é de empresa e precisa ser rastreável: não mascarar.
const ACCESS_KEY_PATTERN = /\d{44}/g;

function looksLikeCnpj(candidate: string): boolean {
  // Evita mascarar palavras comuns: exige ao menos 2 dígitos finais e pelo menos 8 dígitos no total.
  return (candidate.match(/\d/g) ?? []).length >= 8;
}

export function redactText(text: string): string {
  const keys: string[] = [];
  const protectedText = text.replace(ACCESS_KEY_PATTERN, (m) => {
    keys.push(m);
    return `\u0000${keys.length - 1}\u0000`;
  });
  const redacted = protectedText
    .replace(CNPJ_PATTERN, (m) => (looksLikeCnpj(m) ? maskDocument(m) : m))
    .replace(CPF_PATTERN, (m) => maskDocument(m));
  return redacted.replace(/\u0000(\d+)\u0000/g, (_, i: string) => keys[Number(i)]!);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[profundo demais]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && String(value).length === 11) {
    return redactText(String(value));
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/password|senha|token|secret/i.test(k)) {
        out[k] = "[oculto]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
export type LogSink = (line: string) => void;

let sink: LogSink = (line) => process.stdout.write(line + "\n");

/** Troca o destino dos logs (usado em testes). */
export function setLogSink(next: LogSink): void {
  sink = next;
}

const LEVELS: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? "info") as Level | "silent";
  return LEVELS[configured] ?? LEVELS.info;
}

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel()) return;
  const entry = { ts: new Date().toISOString(), level, msg: redactText(message), ...(redact(context ?? {}) as object) };
  sink(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
