import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

// GET /api/products/:id/changes — «История изменения товара»: blocks (one per save) with the changed fields, newest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const storeId = await getStoreId();
  const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const hideCost = session.user.role === "WAREHOUSE"; // purchase prices are back-office data
  const rows = await prisma.productChange.findMany({
    where: { productId: id, ...(hideCost ? { field: { notIn: ["cost", "wholesalePrice"] } } : {}) },
    include: { user: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 2000,
  });
  const groups = new Map<string, { groupId: string; userName: string; createdAt: string; items: { field: string; oldValue: string | null; newValue: string | null }[] }>();
  for (const r of rows) {
    let g = groups.get(r.groupId);
    if (!g) { g = { groupId: r.groupId, userName: r.user.name, createdAt: r.createdAt.toISOString(), items: [] }; groups.set(r.groupId, g); }
    g.items.push({ field: r.field, oldValue: r.oldValue, newValue: r.newValue });
  }
  return NextResponse.json({ groups: [...groups.values()] });
}
