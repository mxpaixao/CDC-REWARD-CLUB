/** Sessão de usuário interno nas páginas e rotas do Next.js. */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/infra/db/client";
import { getSessionUser } from "@/application/auth";
import { can, type Permission } from "@/domain/auth/roles";
import type { SessionUser } from "@/application/actor";

export const SESSION_COOKIE = "cdc_session";

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return getSessionUser(getPrisma(), jar.get(SESSION_COOKIE)?.value);
}

/** Exige login (e, opcionalmente, uma permissão); senão manda para /login. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/inicio?erro=sem-permissao");
  return user;
}
