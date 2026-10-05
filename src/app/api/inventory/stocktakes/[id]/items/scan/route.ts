import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

const schema = z.object({
  /** a scanned barcode (hardware scanner or phone camera) … */
  code: z.string().trim().min(1).max(64).optional(),
  /** … or a product picked by hand / just created */
  productId: z.string().min(1).optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
}).refine((v) => v.code || v.productId);

// POST /api/inventory/stocktakes/:id/items/scan — one scan = +quantity on that product's Сканировано, one statement.
// The product is added to the document if it is not there yet (a scan of something outside the list still counts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: stocktakeId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нужен штрихкод" }, { status: 400 });

  const storeId = await getStoreId();
  const stocktake = await prisma.stocktake.findFirst({ where: { id: stocktakeId, storeId }, select: { status: true } });
  if (!stocktake) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING") {
    return NextResponse.json({ error: "Документ уже проведён — сканировать нельзя" }, { status: 409 });
  }

  let quantity = parsed.data.quantity ?? 1;
  let product: { id: string } | null = null;
  if (parsed.data.productId) {
    product = await prisma.product.findFirst({ where: { id: parsed.data.productId, storeId, deletedAt: null }, select: { id: true } });
  } else if (parsed.data.code) {
    const code = parsed.data.code;
    // a scale label (EAN-13 starting 20/21/22) carries the weight in grams: that is the counted amount
    const weighted = /^2[0-2](\d{5})(\d{5})\d$/.exec(code);
    if (weighted) {
      product = await prisma.product.findFirst({ where: { storeId, deletedAt: null, unit: "kg", scalePlu: weighted[1] }, select: { id: true } });
      if (product) quantity = Number(weighted[2]) / 1000;
    }
    if (!product) product = await prisma.product.findFirst({ where: { storeId, deletedAt: null, barcode: code }, select: { id: true } });
  }
  if (!product) return NextResponse.json({ error: "Товар не найден", code: parsed.data.code ?? null }, { status: 404 });

  const rows = await prisma.$queryRaw<{ id: string; productName: string; barcode: string | null; unit: string; expectedQty: string; countedQty: string; difference: string; scannedAt: Date; created: boolean }[]>`
    INSERT INTO "StocktakeItem" (id, "stocktakeId", "productId", "expectedQty", "countedQty", difference, "scannedAt")
    SELECT gen_random_uuid()::text, ${stocktakeId}, p.id, p.stock, ${quantity}::numeric, ${quantity}::numeric - p.stock, now()
    FROM "Product" p WHERE p.id = ${product.id}
    ON CONFLICT ("stocktakeId", "productId") DO UPDATE SET
      "countedQty" = COALESCE("StocktakeItem"."countedQty", 0) + EXCLUDED."countedQty",
      difference = COALESCE("StocktakeItem"."countedQty", 0) + EXCLUDED."countedQty" - "StocktakeItem"."expectedQty",
      "scannedAt" = now()
    RETURNING id, (xmax = 0) AS created, "expectedQty"::text AS "expectedQty", "countedQty"::text AS "countedQty", difference::text AS difference, "scannedAt",
      (SELECT name FROM "Product" WHERE id = ${product.id}) AS "productName",
      (SELECT barcode FROM "Product" WHERE id = ${product.id}) AS barcode,
      (SELECT unit FROM "Product" WHERE id = ${product.id}) AS unit`;
  const row = rows[0];
  await prisma.stocktake.updateMany({ where: { id: stocktakeId, status: "DRAFT" }, data: { status: "COUNTING" } });
  const scannedCount = await prisma.stocktakeItem.count({ where: { stocktakeId, scannedAt: { not: null } } });

  return NextResponse.json({
    item: {
      id: row.id, productId: product.id, productName: row.productName, barcode: row.barcode, unit: row.unit,
      expectedQty: Number(row.expectedQty), countedQty: Number(row.countedQty), difference: Number(row.difference),
      scannedAt: row.scannedAt.toISOString(),
    },
    created: row.created,
    added: quantity,
    scannedCount,
  });
}
