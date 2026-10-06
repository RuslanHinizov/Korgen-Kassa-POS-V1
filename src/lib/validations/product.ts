import { z } from "zod";

export const productFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  sku: z.string().max(100).optional().or(z.literal("")),
  barcode: z.string().max(100).optional().or(z.literal("")),
  additionalCode: z.string().max(100).optional().or(z.literal("")),
  /// Код НКТ — Kazakhstan national product catalogue code
  ntin: z.string().max(100).optional().or(z.literal("")),
  supplierId: z.string().optional().or(z.literal("")),
  scalePlu: z.string().regex(/^\d{5}$/, "Scale PLU must contain exactly 5 digits").optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  cost: z.coerce.number().min(0).optional(),
  wholesalePrice: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().min(0).default(0),
  unit: z.enum(["pcs", "kg", "l", "m"]).default("pcs"),
  categoryId: z.string().optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  imageUrl: z.string().url().optional().or(z.literal("")),
  active: z.preprocess((val) => {
    if (typeof val === "string") return val === "true" || val === "on";
    return val === true;
  }, z.boolean()).default(true),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;
