# Importação dos cadastros auxiliares (CSV)

Três arquivos alimentam o motor além das notas fiscais: **lojas**, **produtos com margem** e
**lista de exclusão**. O layout abaixo é o que o importador aceita. O formato exato que o SHX
consegue exportar ainda está em aberto (questão 6 da SPEC), e ajustes de nome de coluna são simples.

## Regras gerais

- Codificação UTF-8 (com ou sem BOM) ou Windows-1252.
- Separador `;` (padrão do Excel em português) ou `,`, detectado pelo cabeçalho.
- Primeira linha é o cabeçalho. Maiúsculas, acentos e espaços no nome da coluna não importam
  (`Margem Bruta %` vale como `margem_bruta`). Colunas extras são ignoradas.
- Campos com `;`, aspas ou quebra de linha vão entre aspas duplas; aspas dentro do campo viram `""`.
- Linhas inválidas vão para os erros do lote, com o número da linha; as válidas são gravadas.
  Cabeçalho sem coluna obrigatória falha o lote inteiro.
- Tudo é gravado numa transação: ou o lote entra inteiro (menos as linhas com erro), ou nada entra.
- Reimportar o mesmo arquivo não muda nada.
- Cada mudança gera auditoria com antes e depois, em nome de quem importou (perfil Admin).
- **Simulação:** valide o arquivo e veja o que mudaria sem gravar (`--simular` ou `simular=1`).
- Mensagens de erro nunca repetem CPF ou CNPJ.

## Lojas — `lojas.csv`

| Coluna | Obrigatória | Conteúdo |
| --- | --- | --- |
| `codigo` | sim | Código estável da loja, usado nos parâmetros (ex.: `L1`). Até 10 letras, números ou hífen |
| `nome` | sim | Nome da loja |
| `cnpj` | sim | CNPJ válido, com ou sem pontuação (aceita o alfanumérico) |
| `piloto` | não | `sim` ou `não` (padrão `não`) |

Loja nova é criada; loja existente (mesmo código) é atualizada. CNPJ que já pertence a outra loja é erro.
Quais lojas geram bônus continua no parâmetro `enabled_store_ids`; a coluna `piloto` é informativa
(métrica de vendas identificadas da loja piloto).

## Produtos — `produtos.csv`

| Coluna | Obrigatória | Conteúdo |
| --- | --- | --- |
| `codigo` | sim | Código do produto exatamente como sai no `cProd` do XML |
| `descricao` | sim | Descrição |
| `categoria` | não | Categoria, grupo ou departamento |
| `margem_bruta_pct` | sim | Margem bruta em %, com vírgula ou ponto (ex.: `35,5`). Entre -100 e 100 |

A faixa (A a D) é calculada pela margem com o parâmetro `band_min_margin_pct` vigente no momento
da importação. Produto não é apagado quando some do arquivo (as notas antigas o referenciam).
Frequência decidida: **semanal**. A faixa que vale para o crédito é congelada no item da nota quando
a nota é importada (R5.2): atualizar a margem depois não muda créditos já gerados.

## Lista de exclusão — `exclusao.csv`

| Coluna | Obrigatória | Conteúdo |
| --- | --- | --- |
| `documento` | sim | CPF ou CNPJ válido, com ou sem pontuação |
| `motivo` | sim | `funcionário`, `B2B negociado` ou `outro` |
| `origem` | não | De onde veio a informação (ex.: `RH`, `SHX-B2B`). Se vazia, vale a origem do lote |

Cada documento na lista é um **período** (entrada e saída). Assim, uma nota importada com atraso é
avaliada pela situação da lista na data de emissão. Período encerrado nunca é alterado; se a pessoa
voltar, abre-se um novo período.

Dois modos:

- **incremental** (padrão): inclui quem veio e atualiza motivo e origem. Nunca tira ninguém da lista.
- **completo**, com origem obrigatória (ex.: `--modo completo --origem RH`): o arquivo é a lista
  inteira daquela origem. Quem é da mesma origem, está na lista e não veio no arquivo **sai da lista**.
  Outras origens não são tocadas. Use para a exportação completa de funcionários do RH ou de clientes
  B2B do SHX.

## Como importar

Linha de comando (o usuário precisa ter perfil Admin):

```bash
npm run import:csv -- --tipo produtos --arquivo produtos.csv --usuario admin@cdc --simular
npm run import:csv -- --tipo produtos --arquivo produtos.csv --usuario admin@cdc
npm run import:csv -- --tipo exclusao --arquivo rh.csv --modo completo --origem RH --usuario admin@cdc
npm run import:csv -- --tipo lojas --arquivo lojas.csv --usuario admin@cdc
```

API (sessão de Admin): `POST /api/imports/csv` com `multipart/form-data` (`tipo`, `arquivo`, `modo`,
`origem`, `simular`); `GET /api/imports?tipo=PRODUCTS` lista os lotes recentes. A tela de upload
chega com o painel de gestão (etapa 10).

Arquivos de exemplo sintéticos: `npm run synthetic:csv` grava `var/synthetic/{lojas,produtos,exclusao}.csv`.
