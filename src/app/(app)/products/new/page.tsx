import type { Metadata } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getStoreId } from "@/lib/store-context";
import { ProductEditor } from "@/components/products/product-editor/product-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Товар — Создание" };

export default async function NewProductPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const storeId = await getStoreId();
  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({ where: { storeId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, parentId: true, defaultMarkup: true } }),
    prisma.supplier.findMany({ where: { storeId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <ProductEditor
      categories={categories.map((c) => ({ ...c, defaultMarkup: c.defaultMarkup == null ? null : Number(c.defaultMarkup) }))}
      suppliers={suppliers}
      canSeeCost={session?.user.role !== "WAREHOUSE"}
    />
  );
}
