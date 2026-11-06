import { describe, expect, it } from "vitest";
import { CsvFormatError, decodeCsvBytes, normalizeHeader, parseCsv } from "@/domain/csv/parse";
import {
  parseExclusionReason,
  parsePercentText,
  validateExclusionRows,
  validateProductRows,
  validateStoreRows,
} from "@/domain/catalog/rows";
import { bandForItem, bandForMargin } from "@/domain/margin-band";
import { initialParameterValues } from "@/domain/params/definitions";
import { formatDocument } from "@/domain/document";
import { createRng, fakeCnpj, fakeCpf } from "@/synthetic/generators";
import { syntheticExclusionCsv, syntheticProductsCsv, syntheticStoresCsv } from "@/synthetic/catalog-csv";

const thresholds = initialParameterValues.band_min_margin_pct;

describe("faixa de margem (R5.2)", () => {
  it("aplica os limites de A, B e C com ≥, e abaixo de C é D", () => {
    expect(bandForMargin("35", thresholds)).toBe("A");
    expect(bandForMargin("34.9999", thresholds)).toBe("B");
    expect(bandForMargin("20", thresholds)).toBe("B");
    expect(bandForMargin("19.99", thresholds)).toBe("C");
    expect(bandForMargin("10", thresholds)).toBe("C");
    expect(bandForMargin("9.99", thresholds)).toBe("D");
    expect(bandForMargin("-5", thresholds)).toBe("D");
    expect(bandForMargin("100", thresholds)).toBe("A");
  });

  it("produto sem cadastro é D", () => {
    expect(bandForItem(null, thresholds)).toBe("D");
    expect(bandForItem({ marginPct: "40" }, thresholds)).toBe("A");
  });

  it("segue o parâmetro vigente, não número fixo", () => {
    expect(bandForMargin("30", { A: "30", B: "15", C: "5" })).toBe("A");
  });
});

describe("leitura de CSV", () => {
  it("detecta ponto e vírgula, aspas, CRLF e linhas em branco", () => {
    const t = parseCsv('Código;Descrição;Margem Bruta %\r\nP-1;"Fio 2,5mm; rolo ""100m""";35,5\r\n\r\nP-2;Tomada;20\r\n');
    expect(t.delimiter).toBe(";");
    expect(t.headers).toEqual(["codigo", "descricao", "margem_bruta"]);
    expect(t.rows).toEqual([
      { line: 2, values: { codigo: "P-1", descricao: 'Fio 2,5mm; rolo "100m"', margem_bruta: "35,5" } },
      { line: 4, values: { codigo: "P-2", descricao: "Tomada", margem_bruta: "20" } },
    ]);
  });

  it("aceita vírgula como separador", () => {
    const t = parseCsv("codigo,descricao,margem\nP-1,Fio,35.5\n");
    expect(t.delimiter).toBe(",");
    expect(t.rows[0]!.values.margem).toBe("35.5");
  });

  it("conta linhas corretamente com quebra de linha dentro de aspas", () => {
    const t = parseCsv('codigo;descricao\nP-1;"linha 1\nlinha 2"\nP-2;ok\n');
    expect(t.rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it("lê UTF-8 com BOM e Windows-1252", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("código\nação\n")]);
    expect(decodeCsvBytes(utf8)).toBe("código\nação\n");
    const latin1 = new Uint8Array([0x63, 0xf3, 0x64, 0x69, 0x67, 0x6f]); // "código" em Windows-1252
    expect(decodeCsvBytes(latin1)).toBe("código");
  });

  it("rejeita arquivo vazio, aspas abertas e coluna repetida", () => {
    expect(() => parseCsv("")).toThrow(CsvFormatError);
    expect(() => parseCsv('a;b\n"x;y\n')).toThrow(/aspas/);
    expect(() => parseCsv("codigo;Código\n1;2\n")).toThrow(/repetida/);
  });

  it("normaliza cabeçalho", () => {
    expect(normalizeHeader("  Margem Bruta (%) ")).toBe("margem_bruta");
    expect(normalizeHeader("CPF/CNPJ")).toBe("cpf_cnpj");
  });
});

describe("validação das linhas", () => {
  it("percentual em texto decimal", () => {
    expect(parsePercentText("35,50")).toBe("35.5");
    expect(parsePercentText("35%")).toBe("35");
    expect(parsePercentText("-3,2")).toBe("-3.2");
    expect(parsePercentText("1.234,5")).toBeNull();
    expect(parsePercentText("abc")).toBeNull();
  });

  it("motivos da lista de exclusão", () => {
    expect(parseExclusionReason("Funcionário")).toBe("EMPLOYEE");
    expect(parseExclusionReason("B2B negociado")).toBe("B2B_NEGOTIATED");
    expect(parseExclusionReason("outro")).toBe("OTHER");
    expect(parseExclusionReason("vip")).toBeNull();
  });

  it("produtos: erros por linha, duplicados e margem fora do intervalo", () => {
    const t = parseCsv("codigo;descricao;margem_bruta_pct\nP-1;Fio;35\nP-2;;20\nP-1;Fio de novo;30\nP-3;Cabo;150\nP-4;Tubo;x\n");
    const v = validateProductRows(t);
    expect(v.records.map((r) => r.code)).toEqual(["P-1"]);
    expect(v.errors.map((e) => e.linha)).toEqual([3, 4, 5, 6]);
    expect(v.errors[1]!.mensagem).toMatch(/repetido.*linha 2/);
  });

  it("produtos: falta coluna obrigatória", () => {
    expect(() => validateProductRows(parseCsv("codigo;descricao\nP-1;Fio\n"))).toThrow(/margem_bruta_pct/);
  });

  it("lojas: CNPJ inválido e piloto mal preenchido", () => {
    const rng = createRng(5);
    const cnpj = formatDocument(fakeCnpj(rng));
    const t = parseCsv(`codigo;nome;cnpj;piloto\nL9;Loja 9;${cnpj};sim\nL8;Loja 8;11.111.111/1111-11;não\nL7;Loja 7;${cnpj};talvez\n`);
    const v = validateStoreRows(t);
    expect(v.records).toHaveLength(1);
    expect(v.records[0]!.isPilot).toBe(true);
    expect(v.errors.map((e) => e.linha)).toEqual([3, 4]);
  });

  it("exclusão: documento inválido não aparece na mensagem de erro", () => {
    const rng = createRng(6);
    const cpf = fakeCpf(rng);
    const bad = cpf.slice(0, 10) + String((Number(cpf[10]) + 1) % 10);
    const t = parseCsv(`documento;motivo\n${formatDocument(cpf)};funcionário\n${bad};funcionário\n${cpf};outro\n`);
    const v = validateExclusionRows(t);
    expect(v.records).toHaveLength(1);
    expect(v.records[0]!.document).toBe(cpf);
    expect(JSON.stringify(v.errors)).not.toContain(bad);
    expect(JSON.stringify(v.errors)).not.toContain(cpf);
  });

  it("os CSVs sintéticos do projeto passam sem erro", () => {
    expect(validateStoreRows(parseCsv(syntheticStoresCsv())).errors).toEqual([]);
    expect(validateProductRows(parseCsv(syntheticProductsCsv())).errors).toEqual([]);
    expect(validateExclusionRows(parseCsv(syntheticExclusionCsv())).errors).toEqual([]);
  });
});
