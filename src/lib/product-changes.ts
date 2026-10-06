/** «История изменения товара»: which fields differ between the product as it was and as it was saved. */

export type ChangeField = "name" | "unit" | "barcode" | "additionalCode" | "ntin" | "lowStockThreshold" | "cost" | "price" | "wholesalePrice" | "category" | "supplier" | "active";

export const CHANGE_LABEL: Record<ChangeField, string> = {
  name: "Название товара",
  unit: "Единица измерения",
  barcode: "Штрихкод",
  additionalCode: "Дополнительный код",
  ntin: "Код НКТ (NTIN)",
  lowStockThreshold: "Критический остаток",
  cost: "Закупочная цена",
  price: "Продажная цена",
  wholesalePrice: "Оптовая цена",
  category: "Категория",
  supplier: "Поставщик",
  active: "Статус товара",
};

/** Money fields are shown with the currency, the others as text. Cost is back-office data: hidden from the warehouse role. */
export const MONEY_FIELDS: ChangeField[] = ["cost", "price", "wholesalePrice"];

/** A product as the screen sees it, every value already turned into the text that is stored in the history. */
export type ProductSnapshot = Record<ChangeField, string>;

export interface FieldChange { field: ChangeField; oldValue: string; newValue: string }

export function diffSnapshots(before: ProductSnapshot, after: Partial<ProductSnapshot>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(CHANGE_LABEL) as ChangeField[]) {
    const next = after[field];
    if (next === undefined) continue;
    if (MONEY_FIELDS.includes(field) ? Number(before[field] || 0) === Number(next || 0) : before[field] === next) continue;
    out.push({ field, oldValue: before[field], newValue: next });
  }
  return out;
}
