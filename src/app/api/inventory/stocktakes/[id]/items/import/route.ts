import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

const schema = z.object({
  items: z.array(z.object({ barcode: z.string().trim().min(1), quantity: z.number().positive() })).min(1).max(5000),
});

// POST /api/inventory/stocktakes/:id/items/import — «Импорт товаров» (collector/Excel file):
// lines are matched by barcode. A repeated barcode accumulates onto the existing
// Сканировано count, matching how a physical scanner would add up repeat scans.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: stocktakeId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный файл: нужны столбцы «Штрихкод» и «Количество»" }, { status: 400 });

  const storeId = await getStoreId();
  const stocktake = await prisma.stocktake.findFirst({ where: { id: stocktakeId, storeId }, select: { status: true } });
  if (!stocktake) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING") {
    return NextResponse.json({ error: "На этом этапе нельзя добавлять товары" }, { status: 409 });
  }

  // merge repeated barcodes first, then look every product up in ONE query and write every line in ONE statement
  // (a line-by-line loop of 3 queries each took minutes for a big file)
  const wanted = new Map<string, number>();
  for (const row of parsed.data.items) wanted.set(row.barcode, (wanted.get(row.barcode) ?? 0) + row.quantity);
  const products = await prisma.product.findMany({
    where: { storeId, deletedAt: null, barcode: { in: [...wanted.keys()] } },
    select: { id: true, barcode: true },
    orderBy: { id: "asc" },
  });
  const byBarcode = new Map<string, string>();
  for (const p of products) if (p.barcode && !byBarcode.has(p.barcode)) byBarcode.set(p.barcode, p.id);
  const notFound = [...wanted.keys()].filter((b) => !byBarcode.has(b));
  const found = [...wanted.entries()].filter(([b]) => byBarcode.has(b));
  const added = found.length;
  if (added > 0) {
    const ids = found.map(([b]) => byBarcode.get(b)!);
    const qtys = found.map(([, q]) => String(q));
    await prisma.$executeRaw`
      INSERT INTO "StocktakeItem" (id, "stocktakeId", "productId", "expectedQty", "countedQty", difference, "scannedAt")
      SELECT gen_random_uuid()::text, ${stocktakeId}, p.id, p.stock, v.qty, v.qty - p.stock, now()
      FROM unnest(${ids}::text[], ${qtys}::numeric[]) AS v(pid, qty) JOIN "Product" p ON p.id = v.pid
      ON CONFLICT ("stocktakeId", "productId") DO UPDATE SET
        "countedQty" = COALESCE("StocktakeItem"."countedQty", 0) + EXCLUDED."countedQty",
        difference = COALESCE("StocktakeItem"."countedQty", 0) + EXCLUDED."countedQty" - "StocktakeItem"."expectedQty",
        "scannedAt" = now()`;
  }

  if (added > 0) await prisma.stocktake.updateMany({ where: { id: stocktakeId, status: "DRAFT" }, data: { status: "COUNTING" } });
  return NextResponse.json({ added, notFound });
}
