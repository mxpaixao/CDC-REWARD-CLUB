/**
 * Fontes de XML: pasta monitorada e upload manual.
 */
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { businessDateOf } from "@/domain/business-time";
import { InvalidSalesDocumentError } from "@/domain/invoice/types";
import { parseSalesXml } from "./nfe-xml";
import type { SalesSource, SourceItem, SourceOutcome } from "./sales-source";

/** Tamanho máximo de um XML (NF-e com muitos itens fica bem abaixo disso). */
export const MAX_XML_BYTES = 5 * 1024 * 1024;

export function readXmlItem(reference: string, content: Uint8Array): SourceItem {
  if (content.byteLength > MAX_XML_BYTES) return { reference, error: "arquivo maior que 5 MB" };
  try {
    return { reference, raw: { content, extension: "xml" }, document: parseSalesXml(content) };
  } catch (e) {
    if (e instanceof InvalidSalesDocumentError) return { reference, raw: { content, extension: "xml" }, error: e.message };
    throw e;
  }
}

export interface XmlFolderOptions {
  /** Pasta de entrada (a que o SHX/GIX alimenta). */
  inbox: string;
  /**
   * "move": depois de processar, move o arquivo para processados/AAAA-MM-DD ou erros/AAAA-MM-DD dentro da pasta.
   * "keep": deixa o arquivo onde está (a importação é idempotente pela chave).
   */
  afterImport?: "move" | "keep";
  now?: () => Date;
}

export class XmlFolderSource implements SalesSource {
  readonly name: string;
  private readonly afterImport: "move" | "keep";
  private readonly now: () => Date;

  constructor(private readonly options: XmlFolderOptions) {
    this.name = `pasta:${options.inbox}`;
    this.afterImport = options.afterImport ?? "move";
    this.now = options.now ?? (() => new Date());
  }

  async *items(): AsyncIterable<SourceItem> {
    const entries = await readdir(this.options.inbox, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && /\.xml$/i.test(e.name)).map((e) => e.name).sort();
    for (const name of files) {
      const path = join(this.options.inbox, name);
      const info = await stat(path);
      if (info.size > MAX_XML_BYTES) {
        yield { reference: name, error: "arquivo maior que 5 MB" };
        continue;
      }
      yield readXmlItem(name, new Uint8Array(await readFile(path)));
    }
  }

  async acknowledge(item: SourceItem, outcome: SourceOutcome): Promise<void> {
    if (this.afterImport === "keep") return;
    const folder = outcome === "error" ? "erros" : "processados";
    const target = join(this.options.inbox, folder, businessDateOf(this.now()));
    await mkdir(target, { recursive: true, mode: 0o700 });
    await rename(join(this.options.inbox, item.reference), join(target, item.reference));
  }
}

/** Arquivos enviados pelo painel de gestão. */
export class UploadedXmlSource implements SalesSource {
  readonly name = "upload";
  constructor(private readonly files: Array<{ name: string; content: Uint8Array }>) {}

  async *items(): AsyncIterable<SourceItem> {
    for (const f of this.files) yield readXmlItem(f.name, f.content);
  }

  async acknowledge(): Promise<void> {}
}
