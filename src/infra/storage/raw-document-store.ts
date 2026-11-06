/**
 * Armazenamento restrito dos XMLs brutos (R13.4). Pastas com permissão 0700 e
 * arquivos 0600: só o usuário do serviço lê. O prazo de guarda é definido pela
 * contabilidade (questão em aberto); a limpeza fica para a etapa de entrega.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface RawDocumentStore {
  /** Guarda o conteúdo e devolve o caminho relativo e o SHA-256. Idempotente. */
  save(input: { month: string; name: string; content: Uint8Array }): Promise<{ path: string; sha256: string }>;
  read(path: string): Promise<Uint8Array>;
}

export class LocalRawDocumentStore implements RawDocumentStore {
  constructor(private readonly baseDir: string) {}

  async save(input: { month: string; name: string; content: Uint8Array }) {
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error(`mês inválido: ${input.month}`);
    if (!/^[0-9A-Za-z._-]+$/.test(input.name)) throw new Error("nome de arquivo inválido");
    const full = join(this.baseDir, input.month, input.name);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    try {
      await writeFile(full, input.content, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // já existe: mantém o primeiro (idempotente)
    }
    return { path: relative(this.baseDir, full), sha256 };
  }

  async read(path: string): Promise<Uint8Array> {
    if (path.includes("..")) throw new Error("caminho inválido");
    return new Uint8Array(await readFile(join(this.baseDir, path)));
  }
}

/** Implementação em memória para testes. */
export class InMemoryRawDocumentStore implements RawDocumentStore {
  readonly files = new Map<string, Uint8Array>();
  async save(input: { month: string; name: string; content: Uint8Array }) {
    const path = `${input.month}/${input.name}`;
    if (!this.files.has(path)) this.files.set(path, input.content);
    return { path, sha256: createHash("sha256").update(input.content).digest("hex") };
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error("arquivo não encontrado");
    return f;
  }
}
