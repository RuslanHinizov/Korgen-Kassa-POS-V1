-- Every market numbers its own documents (чеки, приёмки, платежи, …) 1, 2, 3 … The number used to come from one counter
-- shared by all markets, so a second market started at some big number with gaps, and a market could read how much another
-- one sold. A BEFORE INSERT trigger now gives the next number of that market and that kind of document.
--   * the counter row is locked by the insert, so two tills never get the same number, and a rolled-back insert gives its
--     number back (no gaps);
--   * a number that is supplied explicitly (a restore from a dump, an import) is kept and the counter moves past it.

CREATE TABLE "DocumentCounter" (
  "storeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "last" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("storeId", "kind")
);
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the numbering columns used a shared sequence as their default; 0 now means "give me the next number"
ALTER TABLE "Sale" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "WriteOff" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "StoreTransfer" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "StockIn" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "CustomerReturn" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "PurchaseReceipt" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "SupplierReturn" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "Payment" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "Transfer" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "Stocktake" ALTER COLUMN "documentNo" SET DEFAULT 0;
ALTER TABLE "Cashbox" ALTER COLUMN "no" SET DEFAULT 0;

DROP SEQUENCE IF EXISTS "Sale_documentNo_seq", "WriteOff_documentNo_seq", "StoreTransfer_documentNo_seq", "StockIn_documentNo_seq",
  "CustomerReturn_documentNo_seq", "PurchaseReceipt_documentNo_seq", "SupplierReturn_documentNo_seq", "Payment_documentNo_seq",
  "Transfer_documentNo_seq", "Stocktake_documentNo_seq", "Cashbox_no_seq";

-- continue each market after its highest existing number
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'Sale', MAX("documentNo") FROM "Sale" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'WriteOff', MAX("documentNo") FROM "WriteOff" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'StoreTransfer', MAX("documentNo") FROM "StoreTransfer" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'StockIn', MAX("documentNo") FROM "StockIn" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'CustomerReturn', MAX("documentNo") FROM "CustomerReturn" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'PurchaseReceipt', MAX("documentNo") FROM "PurchaseReceipt" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'SupplierReturn', MAX("documentNo") FROM "SupplierReturn" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'Payment', MAX("documentNo") FROM "Payment" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'Transfer', MAX("documentNo") FROM "Transfer" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'Stocktake', MAX("documentNo") FROM "Stocktake" GROUP BY "storeId";
INSERT INTO "DocumentCounter" ("storeId", "kind", "last") SELECT "storeId", 'Cashbox', MAX("no") FROM "Cashbox" GROUP BY "storeId";

CREATE FUNCTION assign_document_no() RETURNS trigger AS $$
DECLARE n integer;
BEGIN
  IF NEW."documentNo" IS NULL OR NEW."documentNo" = 0 THEN
    INSERT INTO "DocumentCounter" ("storeId", "kind", "last") VALUES (NEW."storeId", TG_TABLE_NAME, 1)
    ON CONFLICT ("storeId", "kind") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
    RETURNING "last" INTO n;
    NEW."documentNo" := n;
  ELSE
    INSERT INTO "DocumentCounter" ("storeId", "kind", "last") VALUES (NEW."storeId", TG_TABLE_NAME, NEW."documentNo")
    ON CONFLICT ("storeId", "kind") DO UPDATE SET "last" = GREATEST("DocumentCounter"."last", NEW."documentNo");
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE FUNCTION assign_cashbox_no() RETURNS trigger AS $$
DECLARE n integer;
BEGIN
  IF NEW."no" IS NULL OR NEW."no" = 0 THEN
    INSERT INTO "DocumentCounter" ("storeId", "kind", "last") VALUES (NEW."storeId", 'Cashbox', 1)
    ON CONFLICT ("storeId", "kind") DO UPDATE SET "last" = "DocumentCounter"."last" + 1
    RETURNING "last" INTO n;
    NEW."no" := n;
  ELSE
    INSERT INTO "DocumentCounter" ("storeId", "kind", "last") VALUES (NEW."storeId", 'Cashbox', NEW."no")
    ON CONFLICT ("storeId", "kind") DO UPDATE SET "last" = GREATEST("DocumentCounter"."last", NEW."no");
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_document_no" BEFORE INSERT ON "Sale" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "WriteOff_document_no" BEFORE INSERT ON "WriteOff" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "StoreTransfer_document_no" BEFORE INSERT ON "StoreTransfer" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "StockIn_document_no" BEFORE INSERT ON "StockIn" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "CustomerReturn_document_no" BEFORE INSERT ON "CustomerReturn" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "PurchaseReceipt_document_no" BEFORE INSERT ON "PurchaseReceipt" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "SupplierReturn_document_no" BEFORE INSERT ON "SupplierReturn" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "Payment_document_no" BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "Transfer_document_no" BEFORE INSERT ON "Transfer" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "Stocktake_document_no" BEFORE INSERT ON "Stocktake" FOR EACH ROW EXECUTE FUNCTION assign_document_no();
CREATE TRIGGER "Cashbox_no" BEFORE INSERT ON "Cashbox" FOR EACH ROW EXECUTE FUNCTION assign_cashbox_no();
