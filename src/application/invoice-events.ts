/**
 * Ganchos chamados pelo importador, dentro da mesma transação da nota.
 * Na etapa 4 o motor de regras se pendura aqui para gerar créditos e estornos;
 * como a nota é única pela chave, cada gancho roda uma única vez por nota.
 */
import type { Tx } from "@/infra/db/client";

export interface InvoiceEventHandler {
  /**
   * Nota nova gravada (venda, devolução ou outra). Também é chamado para nota que
   * já nasce cancelada (o cancelamento chegou antes): o motor deve ignorar essas.
   */
  onInvoiceImported(tx: Tx, invoiceId: string): Promise<void>;
  /** Nota já gravada que acaba de ser cancelada: o motor estorna o que ela gerou (R9.1). */
  onInvoiceCanceled(tx: Tx, invoiceId: string): Promise<void>;
}

export const noopInvoiceEvents: InvoiceEventHandler = {
  async onInvoiceImported() {},
  async onInvoiceCanceled() {},
};
