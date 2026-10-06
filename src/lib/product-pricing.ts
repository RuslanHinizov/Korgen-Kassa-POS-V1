/**
 * Product screen «Цены»: Закупочная цена, Наценка (%) and Продажная цена are tied together. Наценка = (price − cost) / cost.
 * The lock next to a price fixes it: editing another field then changes the field that is NOT locked.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export const parseMoney = (v: string): number | null => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

export function markupOf(cost: number, price: number): number | null {
  return cost > 0 ? r2(((price - cost) / cost) * 100) : null;
}
export const priceFrom = (cost: number, markup: number): number => r2(cost * (1 + markup / 100));
export const costFrom = (price: number, markup: number): number | null => (1 + markup / 100 > 0 ? r2(price / (1 + markup / 100)) : null);

export interface PriceFields { cost: string; markup: string; price: string }
export interface PriceLocks { cost: boolean; price: boolean }

const fmt = (n: number | null, fallback: string): string => (n === null ? fallback : String(n));

/** The three fields after the user typed `value` into `edited`. Fields that cannot be worked out are left as they were. */
export function editPrice(fields: PriceFields, locks: PriceLocks, edited: keyof PriceFields, value: string): PriceFields {
  const next = { ...fields, [edited]: value };
  const cost = parseMoney(next.cost);
  const price = parseMoney(next.price);
  const markup = Number(next.markup.replace(",", "."));
  const markupOk = next.markup.trim() !== "" && Number.isFinite(markup);

  if (edited === "cost") {
    if (cost === null) return next;
    if (locks.price && price !== null) return { ...next, markup: fmt(markupOf(cost, price), next.markup) };
    if (markupOk) return { ...next, price: String(priceFrom(cost, markup)) };
    return next;
  }
  if (edited === "price") {
    if (price === null) return next;
    if (locks.cost && cost !== null) return { ...next, markup: fmt(markupOf(cost, price), next.markup) };
    if (markupOk) return { ...next, cost: fmt(costFrom(price, markup), next.cost) };
    if (cost !== null) return { ...next, markup: fmt(markupOf(cost, price), next.markup) };
    return next;
  }
  // markup edited
  if (!markupOk) return next;
  if (locks.price && price !== null) return { ...next, cost: fmt(costFrom(price, markup), next.cost) };
  if (cost !== null) return { ...next, price: String(priceFrom(cost, markup)) };
  if (price !== null) return { ...next, cost: fmt(costFrom(price, markup), next.cost) };
  return next;
}
