"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { productFormSchema } from "@/lib/validations/product";
import { getStoreId } from "@/lib/store-context";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { diffSnapshots, type ProductSnapshot } from "@/lib/product-changes";

/** Server actions are directly callable endpoints — only catalogue staff may change products. */
async function assertCatalogStaff() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.user.role ?? "")) throw new Error("Forbidden");
}

/** Check if a P2002 error relates to a given field name */
function isConstraintOn(e: any, field: string): boolean {
  // Prisma 7 with adapter uses meta.constraint (the raw PG constraint name)
  // Older versions use meta.target (array of field names)
  const constraint: string = e.meta?.constraint ?? "";
  const target: unknown = e.meta?.target;
  const fieldLower = field.toLowerCase();

  if (constraint && constraint.toLowerCase().includes(fieldLower)) return true;
  if (Array.isArray(target)) return target.some((t: string) => t.toLowerCase().includes(fieldLower));
  if (typeof target === "string") return target.toLowerCase().includes(fieldLower);
  return false;
}

/**
 * Resolve the category fields: when a categoryId is chosen, `category` (the
 * denormalised name the POS grid reads) follows it; otherwise fall back to any
 * typed free-text name.
 */
async function resolveCategory(storeId: string, categoryId?: string, typed?: string): Promise<{ categoryId: string | null; category: string | null }> {
  if (categoryId) {
    const cat = await prisma.category.findFirst({ where: { id: categoryId, storeId }, select: { name: true } });
    if (cat) return { categoryId, category: cat.name };
  }
  return { categoryId: null, category: typed || null };
}

export async function createProduct(formData: FormData) {
  await assertCatalogStaff();
  const raw = Object.fromEntries(formData.entries());
  const parsed = productFormSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const storeId = await getStoreId();
  const { categoryId: _cid, category: _cname, ...rest } = parsed.data;
  const data = {
    ...rest,
    storeId,
    sku: parsed.data.sku || null,
    barcode: parsed.data.barcode || null,
    additionalCode: parsed.data.additionalCode || null,
    ntin: parsed.data.ntin || null,
    supplierId: await resolveSupplier(storeId, parsed.data.supplierId),
    scalePlu: parsed.data.scalePlu || null,
    imageUrl: parsed.data.imageUrl || null,
    ...(await resolveCategory(storeId, _cid, _cname)),
  };

  try {
    await prisma.product.create({ data });
  } catch (e: any) {
    console.error("createProduct error:", e.code, JSON.stringify(e.meta));
    if (e.code === "P2002") {
      if (isConstraintOn(e, "sku")) {
        return { error: { formErrors: [], fieldErrors: { sku: ["A product with this SKU already exists"] } } };
      }
      if (isConstraintOn(e, "barcode")) {
        return { error: { formErrors: [], fieldErrors: { barcode: ["A product with this Barcode already exists"] } } };
      }
      return { error: { formErrors: ["A duplicate value was found. Please check SKU or barcode."], fieldErrors: {} } };
    }
    return { error: { formErrors: ["An unexpected error occurred. Please try again."], fieldErrors: {} } };
  }

  revalidatePath("/products");
  redirect(`/store/${await getStoreId()}/products`);
}

/** The supplier chosen on the screen, only when it belongs to this market. */
async function resolveSupplier(storeId: string, supplierId?: string): Promise<string | null> {
  if (!supplierId) return null;
  const found = await prisma.supplier.findFirst({ where: { id: supplierId, storeId }, select: { id: true } });
  return found ? found.id : null;
}

const productUpdateSchema = productFormSchema.partial();

/**
 * Saves the product screen. Only the fields that were sent change (the screen has no stock field: stock moves through
 * documents, never through this form), and every changed field is written to «История изменения товара».
 */
export async function updateProduct(id: string, formData: FormData) {
  await assertCatalogStaff();
  const session = await auth.api.getSession({ headers: await headers() });
  const raw = Object.fromEntries(formData.entries());
  const parsed = productUpdateSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const storeId = await getStoreId();
  const existing = await prisma.product.findFirst({
    where: { id, storeId, deletedAt: null },
    include: { supplier: { select: { name: true } } },
  });
  if (!existing) {
    return { error: { formErrors: ["Product not found"], fieldErrors: {} } };
  }

  const d = parsed.data;
  const warehouse = session?.user.role === "WAREHOUSE"; // the warehouse role never sees or changes purchase prices
  const data: Record<string, unknown> = {};
  const next: Partial<ProductSnapshot> = {};
  const has = (k: keyof typeof d) => d[k] !== undefined;
  if (has("name")) { data.name = d.name; next.name = d.name!; }
  if (has("unit")) { data.unit = d.unit; next.unit = d.unit!; }
  if (has("barcode")) { data.barcode = d.barcode || null; next.barcode = d.barcode || ""; }
  if (has("additionalCode")) { data.additionalCode = d.additionalCode || null; next.additionalCode = d.additionalCode || ""; }
  if (has("ntin")) { data.ntin = d.ntin || null; next.ntin = d.ntin || ""; }
  if (has("sku")) data.sku = d.sku || null;
  if (has("scalePlu")) data.scalePlu = d.scalePlu || null;
  if (has("imageUrl")) data.imageUrl = d.imageUrl || null;
  if (has("lowStockThreshold")) { data.lowStockThreshold = d.lowStockThreshold; next.lowStockThreshold = String(d.lowStockThreshold); }
  if (has("price")) { data.price = d.price; next.price = String(d.price); }
  if (has("cost") && !warehouse) { data.cost = d.cost; next.cost = String(d.cost); }
  if (has("wholesalePrice") && !warehouse) { data.wholesalePrice = d.wholesalePrice; next.wholesalePrice = String(d.wholesalePrice); }
  if (has("active")) { data.active = d.active; next.active = String(d.active); }
  if (has("categoryId") || has("category")) {
    const cat = await resolveCategory(storeId, d.categoryId, d.category);
    data.categoryId = cat.categoryId;
    data.category = cat.category;
    next.category = cat.category ?? "";
  }
  let supplierName: string | undefined;
  if (has("supplierId")) {
    const sid = await resolveSupplier(storeId, d.supplierId);
    data.supplierId = sid;
    supplierName = sid ? (await prisma.supplier.findUnique({ where: { id: sid }, select: { name: true } }))?.name : "";
    next.supplier = supplierName ?? "";
  }

  const before: ProductSnapshot = {
    name: existing.name, unit: existing.unit, barcode: existing.barcode ?? "", additionalCode: existing.additionalCode ?? "", ntin: existing.ntin ?? "",
    lowStockThreshold: String(existing.lowStockThreshold), cost: existing.cost == null ? "" : String(existing.cost), price: String(existing.price),
    wholesalePrice: existing.wholesalePrice == null ? "" : String(existing.wholesalePrice), category: existing.category ?? "", supplier: existing.supplier?.name ?? "",
    active: String(existing.active),
  };
  const changes = diffSnapshots(before, next);

  try {
    await prisma.$transaction([
      prisma.product.update({ where: { id }, data }),
      ...(changes.length && session
        ? [prisma.productChange.createMany({ data: (() => { const groupId = randomUUID(); return changes.map((c) => ({ productId: id, userId: session.user.id, groupId, field: c.field, oldValue: c.oldValue, newValue: c.newValue })); })() })]
        : []),
    ]);
  } catch (e: any) {
    console.error("updateProduct error:", e.code, JSON.stringify(e.meta));
    if (e.code === "P2002") {
      if (isConstraintOn(e, "sku")) {
        return { error: { formErrors: [], fieldErrors: { sku: ["A product with this SKU already exists"] } } };
      }
      if (isConstraintOn(e, "barcode")) {
        return { error: { formErrors: [], fieldErrors: { barcode: ["Товар с таким штрихкодом уже есть"] } } };
      }
      return { error: { formErrors: ["A duplicate value was found. Please check SKU or barcode."], fieldErrors: {} } };
    }
    return { error: { formErrors: ["An unexpected error occurred. Please try again."], fieldErrors: {} } };
  }

  revalidatePath("/products");
  return { ok: true as const };
}

export async function deleteProduct(id: string) {
  await assertCatalogStaff();
  const storeId = await getStoreId();
  const existing = await prisma.product.findFirst({ where: { id, storeId, deletedAt: null } });
  if (!existing) return;
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/products");
}
