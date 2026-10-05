import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { logAudit } from "@/lib/audit";

// POST /api/inventory/stocktakes/:id/post — Провести: Черновик/Подсчёт → Проведён.
// Matches real UMAG: no separate review stage — Провести works directly, even if
// some lines were never actually scanned (still 0/flagged) — the human is trusted
// to have seen the warning. Applies each line's difference to stock, writes an
// inventory ledger row, then locks the document.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const storeId = await getStoreId();

  const stocktake = await prisma.stocktake.findFirst({ where: { id, storeId } });
  if (!stocktake) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING") {
    return NextResponse.json({ error: "Документ уже проведён или отменён" }, { status: 409 });
  }
  const itemCount = await prisma.stocktakeItem.count({ where: { stocktakeId: id } });
  if (itemCount === 0) return NextResponse.json({ error: "Добавьте хотя бы один товар" }, { status: 400 });

  try {
    // Set-based: the whole document is applied with a few SQL statements, however many lines it has. (A loop of three
    // queries per line ran out of the transaction time on a document with every product of the market.)
    const result = await prisma.$transaction(async (tx) => {
      // closing the document first: a second click / second tab cannot post it twice
      const claimed = await tx.stocktake.updateMany({ where: { id, status: { in: ["DRAFT", "COUNTING"] } }, data: { status: "POSTED", postedAt: new Date() } });
      if (claimed.count === 0) throw new Error("ALREADY_POSTED");

      const short = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "StocktakeItem" i JOIN "Product" p ON p.id = i."productId"
        WHERE i."stocktakeId" = ${id} AND i.difference IS NOT NULL AND i.difference <> 0 AND p.stock + i.difference < 0`;
      if (Number(short[0]?.n ?? 0) > 0) throw new Error("INSUFFICIENT_STOCK");

      const applied = await tx.$executeRaw`
        WITH d AS (
          SELECT i."productId" AS pid, i.difference AS diff FROM "StocktakeItem" i
          WHERE i."stocktakeId" = ${id} AND i.difference IS NOT NULL AND i.difference <> 0
        ), upd AS (
          UPDATE "Product" p SET stock = p.stock + d.diff, "updatedAt" = now() FROM d WHERE p.id = d.pid
          RETURNING p.id AS pid, p.stock AS after, d.diff AS diff, p.cost AS cost, p.price AS price
        )
        INSERT INTO "InventoryMovement" (id, "productId", "userId", type, quantity, "stockBefore", "stockAfter", "unitCost", "referenceType", "referenceId", "documentNo", note, "createdAt")
        SELECT gen_random_uuid()::text, pid, ${session.user.id}, 'STOCKTAKE'::"InventoryMovementType", diff, after - diff, after,
               CASE WHEN ${stocktake.valuateAtCost} THEN COALESCE(cost, price) ELSE price END,
               'Stocktake', ${id}, ${String(stocktake.documentNo)}, ${stocktake.note}, now()
        FROM upd`;
      return applied;
    }, { timeout: 600_000, maxWait: 20_000 });

    await logAudit({ userId: session.user.id, action: "STOCKTAKE_POST", entityType: "Stocktake", entityId: id, details: { items: itemCount, changed: result } });
    return NextResponse.json({ stocktake: { ...stocktake, status: "POSTED" } });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "INSUFFICIENT_STOCK") {
      return NextResponse.json({ error: "Недостаточно остатка по одному из товаров" }, { status: 409 });
    }
    if (e instanceof Error && e.message === "ALREADY_POSTED") {
      return NextResponse.json({ error: "Документ уже проведён или отменён" }, { status: 409 });
    }
    throw e;
  }
}
