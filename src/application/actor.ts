import type { InternalRole } from "@/domain/auth/roles";

/** Usuário interno autenticado que executa um caso de uso. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: InternalRole;
  storeId: string | null;
}

/** Quem fez a ação, para a auditoria. */
export type Actor = { kind: "user"; user: SessionUser } | { kind: "job"; name: string } | { kind: "system" };

export const userActor = (user: SessionUser): Actor => ({ kind: "user", user });
export const jobActor = (name: string): Actor => ({ kind: "job", name });
export const systemActor: Actor = { kind: "system" };

/** Erro de regra de negócio com mensagem pronta para a tela. */
export class BusinessRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
