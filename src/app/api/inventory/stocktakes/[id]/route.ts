import { backdatingError } from "@/lib/backdating";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

const PRODUCT_SELECT = { id: true, name: true, barcode: true, unit: true, stock: true, cost: true, price: true, productType: true } as const;

/** Rows of one page of the document that match the search / type / difference filters of the screen. */
function itemFilter(stocktakeId: string, sp: URLSearchParams): Prisma.StocktakeItemWhereInput {
  const q = sp.get("q")?.trim();
  const type = sp.get("type");
  const diff = sp.get("diff");
  const and: Prisma.StocktakeItemWhereInput[] = [];
  if (q) and.push({ product: { OR: [{ name: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] } });
  // same precedence as the screen: service, bundle, weighted, internal (290…), everything else is a factory product
  if (type === "service") and.push({ product: { productType: "SERVICE" } });
  else if (type === "bundle") and.push({ product: { productType: "BUNDLE" } });
  else if (type === "weight") and.push({ product: { productType: "REGULAR", unit: "kg" } });
  else if (type === "internal") and.push({ product: { productType: "REGULAR", unit: { not: "kg" }, barcode: { startsWith: "290" } } });
  else if (type === "factory") and.push({ product: { productType: "REGULAR", unit: { not: "kg" }, OR: [{ barcode: null }, { NOT: { barcode: { startsWith: "290" } } }] } });
  if (diff === "diff") and.push({ difference: { not: 0 } });
  else if (diff === "nodiff") and.push({ OR: [{ difference: 0 }, { difference: null }] });
  else if (diff === "surplus") and.push({ difference: { gt: 0 } });
  else if (diff === "shortage") and.push({ difference: { lt: 0 } });
  return { stocktakeId, AND: and };
}

// GET /api/inventory/stocktakes/:id?page=&pageSize=&q=&type=&diff= — the document header and ONE page of its lines.
// A document may hold every product of the market (tens of thousands of lines), so the lines are never sent all at once;
// the totals are added up here, on the server, over every line that matches the filters.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const storeId = await getStoreId();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(sp.get("pageSize")) || 100));

  const stocktake = await prisma.stocktake.findFirst({ where: { id, storeId }, include: { user: { select: { name: true } } } });
  if (!stocktake) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const where = itemFilter(id, sp);
  const [filteredCount, itemCount, scannedCount, items, valued] = await Promise.all([
    prisma.stocktakeItem.count({ where }),
    prisma.stocktakeItem.count({ where: { stocktakeId: id } }),
    prisma.stocktakeItem.count({ where: { stocktakeId: id, scannedAt: { not: null } } }),
    prisma.stocktakeItem.findMany({
      where,
      include: { product: { select: PRODUCT_SELECT } },
      orderBy: [{ product: { name: "asc" } }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stocktakeItem.findMany({ where: { ...where, difference: { not: 0 } }, select: { difference: true, product: { select: { cost: true, price: true } } } }),
  ]);
  let totalCost = 0;
  let totalSale = 0;
  for (const v of valued) {
    const d = Number(v.difference);
    totalCost += d * Number(v.product.cost ?? 0);
    totalSale += d * Number(v.product.price);
  }

  return NextResponse.json({
    stocktake: {
      id: stocktake.id, documentNo: stocktake.documentNo, status: stocktake.status, note: stocktake.note,
      valuateAtCost: stocktake.valuateAtCost,
      countedAt: stocktake.countedAt, postedAt: stocktake.postedAt, userName: stocktake.user.name,
      itemCount, scannedCount, filteredCount, page, pageSize, totalCost, totalSale,
      items: items.map((i) => ({
        id: i.id, productId: i.productId, productName: i.product.name, barcode: i.product.barcode,
        unit: i.product.unit, productType: i.product.productType, currentStock: Number(i.product.stock),
        cost: i.product.cost != null ? Number(i.product.cost) : null, price: Number(i.product.price),
        expectedQty: Number(i.expectedQty),
        countedQty: i.countedQty != null ? Number(i.countedQty) : null,
        difference: i.difference != null ? Number(i.difference) : null,
        scannedAt: i.scannedAt ? i.scannedAt.toISOString() : null,
      })),
    },
  });
}

const patchSchema = z.object({
  countedAt: z.coerce.date().optional(),
  note: z.string().max(1000).optional().nullable(),
  valuateAtCost: z.boolean().optional(),
});

// PATCH /api/inventory/stocktakes/:id — edit header fields while still DRAFT/COUNTING
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const storeId = await getStoreId();
  const existing = await prisma.stocktake.findFirst({ where: { id, storeId }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (existing.status !== "DRAFT" && existing.status !== "COUNTING") {
    return NextResponse.json({ error: "Документ на этом этапе нельзя изменить" }, { status: 409 });
  }

  const bd = await backdatingError(storeId, parsed.data.countedAt);
  if (bd) return NextResponse.json({ error: bd }, { status: 400 });

  const stocktake = await prisma.stocktake.update({
    where: { id },
    data: {
      ...(parsed.data.countedAt !== undefined ? { countedAt: parsed.data.countedAt } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      ...(parsed.data.valuateAtCost !== undefined ? { valuateAtCost: parsed.data.valuateAtCost } : {}),
    },
  });
  return NextResponse.json({ stocktake });
}

// DELETE /api/inventory/stocktakes/:id — only before it's posted
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const storeId = await getStoreId();
  const existing = await prisma.stocktake.findFirst({ where: { id, storeId }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (existing.status === "POSTED") return NextResponse.json({ error: "Проведённый документ нельзя удалить" }, { status: 409 });

  await prisma.stocktake.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
