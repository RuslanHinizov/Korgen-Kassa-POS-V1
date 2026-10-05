import { prisma } from "@/lib/db";

export interface RevenueDay {
  date: string;
  revenue: number;
  transactions: number;
}
export interface RevenueSummary {
  revenue: number;
  grossProfit: number;
  transactions: number;
  avgTransaction: number;
  revenueByDay: RevenueDay[];
  /** Sold products that have no purchase price: their whole sum counts as profit, so the profit is overstated by this much. */
  missingCost: { products: number; revenue: number };
}

/**
 * Revenue/profit summary for [start, end] — used by the Главная dashboard.
 * Like UMAG's: revenue = sales − returns, profit = (sales − their cost) − (returns − the cost of what came back).
 * Returns count on the day they were made; a fully refunded sale still counts as a sale (its refund is the deduction).
 */
export async function getRevenueSummary(
  start: Date,
  end: Date,
  storeId: string,
  /** Viewer's UTC offset as `Date#getTimezoneOffset()` (minutes, +5h → -300); days are bucketed in that zone. */
  tzOffsetMin = 0
): Promise<RevenueSummary> {
  const localDay = (d: Date) => new Date(d.getTime() - tzOffsetMin * 60000).toISOString().slice(0, 10);
  const sales = await prisma.sale.findMany({
    where: { storeId, createdAt: { gte: start, lte: end }, status: { in: ["COMPLETED", "REFUNDED"] } },
    select: {
      total: true,
      discountAmount: true,
      createdAt: true,
      items: { select: { total: true, quantity: true, discountAmount: true, productId: true, product: { select: { cost: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byDay: Record<string, { revenue: number; transactions: number }> = {};
  let totalRevenue = 0;
  let totalGrossProfit = 0;
  const missingCostProducts = new Set<string>();
  let missingCostRevenue = 0;

  for (const sale of sales) {
    const day = localDay(sale.createdAt);
    if (!byDay[day]) byDay[day] = { revenue: 0, transactions: 0 };
    const rev = parseFloat(sale.total.toString());
    byDay[day].revenue += rev;
    byDay[day].transactions += 1;
    totalRevenue += rev;

    // Sale.discountAmount also contains the per-line discounts, which SaleItem.total already nets out;
    // only the order-level remainder still has to come off the profit.
    const lineDiscounts = sale.items.reduce((s, i) => s + parseFloat(i.discountAmount.toString()), 0);
    totalGrossProfit -= Math.max(0, parseFloat(sale.discountAmount.toString()) - lineDiscounts);

    for (const item of sale.items) {
      const itemRevenue = parseFloat(item.total.toString());
      const unitCost = item.product?.cost ? parseFloat(item.product.cost.toString()) : 0;
      totalGrossProfit += itemRevenue - unitCost * parseFloat(item.quantity.toString());
      if (unitCost === 0 && itemRevenue > 0) {
        missingCostProducts.add(item.productId ?? `custom:${item.total}`);
        missingCostRevenue += itemRevenue;
      }
    }
  }

  // Returns made in the period, taken off revenue and (at cost) added back to profit.
  const refunds = await prisma.refund.findMany({
    where: { sale: { storeId }, createdAt: { gte: start, lte: end } },
    select: { amount: true, createdAt: true, items: true },
  });
  const refundLines = refunds.flatMap((r) => (Array.isArray(r.items) ? (r.items as unknown as { productId?: string | null; quantity: number }[]) : []));
  const returnedIds = [...new Set(refundLines.map((l) => l.productId).filter((id): id is string => !!id))];
  const costRows = returnedIds.length ? await prisma.product.findMany({ where: { id: { in: returnedIds }, storeId }, select: { id: true, cost: true } }) : [];
  const costById = new Map(costRows.map((p) => [p.id, Number(p.cost ?? 0)]));
  for (const r of refunds) {
    const day = localDay(r.createdAt);
    if (!byDay[day]) byDay[day] = { revenue: 0, transactions: 0 };
    const amount = Number(r.amount);
    byDay[day].revenue -= amount;
    totalRevenue -= amount;
    totalGrossProfit -= amount;
    for (const l of Array.isArray(r.items) ? (r.items as unknown as { productId?: string | null; quantity: number }[]) : []) {
      totalGrossProfit += Number(l.quantity) * (l.productId ? (costById.get(l.productId) ?? 0) : 0);
    }
  }

  // Keep every day in the selected range, including zero-sale days. Besides
  // making the chart truthful, this matches the operational dashboard pattern:
  // an empty day is meaningful and must not disappear from the time axis.
  const revenueByDay: RevenueDay[] = [];
  const cursor = new Date(`${localDay(start)}T00:00:00.000Z`);
  const lastDay = localDay(end);
  while (cursor.toISOString().slice(0, 10) <= lastDay) {
    const date = cursor.toISOString().slice(0, 10);
    const data = byDay[date] ?? { revenue: 0, transactions: 0 };
    revenueByDay.push({ date, ...data });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    revenue: totalRevenue,
    grossProfit: totalGrossProfit,
    transactions: sales.length,
    avgTransaction: sales.length > 0 ? totalRevenue / sales.length : 0,
    revenueByDay,
    missingCost: { products: missingCostProducts.size, revenue: missingCostRevenue },
  };
}

/**
 * Склад card. The headline numbers are UMAG's: stock × price and stock × cost over every active product, so products with a
 * negative balance (sold but never received) are subtracted. `shelf` is what is really on the shelves (positive balances
 * only) and `negative` shows how much the minus balances pull the headline down.
 */
export interface StockValue {
  saleValue: number;
  costValue: number;
  shelf: { saleValue: number; costValue: number };
  negative: { products: number; saleValue: number; costValue: number };
}
export async function getStockValue(storeId: string): Promise<StockValue> {
  const rows = await prisma.$queryRaw<Record<string, string | bigint | null>[]>`
    SELECT SUM(stock * price) AS sale_value, SUM(stock * COALESCE(cost, 0)) AS cost_value,
           SUM(stock * price) FILTER (WHERE stock > 0) AS shelf_sale, SUM(stock * COALESCE(cost, 0)) FILTER (WHERE stock > 0) AS shelf_cost,
           COUNT(*) FILTER (WHERE stock < 0) AS neg_products,
           SUM(stock * price) FILTER (WHERE stock < 0) AS neg_sale, SUM(stock * COALESCE(cost, 0)) FILTER (WHERE stock < 0) AS neg_cost
    FROM "Product" WHERE active = true AND "deletedAt" IS NULL AND "storeId" = ${storeId}
  `;
  const r = rows[0] ?? {};
  const n = (v: string | bigint | null | undefined) => Number(v ?? 0) || 0;
  return {
    saleValue: n(r.sale_value),
    costValue: n(r.cost_value),
    shelf: { saleValue: n(r.shelf_sale), costValue: n(r.shelf_cost) },
    negative: { products: n(r.neg_products), saleValue: n(r.neg_sale), costValue: n(r.neg_cost) },
  };
}
