import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { clampLabelSize, labelsDocument } from "@/lib/label-print";

// jsdom has no canvas to measure the barcode text with: the drawing itself is not what these tests are about
vi.mock("@/lib/draw-barcode", () => ({
  drawBarcode: (svg: SVGSVGElement, code: string) => { svg.setAttribute("width", "200"); svg.setAttribute("height", "60"); svg.setAttribute("data-code", code); },
}));

const require = createRequire(import.meta.url);
const { tsplLabel, dotsFor } = require("../../till-app/label-tspl.js") as {
  tsplLabel: (o: Record<string, unknown>) => { data: Buffer };
  dotsFor: (mm: number) => number;
};

describe("label size", () => {
  it("keeps the label inside what the XP-365B takes (20–82 mm wide)", () => {
    expect(clampLabelSize({ widthMm: 5, heightMm: 40 })).toEqual({ widthMm: 20, heightMm: 40 });
    expect(clampLabelSize({ widthMm: 200, heightMm: 40 })).toEqual({ widthMm: 82, heightMm: 40 });
    expect(clampLabelSize({ widthMm: 58, heightMm: 40 })).toEqual({ widthMm: 58, heightMm: 40 });
    expect(clampLabelSize({ widthMm: NaN, heightMm: NaN })).toEqual({ widthMm: 58, heightMm: 40 });
  });
});

describe("label page", () => {
  it("is one page of exactly the label size, with the escaped name, the price and the barcode", () => {
    const html = labelsDocument([{ name: "Чай <b>Lipton</b>", price: 1234, unit: "pcs", barcode: "4600000000019" }], { widthMm: 58, heightMm: 40 });
    expect(html).toContain("@page{size:58mm 40mm;margin:0}");
    expect(html).toContain("width:58mm;height:40mm");
    expect(html).toContain("Чай &lt;b&gt;Lipton&lt;/b&gt;");
    expect(html).toContain("<svg");
    expect(html).toMatch(/1.?234/); // the currency symbol and separators depend on the app's currency setting
  });

  it("makes one page per label", () => {
    const l = { name: "A", price: 1, unit: "pcs", barcode: "12345678" };
    const html = labelsDocument([l, l, l], { widthMm: 40, heightMm: 30 });
    expect(html.match(/class="lbl"/g)).toHaveLength(3);
  });
});

describe("TSPL label for the XP-365B", () => {
  it("sets the size and gap, sends the bitmap with 0 = black, then prints the copies", () => {
    const widthMm = 8; // 64 dots wide
    const heightMm = 2; // 16 dots high
    const w = dotsFor(widthMm);
    const h = dotsFor(heightMm);
    expect([w, h]).toEqual([64, 16]);
    // a picture that is white everywhere except the first pixel
    const bgra = Buffer.alloc(w * h * 4, 255);
    bgra[0] = bgra[1] = bgra[2] = 0;
    const { data } = tsplLabel({ bgra, width: w, height: h, widthMm, heightMm, gapMm: 2, copies: 3 });
    const text = data.toString("latin1");
    expect(text).toContain("SIZE 8 mm,2 mm\r\nGAP 2 mm,0 mm\r\n");
    expect(text).toContain("BITMAP 0,0,8,16,0,");
    expect(text.endsWith("\r\nPRINT 3,1\r\n")).toBe(true);
    const start = data.indexOf("BITMAP 0,0,8,16,0,") + "BITMAP 0,0,8,16,0,".length;
    expect(data[start]).toBe(0b01111111); // first dot black (0), the other seven white (1)
    expect(data[start + 1]).toBe(0xff);
    expect(data.length - start - "\r\nPRINT 3,1\r\n".length).toBe(8 * 16);
  });

  it("can send black as 1 for a printer that wants it the other way round", () => {
    const bgra = Buffer.alloc(8 * 1 * 4, 255);
    bgra[0] = bgra[1] = bgra[2] = 0;
    const { data } = tsplLabel({ bgra, width: 8, height: 1, widthMm: 1, heightMm: 1, invert: false });
    const marker = "BITMAP 0,0,1,1,0,";
    expect(data[data.indexOf(marker) + marker.length]).toBe(0b10000000);
  });
});
