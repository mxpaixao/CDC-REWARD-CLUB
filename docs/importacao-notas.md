# Importação de notas fiscais (XML)

Como o motor lê as vendas do SHX/GIX na Fase 1 (SPEC seção 7). A forma de entrega dos XMLs
(pasta, SFTP ou API) ainda está em aberto (questão 2); a leitura fica atrás da interface
`SalesSource`, então trocar a origem não muda o motor.

## Origens

- **Pasta monitorada** (`XmlFolderSource`): o SHX/GIX grava os XMLs em `XML_INBOX_DIR`. A cada
  rodada, o motor lê os `.xml` da pasta (não entra em subpastas) e move cada arquivo para
  `processados/AAAA-MM-DD/` ou `erros/AAAA-MM-DD/`. Se a pasta for só leitura para o motor, use o
  modo "manter" (`--manter`): os arquivos ficam onde estão e a reimportação não duplica nada.
  Se o banco cair no meio, o arquivo não é movido e entra de novo na próxima rodada.
- **Upload manual** (`POST /api/imports/xml`, Admin): até 500 XMLs por envio, 5 MB cada.
- O job de hora em hora chega na etapa 8; até lá, `npm run import:xml`.

## O que é aceito

| Documento | Raiz do XML | Condição |
| --- | --- | --- |
| NFC-e (65) e NF-e (55) | `nfeProc` com `protNFe` | `cStat` 100 (autorizado) ou 150 (autorizado fora de prazo) |
| Cancelamento | `procEventoNFe`, `tpEvento` 110111 | retorno com `cStat` 135 ou 155 |
| Cancelamento por substituição (NFC-e) | `procEventoNFe`, `tpEvento` 110112 | idem; a nota original é cancelada |
| Outros eventos (ex.: carta de correção 110110) | `procEventoNFe` | ignorados (contados no lote) |

Vai para os erros do lote, com o nome do arquivo e o motivo:

- XML mal formado, com DOCTYPE/ENTITY, ou que não é NF-e/evento;
- NF-e sem protocolo de autorização ou com `cStat` diferente de 100 e 150;
- chave de acesso com dígito verificador errado, ou diferente entre `infNFe/@Id` e `protNFe`, ou
  que não bate com o modelo e o CNPJ do emitente;
- emitente que não é uma loja cadastrada (nota de outra empresa);
- valor com mais de duas casas, desconto maior que o item, CPF/CNPJ do destinatário inválido;
- nota ou evento de **homologação** (`tpAmb` 2) quando `ACCEPT_HOMOLOGATION_XML=false` (produção).

As mensagens nunca repetem CPF ou CNPJ.

## O que é gravado

- **Nota com cliente identificado** (`dest/CPF` ou `dest/CNPJ`): cabeçalho, itens com valor base
  (`vProd − vDesc`) e faixa congelada, e o XML bruto no armazenamento restrito (`RAW_XML_DIR`,
  pastas 0700 e arquivos 0600).
- **Nota sem cliente identificado:** só o cabeçalho (loja, data, total, quantidade de itens), para a
  métrica de vendas identificadas. Itens e XML não são guardados.
- **Devolução** (NF-e de entrada, `finNFe` 4): sempre com os itens, ligada à venda pela chave
  referenciada (`refNFe`).
- **Notas de todas as lojas CDC** entram (métricas, volume de nível e atividade). Só as lojas em
  `enabled_store_ids` geram bônus — isso é com o motor (etapa 4).
- **CFOP de cada item** fica guardado: o motor vai usar para não dar bônus em operação que não é
  venda (bonificação, remessa, transferência) — ver questão 17 da SPEC.

## Faixa do item

Na importação, cada item recebe a faixa pela margem do produto cadastrado e pelo parâmetro
`band_min_margin_pct` vigente **na emissão** da nota. Produto sem cadastro é faixa D e aparece no
relatório "itens sem faixa" (`GET /api/reports/items-without-band?de=AAAA-MM-DD&ate=AAAA-MM-DD`).
Cadastrar o produto depois não muda a faixa do item já importado (R5.2).

## Idempotência e imutabilidade

- A chave de acesso é única: o mesmo XML importado de novo (mesmo com outro nome) conta como
  "repetida" e não muda nada (regra 3, critério 19).
- Nota gravada não muda, exceto a situação ao ser cancelada; itens nunca mudam (trigger no banco).
- Cancelamento que chega antes da nota fica guardado; quando a nota chega, ela já nasce cancelada.

## Lote

Cada rodada é um lote com: lidas, novas, repetidas, cancelamentos, devoluções, erros, sem
destinatário e ignorados, mais as mensagens (erros e avisos) por arquivo. `GET /api/imports?tipo=XML`.

## XMLs sintéticos

`npm run synthetic:xml -- --inicio 2027-02-01 --dias 3 --saida var/inbox` gera alguns dias de venda
nas lojas sintéticas, em **homologação** (sem valor fiscal), com clientes identificados, vendas sem
identificação, um cancelamento e uma devolução.
