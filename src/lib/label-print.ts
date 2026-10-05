/**
 * Sticky price labels (Xprinter XP-365B and similar label printers). One label = one page of the label's own size, so the
 * printer cuts every label at the right place. On the till program the label goes straight to the label printer
 * (till-app/main.js); in a browser the print window opens on a page of the label size and the label printer is chosen
 * there once (the browser remembers it).
 */
import { drawBarcode } from "@/lib/draw-barcode";
import { isFractionalUnit, unitLabel } from "@/lib/units";
import { formatCurrency } from "@/lib/utils";

export interface LabelSize { widthMm: number; heightMm: number }
export interface LabelData { name: string; price: number; unit: string; barcode: string }

export const LABEL_SIZE_KEY = "korgen-label-size";
export const LABEL_PRESETS: LabelSize[] = [
  { widthMm: 58, heightMm: 40 }, { widthMm: 58, heightMm: 30 }, { widthMm: 40, heightMm: 30 }, { widthMm: 40, heightMm: 25 },
  { widthMm: 30, heightMm: 20 }, { widthMm: 60, heightMm: 40 }, { widthMm: 70, heightMm: 50 },
];
export const DEFAULT_LABEL_SIZE: LabelSize = LABEL_PRESETS[0];

/** The Xprinter XP-365B takes paper 20–82 mm wide. */
export function clampLabelSize(s: Partial<LabelSize>): LabelSize {
  const w = Number(s.widthMm);
  const h = Number(s.heightMm);
  return {
    widthMm: Number.isFinite(w) ? Math.min(82, Math.max(20, Math.round(w))) : DEFAULT_LABEL_SIZE.widthMm,
    heightMm: Number.isFinite(h) ? Math.min(200, Math.max(10, Math.round(h))) : DEFAULT_LABEL_SIZE.heightMm,
  };
}

export function getLabelSize(): LabelSize {
  try {
    const raw = localStorage.getItem(LABEL_SIZE_KEY);
    if (raw) return clampLabelSize(JSON.parse(raw));
  } catch { /* default */ }
  return DEFAULT_LABEL_SIZE;
}

export function setLabelSize(size: LabelSize): void {
  try { localStorage.setItem(LABEL_SIZE_KEY, JSON.stringify(clampLabelSize(size))); } catch { /* best effort */ }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The barcode as an SVG that stretches to the width of its box. */
export function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  drawBarcode(svg, code, { displayValue: true, margin: 0, height: 46, width: 1.45, fontSize: 12 });
  // JsBarcode writes the size as "179px": the viewBox wants plain numbers
  svg.setAttribute("viewBox", `0 0 ${parseFloat(svg.getAttribute("width") ?? "0")} ${parseFloat(svg.getAttribute("height") ?? "0")}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return svg.outerHTML;
}

/** One label as a page of exactly `size`. Plain CSS in millimetres: nothing depends on the app's own styles. */
export function labelPage(label: LabelData, size: LabelSize): string {
  const price = `${formatCurrency(label.price)}${isFractionalUnit(label.unit) ? ` / ${unitLabel(label.unit, true)}` : ""}`;
  // a small label gets smaller letters
  const k = Math.min(size.widthMm / 58, size.heightMm / 40, 1.3);
  const nameMm = Math.max(2.4, 3.6 * k);
  const priceMm = Math.max(3.6, 6.4 * k);
  return (
    `<div class="lbl" style="width:${size.widthMm}mm;height:${size.heightMm}mm">` +
    `<div class="n" style="font-size:${nameMm.toFixed(2)}mm">${esc(label.name)}</div>` +
    `<div class="p" style="font-size:${priceMm.toFixed(2)}mm">${esc(price)}</div>` +
    `<div class="b">${barcodeSvg(label.barcode)}</div></div>`
  );
}

export function labelsDocument(labels: LabelData[], size: LabelSize): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@page{size:${size.widthMm}mm ${size.heightMm}mm;margin:0}` +
    `html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;overflow:hidden}` +
    `.lbl{box-sizing:border-box;padding:1.2mm 1.6mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;overflow:hidden;page-break-after:always;break-after:page}` +
    `.lbl:last-child{page-break-after:auto;break-after:auto}` +
    `.n{font-weight:700;line-height:1.1;max-height:2.25em;overflow:hidden;width:100%}` +
    `.p{font-weight:800;line-height:1.05}` +
    `.b{flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}` +
    `.b svg{width:100%;height:100%}` +
    `</style></head><body>${labels.map((l) => labelPage(l, size)).join("")}</body></html>`
  );
}

interface LabelBridge {
  printLabel?: (html: string, opts: { widthMm: number; heightMm: number; copies: number }) => Promise<{ ok: boolean; error?: string; printer?: string }>;
  labelPrinter?: () => Promise<string | null>;
}
function bridge(): LabelBridge | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { korgenShell?: LabelBridge }).korgenShell;
}

export function programCanPrintLabels(): boolean {
  return typeof bridge()?.printLabel === "function";
}

/** The label printer the till program found (null: none installed, labels then go to the receipt printer). */
export async function programLabelPrinter(): Promise<string | null> {
  try { return (await bridge()?.labelPrinter?.()) ?? null; } catch { return null; }
}

/** Till program: each label is its own print job, `copies` of it, silently. */
export async function printLabelsOnProgram(labels: { label: LabelData; copies: number }[], size: LabelSize): Promise<{ ok: boolean; error?: string }> {
  const b = bridge();
  if (!b?.printLabel) return { ok: false, error: "no program printer" };
  for (const { label, copies } of labels) {
    const r = await b.printLabel(labelsDocument([label], size), { widthMm: size.widthMm, heightMm: size.heightMm, copies });
    if (!r.ok) return { ok: false, error: r.error };
  }
  return { ok: true };
}

/** Browser: a print window with one page per label (copies repeated); the label printer is picked in the print dialog. */
export function printLabelsInBrowser(labels: { label: LabelData; copies: number }[], size: LabelSize): void {
  const list = labels.flatMap(({ label, copies }) => Array.from({ length: Math.max(1, copies) }, () => label));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(labelsDocument(list, size));
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow?.addEventListener("afterprint", cleanup);
  setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 150);
}

/** Prints on whatever this screen has: the till program's label printer, or the browser's print window. */
export async function printLabels(labels: { label: LabelData; copies: number }[], size: LabelSize): Promise<{ ok: boolean; error?: string }> {
  if (programCanPrintLabels()) return printLabelsOnProgram(labels, size);
  printLabelsInBrowser(labels, size);
  return { ok: true };
}
