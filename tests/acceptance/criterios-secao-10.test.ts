/**
 * Critérios de aceite da SPEC, seção 10 (regra inviolável 10).
 *
 * Cada critério nasce aqui como pendente, marcado com a etapa que o fecha.
 * Quando a etapa é implementada, o `it.todo` sai daqui e o teste real vai para
 * `tests/acceptance/cNN-*.db.test.ts`, contra o banco. Este arquivo serve de
 * índice: o que ainda aparece como todo é o que falta entregar.
 *
 * Premissas: parâmetros da seção 4; prestador Carlos (Profissional, ativo);
 * loja piloto L1; produtos P-A, P-C e P-D; cliente Ana sem vínculo anterior.
 * Documentos sintéticos de `acceptancePersonas()`.
 */
import { describe, it } from "vitest";

// Critério 19: parte da nota em c19-idempotencia.db.test.ts (etapa 3); parte do crédito na etapa 4.
describe("Etapa 4 — Motor e ledger (continuação do critério 19)", () => {
  it.todo("19. Idempotência: o mesmo XML importado duas vezes → um crédito");
});

describe("Etapa 4 — Motor e ledger", () => {
  it.todo("1. Compra própria: R$ 1.000 em P-A e R$ 200 em P-C → R$ 10,00 pendentes, liberados 7 dias depois");
  it.todo("2. Compra indicada: Ana compra R$ 1.000 em P-A e R$ 500 em P-C → R$ 45,00 de indicação para Carlos");
  it.todo("3. Faixa D: compra indicada de R$ 800 só em P-D → crédito zero");
  it.todo("4. Desconto no item: P-A com vProd R$ 100 e vDesc R$ 10 → base de R$ 90");
  it.todo("11. Cancelamento na carência: R$ 40 pendentes em 10/02/2027, nota cancelada em 12/02 → pendente zerado, nada liberado");
  it.todo("12. Devolução após liberação: 10 un. de P-A por R$ 1.000 (R$ 40 liberados), devolução de 2 → ESTORNO de R$ 8,00");
  it.todo("13. Teto mensal: R$ 980 de indicação no mês + nova venda de R$ 45 → R$ 20 normais e R$ 25 retidos");
  it.todo("15. FIFO: lotes de R$ 50 (vence 01/08/2027) e R$ 80 (vence 01/09/2027), resgate de R$ 60 → R$ 50 do primeiro e R$ 10 do segundo");
  it.todo("16. Vencimento: lote de R$ 70 com R$ 20 usados chega ao fim da validade → VENCIMENTO de R$ 50");
  it.todo("24. Venda a prazo (decisão 06/11/2026): venda indicada com tPag 15 → nenhum crédito");
});

describe("Etapa 5 — Prestadores", () => {
  it.todo("21. Promoção: volume de 90 dias passa o limite de Parceiro → promovido no recálculo diário; vendas seguintes com taxa de Parceiro");
  it.todo("22. Inatividade: 180 dias sem compra própria nem venda indicada → inativo; sai do CSV de ativos e entra no de desligados");
});

describe("Etapa 6 — Vínculos", () => {
  it.todo("5. Autoindicação: Carlos vincula o próprio CPF ao próprio código → bloqueado, com mensagem clara");
  it.todo("6. Funcionário: CPF da lista de funcionários tenta se vincular → bloqueado");
  it.todo("7. Janela de 120 dias: vínculo de 01/02/2027 → venda de 31/05/2027 é de Carlos; a de 02/06/2027 não");
  it.todo("8. Renovação: Ana apresenta o código de Carlos em 01/05/2027 → vínculo passa a terminar em 29/08/2027");
  it.todo("9. Último código vale: troca para Bruno em 03/03/2027 → vendas anteriores com Carlos, seguintes com Bruno; vínculo de Carlos substituído");
  it.todo("10. Alerta de troca: terceira troca em 90 dias → alerta criado e vínculo criado");
  it.todo("20. Boas-vindas: compra de R$ 1.500 → desconto de R$ 50 (5% daria R$ 75); vínculo posterior a outro prestador → sem desconto");
  it.todo("23. Lista B2B: documento B2B não consegue vínculo e nota com esse destinatário não gera crédito de indicação");
});

describe("Etapa 7 — Resgate", () => {
  it.todo("14. Teto de resgate: R$ 300 disponíveis, compra de R$ 400 → máximo R$ 200; resgata R$ 200 e ficam R$ 100");
  it.todo("17. Reserva expirada: R$ 100 às 10:00 sem nota até 10:00 do dia seguinte → expirada, R$ 100 voltam aos mesmos lotes");
  it.todo("18. Conciliação: reserva R7K4M de R$ 100, nota 40 min depois com desconto de R$ 100 e R7K4M em infCpl → confirmada e ligada à chave");
});
