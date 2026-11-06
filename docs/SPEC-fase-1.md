# SPEC — Motor Clube CDC · Fase 1 (piloto do prestador)

Versão 0.3 · 06/11/2026 (decisões da seção 13 incorporadas) · Dono do produto: Diretoria Comercial da CDC · Execução: CPD da CDC com Claude Code

## 1. Objetivo

Colocar em operação, numa loja piloto, o trilho Prestador do Clube CDC. O prestador aprovado recebe um código, indica clientes, acumula bônus em reais sobre as próprias compras e sobre as compras dos clientes indicados, e usa o bônus como desconto em compras seguintes.

O motor lê as vendas pelas notas fiscais exportadas do SHX/GIX. Nada na Fase 1 depende de customização no caixa do GIX.

Critério de saída da Fase 1 (gate G2 do roadmap): três meses de operação com conciliação diária fechada e dados suficientes para medir se a receita indicada paga o bônus.

## 2. Escopo

**Dentro:**

- Cadastro, aprovação, suspensão, revalidação, níveis e inatividade de prestadores.
- Código de indicação, link, QR e página pública de vínculo.
- Vínculo cliente–prestador: 120 dias, renovação, "último código vale".
- Importação de cadastros auxiliares por CSV: lojas, produtos com margem, lista de exclusão (clientes B2B com preço negociado e funcionários).
- Importação de XML de NFC-e e NF-e: vendas, cancelamentos e devoluções.
- Motor de regras e ledger: crédito pendente, liberação, retenção, vencimento, estorno e ajuste.
- Resgate com reserva no painel do caixa e conciliação com as notas.
- Desconto de boas-vindas para o cliente indicado.
- Portal do prestador, painel do caixa e painel de gestão com relatórios e exportações.
- Outbox de notificações com adapter de log.
- Exportação diária dos prestadores ativos para o SHX vincular a tabela de preço Profissional.
- Perfil profissional do prestador: profissões de uma lista padronizada (mais de uma, com a principal), profissão regulamentada e registro no conselho, certificações (declaradas ou verificadas), áreas de atendimento e consentimento separado para aparecer na vitrine futura (CDC Indica). Na Fase 1 esses dados não aparecem em página pública.
- Aba Capacitação no portal do prestador: trilhas de vídeos e aulas cadastradas pela gestão, com marcação de assistido.

**Fora:**

- Envio real por WhatsApp (o adapter fica pronto para a Fase 2).
- Integração em tempo real com o caixa do GIX (Fase 2).
- Acúmulo de bônus para clientes CPF. Na Fase 1, o cliente indicado só ganha o desconto de boas-vindas.
- App nativo e qualquer integração com a Fidelimax.
- Cálculo do preço da tabela meio de campo. Ela é mantida no SHX; o motor só informa quem está ativo.
- CDC Indica (vitrine pública de prestadores, Fase 2) e CDC Serviços (serviços próprios da CDC, Fase 3). Ver seção 14.

## 3. Perfis e permissões

| Perfil | Pode |
| --- | --- |
| Admin | Tudo, inclusive parâmetros, usuários e ajustes manuais |
| Gerente de canal | Aprovar, suspender, revalidar e reativar prestadores; revisar créditos retidos; ver relatórios da própria carteira |
| Operador de caixa | Consultar participante, criar vínculo, registrar desconto de boas-vindas, criar e cancelar reserva de resgate, pré-cadastrar prestador |
| Prestador | Ver no portal o próprio saldo, extrato, código, clientes vinculados e nível |

Usuários internos entram com e-mail e senha, ou com o provedor de identidade que o CPD indicar. O prestador entra com CPF ou CNPJ e um código de acesso de 6 dígitos enviado pelo adapter de mensagens. Enquanto o adapter for o de log, o código aparece para o gerente de canal no painel, para ser repassado ao prestador.

## 4. Parâmetros

Todos ficam numa tabela com vigência. Mudança de parâmetro cria nova versão com data de início; cada venda usa a versão vigente na data de emissão da nota.

| Chave | Valor inicial | Descrição |
| --- | --- | --- |
| enabled_store_ids | loja piloto | Lojas cujas notas geram crédito; as demais entram só nas métricas |
| holding_days | 7 | Carência entre a venda e a liberação do crédito |
| held_approval_holding_days | 14 | Carência mínima, contada da venda, de crédito retido aprovado pelo gerente (R7.2) |
| provider_credit_validity_days | 180 | Validade do crédito liberado |
| provider_redemption_cap_pct | 50 | Teto de uso do bônus, em % do valor da compra |
| referral_link_days | 120 | Duração do vínculo cliente–prestador |
| welcome_discount_pct | 5 | Desconto na primeira compra com código |
| welcome_discount_cap_cents | 5000 | Teto do desconto de boas-vindas (R$ 50,00) |
| band_min_margin_pct | A 35 · B 20 · C 10 | Margem bruta mínima de cada faixa; abaixo de 10, faixa D |
| own_purchase_rate_pct | A 1 · B 1 · C 0 · D 0 | Bônus sobre compras próprias do prestador |
| referral_rate_pct | tabela da R5.4 | Bônus sobre compras indicadas, por faixa e nível |
| referral_monthly_cap_cents | Profissional 100000 · Parceiro 250000 · Parceiro Ouro 500000 | Teto mensal de crédito de indicação por prestador |
| tier_threshold_cents | Parceiro e Parceiro Ouro: a definir | Volume de 90 dias para cada nível (definido pela gestão a partir do relatório de percentis); enquanto vazio, ninguém é promovido |
| tier_volume_window_days | 90 | Janela do volume para nível (R10.1) |
| inactivity_days | 180 | Dias sem compra própria e sem venda indicada até inativar |
| revalidation_days | 365 | Prazo até a revalidação anual do prestador |
| revalidation_grace_days | 30 | Prazo para revalidar antes da suspensão |
| code_switch_alert | 3 trocas em 90 dias | Trocas de prestador no mesmo cliente que geram alerta |
| hold_expiry_hours | 24 | Validade de uma reserva de resgate sem nota correspondente |
| reconciliation_tolerance_cents | 5 | Tolerância na conciliação de resgate e de boas-vindas |
| deferred_payment_types | 05, 15 | Códigos `tPag` de venda a prazo; nota com qualquer um deles não gera bônus (R6.2) |
| expiry_notice_days | 15 e 3 | Avisos antes do vencimento de um lote |
| expiring_soon_days | 15 | Janela do saldo "a vencer" |
| returned_redemption_validity_days | 30 | Validade do bônus devolvido ao saldo por devolução de compra (a confirmar) |
| portal_access_code_ttl_minutes | 10 | Validade do código de acesso ao portal |
| portal_access_code_max_attempts | 5 | Tentativas por código de acesso ao portal |

`enabled_store_ids` guarda os códigos das lojas (ex.: `L1`). Parâmetro novo nunca tem vigência no passado: vendas já processadas continuam com a versão da época.

## 5. Modelo de dados (mínimo)

O Claude Code pode detalhar tabelas e índices; estes são os conceitos e campos obrigatórios.

| Entidade | Campos principais |
| --- | --- |
| Loja | nome, CNPJ, se é piloto |
| Usuário interno | nome, e-mail, perfil, loja, gerente de canal responsável |
| Participante | tipo (cliente ou prestador), documento (só dígitos, único), tipo de documento, nome, telefone, nascimento, situação, aceite do regulamento (versão, data, canal), consentimento de ofertas (sim/não, data) |
| Perfil do prestador | profissões (da lista padronizada, uma principal), tipo de comprovação, observação, vendedor responsável, gerente de canal, aprovado por e quando, código de indicação (único), nível e data do nível, última atividade, situação (pendente, ativo, suspenso, inativo), próxima revalidação, apresentação e foto (opcionais), consentimento de vitrine (sim/não, data, versão do termo) |
| Profissão (catálogo) | nome, se é regulamentada, conselho de registro exigido (CREA, CFT/CRT, CAU ou nenhum), ativa |
| Certificação do prestador | prestador, tipo (registro em conselho, NR-10, NR-35, curso técnico ou livre, certificação de fabricante, outro), emissor, número ou identificador, emissão, validade, situação (declarada, verificada, recusada, vencida), verificado por e quando, anexo opcional |
| Área de atendimento | prestador, município, zona ou bairro (lista padronizada para Manaus) |
| Conteúdo de capacitação | trilha, título, descrição, endereço do vídeo, duração, ordem, publicado (sim/não), criado por |
| Progresso de capacitação | prestador, conteúdo, concluído em |
| Vínculo de indicação | prestador, cliente, início, fim (exclusivo), motivo de encerramento (vencido, substituído, cancelado), origem (caixa, link), criado por |
| Desconto de boas-vindas | cliente (único), prestador, loja, operador, valor da compra informado, valor esperado, valor encontrado na nota, situação da conciliação |
| Produto | código (`cProd`), descrição, categoria, margem bruta %, faixa, atualizado em |
| Lista de exclusão | documento, motivo (B2B negociado, funcionário, outro), origem, atualizado em |
| Nota | chave (44 dígitos, única), modelo (55 ou 65), tipo (saída ou entrada), finalidade, emissão, loja, documento do destinatário, total, desconto total, formas de pagamento, observação, chave referenciada, situação (autorizada ou cancelada), lote de importação, caminho do XML bruto |
| Item da nota | número do item, código do produto, descrição, quantidade, valor bruto, desconto, valor base, faixa |
| Lote de crédito | participante, origem (compra própria, indicação, ajuste, devolução de resgate), nota e item de origem, vínculo de origem, valor, situação (pendente, retido, liberado, rejeitado, estornado), data de liberação, validade |
| Lançamento do ledger | participante, tipo, valor assinado em centavos, lote, reserva, nota, usuário, motivo, data |
| Reserva de resgate | código curto, participante, loja, operador, valor da compra informado, valor reservado, criada em, situação (reservada, confirmada, expirada, cancelada), chave da nota casada, alocação por lote |
| Alerta | tipo (troca de código, conflito de lista, telefone repetido, divergência de conciliação), participante, detalhe, situação |
| Outbox | participante, modelo de mensagem, variáveis, situação, tentativas, criada em, enviada em, resposta do provedor |
| Auditoria | usuário, ação, entidade, identificador, antes, depois, data |
| Versão de parâmetro | chave, valor, início da vigência, criado por |
| Lote de importação | tipo (XML, produtos, exclusão, lojas), arquivo, início, fim, totais, erros |

Tipos de lançamento do ledger: `CREDITO_PENDENTE`, `LIBERACAO`, `RETENCAO`, `APROVACAO_RETIDO`, `REJEICAO_RETIDO`, `RESGATE_RESERVADO`, `RESGATE_CANCELADO`, `VENCIMENTO`, `ESTORNO`, `AJUSTE`.

Saldos derivados, nunca armazenados como campo editável:

- **pendente:** créditos ainda na carência;
- **retido:** créditos aguardando revisão (teto mensal ou venda a prazo);
- **disponível:** créditos liberados menos resgates, vencimentos e estornos, mais ajustes;
- **a vencer:** parte do disponível que vence nos próximos 15 dias.

## 6. Regras de negócio

### 6.1 Prestador

- **R1.1** Documento: CPF ou CNPJ válido (inclusive CNPJ alfanumérico, IN RFB 2.229/2024). Um documento corresponde a um participante; na Fase 1 não há documento secundário, então compras do prestador em outro documento (ex.: CPF e CNPJ de MEI) não contam.
- **R1.2** Não pode ser prestador quem está na lista de exclusão (funcionário ou cliente B2B com preço negociado).
- **R1.3** Comprovação obrigatória, uma entre três: MEI ou CNPJ com atividade compatível; registro profissional (CFT, CREA ou outro); indicação de vendedor da CDC. Guardar tipo e observação; anexo opcional.
- **R1.4** Situações: pendente → ativo (aprovação do gerente de canal); ativo ↔ suspenso (gerente, com motivo); ativo → inativo (R10.4); inativo → ativo (gerente).
- **R1.5** Na aprovação: gerar o código (R2), definir nível Profissional, registrar vendedor e gerente responsáveis, enfileirar a mensagem de boas-vindas com código e link.
- **R1.6** Revalidação: ao completar `revalidation_days` desde a aprovação, o prestador entra na fila de revalidação; sem revalidação em `revalidation_grace_days`, fica suspenso.
- **R1.7** Perfil profissional: ao menos uma profissão da lista padronizada, uma marcada como principal. Profissão regulamentada (ex.: engenheiro — CREA; técnico industrial — CFT/CRT; arquiteto — CAU) exige o número de registro no conselho, que também pode servir de comprovação da R1.3.
- **R1.8** Certificações (NR-10, NR-35, cursos, certificações de fabricante e outras) são declaradas pelo prestador ou registradas pela gestão; só a gestão marca como verificada, com quem e quando. Certificação vencida deixa de valer como verificada. Só certificação verificada pode virar selo em tela pública futura.
- **R1.9** Consentimento de vitrine (aparecer no CDC Indica) é separado do aceite do regulamento e do consentimento de ofertas, começa desmarcado e pode ser revogado a qualquer momento (R13.1). Na Fase 1 é só registrado.

### 6.2 Código de indicação

- **R2.1** Formato: primeiro nome em maiúsculas, sem acentos e sem espaços, até 12 letras, mais 3 dígitos aleatórios. Exemplo: `CARLOS482`.
- **R2.2** Único no sistema; em colisão, sortear outros dígitos.
- **R2.3** Link público `/i/{CODIGO}`; o QR aponta para o link.
- **R2.4** Código de prestador suspenso ou inativo não cria nem renova vínculo.
- **R2.5** Prestador suspenso, inativo ou pendente não acumula bônus (nem de compra própria nem de indicação; o crédito não fica retido, é perdido) e não resgata. Os lotes que ele já tem continuam liberando e vencendo normalmente. O regulamento deve trazer essa regra de forma explícita.

### 6.3 Vínculo cliente–prestador

- **R3.1** Origem: painel do caixa (operador informa CPF do cliente e código e registra o aceite do regulamento, canal "caixa") ou página pública (cliente informa CPF, nome e WhatsApp e aceita o regulamento).
- **R3.1a** Segurança da página pública: ela só cria vínculo para CPF sem vínculo ativo, ou renova o vínculo com o mesmo código. Troca de prestador (R3.5) só no painel do caixa, com o cliente presente.
- **R3.2** Bloqueios: CPF inválido; documento do próprio prestador; documento na lista de exclusão; cliente que é prestador ativo; telefone igual ao do prestador, quando informado.
- **R3.3** Duração: `referral_link_days` a partir do início; o fim é exclusivo.
- **R3.4** Renovação: cliente com vínculo ativo apresenta o mesmo código → o fim passa a ser agora + `referral_link_days`.
- **R3.5** Último código vale: cliente com vínculo ativo apresenta outro código → o vínculo atual termina agora (substituído) e nasce um novo com o novo prestador.
- **R3.6** Alertas: `code_switch_alert` atingido para o mesmo cliente; vários CPFs com o mesmo telefone. O vínculo é criado mesmo assim.
- **R3.7** Uma venda pertence ao prestador cujo vínculo estava ativo na data e hora de emissão da nota. Vínculo criado depois da emissão não alcança a venda; o painel do caixa orienta a vincular antes de finalizar.
- **R3.8** Cliente vinculado vira participante do tipo cliente, com o que foi informado.
- **R3.9** ~~Vínculo retroativo~~ — removido (decisão de 06/11/2026). Não existe vínculo com início no passado.
- **R3.10** Cliente com vínculo ativo que é aprovado como prestador tem o vínculo encerrado como cancelado na aprovação.

### 6.4 Desconto de boas-vindas

- **R4.1** Tem direito ao desconto o CPF que nunca recebeu boas-vindas e tem vínculo ativo, inclusive quem se vinculou pela página pública. O painel do caixa pede o valor da compra e mostra o desconto: `welcome_discount_pct` limitado a `welcome_discount_cap_cents`, arredondado para baixo no centavo.
- **R4.2** O operador confirma que aplicou; o sistema grava um registro único por CPF.
- **R4.3** A conciliação procura a nota daquele CPF, naquela loja, no mesmo dia, e registra o desconto encontrado. Diferença acima da tolerância vira alerta.

### 6.5 Acúmulo

- **R5.1** Valor base do item = `vProd` − `vDesc`, em centavos. Frete, seguro e outras despesas ficam fora.
- **R5.2** Faixa do item pela tabela de produtos: margem ≥ 35% é A; ≥ 20% é B; ≥ 10% é C; abaixo disso, D. Produto sem cadastro é D e entra no relatório "itens sem faixa". A faixa é congelada no item na importação da nota, pela margem do produto e por `band_min_margin_pct` vigente na emissão; cadastro posterior do produto não reclassifica o item (correção por ajuste). A base de produtos com margem é atualizada semanalmente.
- **R5.3** Compra própria: nota de saída cujo destinatário é um prestador ativo. Crédito = Σ base × taxa própria da faixa (A 1%, B 1%, C 0%, D 0%).
- **R5.4** Compra indicada: nota de saída cujo destinatário tem vínculo ativo (R3.7) com prestador ativo e não está na lista de exclusão. Crédito do prestador = Σ base × taxa da faixa no nível do prestador na data da venda:

| Faixa | Profissional | Parceiro | Parceiro Ouro |
| --- | --- | --- | --- |
| A | 4,00% | 4,50% | 5,00% |
| B | 2,50% | 2,75% | 3,00% |
| C | 1,00% | 1,25% | 1,50% |
| D | 0% | 0% | 0% |

- **R5.5** Arredondamento: somar com aritmética decimal e arredondar uma vez por nota e por tipo de crédito, para o centavo, meio para cima.
- **R5.6** O resgate e o desconto de boas-vindas entram como desconto nos itens (`vDesc`), então a parte paga com bônus já fica fora da base.
- **R5.7** Só notas de lojas em `enabled_store_ids` geram crédito; as demais entram apenas nas métricas.
- **R5.8** Nota cujo destinatário é prestador e também está na lista de exclusão não gera crédito e cria alerta de conflito.

### 6.6 Carência, liberação e validade

- **R6.1** Todo crédito nasce pendente, com liberação na data da venda + `holding_days`.
- **R6.2** Nota com qualquer forma de pagamento em `deferred_payment_types`, inclusive pagamento misto, não gera bônus (nem de compra própria nem de indicação). Revisitar quando existir a baixa de títulos do SHX (questão aberta 7).
- **R6.3** Crédito liberado vale `provider_credit_validity_days` a partir da data prevista de liberação; o último dia é válido até 23:59 em Manaus. A carência conta por data: venda do dia D é liberada pelo job do dia D + `holding_days`.
- **R6.4** Resgates consomem os lotes por ordem de vencimento (o que vence antes sai primeiro), com a alocação registrada.
- **R6.5** No dia seguinte ao fim da validade, o job lança `VENCIMENTO` do saldo restante do lote.
- **R6.6** Avisos de vencimento em `expiry_notice_days` para lotes com saldo.

### 6.7 Teto mensal e retenção

- **R7.1** Créditos de indicação gerados no mês civil da venda, por prestador, são somados; o que passar do teto do nível (nível na data da venda) vira retido. O teto é aplicado na ordem de importação das notas, sem recálculo posterior. Estorno reduz o acumulado do mês para as vendas seguintes, mas não solta automaticamente o que já ficou retido.
- **R7.2** O gerente de canal aprova ou rejeita com motivo. Ambos auditados. O crédito aprovado é liberado na data mais tarde entre a venda + `held_approval_holding_days` e a data da aprovação.
- **R7.3** Créditos de compra própria não têm teto.

### 6.8 Resgate com reserva

- **R8.1** O operador busca o prestador por documento ou código e informa o valor total da compra atual.
- **R8.2** Máximo = menor valor entre o saldo disponível e `provider_redemption_cap_pct` da compra, arredondado para baixo no centavo.
- **R8.3** O operador confirma um valor até o máximo; o sistema cria a reserva com código curto (ex.: `R7K4M`) e lança `RESGATE_RESERVADO`, consumindo lotes pela R6.4.
- **R8.4** O operador aplica no GIX um desconto nos itens igual ao valor reservado, com motivo "Clube CDC", e escreve o código da reserva na observação da venda, se o GIX permitir.
- **R8.5** Conciliação: a reserva é confirmada quando aparece nota da mesma loja e do mesmo documento, emitida até `hold_expiry_hours` depois da reserva, com desconto total de pelo menos o valor reservado menos a tolerância. Se o código da reserva estiver em `infCpl`, ele tem prioridade no casamento.
- **R8.5a** A nota manda: se a nota casada (pelo código em `infCpl` ou por ser a única no prazo) tiver desconto menor que o reservado menos a tolerância, a reserva é confirmada pelo desconto encontrado, a diferença volta aos mesmos lotes e abre alerta de divergência.
- **R8.5b** Nota atrasada: se a nota de uma reserva já expirada chegar depois, mas tiver sido emitida dentro do prazo, ela casa mesmo assim, o resgate é lançado de novo (o saldo pode ficar negativo, R9.3) e abre alerta.
- **R8.6** Sem nota no prazo, a reserva expira e `RESGATE_CANCELADO` devolve o valor aos mesmos lotes, com a validade original.
- **R8.7** O operador pode cancelar a reserva antes da nota; a devolução é imediata.
- **R8.8** Código de reserva encontrado em nota sem reserva válida vira alerta de divergência.
- **R8.9** Prestador suspenso, inativo ou pendente não reserva resgate (R2.5).

### 6.9 Cancelamentos e devoluções

- **R9.1** Evento de cancelamento de nota importada estorna todo crédito gerado por ela. Se a nota tinha confirmado um resgate, o resgate é desfeito e o valor volta ao saldo.
- **R9.2** Devolução: NF-e de entrada com finalidade devolução que referencia a chave da venda gera estorno proporcional por item (quantidade devolvida ÷ quantidade vendida × crédito do item).
- **R9.3** Estorno de crédito pendente reduz o pendente. Estorno de crédito liberado gera `ESTORNO` negativo. O saldo pode ficar negativo e créditos futuros compensam; o sistema nunca cobra o prestador.
- **R9.4** Devolução de compra em que houve resgate: o valor do resgate proporcional aos itens devolvidos volta ao saldo como lote novo, com validade de `returned_redemption_validity_days` (a confirmar, questão aberta 8).

### 6.10 Níveis e inatividade

- **R10.1** Volume de 90 dias = soma das bases das compras próprias e das compras indicadas nos últimos `tier_volume_window_days` dias, líquida de devoluções. Contam as notas de todas as lojas CDC, não só das lojas em `enabled_store_ids`.
- **R10.2** Promoção imediata no recálculo diário, quando o volume atinge o limite do nível superior.
- **R10.3** Rebaixamento só na revisão trimestral (1º de janeiro, abril, julho e outubro): volume abaixo do limite do nível atual desce um nível.
- **R10.4** Sem compra própria e sem venda indicada há `inactivity_days`, em qualquer loja CDC, o prestador fica inativo e sai da exportação de ativos. A contagem parte do mais recente entre aprovação, reativação e última compra própria ou venda indicada.
- **R10.5** Relatório com os percentis 60 e 85 do volume de 90 dias dos prestadores ativos, para a gestão definir os limites em reais.

### 6.11 Exportação para o SHX

- **R11.1** Diariamente, CSV e endpoint com os prestadores ativos: documento, nome, nível e data de ativação. O CPD usa a lista para vincular a tabela Profissional no SHX.
- **R11.2** Também exportar quem deixou de estar ativo desde a última exportação, para desvincular a tabela.

### 6.12 Notificações

- **R12.1** Eventos enfileiram mensagens na outbox: boas-vindas do prestador (código e link), novo cliente vinculado (primeiro nome), crédito liberado (valor e validade), saldo a vencer, resgate confirmado, mudança de nível e código de acesso ao portal.
- **R12.2** Modelos em português, com variáveis. Adapter de log na Fase 1; adapter da API oficial do WhatsApp na Fase 2, sem mudar quem enfileira.
- **R12.3** Mensagens de oferta só para quem consentiu. Saldo, vencimento e acesso são mensagens do próprio programa.

### 6.13 LGPD e privacidade

- **R13.1** Registrar aceite do regulamento (versão, data, canal) de prestadores e clientes vinculados; consentimento de ofertas separado e revogável.
- **R13.2** O portal mostra dos clientes vinculados só o primeiro nome, o CPF mascarado, a validade do vínculo e o bônus gerado. Nunca itens, valores de compra ou telefone.
- **R13.3** Pedido de exclusão: anonimizar dados pessoais e manter os lançamentos ligados a um identificador interno.
- **R13.4** XMLs brutos em armazenamento de acesso restrito, com prazo de guarda definido pela contabilidade.
- **R13.5** Logs sem CPF ou CNPJ em claro.

## 7. Importação de notas

Fonte na Fase 1: pasta monitorada, ou upload manual no painel de gestão, com XMLs de NFC-e (modelo 65) e NF-e (modelo 55) autorizados, exportados pelo SHX/GIX, mais os XMLs de evento de cancelamento.

Implementar a leitura atrás de uma interface `SalesSource`, com `XmlFolderSource` na Fase 1. Uma futura `ShxApiSource` não pode exigir mudança no motor.

| Dado | Caminho no XML (layout 4.00) |
| --- | --- |
| Chave de acesso | atributo `Id` de `infNFe` sem o prefixo `NFe`, ou `protNFe/infProt/chNFe` |
| Autorização | `protNFe/infProt/cStat` = 100 |
| Modelo | `ide/mod` |
| Tipo | `ide/tpNF` (1 saída, 0 entrada) |
| Finalidade | `ide/finNFe` (1 normal, 4 devolução) |
| Nota referenciada | `ide/NFref/refNFe` |
| Emissão | `ide/dhEmi` |
| Loja | `emit/CNPJ` |
| Destinatário | `dest/CPF` ou `dest/CNPJ` (ausente quando o cliente não se identifica) |
| Itens | `det` (atributo `nItem`): `prod/cProd`, `prod/xProd`, `prod/qCom`, `prod/vProd`, `prod/vDesc` |
| Totais | `total/ICMSTot/vNF`, `total/ICMSTot/vDesc` |
| Pagamento | `pag/detPag/tPag` |
| Observação | `infAdic/infCpl` |
| Cancelamento | `procEventoNFe/evento/infEvento` com `tpEvento` 110111 e `chNFe` |

Regras de importação:

- Idempotente pela chave; reimportar o mesmo arquivo não muda nada.
- Nota sem destinatário identificado é registrada só para a métrica de vendas identificadas.
- XML inválido, não autorizado ou de outra empresa vai para os erros do lote.
- Cada lote mostra: lidas, novas, repetidas, cancelamentos, devoluções, erros.
- O projeto traz um gerador de XMLs sintéticos válidos para testes, com CPFs fictícios válidos.

## 8. Telas

### 8.1 Painel do caixa (tablet ou desktop)

- Busca por CPF, CNPJ ou código.
- Card do participante: nome, tipo, nível, saldo disponível, pendente, retido e próximo vencimento.
- Ações: vincular cliente a prestador, com bloqueios e alertas à vista; desconto de boas-vindas (valor da compra → desconto → confirmar); reservar resgate (valor da compra → máximo → valor → código da reserva em destaque, com a instrução "aplique no GIX como desconto Clube CDC e anote o código na observação"); cancelar reserva; pré-cadastrar prestador.
- Cada ação em menos de 30 segundos para um operador treinado.

### 8.2 Página pública `/i/{CODIGO}`

- Mostra o primeiro nome e a profissão do prestador e o benefício: 5% na primeira compra, até R$ 50.
- Formulário: CPF, nome, WhatsApp, aceite do regulamento e consentimento opcional de ofertas.
- Resultado: "Pronto. Informe seu CPF no caixa da CDC."

### 8.3 Portal do prestador (celular primeiro)

- Login com documento e código de acesso.
- Saldo disponível, pendente, retido e a vencer; extrato por mês.
- Código, link, QR e botão de compartilhar no WhatsApp.
- Clientes vinculados, conforme R13.2.
- Nível atual, volume de 90 dias e quanto falta para o próximo nível.
- Perfil profissional: profissões, áreas de atendimento, certificações (declarar e ver a situação) e consentimento de vitrine.
- Aba Capacitação: trilhas, vídeos e aulas publicados pela gestão, com marcação de assistido. Vídeo hospedado fora do motor (ex.: YouTube não listado) e leve para celular.

### 8.4 Painel de gestão

- Filas: aprovação, revalidação, créditos retidos, alertas e divergências de conciliação.
- Prestadores: filtros por loja, vendedor, gerente, nível e situação; ficha com histórico e auditoria.
- Parâmetros com vigência.
- Importações: lotes, erros e itens sem faixa; importação de CSVs auxiliares.
- Catálogo de profissões, verificação de certificações e conteúdos de capacitação (cadastro, ordem, publicação e quem assistiu).
- Relatórios com exportação CSV: receita indicada por prestador e por vendedor; bônus gerado, liberado, resgatado, vencido, retido e a vencer (passivo do programa); prestadores ativos por nível; percentual de vendas identificadas na loja piloto; percentis de volume para os limites de nível.

## 9. Jobs

Horários em `America/Manaus`. Todos idempotentes e reexecutáveis.

| Job | Frequência | O que faz |
| --- | --- | --- |
| Importar notas | A cada hora | Lê a fonte, importa vendas, cancelamentos e devoluções, gera créditos e estornos |
| Liberar créditos | Diário, 01:00 | Libera créditos com carência cumprida |
| Vencer créditos | Diário, 01:15 | Lança vencimentos |
| Recalcular níveis | Diário, 02:00 | Promoções |
| Revisão trimestral | 1º de jan, abr, jul e out, 03:00 | Rebaixamentos |
| Inatividade e revalidação | Diário, 03:30 | Inativa prestadores e abre a fila de revalidação |
| Exportar ativos | Diário, 05:00 | CSV de ativos e de desligados para o SHX |
| Avisos de vencimento | Diário, 09:00 | Enfileira avisos de 15 e 3 dias |
| Conciliar | A cada hora e às 23:30 | Casa reservas e boas-vindas com notas; expira reservas vencidas |
| Enviar outbox | A cada minuto | Entrega mensagens pelo adapter |

## 10. Critérios de aceite

Premissas: parâmetros da seção 4; prestador Carlos, nível Profissional, ativo; loja piloto L1; produtos P-A (faixa A), P-C (faixa C) e P-D (faixa D); cliente Ana, sem vínculo anterior. Todos os documentos são sintéticos.

1. **Compra própria:** Carlos compra R$ 1.000,00 em P-A e R$ 200,00 em P-C → crédito pendente de R$ 10,00, liberado 7 dias depois.
2. **Compra indicada:** Ana, vinculada a Carlos, compra R$ 1.000,00 em P-A e R$ 500,00 em P-C → crédito de indicação de R$ 45,00 para Carlos.
3. **Faixa D:** compra indicada de R$ 800,00 só em P-D → crédito zero.
4. **Desconto no item:** item P-A com `vProd` R$ 100,00 e `vDesc` R$ 10,00 → base de R$ 90,00.
5. **Autoindicação:** Carlos tenta vincular o próprio CPF ao próprio código → bloqueado, com mensagem clara.
6. **Funcionário:** CPF da lista de funcionários tenta se vincular → bloqueado.
7. **Janela de 120 dias:** vínculo iniciado em 01/02/2027 → venda de 31/05/2027 atribuída a Carlos; venda de 02/06/2027 não atribuída.
8. **Renovação:** Ana apresenta de novo o código de Carlos em 01/05/2027 → o vínculo passa a terminar em 29/08/2027.
9. **Último código vale:** Ana, vinculada a Carlos desde 01/02/2027, apresenta o código de Bruno em 03/03/2027 → vendas anteriores à troca ficam com Carlos, as seguintes com Bruno; o vínculo de Carlos termina como substituído.
10. **Alerta de troca:** terceira troca de prestador para o mesmo cliente em 90 dias → alerta criado e vínculo criado.
11. **Cancelamento na carência:** venda indicada de R$ 1.000,00 em P-A em 10/02/2027 gera R$ 40,00 pendentes; cancelamento da nota em 12/02/2027 → pendente zerado e nada liberado.
12. **Devolução após liberação:** venda indicada de 10 unidades de P-A por R$ 1.000,00 (R$ 40,00 liberados); devolução de 2 unidades → `ESTORNO` de R$ 8,00.
13. **Teto mensal:** Carlos já tem R$ 980,00 de indicação no mês; nova venda indicada gera R$ 45,00 → R$ 20,00 seguem normais e R$ 25,00 ficam retidos.
14. **Teto de resgate:** Carlos tem R$ 300,00 disponíveis e compra R$ 400,00 → máximo de R$ 200,00; resgata R$ 200,00 e ficam R$ 100,00.
15. **FIFO:** lotes de R$ 50,00 (vence 01/08/2027) e R$ 80,00 (vence 01/09/2027); resgate de R$ 60,00 consome R$ 50,00 do primeiro e R$ 10,00 do segundo.
16. **Vencimento:** lote de R$ 70,00 com R$ 20,00 usados chega ao fim da validade → `VENCIMENTO` de R$ 50,00.
17. **Reserva expirada:** reserva de R$ 100,00 às 10:00 sem nota até 10:00 do dia seguinte → expirada, e R$ 100,00 voltam aos mesmos lotes.
18. **Conciliação:** reserva `R7K4M` de R$ 100,00; nota da mesma loja e do mesmo documento, 40 minutos depois, com desconto total de R$ 100,00 e `R7K4M` em `infCpl` → reserva confirmada e ligada à chave da nota.
19. **Idempotência:** o mesmo XML importado duas vezes → uma nota e um crédito.
20. **Boas-vindas:** primeira vinculação de Ana, compra de R$ 1.500,00 → desconto sugerido de R$ 50,00 (5% daria R$ 75,00); vinculação posterior de Ana a outro prestador → sem desconto de boas-vindas.
21. **Promoção de nível:** volume de 90 dias de Carlos passa o limite de Parceiro → promovido no recálculo diário; vendas a partir da promoção usam as taxas de Parceiro.
22. **Inatividade:** prestador sem compra própria e sem venda indicada há 180 dias → inativo; sai do CSV de ativos e entra no de desligados.
23. **Lista B2B:** documento da lista B2B não consegue vínculo, e nota com esse destinatário não gera crédito de indicação.
24. **Venda a prazo:** venda indicada com `tPag` 15, sozinho ou junto com outra forma de pagamento → nenhum crédito (R6.2).

## 11. Etapas de construção

Cada etapa termina com testes passando e o README atualizado.

1. **Base:** projeto, ambiente local, banco, login de usuários internos, perfis, auditoria, parâmetros com vigência e dados sintéticos.
2. **Cadastros auxiliares:** importação por CSV de lojas, produtos com margem e faixa, lista de exclusão; relatório de itens sem faixa.
3. **Notas:** gerador de XMLs sintéticos, importador idempotente, cancelamentos, devoluções, lotes e erros. Critério 19.
4. **Motor e ledger:** acúmulo, carência, teto e retenção, validade, FIFO, estornos e venda a prazo. Critérios 1 a 4, 11 a 13, 15, 16 e 24.
5. **Prestadores:** cadastro, aprovação, código, suspensão, revalidação, níveis e inatividade; perfil profissional (profissões, regulamentação, certificações, áreas de atendimento e consentimento de vitrine). Critérios 21 e 22.
6. **Vínculos:** painel do caixa e página pública, bloqueios, renovação, troca, alertas, retroativo e boas-vindas. Critérios 5 a 10, 20 e 23.
7. **Resgate:** reserva, cancelamento, conciliação e expiração. Critérios 14, 17 e 18.
8. **Jobs e outbox:** agendamentos da seção 9 e adapter de log.
9. **Portal do prestador**, com a aba Capacitação.
10. **Painel de gestão:** filas, relatórios, exportações, o CSV diário de ativos, catálogo de profissões, verificação de certificações e conteúdos de capacitação.
11. **Entrega ao CPD:** README de implantação, variáveis de ambiente, backup, monitoramento dos jobs e checklist de LGPD.

## 12. Questões em aberto

| # | Questão | Quem responde |
| --- | --- | --- |
| 1 | Hospedagem (stack: padrão do CLAUDE.md, sem preferência declarada) | CPD |
| 2 | Como o SHX/GIX entrega os XMLs (pasta, SFTP ou API) e com que frequência | SHX e CPD |
| 3 | Se o GIX aceita texto livre na observação da NFC-e, para o código da reserva | SHX |
| 4 | Loja piloto e lista inicial de prestadores | Comercial |
| 5 | Limites em reais dos níveis Parceiro e Parceiro Ouro | Comercial, após o relatório de percentis |
| 6 | Arquivo de margem por produto (frequência decidida: semanal) | Comercial e CPD |
| 7 | Baixa de títulos do SHX para liberar créditos de venda a prazo | Financeiro e CPD |
| 8 | Validade do bônus devolvido por devolução de compra (proposta: 30 dias) | Comercial |
| 9 | Textos do regulamento e da política de privacidade, com cláusulas completas de elegibilidade, bloqueio de prestador irregular (R2.5), direito de alterar critérios por vigência e LGPD | Jurídico |
| 10 | Resgate como desconto incondicional na nota | Contabilidade |
| 11 | Provedor de identidade para usuários internos (hoje e-mail e senha) | CPD |
| 12 | Bônus de cliente que chegar pela vitrine do CDC Indica (sugestão: origem própria, taxa menor ou zero, conta para ranking e nível) | Comercial |
| 13 | Responsabilidade da CDC pelo serviço de prestador indicado na vitrine (Código de Defesa do Consumidor, arts. 7º, 25 e 34) | Jurídico |
| 14 | Modelo de ganho do CDC Indica (sugestão para começar: gratuito para o prestador, ganho na venda de material) | Comercial |
| 15 | Hospedagem dos vídeos de capacitação e parcerias de conteúdo (fabricantes, SENAI-AM) | Comercial e CPD |
| 16 | Pesquisa jurídica completa e elaboração dos documentos do programa, com especialista; escopo inicial na seção 15 | Diretoria e Jurídico |

## 13. Registro de decisões

| Data | Decisão |
| --- | --- |
| 06/11/2026 | Caminho híbrido: a Fase 1 constrói o trilho Prestador no motor próprio; o CPF entra no motor na Fase 2. |
| 06/11/2026 | Benefício em bônus (R$) para a próxima compra, sem cashback em dinheiro. |
| 06/11/2026 | Fase 1 lê as vendas por XML; integração em tempo real com o caixa fica para a Fase 2. |
| 06/11/2026 | Stack padrão do CLAUDE.md (sem preferência declarada pelo CPD). Hospedagem ainda em aberto; recomendação: servidor ou VM com Docker (na CDC ou nuvem com região no Brasil), porque a importação lê pasta monitorada e os jobs precisam de processo contínuo. |
| 06/11/2026 | Página pública só cria vínculo para CPF sem vínculo ativo ou renova o mesmo código; troca de prestador só no caixa (R3.1a). |
| 06/11/2026 | Nota de reserva que chega atrasada, mas emitida no prazo, casa mesmo assim; resgate relançado e alerta (R8.5b). |
| 06/11/2026 | A nota manda: desconto aplicado a menor confirma a reserva pelo valor encontrado, devolve a diferença e abre alerta (R8.5a). |
| 06/11/2026 | Sem vínculo retroativo: R3.9 e `retroactive_link_hours` removidos. Venda emitida antes do vínculo não é atribuída. |
| 06/11/2026 | Teto mensal aplicado na ordem de importação das notas, sem recálculo (R7.1). |
| 06/11/2026 | Nota com pagamento a prazo, inclusive misto, não gera bônus (R6.2, critério 24). |
| 06/11/2026 | Crédito retido aprovado libera no mínimo 14 dias após a venda (`held_approval_holding_days`, R7.2). |
| 06/11/2026 | Prestador suspenso, inativo ou pendente não acumula nem resgata; o regulamento deve trazer cláusulas completas sobre isso (R2.5, R8.9). |
| 06/11/2026 | Compras em todas as lojas CDC contam para volume de nível e atividade; só as lojas em `enabled_store_ids` geram bônus (R10.1, R10.4). |
| 06/11/2026 | Faixa congelada na importação; base de produtos atualizada semanalmente (R5.2). |
| 06/11/2026 | Alerta de troca conta substituições (R3.5): 3 substituições em 90 dias. |
| 06/11/2026 | Boas-vindas: CPF que nunca recebeu e tem vínculo ativo, inclusive pela página pública (R4.1). |
| 06/11/2026 | Um documento por participante na Fase 1, sem documento secundário (R1.1). |
| 06/11/2026 | Programa pode mudar critérios a qualquer momento por nova versão de parâmetro, nunca retroativa; conceder bônus não é obrigação fora dos critérios vigentes (cláusula para o regulamento). |
| 06/11/2026 | Etapa 2: lista de exclusão guardada como períodos (entrada e saída), para avaliar cada nota pela lista na data de emissão. Importação em dois modos: incremental (nunca remove) e completo por origem (remove quem é da mesma origem e não veio no arquivo). Produtos nunca são apagados. Relatório "itens sem faixa" entregue na etapa 3, junto com os itens de nota. Layouts em `docs/importacao-csv.md`. |
| 06/11/2026 | Perfil profissional do prestador entra na etapa 5: profissões padronizadas, profissão regulamentada com registro no conselho, certificações declaradas ou verificadas, áreas de atendimento e consentimento de vitrine (R1.7 a R1.9). Sem exibição pública na Fase 1. |
| 06/11/2026 | Aba Capacitação simples no portal do prestador (etapa 9), com gestão dos conteúdos no painel (etapa 10). O braço de capacitação evolui depois. |
| 06/11/2026 | CDC Indica registrado como Fase 2 e CDC Serviços como Fase 3 (seção 14). |
| 06/11/2026 | Frente jurídica: pesquisa completa e elaboração do regulamento, termos e contratos com apoio especializado (questão 16); escopo inicial na seção 15. |
| 06/11/2026 | Adotados sem objeção: fim do vínculo por instante (início + 120 dias, mesma hora); validade com último dia inclusivo; lote por nota e tipo de crédito, dividido quando o teto corta; estorno proporcional entre parte normal e retida; saldo negativo absorvido pelo próximo crédito liberado; ajuste positivo cria lote de 180 dias e negativo consome FIFO; cancelamento de nota com resgate devolve aos mesmos lotes; devolução com resgate proporcional ao vProd devolvido; casamento de item devolvido por cProd; cancelamento antes da nota fica guardado; sem verificação de assinatura digital na Fase 1; data de ativação da exportação = última ativação; prestador que entra na lista de exclusão gera só alerta; CNPJ alfanumérico aceito. |

## 14. Fases seguintes (visão)

Registro de direção, sem compromisso de escopo ou prazo. Cada fase ganha SPEC própria antes de começar.

### Fase 2 — CDC Indica

- Página pública de busca de prestadores por serviço e por bairro ou município.
- Só aparecem prestadores ativos, revalidados e com consentimento de vitrine (R1.9). Selos só de certificações verificadas (R1.8).
- Contato pelo sistema (botão de WhatsApp intermediado), para medir os contatos e vincular o cliente ao prestador com origem "vitrine". A regra de bônus para esse vínculo está na questão 12.
- Avaliações só de clientes que foram vinculados ou compraram, com moderação da gestão.
- Ranking com critérios a definir (nível, capacitação concluída, avaliações).
- Também entram na Fase 2 o acúmulo para clientes CPF e o envio real por WhatsApp, já previstos.

### Fase 3 — CDC Serviços

- Serviços próprios da CDC (instalação, montagem e outros) no mesmo catálogo de profissões, com agendamento e garantia.
- Exige definição fiscal (ISS e NFS-e de Manaus) e trabalhista (equipe própria ou parceiros).

### Capacitação (evolução)

- Trilhas completas, certificados de conclusão e parcerias de conteúdo. A conclusão pode contar para ranking e selos.
- Certificado da CDC não substitui as capacitações obrigatórias das normas regulamentadoras (NR-10, NR-35) nem o registro em conselho.

## 15. Frente jurídica (escopo inicial para o especialista)

Ponto de partida para a pesquisa e a redação dos documentos (questão 16). Não é parecer jurídico; cada item precisa ser validado e aprofundado por advogado.

- **Código de Defesa do Consumidor (Lei 8.078/1990):** oferta vincula (arts. 30 e 35), então o benefício anunciado na página pública e no regulamento precisa ser cumprido; informação clara (arts. 6º, III, e 31); contrato de adesão legível e com cláusulas limitativas em destaque (art. 54, §§ 3º e 4º); cláusulas abusivas (art. 51), em especial alteração unilateral depois da adesão (inciso XIII) e exclusão de responsabilidade (inciso I) — afeta a decisão de poder mudar critérios a qualquer momento; responsabilidade solidária por representantes autônomos e na cadeia de fornecimento (arts. 7º, parágrafo único, 25 e 34) — afeta o CDC Indica.
- **Código Civil:** contrato de adesão (arts. 423 e 424) e boa-fé (art. 422). Natureza da relação com o prestador: a indicação recompensada em bônus não pode se confundir com corretagem (arts. 722 a 729), agência (arts. 710 a 721), representação comercial (Lei 4.886/1965) ou vínculo de emprego.
- **LGPD (Lei 13.709/2018):** base legal por finalidade (execução do contrato do programa; consentimento para ofertas e vitrine; legítimo interesse para prevenção de fraude — arts. 7º, 8º e 10); o controlador precisa provar o consentimento (art. 8º, § 2º), o que afeta o aceite feito no caixa; direitos do titular (art. 18); crianças e adolescentes (art. 14), o que pede idade mínima no regulamento; encarregado (art. 41); segurança e comunicação de incidentes (arts. 46 e 48); transferência internacional se a hospedagem for fora do Brasil (art. 33).
- **Marco Civil da Internet (Lei 12.965/2014):** guarda dos registros de acesso do portal e da página pública (art. 15) e termos de uso.
- **Comércio eletrônico (Decreto 7.962/2013):** informações e atendimento nas páginas online.
- **Promoções comerciais (Lei 5.768/1971):** o desconto do programa não depende de sorte, mas qualquer sorteio, vale-brinde ou concurso dentro do clube precisa de autorização do Ministério da Fazenda.
- **Tributário:** bônus como desconto incondicional na nota (questão 10; base do ICMS, LC 87/1996, art. 13, § 1º); nenhum pagamento em dinheiro ao prestador; na Fase 3, ISS e NFS-e.
- **Profissões e conteúdos:** conselhos para os selos (CREA — Lei 5.194/1966; CFT/CRT — Lei 13.639/2018; CAU — Lei 12.378/2010); capacitação da CDC não pode ser apresentada como cumprimento de NR-10 ou NR-35 sem seguir essas normas; direitos autorais e de imagem dos conteúdos (Lei 9.610/1998).
- **Documentos a elaborar:** regulamento do Clube CDC (prestador e cliente indicado); termo de adesão do prestador, com código de conduta e hipóteses de suspensão; termos de uso do portal e da página pública; política de privacidade; termo de consentimento de vitrine; autorização de uso de imagem para os conteúdos de capacitação; na Fase 3, contratos de serviço.
