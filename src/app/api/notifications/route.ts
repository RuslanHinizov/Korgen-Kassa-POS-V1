import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

export type AppNotification = {
  id: string;
  level: "warning" | "error";
  title: string;
  description: string;
  href: string;
};

/** Live, store-scoped operational alerts shown from the global navigation. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const storeId = await getStoreId();
  // A product is "low" when its stock is at or under its own threshold (a column comparison, so it is counted in the database
  // — never from a capped list). Minus balances (sold, never received) are part of it and are named separately.
  const [lowRows, activeCashboxes] = await Promise.all([
    prisma.$queryRaw<{ low: bigint; negative: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE stock <= "lowStockThreshold") AS low, COUNT(*) FILTER (WHERE stock < 0) AS negative
      FROM "Product" WHERE "storeId" = ${storeId} AND active = true AND "deletedAt" IS NULL`,
    prisma.cashbox.count({ where: { storeId, active: true } }),
  ]);
  const low = Number(lowRows[0]?.low ?? 0);
  const negative = Number(lowRows[0]?.negative ?? 0);
  const notifications: AppNotification[] = [];

  if (low > 0) {
    notifications.push({
      id: "low-stock",
      level: "warning",
      title: "Низкий остаток товаров",
      description: `Товаров на минимальном остатке: ${low}.` + (negative > 0 ? ` Из них с остатком в минусе: ${negative}.` : ""),
      href: "/reports?tab=lowStock",
    });
  }

  if (activeCashboxes === 0) {
    notifications.push({
      id: "cashbox-missing",
      level: "warning",
      title: "Нет активной кассы",
      description: "Для приёма оплаты настройте и активируйте кассу.",
      href: "/management/cashboxes",
    });
  }

  return NextResponse.json({ notifications });
}
