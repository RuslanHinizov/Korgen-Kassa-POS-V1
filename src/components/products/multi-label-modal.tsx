"use client";

import { useState } from "react";
import { Printer, WandSparkles, X } from "lucide-react";
import { printLabels } from "@/lib/label-print";
import { LabelSizePicker, useLabelSize } from "@/components/labels/label-size-picker";

export interface LabelProduct { id: string; name: string; barcode: string | null; price: number; unit: string }

/** Prints price labels (one sticky label per copy) for several products at once, on the label printer. */
export function MultiLabelModal({ products, onClose }: { products: LabelProduct[]; onClose: () => void }) {
  const [items, setItems] = useState(products);
  const [copies, setCopies] = useState<Record<string, number>>(() => Object.fromEntries(products.map((p) => [p.id, 1])));
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useLabelSize();
  const missing = items.filter((p) => !p.barcode);

  async function generateMissing() {
    setBusy(true);
    const next = [...items];
    for (let i = 0; i < next.length; i++) {
      if (next[i].barcode) continue;
      try {
        const r = await fetch(`/api/products/${next[i].id}/barcode`, { method: "POST" });
        const d = await r.json();
        if (r.ok) next[i] = { ...next[i], barcode: d.barcode };
      } catch { /* left without barcode, still reported below */ }
    }
    setItems(next);
    setBusy(false);
  }

  const printable = items.filter((p) => p.barcode);
  const total = printable.reduce((n, p) => n + Math.max(1, copies[p.id] ?? 1), 0);

  async function print() {
    const r = await printLabels(printable.map((p) => ({ label: { name: p.name, price: p.price, unit: p.unit, barcode: p.barcode! }, copies: Math.max(1, copies[p.id] ?? 1) })), size);
    if (!r.ok) alert(`Этикетки не напечатаны: ${r.error ?? "ошибка принтера"}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border bg-background p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Печать этикеток ({total})</h2>
          <button onClick={onClose} aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>
        <LabelSizePicker value={size} onChange={setSize} className="mb-3" />
        <div className="mb-3 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
          {items.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3">
              <span className="truncate">{p.name}{!p.barcode && <span className="ml-2 text-xs text-destructive">нет штрихкода</span>}</span>
              <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                Копий
                <input type="number" min={1} max={99} value={copies[p.id] ?? 1} onChange={(e) => setCopies((c) => ({ ...c, [p.id]: Math.min(99, Math.max(1, Number(e.target.value) || 1)) }))} className="h-7 w-14 rounded border bg-background px-1 text-right text-foreground" />
              </label>
            </div>
          ))}
        </div>
        {missing.length > 0 && (
          <button onClick={generateMissing} disabled={busy} className="mb-3 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
            <WandSparkles className="h-4 w-4" />{busy ? "Создание…" : `Создать EAN‑13 для товаров без штрихкода (${missing.length})`}
          </button>
        )}
        <p className="mb-2 text-xs text-muted-foreground">В окне печати выберите принтер этикеток Xprinter XP-365B (браузер запомнит выбор). Одна этикетка — одна страница выбранного размера.</p>
        <button onClick={() => void print()} disabled={printable.length === 0} className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          <Printer className="h-4 w-4" />Печать
        </button>
      </div>
    </div>
  );
}
