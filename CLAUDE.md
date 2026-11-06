# Motor Clube CDC

Programa de fidelidade da Casa das Correias (CDC), home center B2B+B2C em Manaus, com quatro lojas. Este repositório é o motor próprio do Clube CDC: regras, saldos em ledger, códigos de indicação, leitura das notas fiscais do SHX/GIX e os painéis de operação.

A regra de negócio está em `docs/SPEC-fase-1.md`. Em caso de dúvida, a SPEC manda. Se a SPEC não cobre um caso, pergunte antes de decidir.

Documento de negócio de referência: "Clube CDC — Programa de Fidelidade" (Diretoria Comercial). Tudo o que importa para a Fase 1 já está na SPEC.

## Fase atual

Fase 1 — piloto do trilho Prestador de serviço em uma loja:

- cadastro e aprovação de prestadores, com código de indicação, link e QR;
- vínculo cliente–prestador por 120 dias;
- leitura de notas fiscais (XML de NFC-e e NF-e) exportadas do SHX/GIX;
- bônus em ledger, com carência, validade, tetos, retenção e estornos;
- resgate com reserva pelo painel do caixa e conciliação com as notas;
- portal do prestador, painel do caixa e painel de gestão.

Fora da Fase 1: app nativo, envio real de WhatsApp (só outbox e adapter), chamada em tempo real a partir do caixa do GIX, acúmulo de bônus para clientes CPF, cálculo da tabela de preço do prestador (é feito no SHX) e qualquer integração com a Fidelimax.

## Stack

Antes de criar o projeto, pergunte ao usuário qual stack o CPD da CDC domina e onde o sistema será hospedado. Sem preferência declarada, use:

- TypeScript e Node.js na versão LTS atual
- Next.js (App Router) para painéis, portal, página pública e API
- PostgreSQL (versão estável atual) com Prisma
- pg-boss para jobs agendados
- Vitest para testes
- Docker Compose para o ambiente local

Registre aqui a decisão final de stack e hospedagem.

**Decisão (06/11/2026):** o CPD não declarou preferência; adotada a stack padrão acima, nas versões:
Node.js 26 LTS, TypeScript 6, Next.js 16 (App Router), PostgreSQL 18 (Docker; testes rodam em 16+),
Prisma 7 com `@prisma/adapter-pg`, Vitest 5, pg-boss (etapa 8). Datas com Luxon, decimais com decimal.js,
validação com zod. **Hospedagem: em aberto** — recomendação registrada na SPEC seção 13.

Estrutura: `src/domain` (regras puras, sem I/O), `src/application` (casos de uso, transação, auditoria),
`src/infra` (banco, log, segurança, integrações), `src/app` (Next.js), `src/synthetic` (dados sintéticos),
`tests/unit`, `tests/integration`, `tests/acceptance` (critérios da seção 10).

## Regras invioláveis

1. Dinheiro em centavos, como inteiro. Nunca `float` para valores monetários; percentuais com aritmética decimal.
2. Saldo é a soma do ledger. Lançamentos são imutáveis; correção é um novo lançamento de ajuste, com motivo e usuário.
3. Importação de nota é idempotente pela chave de acesso de 44 dígitos.
4. Todo número de regra (percentuais, prazos, tetos, limites de nível) vem da tabela de parâmetros com vigência. Nada de número fixo no código.
5. Datas de negócio (carência, validade, mês do teto, trimestre, janelas de vínculo) em `America/Manaus`.
6. CPF e CNPJ: validar dígitos, guardar só os dígitos, nunca escrever em log em claro, mascarar em telas de terceiros (ex.: `***.456.789-**`).
7. Nenhum dado real de cliente entra no repositório, em fixtures, em testes ou em prompts. Use dados sintéticos e XMLs de exemplo gerados pelo próprio projeto.
8. Toda ação de usuário interno que muda dado grava auditoria: quem, o quê, antes, depois e quando.
9. Integrações externas (SHX/GIX, WhatsApp) ficam atrás de interfaces, com implementação fake para testes.
10. Cada regra da SPEC tem teste. Os critérios de aceite da seção 10 da SPEC viram testes automatizados antes das telas.
11. Todo job é idempotente e pode ser reexecutado sem duplicar lançamentos.

## Glossário (domínio → código)

| Domínio | Código |
| --- | --- |
| participante | member |
| prestador de serviço | provider |
| cliente indicado | referred_customer |
| código de indicação | referral_code |
| vínculo de indicação | referral_link |
| lançamento do ledger | ledger_entry |
| lote de crédito | credit_lot |
| faixa de margem (A a D) | margin_band |
| nível | tier |
| carência | holding_period |
| reserva de resgate | redemption_hold |
| retido para revisão | held_for_review |
| nota fiscal / item | invoice / invoice_item |
| loja | store |
| operador de caixa | cashier |
| gerente de canal | channel_manager |
| desconto de boas-vindas | welcome_discount |

Nomes de código em inglês. Textos de tela, mensagens, documentação e commits em português do Brasil.

## Forma de trabalho

- Siga a ordem de etapas da seção 11 da SPEC. Uma etapa por vez.
- Ao fim de cada etapa: testes passando, README atualizado e um resumo curto do que mudou e do que ficou pendente.
- Mudança de regra de negócio só com confirmação do usuário. Registre a decisão na seção 13 da SPEC.
- Mantenha a seção "Comandos" abaixo sempre atualizada.

## Comandos

Copie `.env.example` para `.env` antes de tudo.

| O quê | Comando |
| --- | --- |
| Subir só o banco | `docker compose up -d db` |
| Subir banco + migração + app | `docker compose up -d --build` |
| Instalar dependências | `npm install` (gera o cliente Prisma) |
| Aplicar migrações | `npm run db:migrate` |
| Criar migração nova (dev) | `npm run db:migrate:dev -- --name <nome>` |
| Carregar dados sintéticos | `npm run db:seed` |
| Zerar o banco local | `npm run db:reset` |
| App em desenvolvimento | `npm run dev` → http://localhost:3000 |
| Todos os testes | `npm test` |
| Só testes de unidade | `npm run test:unit` |
| Só testes com banco | `npm run test:integration` (usa `TEST_DATABASE_URL`, apagado a cada execução) |
| Checagem de tipos | `npm run typecheck` |
| Build de produção | `npm run build` |

A preencher nas próximas etapas: gerar e importar XMLs sintéticos (etapa 3), rodar cada job manualmente (etapa 8).
