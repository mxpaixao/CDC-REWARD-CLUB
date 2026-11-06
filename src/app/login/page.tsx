import { redirect } from "next/navigation";
import { currentUser } from "@/web/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/inicio");
  return (
    <main>
      <div className="card narrow">
        <h1>Clube CDC</h1>
        <p className="muted">Acesso da equipe CDC</p>
        <LoginForm />
      </div>
    </main>
  );
}
