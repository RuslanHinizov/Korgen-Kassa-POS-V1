-- «История изменения товара»: what was changed on a product, by whom, when (one row per field, rows of one save share groupId).
CREATE TABLE "ProductChange" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductChange_productId_createdAt_idx" ON "ProductChange"("productId", "createdAt");
ALTER TABLE "ProductChange" ADD CONSTRAINT "ProductChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductChange" ADD CONSTRAINT "ProductChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
