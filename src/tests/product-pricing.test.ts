import { describe, expect, it } from "vitest";
import { editPrice, markupOf, priceFrom } from "@/lib/product-pricing";
import { diffSnapshots, type ProductSnapshot } from "@/lib/product-changes";

describe("price fields (UMAG: cost, markup, sale price)", () => {
  it("markup = (price - cost) / cost, as on the UMAG screen (194 → 240 = 23.71%)", () => {
    expect(markupOf(194, 240)).toBe(23.71);
    expect(priceFrom(194, 23.71)).toBe(240);
    expect(markupOf(0, 240)).toBeNull();
  });

  it("editing the sale price with the cost locked works out the markup", () => {
    const r = editPrice({ cost: "194", markup: "0", price: "194" }, { cost: true, price: false }, "price", "240");
    expect(r).toEqual({ cost: "194", markup: "23.71", price: "240" });
  });

  it("editing the markup changes the price when only the cost is locked", () => {
    const r = editPrice({ cost: "200", markup: "0", price: "200" }, { cost: true, price: false }, "markup", "25");
    expect(r.price).toBe("250");
    expect(r.cost).toBe("200");
  });

  it("editing the markup changes the cost when the sale price is locked", () => {
    const r = editPrice({ cost: "200", markup: "25", price: "250" }, { cost: false, price: true }, "markup", "50");
    expect(r.price).toBe("250");
    expect(r.cost).toBe("166.67");
  });

  it("editing the cost keeps the markup and moves the price (price not locked)", () => {
    const r = editPrice({ cost: "200", markup: "25", price: "250" }, { cost: false, price: false }, "cost", "100");
    expect(r.price).toBe("125");
  });

  it("editing the cost with the price locked works out a new markup", () => {
    const r = editPrice({ cost: "200", markup: "25", price: "250" }, { cost: false, price: true }, "cost", "125");
    expect(r.markup).toBe("100");
    expect(r.price).toBe("250");
  });

  it("an empty or invalid field leaves the others alone", () => {
    const r = editPrice({ cost: "200", markup: "25", price: "250" }, { cost: true, price: false }, "price", "");
    expect(r).toEqual({ cost: "200", markup: "25", price: "" });
  });
});

describe("product change history", () => {
  const before: ProductSnapshot = {
    name: "Чай", unit: "pcs", barcode: "123", additionalCode: "", ntin: "", lowStockThreshold: "5",
    cost: "160", price: "200", wholesalePrice: "0", category: "Незаданные", supplier: "", active: "true",
  };

  it("lists only the fields that really changed", () => {
    const d = diffSnapshots(before, { ...before, cost: "156.00", price: "210", name: "Чай" });
    expect(d).toEqual([
      { field: "cost", oldValue: "160", newValue: "156.00" },
      { field: "price", oldValue: "200", newValue: "210" },
    ]);
  });

  it("money compares as numbers: 160 and 160.00 are the same", () => {
    expect(diffSnapshots(before, { cost: "160.00", wholesalePrice: "" })).toEqual([]);
  });

  it("skips fields that were not sent", () => {
    expect(diffSnapshots(before, { name: "Чай чёрный" })).toEqual([{ field: "name", oldValue: "Чай", newValue: "Чай чёрный" }]);
  });
});
