/**
 * Perfis e permissões (SPEC seção 3). O prestador não é usuário interno:
 * entra no portal com documento e código de acesso (etapa 9).
 */

export const INTERNAL_ROLES = ["ADMIN", "CHANNEL_MANAGER", "CASHIER"] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const roleLabels: Record<InternalRole, string> = {
  ADMIN: "Admin",
  CHANNEL_MANAGER: "Gerente de canal",
  CASHIER: "Operador de caixa",
};

export const PERMISSIONS = [
  // Admin
  "parameters.manage",
  "users.manage",
  "ledger.adjust",
  "imports.manage",
  "reports.view_all",
  // Gerente de canal
  "provider.approve",
  "provider.suspend",
  "provider.revalidate",
  "provider.reactivate",
  "credit.review_held",
  "reports.view_own_portfolio",
  "portal.view_access_code",
  // Operador de caixa
  "member.lookup",
  "referral.create",
  "welcome.register",
  "redemption.create",
  "redemption.cancel",
  "provider.preregister",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CHANNEL_MANAGER: readonly Permission[] = [
  "provider.approve",
  "provider.suspend",
  "provider.revalidate",
  "provider.reactivate",
  "credit.review_held",
  "reports.view_own_portfolio",
  "portal.view_access_code",
];

const CASHIER: readonly Permission[] = [
  "member.lookup",
  "referral.create",
  "welcome.register",
  "redemption.create",
  "redemption.cancel",
  "provider.preregister",
];

const rolePermissions: Record<InternalRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  CHANNEL_MANAGER: new Set(CHANNEL_MANAGER),
  CASHIER: new Set(CASHIER),
};

export function can(role: InternalRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`sem permissão para ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: InternalRole, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
