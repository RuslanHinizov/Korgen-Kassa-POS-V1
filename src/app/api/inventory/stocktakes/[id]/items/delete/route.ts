import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

const schema = z.object({ itemIds: z.array(z.string().min(1)).min(1).max(100_000) });

// POST /api/inventory/stocktakes/:id/items/delete — «Удалить выбранное»: any number of lines in one statement
// (one request per line froze the screen on a big selection).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: stocktakeId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Не выбраны строки" }, { status: 400 });

  const storeId = await getStoreId();
  const stocktake = await prisma.stocktake.findFirst({ where: { id: stocktakeId, storeId }, select: { status: true } });
  if (!stocktake) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING") {
    return NextResponse.json({ error: "На этом этапе нельзя изменять товары" }, { status: 409 });
  }
  const deleted = await prisma.$executeRaw`DELETE FROM "StocktakeItem" WHERE "stocktakeId" = ${stocktakeId} AND id = ANY(${parsed.data.itemIds}::text[])`;
  return NextResponse.json({ deleted });
}
