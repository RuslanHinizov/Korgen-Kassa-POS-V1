import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

const schema = z.union([
  z.object({ productIds: z.array(z.string().min(1)).min(1) }),
  z.object({ categoryId: z.string().min(1) }),
  // «Добавить все найденные»: the same filters as the picker, applied on the server to EVERY match (not just the visible page)
  z.object({ filter: z.object({
    categoryId: z.string().optional(), supplierId: z.string().optional(), type: z.string().optional(), stock: z.string().optional(),
  }) }),
]);

// POST /api/inventory/stocktakes/:id/items/bulk — add several products at once,
// either explicit ids (the "Добавление товаров" filter+checkbox picker) or every
// product in a category and its subcategories. Skips products already added.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: stocktakeId } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const storeId = await getStoreId();
  const stocktake = await prisma.stocktake.findFirst({ where: { id: stocktakeId, storeId }, select: { status: true } });
  if (!stocktake) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING") {
    return NextResponse.json({ error: "На этом этапе нельзя добавлять товары" }, { status: 409 });
  }

  let productIdsToAdd: string[];
  if ("productIds" in parsed.data) {
    productIdsToAdd = parsed.data.productIds;
  } else if ("filter" in parsed.data) {
    const f = parsed.data.filter;
    const typeWhere: Prisma.ProductWhereInput =
      f.type === "factory" ? { productType: "REGULAR", barcode: { not: null }, NOT: { barcode: { startsWith: "290" } } }
      : f.type === "internal" ? { productType: "REGULAR", barcode: { startsWith: "290" } }
      : f.type === "weight" ? { unit: "kg" }
      : f.type === "service" ? { productType: "SERVICE" }
      : f.type === "bundle" ? { productType: "BUNDLE" }
      : {};
    const matches = await prisma.product.findMany({
      where: {
        storeId, deletedAt: null, ...typeWhere,
        ...(f.categoryId ? { categoryId: f.categoryId } : {}),
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
        ...(f.stock === "nonzero" ? { stock: { gt: 0 } } : f.stock === "zero" ? { stock: { lte: 0 } } : {}),
      },
      select: { id: true },
    });
    productIdsToAdd = matches.map((p) => p.id);
  } else {
    const rootCategory = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, storeId }, select: { id: true } });
    if (!rootCategory) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });

    // Walk the category tree to include subcategories.
    const categoryIds = [rootCategory.id];
    let frontier = [rootCategory.id];
    while (frontier.length > 0) {
      const children = await prisma.category.findMany({ where: { storeId, parentId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id);
      categoryIds.push(...frontier);
    }

    const inCategory = await prisma.product.findMany({ where: { storeId, deletedAt: null, categoryId: { in: categoryIds } }, select: { id: true } });
    productIdsToAdd = inCategory.map((p) => p.id);
  }

  // ONE statement for any number of products; products already in the document are skipped.
  // Starts counted at 0, openly shown, flagged until scanned (matches real UMAG).
  const added = productIdsToAdd.length === 0 ? 0 : await prisma.$executeRaw`
    INSERT INTO "StocktakeItem" (id, "stocktakeId", "productId", "expectedQty", "countedQty", difference, "scannedAt")
    SELECT gen_random_uuid()::text, ${stocktakeId}, p.id, p.stock, 0, -p.stock, NULL
    FROM "Product" p WHERE p."storeId" = ${storeId} AND p."deletedAt" IS NULL AND p.id = ANY(${productIdsToAdd}::text[])
    ON CONFLICT ("stocktakeId", "productId") DO NOTHING`;

  if (added > 0 && stocktake.status === "DRAFT") await prisma.stocktake.update({ where: { id: stocktakeId }, data: { status: "COUNTING" } });
  return NextResponse.json({ added });
}
