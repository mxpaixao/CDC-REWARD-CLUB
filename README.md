# Motor Clube CDC

Motor próprio do programa de fidelidade **Clube CDC** da Casa das Correias: regras, saldos em ledger,
códigos de indicação, leitura das notas fiscais do SHX/GIX e os painéis de operação.

- Regra de negócio: [`docs/SPEC-fase-1.md`](docs/SPEC-fase-1.md) — em caso de dúvida, a SPEC manda.
- Instruções de trabalho e regras invioláveis: [`CLAUDE.md`](CLAUDE.md).

## Situação

Fase 1 (piloto do trilho Prestador), construída por etapas (SPEC seção 11).

| Etapa | Situação |
| --- | --- |
| 1. Base | **concluída** |
| 2. Cadastros auxiliares | **concluída** |
| 3. Notas | **concluída** (critério 19: parte da nota; a do crédito fecha na etapa 4) |
| 4. Motor e ledger | próxima |
| 5–11 | pendentes |

Os 24 critérios de aceite da SPEC seção 10 já estão em `tests/acceptance/criterios-secao-10.test.ts`
como pendentes, cada um marcado com a etapa que o fecha.

## Como rodar

Requisitos: Node.js 26 LTS e Docker (ou um PostgreSQL 16+ local).

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

O seed cria lojas, usuários, parâmetros, produtos e lista de exclusão, todos sintéticos.
Para ter notas: `npm run synthetic:xml -- --saida var/inbox` e depois
`npm run import:xml -- --usuario admin@exemplo.test`.

Acesse http://localhost:3000 e entre com um dos usuários sintéticos — a senha é o `SEED_PASSWORD` do `.env`:

| E-mail | Perfil |
| --- | --- |
| `admin@exemplo.test` | Admin |
| `gerente@exemplo.test` | Gerente de canal |
| `caixa@exemplo.test` | Operador de caixa (loja piloto sintética L1) |

Para subir tudo em contêineres (banco, migração e app): `docker compose up -d --build`.

## Testes

```bash
npm test                  # tudo
npm run test:unit         # domínio, sem banco
npm run test:integration  # com banco: apaga e recria TEST_DATABASE_URL (precisa terminar em _test)
```

## O que a etapa 1 entrega

- **Projeto:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL, Vitest, Docker Compose.
- **Dinheiro** (`src/domain/money.ts`): centavos inteiros, percentuais em decimal, arredondamento
  meio para cima (R5.5) e para baixo (R8.2) explícitos; float é rejeitado.
- **CPF e CNPJ** (`src/domain/document.ts`): validação de dígitos, inclusive CNPJ alfanumérico
  (IN RFB 2.229/2024), normalização e máscara `***.456.789-**`.
- **Datas de negócio** (`src/domain/business-time.ts`): tudo em America/Manaus.
- **Parâmetros com vigência** (`src/domain/params`, `src/application/parameters.ts`): os 26 parâmetros
  da SPEC seção 4 (com as decisões de 06/11/2026), validados por esquema; mudança só por nova versão,
  nunca retroativa, só Admin, auditada. API: `GET/POST /api/parameters`.
- **Login de usuários internos** (`src/application/auth.ts`): e-mail e senha (scrypt), sessão com token
  guardado só como hash, bloqueio temporário após tentativas erradas.
- **Perfis e permissões** (`src/domain/auth/roles.ts`): Admin, Gerente de canal e Operador de caixa (SPEC seção 3).
- **Auditoria** (`src/application/audit.ts`): quem, o quê, antes, depois e quando, na mesma transação da
  mudança; a tabela só aceita inserção (trigger no banco), assim como as versões de parâmetro.
- **Logs** (`src/infra/log/logger.ts`): JSON por linha, CPF e CNPJ mascarados automaticamente.
- **Dados sintéticos** (`src/synthetic`): gerador determinístico de CPF, CNPJ, nomes e telefones;
  personas dos critérios de aceite (Carlos, Ana, Bruno); 4 lojas sintéticas com L1 como piloto.
- **Saúde:** `GET /api/health` para o monitoramento.

## O que a etapa 2 entrega

- **Importação por CSV** de lojas, produtos com margem e lista de exclusão — layouts e regras em
  [`docs/importacao-csv.md`](docs/importacao-csv.md). Linha de comando (`npm run import:csv`) e API
  (`POST /api/imports/csv`, `GET /api/imports`), só para Admin.
- **Lote de importação** com lidas, novas, atualizadas, sem mudança, removidas e erros por linha;
  gravação atômica; simulação sem gravar; reimportação idempotente; auditoria de cada mudança.
- **Faixa de margem** (`src/domain/margin-band.ts`) calculada pelo parâmetro `band_min_margin_pct`.
- **Lista de exclusão com histórico** de períodos (`src/application/exclusion-list.ts`): responde se um
  documento estava na lista numa data; modos incremental e completo por origem; período encerrado é
  imutável no banco.
- **Seed** agora carrega também produtos (P-A, P-B, P-C, P-D dos critérios + 50 sorteados) e a lista
  de exclusão sintética.
- O relatório **"itens sem faixa"** depende dos itens de nota e entra na etapa 3.

## O que a etapa 3 entrega

- **Leitura de XML** de NFC-e e NF-e (layout 4.00) e dos eventos de cancelamento
  (`src/infra/sales-source/nfe-xml.ts`), com validação da chave de acesso (inclusive CNPJ
  alfanumérico), da autorização e da loja emitente; XML com DOCTYPE é recusado.
- **Fonte de vendas atrás de interface** (`SalesSource`): pasta monitorada e upload manual. Uma
  futura API do SHX entra sem mudar o motor.
- **Importador idempotente** pela chave (`src/application/imports/invoice-import.ts`): uma transação
  por documento, cancelamento antes ou depois da nota, cancelamento por substituição, devoluções
  ligadas à venda, faixa congelada no item, lote com totais e mensagens; notas imutáveis no banco.
- **XML bruto** guardado em armazenamento restrito (permissões 0700/0600).
- **Gerador de XMLs sintéticos** em homologação (`npm run synthetic:xml`) e importação manual
  (`npm run import:xml`, `POST /api/imports/xml`).
- **Relatório "itens sem faixa"** (`GET /api/reports/items-without-band`).
- Detalhes para o CPD em [`docs/importacao-notas.md`](docs/importacao-notas.md).

## Estrutura

```
src/
  domain/        regras puras, sem banco nem rede
  application/   casos de uso: transação, permissão, auditoria
  infra/         banco (Prisma), log, segurança, configuração
  app/           Next.js: telas e rotas de API
  synthetic/     geradores de dados sintéticos e seed
prisma/          schema, migrações e seed
scripts/         linha de comando (importar CSV, gerar CSVs sintéticos)
tests/
  unit/          domínio
  integration/   com banco
  acceptance/    critérios da SPEC seção 10
docs/            SPEC, layouts de CSV e importação de notas
```
