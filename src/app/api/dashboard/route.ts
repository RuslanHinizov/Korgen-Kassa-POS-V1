import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { getRevenueSummary, getStockValue } from "@/lib/reports";
import { cashboxLiveState } from "@/lib/dashboard-helpers";

/** GET /api/dashboard?range=today|yesterday|week|month30|month90 — Главная page: KPIs,
 * revenue chart, recent receipts, stock value. Range set matches UMAG's own 5 period
 * chips (Сегодня/Вчера/7 дней/30 дней/90 дней). */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = req.nextUrl.searchParams.get("range") ?? "week";
  // The server runs in UTC while the shop does not: build the period in the viewer's time zone.
  const rawTz = Number(req.nextUrl.searchParams.get("tz"));
  const tzOffsetMin = Number.isFinite(rawTz) && Math.abs(rawTz) <= 14 * 60 ? rawTz : 0;
  const toReal = (shifted: Date) => new Date(shifted.getTime() + tzOffsetMin * 60000);
  // "Shifted" dates carry the viewer's wall-clock time in their UTC fields.
  const nowLocal = new Date(Date.now() - tzOffsetMin * 60000);
  const startLocal = new Date(nowLocal);
  startLocal.setUTCHours(0, 0, 0, 0);
  const endLocal = new Date(nowLocal);
  endLocal.setUTCHours(23, 59, 59, 999);
  if (range === "yesterday") {
    startLocal.setUTCDate(startLocal.getUTCDate() - 1);
    endLocal.setUTCDate(endLocal.getUTCDate() - 1);
  } else if (range === "month30") {
    startLocal.setUTCDate(startLocal.getUTCDate() - 29);
  } else if (range === "month90") {
    startLocal.setUTCDate(startLocal.getUTCDate() - 89);
  } else if (range !== "today") {
    startLocal.setUTCDate(startLocal.getUTCDate() - 6); // week (default)
  }
  const start = toReal(startLocal);
  const end = toReal(endLocal);

  const storeId = await getStoreId();
  const [summary, stock, receipts, expenses, cashboxes, accounts] = await Promise.all([
    getRevenueSummary(start, end, storeId, tzOffsetMin),
    getStockValue(storeId),
    // Приёмки panel: the receipts posted in the chosen period, newest first (the panel's «Расходы» is their total)
    prisma.purchaseReceipt.findMany({
      where: { storeId, status: "POSTED", postedAt: { gte: start, lte: end } },
      orderBy: { postedAt: "desc" },
      take: 3,
      select: {
        id: true,
        totalAmount: true,
        postedAt: true,
        createdAt: true,
        status: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.purchaseReceipt.aggregate({
      where: { storeId, status: "POSTED", postedAt: { gte: start, lte: end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.cashbox.findMany({
      where: { storeId },
      orderBy: { no: "asc" },
      select: { id: true, name: true, active: true, lastSyncAt: true, appVersion: true, account: { select: { balance: true } } },
    }),
    prisma.financeAccount.findMany({
      where: { storeId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, balance: true },
    }),
  ]);

  return NextResponse.json({
    summary: {
      revenue: summary.revenue,
      grossProfit: summary.grossProfit,
      avgTransaction: summary.avgTransaction,
      missingCost: summary.missingCost,
    },
    revenueByDay: summary.revenueByDay,
    stock,
    expenses: Number(expenses._sum.totalAmount ?? 0),
    receiptsCount: expenses._count,
    receipts: receipts.map((r) => ({
      id: r.id,
      supplierName: r.supplier?.name ?? "—",
      total: Number(r.totalAmount),
      receivedAt: r.postedAt ?? r.createdAt,
      status: r.status,
    })),
    cashboxes: cashboxes.map((c) => ({
      id: c.id,
      name: c.name,
      balance: c.account ? Number(c.account.balance) : null,
      state: cashboxLiveState(c),
      lastSyncAt: c.lastSyncAt,
      appVersion: c.appVersion,
    })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance) })),
  });
}
