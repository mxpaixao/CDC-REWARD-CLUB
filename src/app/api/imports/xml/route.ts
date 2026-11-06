/**
 * Upload manual de XMLs de NF-e, NFC-e e eventos de cancelamento (Admin).
 * multipart/form-data com um ou mais campos "arquivos".
 */
import { getPrisma } from "@/infra/db/client";
import { loadConfig } from "@/infra/config";
import { ForbiddenError } from "@/domain/auth/roles";
import { userActor } from "@/application/actor";
import { importSales } from "@/application/imports/invoice-import";
import { MAX_XML_BYTES, UploadedXmlSource } from "@/infra/sales-source/xml-sources";
import { LocalRawDocumentStore } from "@/infra/storage/raw-document-store";
import { currentUser } from "@/web/session";

export const dynamic = "force-dynamic";
const MAX_FILES = 500;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ erro: "não autenticado" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ erro: "envie multipart/form-data" }, { status: 400 });
  const files = form.getAll("arquivos").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ erro: "envie os XMLs no campo 'arquivos'" }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ erro: `no máximo ${MAX_FILES} arquivos por envio` }, { status: 413 });
  if (files.some((f) => f.size > MAX_XML_BYTES)) return Response.json({ erro: "cada XML pode ter até 5 MB" }, { status: 413 });
  const config = loadConfig();
  try {
    const source = new UploadedXmlSource(
      await Promise.all(files.map(async (f) => ({ name: f.name, content: new Uint8Array(await f.arrayBuffer()) }))),
    );
    const result = await importSales(getPrisma(), userActor(user), source, {
      acceptHomologation: config.ACCEPT_HOMOLOGATION_XML,
      rawStore: new LocalRawDocumentStore(config.RAW_XML_DIR),
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ erro: "sem permissão" }, { status: 403 });
    throw e;
  }
}
