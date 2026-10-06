import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

// GET /api/products/:id/sales-dynamics?tz=300 — «Динамика продаж»: units sold per day over the last month (days in the
// viewer's time zone: `tz` = minutes east of UTC, 300 = Almaty).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const storeId = await getStoreId();
  const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true, unit: true } });
  if (!product) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const tzRaw = Number(req.nextUrl.searchParams.get("tz"));
  const tz = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? Math.round(tzRaw) : 300;
  const rows = await prisma.$queryRaw<{ day: string; qty: string }[]>`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now() + make_interval(mins => ${tz})) - interval '30 days', date_trunc('day', now() + make_interval(mins => ${tz})), interval '1 day') AS d
    ), sold AS (
      SELECT date_trunc('day', s."createdAt" + make_interval(mins => ${tz})) AS d, sum(si.quantity) AS q
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE si."productId" = ${id} AND s.status = 'COMPLETED' AND s."storeId" = ${storeId}
        AND s."createdAt" >= now() - interval '32 days'
      GROUP BY 1
    )
    SELECT to_char(days.d, 'YYYY-MM-DD') AS day, COALESCE(sold.q, 0)::text AS qty FROM days LEFT JOIN sold ON sold.d = days.d ORDER BY days.d`;
  return NextResponse.json({ unit: product.unit, days: rows.map((r) => ({ day: r.day, qty: Number(r.qty) })) });
}
