import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";
import { generateEan13 } from "@/lib/barcode";

// GET /api/products/generate-barcode — an unused internal EAN-13 (290…) for the «Сгенерировать» buttons of the product screen.
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const storeId = await getStoreId();
  for (let i = 0; i < 20; i++) {
    const code = generateEan13();
    const taken = await prisma.product.findFirst({ where: { storeId, OR: [{ barcode: code }, { additionalCode: code }] }, select: { id: true } });
    if (!taken) return NextResponse.json({ barcode: code });
  }
  return NextResponse.json({ error: "Не удалось создать штрихкод" }, { status: 500 });
}
