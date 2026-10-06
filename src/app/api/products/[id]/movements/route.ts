import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import type { InventoryMovementType } from "@/generated/prisma/client";

// «Тип операции» filter of «История движения товара»: the choice → the movement types behind it.
const MOVEMENT_GROUPS: { key: string; label: string; types: InventoryMovementType[] }[] = [
  { key: "SALE", label: "Продажа", types: ["SALE"] },
  { key: "RECEIPT", label: "Приемка", types: ["RECEIPT"] },
  { key: "SALE_RETURN", label: "Возврат от покупателя", types: ["SALE_RETURN"] },
  { key: "SUPPLIER_RETURN", label: "Возврат поставщику", types: ["SUPPLIER_RETURN"] },
  { key: "STOCKTAKE", label: "Инвентаризация", types: ["STOCKTAKE"] },
  { key: "WRITE_OFF", label: "Списание", types: ["DAMAGE", "WASTE", "THEFT"] },
  { key: "TRANSFER", label: "Перемещение", types: ["TRANSFER_OUT", "TRANSFER_IN"] },
  { key: "ADJUSTMENT", label: "Корректировка", types: ["ADJUSTMENT"] },
  { key: "OPENING_BALANCE", label: "Начальный остаток", types: ["OPENING_BALANCE"] },
  { key: "IMPORT", label: "Импорт", types: ["IMPORT"] },
];

const TYPE_LABEL: Record<string, string> = {
  SALE: "Продажа", RECEIPT: "Приемка", SALE_RETURN: "Возврат от покупателя", SUPPLIER_RETURN: "Возврат поставщику", STOCKTAKE: "Инвентаризация",
  DAMAGE: "Списание", WASTE: "Списание", THEFT: "Списание", TRANSFER_OUT: "Перемещение", TRANSFER_IN: "Перемещение",
  ADJUSTMENT: "Корректировка", OPENING_BALANCE: "Начальный остаток", IMPORT: "Импорт",
};

/** The page of the document a movement came from, when there is one (path inside the market). */
function docPath(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceId) return null;
  switch (referenceType) {
    case "PurchaseReceipt": return `/purchases/${referenceId}`;
    case "Stocktake": return `/products/stocktake/${referenceId}`;
    case "WriteOff": return `/products/write-off/${referenceId}`;
    case "StockIn": return `/products/stock-in/${referenceId}`;
    case "StoreTransfer": return `/products/transfer/${referenceId}`;
    case "SupplierReturn": return `/purchases/returns/${referenceId}`;
    default: return null;
  }
}

// GET /api/products/:id/movements?type=SALE,RECEIPT&from=2026-09-01&to=2026-09-30 — «История движения товара».
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const storeId = await getStoreId();
  const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true, unit: true } });
  if (!product) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const keys = (sp.get("type") ?? "").split(",").filter(Boolean);
  const types = MOVEMENT_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => g.types);
  const tzRaw = Number(sp.get("tz"));
  const tz = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? tzRaw : 300; // minutes east of UTC
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  // a calendar day in the viewer's time zone → the UTC moment it starts
  const startOf = (s: string) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() - tz * 60000);
  const from = day(sp.get("from"));
  const to = day(sp.get("to"));

  const rows = await prisma.inventoryMovement.findMany({
    where: {
      productId: id,
      ...(types.length ? { type: { in: types } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: startOf(from) } : {}), ...(to ? { lt: new Date(startOf(to).getTime() + 86_400_000) } : {}) } } : {}),
    },
    include: { user: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  // the number of a sale is on the sale, not on the stock movement
  const saleIds = rows.filter((r) => r.referenceType === "Sale" && r.referenceId).map((r) => r.referenceId!);
  const sales = saleIds.length ? await prisma.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, documentNo: true } }) : [];
  const saleNo = new Map(sales.map((s) => [s.id, s.documentNo]));

  return NextResponse.json({
    unit: product.unit,
    groups: MOVEMENT_GROUPS.map((g) => ({ key: g.key, label: g.label })),
    movements: rows.map((r) => {
      const no = r.referenceType === "Sale" && r.referenceId ? saleNo.get(r.referenceId) : r.documentNo;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        userName: r.user.name,
        label: TYPE_LABEL[r.type] ?? r.type,
        documentNo: no == null ? null : String(no),
        href: docPath(r.referenceType, r.referenceId),
        supplier: r.supplier?.name ?? null,
        before: Number(r.stockBefore),
        after: Number(r.stockAfter),
        diff: Number(r.stockAfter) - Number(r.stockBefore),
      };
    }),
  });
}
