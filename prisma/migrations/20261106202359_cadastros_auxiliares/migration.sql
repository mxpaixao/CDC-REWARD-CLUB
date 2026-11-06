-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('XML', 'PRODUCTS', 'EXCLUSIONS', 'STORES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarginBand" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "ExclusionReason" AS ENUM ('B2B_NEGOTIATED', 'EMPLOYEE', 'OTHER');

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "type" "ImportType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'incremental',
    "status" "ImportStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "totals" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "margin_pct" DECIMAL(9,4) NOT NULL,
    "band" "MarginBand" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_import_batch_id" UUID,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exclusion_entry" (
    "id" UUID NOT NULL,
    "document" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "reason" "ExclusionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_import_batch_id" UUID,

    CONSTRAINT "exclusion_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batch_type_started_at_idx" ON "import_batch"("type", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_code_key" ON "product"("code");

-- CreateIndex
CREATE INDEX "exclusion_entry_document_idx" ON "exclusion_entry"("document");

-- CreateIndex
CREATE INDEX "exclusion_entry_source_idx" ON "exclusion_entry"("source");

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "internal_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_last_import_batch_id_fkey" FOREIGN KEY ("last_import_batch_id") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exclusion_entry" ADD CONSTRAINT "exclusion_entry_last_import_batch_id_fkey" FOREIGN KEY ("last_import_batch_id") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um único período aberto por documento na lista de exclusão.
CREATE UNIQUE INDEX "exclusion_entry_open_document_key" ON "exclusion_entry"("document") WHERE "removed_at" IS NULL;

-- Período fechado não reabre nem muda: correção é um novo período.
CREATE OR REPLACE FUNCTION exclusion_entry_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'exclusion_entry: DELETE não é permitido; encerre o período' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'exclusion_entry: período encerrado não pode ser alterado' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.document <> OLD.document OR NEW.added_at <> OLD.added_at THEN
    RAISE EXCEPTION 'exclusion_entry: documento e início do período são imutáveis' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exclusion_entry_guard
  BEFORE UPDATE OR DELETE ON "exclusion_entry"
  FOR EACH ROW EXECUTE FUNCTION exclusion_entry_guard();
