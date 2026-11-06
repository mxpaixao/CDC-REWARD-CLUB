/**
 * Dados sintéticos (regra inviolável 7). Nada aqui vem de cliente real:
 * CPFs e CNPJs são gerados com dígitos verificadores válidos a partir de uma
 * semente, nomes vêm de listas genéricas e telefones usam o prefixo 90000.
 * Com a mesma semente, a saída é sempre a mesma — os testes ficam estáveis.
 */
import { cnpjCheckDigits, cpfCheckDigits } from "@/domain/document";

export type Rng = () => number;

/** PRNG determinístico (mulberry32). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("lista vazia");
  return items[randomInt(rng, 0, items.length - 1)]!;
}

function digits(rng: Rng, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String(randomInt(rng, 0, 9));
  return s;
}

export function fakeCpf(rng: Rng): string {
  let base: string;
  do base = digits(rng, 9);
  while (/^(\d)\1+$/.test(base));
  return base + cpfCheckDigits(base);
}

/** CNPJ numérico sintético. Filial 0001 por padrão; raiz sorteada se não for informada. */
export function fakeCnpj(rng: Rng, branch = "0001", root?: string): string {
  const base = (root ?? digits(rng, 8)) + branch;
  return base + cnpjCheckDigits(base);
}

/** CNPJ alfanumérico sintético (formato da IN RFB 2.229/2024). */
export function fakeAlphanumericCnpj(rng: Rng): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let root = "";
  for (let i = 0; i < 8; i++) root += alphabet[randomInt(rng, 0, alphabet.length - 1)];
  const base = root + "0001";
  return base + cnpjCheckDigits(base);
}

const FIRST_NAMES = [
  "Carlos", "Ana", "Bruno", "Fernanda", "José", "Maria", "João", "Patrícia", "Raimundo", "Francisca",
  "Antônio", "Juliana", "Marcos", "Luciana", "Paulo", "Sandra", "Pedro", "Cláudia", "Rafael", "Simone",
] as const;
const SURNAMES = [
  "Teste", "Exemplo", "Fictício", "Sintético", "Amostra", "Modelo", "Demonstração", "Simulado",
] as const;
const PROFESSIONS = [
  "Eletricista", "Encanador", "Pedreiro", "Pintor", "Marceneiro", "Serralheiro", "Mecânico", "Técnico de refrigeração",
] as const;

export function fakeName(rng: Rng, firstName?: string): string {
  return `${firstName ?? pick(rng, FIRST_NAMES)} ${pick(rng, SURNAMES)}`;
}

export function fakeProfession(rng: Rng): string {
  return pick(rng, PROFESSIONS);
}

/** Celular sintético de Manaus no formato só dígitos: 9290000XXXX. */
export function fakePhone(rng: Rng): string {
  return `9290000${digits(rng, 4)}`;
}

export function fakeEmail(name: string): string {
  const local = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${local}@exemplo.test`;
}

/** Personas fixas dos critérios de aceite (SPEC seção 10). Mesmos documentos em todo teste. */
export function acceptancePersonas() {
  const rng = createRng(20270201);
  return {
    carlos: { name: "Carlos Teste", firstName: "Carlos", cpf: fakeCpf(rng), phone: fakePhone(rng), profession: "Eletricista" },
    bruno: { name: "Bruno Exemplo", firstName: "Bruno", cpf: fakeCpf(rng), phone: fakePhone(rng), profession: "Encanador" },
    ana: { name: "Ana Fictícia", firstName: "Ana", cpf: fakeCpf(rng), phone: fakePhone(rng) },
    employee: { name: "Funcionária Simulada", firstName: "Funcionária", cpf: fakeCpf(rng) },
    b2bCustomer: { name: "Construtora Amostra Ltda", cnpj: fakeCnpj(rng) },
  };
}

/** Lojas sintéticas. L1 é a loja piloto sintética (a real é a questão aberta 4). */
export function syntheticStores() {
  const rng = createRng(4);
  const root = digits(rng, 8); // mesma empresa: mesma raiz, filiais diferentes
  return [
    { code: "L1", name: "CDC Loja 1 (sintética)", cnpj: fakeCnpj(rng, "0001", root), isPilot: true },
    { code: "L2", name: "CDC Loja 2 (sintética)", cnpj: fakeCnpj(rng, "0002", root), isPilot: false },
    { code: "L3", name: "CDC Loja 3 (sintética)", cnpj: fakeCnpj(rng, "0003", root), isPilot: false },
    { code: "L4", name: "CDC Loja 4 (sintética)", cnpj: fakeCnpj(rng, "0004", root), isPilot: false },
  ];
}
