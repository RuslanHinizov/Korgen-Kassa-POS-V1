import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { Prisma } from "@/generated/prisma/client";

// GET /api/products?q=&categoryId=|uncategorized&page=&pageSize=&sortBy=cost|price&sortOrder=asc|desc
//   &type=all|factory|weight|internal|service|bundle|article — Фильтр's product-type tabs
//   &supplierId=&unit=&priceField=price|cost|wholesalePrice&priceFrom=&priceTo=
//   &markupSign=positive|negative&markupFrom=&markupTo=&ntin=set|unset — Фильтр's remaining fields
// — Список товаров: full-fidelity paginated list (the server component route only
// ever showed the latest 300 — this is the real list backing the UMAG-style table).
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Purchase cost and margins are back-office data; cashiers and warehouse staff
  // (UMAG never shows Складской работник a Закупочная цена anywhere) get the sell price only.
  const canSeeCost = ["ADMIN", "MANAGER"].includes(session.user.role ?? "");

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const categoryId = sp.get("categoryId");
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(500, Math.max(1, Number(sp.get("pageSize") ?? 50)));
  const sortBy = sp.get("sortBy") === "price" ? "price" : sp.get("sortBy") === "cost" ? "cost" : null;
  const sortOrder = sp.get("sortOrder") === "asc" ? "asc" : "desc";
  const type = sp.get("type");
  const supplierId = sp.get("supplierId");
  const unit = sp.get("unit");
  const priceField = sp.get("priceField") === "cost" ? "cost" : sp.get("priceField") === "wholesalePrice" ? "wholesalePrice" : sp.get("priceField") === "price" ? "price" : null;
  const priceFrom = sp.get("priceFrom"); const priceTo = sp.get("priceTo");
  const markupSign = sp.get("markupSign") === "positive" ? "positive" : sp.get("markupSign") === "negative" ? "negative" : null;
  const markupFrom = sp.get("markupFrom"); const markupTo = sp.get("markupTo");
  const ntinFilter = sp.get("ntin");
  const stockFilter = sp.get("stock"); // nonzero|zero — Остаток filter in the stocktake product picker

  const typeWhere: Prisma.ProductWhereInput =
    type === "factory" ? { productType: "REGULAR", barcode: { not: null }, NOT: { barcode: { startsWith: "290" } } }
    : type === "internal" ? { productType: "REGULAR", barcode: { startsWith: "290" } }
    : type === "weight" ? { unit: "kg" }
    : type === "service" ? { productType: "SERVICE" }
    : type === "bundle" ? { productType: "BUNDLE" }
    : type === "article" ? { articleId: { not: null } }
    : {};

  const storeId = await getStoreId();

  // Наценка compares two columns (price vs cost), which Prisma's typed `where`
  // can't express — resolve matching ids via raw SQL first, then intersect below.
  let markupIds: string[] | null = null;
  if (markupSign) {
    const cmp = markupSign === "positive" ? Prisma.sql`p.price > p.cost` : Prisma.sql`p.price < p.cost`;
    const fromClause = markupFrom ? Prisma.sql`AND ABS((p.price - p.cost) / p.cost * 100) >= ${Number(markupFrom)}` : Prisma.empty;
    const toClause = markupTo ? Prisma.sql`AND ABS((p.price - p.cost) / p.cost * 100) <= ${Number(markupTo)}` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p.id FROM "Product" p WHERE p."storeId" = ${storeId} AND p."deletedAt" IS NULL AND p.cost IS NOT NULL AND p.cost > 0 AND ${cmp} ${fromClause} ${toClause}`
    );
    markupIds = rows.map((r) => r.id);
  }

  const where: Prisma.ProductWhereInput = {
    storeId,
    deletedAt: null,
    ...typeWhere,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
    ...(categoryId === "uncategorized" ? { categoryId: null } : categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(unit ? { unit } : {}),
    ...(ntinFilter === "set" ? { ntin: { not: null } } : ntinFilter === "unset" ? { ntin: null } : {}),
    ...(priceField && (priceFrom || priceTo) ? { [priceField]: { ...(priceFrom ? { gte: Number(priceFrom) } : {}), ...(priceTo ? { lte: Number(priceTo) } : {}) } } : {}),
    ...(markupIds ? { id: { in: markupIds } } : {}),
    ...(stockFilter === "nonzero" ? { stock: { gt: 0 } } : stockFilter === "zero" ? { stock: { lte: 0 } } : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: sortBy ? { [sortBy]: sortOrder } : { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { supplier: { select: { name: true } }, categoryRef: { select: { name: true } } },
    }),
  ]);

  // the stocktake picker greys out products already in the document
  const stocktakeId = sp.get("stocktakeId");
  const inDoc = stocktakeId
    ? new Set((await prisma.stocktakeItem.findMany({ where: { stocktakeId, stocktake: { storeId }, productId: { in: products.map((p) => p.id) } }, select: { productId: true } })).map((i) => i.productId))
    : null;

  return NextResponse.json({
    products: products.map((p) => {
      const cost = Number(p.cost ?? 0);
      const price = Number(p.price);
      return {
        id: p.id, name: p.name, barcode: p.barcode, ntin: p.ntin, sku: p.sku, articleId: p.articleId,
        additionalCode: p.additionalCode, cost: canSeeCost ? cost : 0, price, unit: p.unit, scalePlu: p.scalePlu, productType: p.productType,
        markup: !canSeeCost ? 0 : cost > 0 ? Math.round(((price - cost) / cost) * 1000) / 10 : 0,
        margin: !canSeeCost ? 0 : price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0,
        updatedAt: p.updatedAt, supplierName: p.supplier?.name ?? null, categoryName: p.categoryRef?.name ?? null,
        stock: Number(p.stock), active: p.active,
        ...(inDoc ? { inStocktake: inDoc.has(p.id) } : {}),
      };
    }),
    total,
  });
}
