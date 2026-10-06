import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getStoreId } from "@/lib/store-context";
import { ProductEditor } from "@/components/products/product-editor/product-editor";
import { DbError } from "@/components/ui/db-error";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Товар — Редактирование" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: Props) {
  noStore();
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  try {
    const storeId = await getStoreId();
    const product = await prisma.product.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!product) notFound();
    const [categories, suppliers, firstMovement] = await Promise.all([
      prisma.category.findMany({ where: { storeId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, parentId: true, defaultMarkup: true } }),
      prisma.supplier.findMany({ where: { storeId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      // the product has no author field: whoever first put it on the books (its opening balance / first document) is shown
      prisma.inventoryMovement.findFirst({ where: { productId: id }, orderBy: { createdAt: "asc" }, select: { user: { select: { name: true } } } }),
    ]);
    return (
      <ProductEditor
        product={{
          id: product.id, name: product.name, unit: product.unit, barcode: product.barcode ?? "", additionalCode: product.additionalCode ?? "", ntin: product.ntin ?? "",
          lowStockThreshold: product.lowStockThreshold, cost: product.cost == null ? null : Number(product.cost), price: Number(product.price),
          wholesalePrice: product.wholesalePrice == null ? null : Number(product.wholesalePrice), categoryId: product.categoryId, supplierId: product.supplierId,
        }}
        categories={categories.map((c) => ({ ...c, defaultMarkup: c.defaultMarkup == null ? null : Number(c.defaultMarkup) }))}
        suppliers={suppliers}
        creatorName={firstMovement?.user.name ?? null}
        canSeeCost={session?.user.role !== "WAREHOUSE"}
      />
    );
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_")) throw e; // notFound() / redirects pass through
    return <DbError page="this product" />;
  }
}
