"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/infra/db/client";
import { loadConfig } from "@/infra/config";
import { login, logout, LoginError } from "@/application/auth";
import { SESSION_COOKIE } from "@/web/session";

export interface LoginState {
  error?: string;
  /** Devolvido para o formulário não perder o e-mail digitado após um erro. */
  email?: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Informe e-mail e senha.", email };
  try {
    const result = await login(getPrisma(), loadConfig(), { email, password });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: result.expiresAt,
    });
  } catch (e) {
    if (e instanceof LoginError) return { error: e.message, email };
    throw e;
  }
  redirect("/inicio");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  await logout(getPrisma(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
