import { requireUser } from "@/web/session";
import { roleLabels, can } from "@/domain/auth/roles";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await requireUser();
  const { erro } = await searchParams;
  return (
    <main>
      <header className="top">
        <div>
          <h1>Olá, {user.name}</h1>
          <span className="muted">{roleLabels[user.role]}</span>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="secondary">Sair</button>
        </form>
      </header>
      {erro === "sem-permissao" ? <p className="error" role="alert">Seu perfil não tem acesso a essa área.</p> : null}
      <div className="card">
        <p>As telas do Clube CDC chegam nas próximas etapas:</p>
        <ul className="areas">
          {can(user.role, "member.lookup") ? <li>Painel do caixa (etapas 6 e 7)</li> : null}
          {can(user.role, "provider.approve") ? <li>Filas de aprovação e revisão (etapa 10)</li> : null}
          {can(user.role, "parameters.manage") ? <li>Parâmetros com vigência (etapa 10; já disponível pela API)</li> : null}
        </ul>
      </div>
    </main>
  );
}
