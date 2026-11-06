/**
 * Fonte de vendas (SPEC seção 7). Na Fase 1, pasta monitorada (`XmlFolderSource`)
 * e upload manual (`UploadedXmlSource`). Uma futura `ShxApiSource` entrega os
 * mesmos `SalesDocument` e o importador não muda.
 */
import type { SalesDocument } from "@/domain/invoice/types";

export type SourceOutcome = "imported" | "repeated" | "ignored" | "error";

export interface SourceItem {
  /** Identificação do item na origem (nome do arquivo, id na API). */
  reference: string;
  /** Conteúdo original, guardado no armazenamento restrito quando a nota identifica o cliente. */
  raw?: { content: Uint8Array; extension: "xml" | "json" };
  /** Documento interpretado; ausente quando a leitura falhou. */
  document?: SalesDocument;
  /** Motivo da falha de leitura (sem CPF ou CNPJ). */
  error?: string;
}

export interface SalesSource {
  readonly name: string;
  items(): AsyncIterable<SourceItem>;
  /** Avisa a origem do resultado de cada item (ex.: mover o arquivo para processados). */
  acknowledge(item: SourceItem, outcome: SourceOutcome): Promise<void>;
}
