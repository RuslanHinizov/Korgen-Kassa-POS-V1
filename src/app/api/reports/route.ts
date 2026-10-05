import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

const LOW_STOCK_LIST_LIMIT = 500;

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const range = searchParams.get("range") ?? "today";

  const now = new Date();
  let start: Date;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (range) {
    case "week":
      start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "custom": {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      start = from ? new Date(from) : new Date(now.setDate(now.getDate() - 30));
      const customEnd = to ? new Date(to) : new Date();
      customEnd.setHours(23, 59, 59, 999);
      end.setTime(customEnd.getTime());
      break;
    }
    default: // today
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
  }

  const storeId = await getStoreId();
  const [sales, topProducts, voidedCount, refundSummary, lowStockProducts, lowStockCount] = await Promise.all([
    // (see the two low-stock queries at the end of this list)
    prisma.sale.findMany({
      // Include refunded sales in gross revenue.  The dashboard then subtracts
      // the matching refund rows only when the cashier selects net revenue.
      // Excluding these sales here caused a refund to be deducted twice.
      where: { storeId, createdAt: { gte: start, lte: end }, status: { in: ["COMPLETED", "REFUNDED"] } },
      select: {
        id: true,
        total: true,
        subtotal: true,
        discountAmount: true,
        tipAmount: true,
        paymentMethod: true,
        paymentLines: true,
        createdAt: true,
        items: {
          select: {
            price: true,
            quantity: true,
            total: true,
            productId: true,
            product: { select: { cost: true } },
          },
        },
        customer: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.saleItem.groupBy({
      by: ["productId", "name"],
      where: { sale: { storeId, createdAt: { gte: start, lte: end }, status: { in: ["COMPLETED", "REFUNDED"] } } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    }),
    prisma.sale.count({ where: { storeId, createdAt: { gte: start, lte: end }, status: "VOIDED" } }),
    prisma.refund.aggregate({
      where: { sale: { storeId }, createdAt: { gte: start, lte: end } },
      _count: { id: true },
      _sum: { amount: true },
    }),
    // «Низкий остаток»: products at or under their own threshold, chosen in the database (the lowest balances first) — not
    // a cut of the 100 lowest-stock products, which made the count read "100" whatever the real number was.
    prisma.$queryRaw<{ id: string; name: string; stock: unknown; lowStockThreshold: number; sku: string | null; category: string | null }[]>`
      SELECT id, name, stock, "lowStockThreshold", sku, category FROM "Product"
      WHERE "storeId" = ${storeId} AND active = true AND "deletedAt" IS NULL AND stock <= "lowStockThreshold"
      ORDER BY stock ASC, name ASC LIMIT ${LOW_STOCK_LIST_LIMIT}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Product"
      WHERE "storeId" = ${storeId} AND active = true AND "deletedAt" IS NULL AND stock <= "lowStockThreshold"`,
  ]);

  const lowStock = lowStockProducts.map((p) => ({ ...p, stock: Number(p.stock) }));
  const lowStockTotal = Number(lowStockCount[0]?.n ?? 0);

  const byDay: Record<string, { revenue: number; transactions: number }> = {};
  let totalRevenue = 0;
  let totalTips = 0;
  let totalGrossProfit = 0;
  const paymentBreakdown: Record<string, number> = { CASH: 0, CARD: 0, OTHER: 0 };
  const uniqueCustomers = new Set<string>();

  for (const sale of sales) {
    const day = sale.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { revenue: 0, transactions: 0 };
    const rev = parseFloat(sale.total.toString());
    byDay[day].revenue += rev;
    byDay[day].transactions += 1;
    totalRevenue += rev;
    totalTips += parseFloat((sale.tipAmount ?? 0).toString());
    if (sale.customer?.id) uniqueCustomers.add(sale.customer.id);

    for (const item of sale.items) {
      const itemRevenue = parseFloat(item.total.toString());
      const unitCost = item.product?.cost ? parseFloat(item.product.cost.toString()) : 0;
      totalGrossProfit += itemRevenue - unitCost * parseFloat(item.quantity.toString());
    }

    const lines = sale.paymentLines as Array<{ method: string; amount: number }> | null;
    if (lines && lines.length > 0) {
      for (const line of lines) {
        paymentBreakdown[line.method] = (paymentBreakdown[line.method] ?? 0) + line.amount;
      }
    } else {
      paymentBreakdown[sale.paymentMethod] = (paymentBreakdown[sale.paymentMethod] ?? 0) + rev;
    }
  }

  const revenueByDay = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  const pieData = Object.entries(paymentBreakdown)
    .filter(([, v]) => v > 0)
    .map(([method, value]) => ({ method, value: Math.round(value * 100) / 100 }));

  return NextResponse.json({
    summary: {
      revenue: totalRevenue,
      grossProfit: totalGrossProfit,
      transactions: sales.length,
      tips: totalTips,
      avgTransaction: sales.length > 0 ? totalRevenue / sales.length : 0,
      voidedCount,
      refundCount: refundSummary._count.id,
      refundTotal: parseFloat((refundSummary._sum.amount ?? 0).toString()),
      customerVisits: uniqueCustomers.size,
    },
    revenueByDay,
    pieData,
    topProducts: topProducts.map((p) => ({
      name: p.name,
      qty: p._sum.quantity ?? 0,
      revenue: parseFloat((p._sum.total ?? 0).toString()),
    })),
    lowStock,
    lowStockTotal,
  });
}
