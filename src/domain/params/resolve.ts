/**
 * Resolução de parâmetros por vigência (SPEC seção 4): cada uso pega a versão
 * com o maior início de vigência que não passe do instante consultado — para
 * vendas, a data e hora de emissão da nota.
 */
import {
  PARAMETER_KEYS,
  type ParameterKey,
  type ParameterSnapshot,
  type ParameterValue,
  validateParameter,
} from "./definitions";

export interface ParameterVersionRecord {
  key: string;
  value: unknown;
  validFrom: Date;
}

export class ParameterNotFoundError extends Error {
  constructor(key: string, at: Date) {
    super(`nenhuma versão vigente do parâmetro ${key} em ${at.toISOString()}`);
    this.name = "ParameterNotFoundError";
  }
}

/** Leitura de parâmetros usada pelo motor. A implementação pode ser o banco ou memória. */
export interface ParameterReader {
  get<K extends ParameterKey>(key: K, at: Date): Promise<ParameterValue<K>>;
  snapshot(at: Date): Promise<ParameterSnapshot>;
}

export function resolveVersion(
  versions: readonly ParameterVersionRecord[],
  key: ParameterKey,
  at: Date,
): ParameterVersionRecord | undefined {
  let best: ParameterVersionRecord | undefined;
  for (const v of versions) {
    if (v.key !== key || v.validFrom.getTime() > at.getTime()) continue;
    if (!best || v.validFrom.getTime() > best.validFrom.getTime()) best = v;
  }
  return best;
}

/** Implementação em memória — para testes do domínio e simulações. */
export class InMemoryParameterReader implements ParameterReader {
  private readonly versions: ParameterVersionRecord[];

  constructor(versions: ParameterVersionRecord[] = []) {
    this.versions = [...versions];
  }

  static fromSnapshot(snapshot: ParameterSnapshot, validFrom: Date): InMemoryParameterReader {
    return new InMemoryParameterReader(PARAMETER_KEYS.map((key) => ({ key, value: snapshot[key], validFrom })));
  }

  /** Acrescenta uma nova versão (não altera as anteriores). */
  addVersion<K extends ParameterKey>(key: K, value: ParameterValue<K>, validFrom: Date): void {
    this.versions.push({ key, value: validateParameter(key, value), validFrom });
  }

  async get<K extends ParameterKey>(key: K, at: Date): Promise<ParameterValue<K>> {
    const v = resolveVersion(this.versions, key, at);
    if (!v) throw new ParameterNotFoundError(key, at);
    return validateParameter(key, v.value);
  }

  async snapshot(at: Date): Promise<ParameterSnapshot> {
    const entries = await Promise.all(PARAMETER_KEYS.map(async (key) => [key, await this.get(key, at)] as const));
    return Object.fromEntries(entries) as ParameterSnapshot;
  }
}
