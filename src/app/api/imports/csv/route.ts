/**
 * Upload de CSV de cadastro auxiliar (Admin). multipart/form-data com:
 *   tipo     lojas | produtos | exclusao
 *   arquivo  o CSV
 *   modo     incremental (padrão) | completo   — só lista de exclusão
 *   origem   ex.: RH, SHX-B2B                  — obrigatória no modo completo
 *   simular  "1" para só validar
 */
import { getPrisma } from "@/infra/db/client";
import { ForbiddenError } from "@/domain/auth/roles";
import { BusinessRuleError } from "@/application/actor";
import { importCatalogCsv, type CatalogImportType } from "@/application/imports/catalog-import";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";

const TYPES: Record<string, CatalogImportType> = { lojas: "STORES", produtos: "PRODUCTS", exclusao: "EXCLUSIONS" };
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ erro: "envie multipart/form-data" }, { status: 400 });
  const type = TYPES[String(form.get("tipo") ?? "")];
  const file = form.get("arquivo");
  const mode = String(form.get("modo") ?? "incremental");
  if (!type) return Response.json({ erro: "tipo deve ser lojas, produtos ou exclusao" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ erro: "envie o arquivo no campo 'arquivo'" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ erro: "arquivo maior que 20 MB" }, { status: 413 });
  if (mode !== "incremental" && mode !== "completo") return Response.json({ erro: "modo inválido" }, { status: 400 });
  try {
    const result = await importCatalogCsv(getPrisma(), user, {
      type,
      fileName: file.name,
      content: new Uint8Array(await file.arrayBuffer()),
      mode,
      source: form.get("origem") ? String(form.get("origem")) : undefined,
      dryRun: form.get("simular") === "1",
    });
    return Response.json(result, { status: result.status === "FAILED" ? 422 : 200 });
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ erro: "sem permissão" }, { status: 403 });
    if (e instanceof BusinessRuleError) return Response.json({ erro: e.message, codigo: e.code }, { status: 422 });
    throw e;
  }
}
