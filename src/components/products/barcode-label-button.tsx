"use client";

import { useEffect, useState } from "react";
import { Barcode, Printer, WandSparkles, X } from "lucide-react";
import { labelsDocument, printLabels } from "@/lib/label-print";
import { LabelSizePicker, useLabelSize } from "@/components/labels/label-size-picker";

export function BarcodeLabelButton({ productId, productName, initialBarcode, price, unit, iconOnly, hidden }: { productId: string; productName: string; initialBarcode?: string | null; price: number; unit: string; iconOnly?: boolean; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const [barcode, setBarcode] = useState(initialBarcode ?? "");
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useLabelSize();

  // Lets a toolbar-level "Печать" action (e.g. the Список товаров bulk bar) open
  // this exact row's label modal without lifting state up to a shared parent.
  useEffect(() => {
    if (!iconOnly && !hidden) return;
    function onExternalPrint(e: Event) { if ((e as CustomEvent).detail === productId) setOpen(true); }
    window.addEventListener("print-single-label", onExternalPrint);
    return () => window.removeEventListener("print-single-label", onExternalPrint);
  }, [iconOnly, hidden, productId]);
  async function generate() { setBusy(true); try { const r = await fetch(`/api/products/${productId}/barcode`, { method: "POST" }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setBarcode(d.barcode); } catch (e) { alert(e instanceof Error ? e.message : "Штрихкод не создан"); } finally { setBusy(false); } }
  async function print() {
    const r = await printLabels([{ label: { name: productName, price, unit, barcode }, copies }], size);
    if (!r.ok) alert(`Этикетка не напечатана: ${r.error ?? "ошибка принтера"}`);
  }

  return <>
    {hidden ? null : iconOnly ? (
      <button onClick={() => setOpen(true)} className="rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label="Этикетка"><Printer className="h-3.5 w-3.5" /></button>
    ) : (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"><Barcode className="h-3.5 w-3.5" />Этикетка</button>
    )}
    {open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Этикетка товара</h2>
            <button onClick={() => setOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
          </div>
          {barcode ? (
            <>
              <div className="mb-3 flex justify-center rounded-lg border bg-muted/40 p-3">
                <iframe title="Предпросмотр этикетки" srcDoc={labelsDocument([{ name: productName, price, unit, barcode }], size)} style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm`, border: "1px solid #bbb", background: "#fff" }} />
              </div>
              <LabelSizePicker value={size} onChange={setSize} className="mb-3" />
              <label className="mb-3 flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Копий</span>
                <input type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} className="h-9 w-16 rounded-md border bg-background px-2 text-right" />
              </label>
              <p className="mb-3 text-xs text-muted-foreground">В окне печати выберите принтер этикеток Xprinter XP-365B (браузер запомнит выбор).</p>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">У товара нет штрихкода. Создайте внутренний EAN‑13 код.</div>
          )}
          <div className="mt-2 flex gap-2">
            {!barcode && <button disabled={busy} onClick={generate} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"><WandSparkles className="h-4 w-4" />{busy ? "Создание…" : "Создать EAN‑13"}</button>}
            {barcode && <button onClick={() => void print()} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"><Printer className="h-4 w-4" />Печать</button>}
          </div>
        </div>
      </div>
    )}
  </>;
}
