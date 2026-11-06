-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('AUTHORIZED', 'CANCELED');

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "access_key" TEXT NOT NULL,
    "model" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "purpose" INTEGER NOT NULL,
    "environment" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "store_id" UUID NOT NULL,
    "recipient_document" TEXT,
    "recipient_document_type" TEXT,
    "total_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "payment_types" TEXT[],
    "additional_info" TEXT,
    "referenced_keys" TEXT[],
    "item_count" INTEGER NOT NULL,
    "items_stored" BOOLEAN NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "canceled_at" TIMESTAMPTZ(3),
    "authorization_status" INTEGER NOT NULL,
    "authorization_protocol" TEXT,
    "import_batch_id" UUID NOT NULL,
    "raw_xml_path" TEXT,
    "raw_sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_item" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "item_number" INTEGER NOT NULL,
    "product_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cfop" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "base_cents" INTEGER NOT NULL,
    "band" "MarginBand" NOT NULL,
    "product_found" BOOLEAN NOT NULL,

    CONSTRAINT "invoice_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_cancellation" (
    "id" UUID NOT NULL,
    "access_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_at" TIMESTAMPTZ(3) NOT NULL,
    "protocol" TEXT,
    "substitute_key" TEXT,
    "applied_at" TIMESTAMPTZ(3),
    "import_batch_id" UUID NOT NULL,
    "raw_xml_path" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_access_key_key" ON "invoice"("access_key");

-- CreateIndex
CREATE INDEX "invoice_recipient_document_issued_at_idx" ON "invoice"("recipient_document", "issued_at");

-- CreateIndex
CREATE INDEX "invoice_store_id_issued_at_idx" ON "invoice"("store_id", "issued_at");

-- CreateIndex
CREATE INDEX "invoice_referenced_keys_idx" ON "invoice" USING GIN ("referenced_keys");

-- CreateIndex
CREATE INDEX "invoice_item_product_code_idx" ON "invoice_item"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_item_invoice_id_item_number_key" ON "invoice_item"("invoice_id", "item_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_cancellation_access_key_key" ON "invoice_cancellation"("access_key");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_cancellation" ADD CONSTRAINT "invoice_cancellation_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Imutabilidade das notas (regra 3): depois de gravada, a nota só muda de
-- situação (cancelamento). Itens não mudam. Cancelamento só ganha a data de aplicação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice: DELETE não é permitido' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'canceled_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'canceled_at') THEN
    RAISE EXCEPTION 'invoice: só situação e data de cancelamento podem mudar' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CANCELED' AND NEW.status <> 'CANCELED' THEN
    RAISE EXCEPTION 'invoice: nota cancelada não volta a autorizada' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_guard
  BEFORE UPDATE OR DELETE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE TRIGGER invoice_item_immutable
  BEFORE UPDATE OR DELETE ON "invoice_item"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION invoice_cancellation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice_cancellation: DELETE não é permitido' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'applied_at') IS DISTINCT FROM (to_jsonb(OLD) - 'applied_at') OR OLD.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_cancellation: só a data de aplicação pode ser preenchida, uma vez' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_cancellation_guard
  BEFORE UPDATE OR DELETE ON "invoice_cancellation"
  FOR EACH ROW EXECUTE FUNCTION invoice_cancellation_guard();

-- Valores coerentes
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_base_check" CHECK ("base_cents" = "gross_cents" - "discount_cents" AND "discount_cents" >= 0 AND "discount_cents" <= "gross_cents");
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_model_check" CHECK ("model" IN (55, 65));
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_access_key_check" CHECK ("access_key" ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$');
