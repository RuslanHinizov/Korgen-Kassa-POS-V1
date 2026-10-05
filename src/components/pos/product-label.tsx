"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import type { ProductResult } from "./product-search";
import { labelsDocument, printLabels, programCanPrintLabels, programLabelPrinter } from "@/lib/label-print";
import { LabelSizePicker, useLabelSize } from "@/components/labels/label-size-picker";
import { CreateProductModal } from "./create-product-modal";
import { searchLocal, syncCatalog } from "@/lib/offline/catalog";

export interface LabelProduct { name: string; price: number; unit: string; barcode: string }

/** Printable shelf/item label: name, price and a scannable barcode. On the till program it goes to the label printer (XP-365B). */
export function ProductLabelModal({ product, onClose }: { product: LabelProduct; onClose: () => void }) {
  const [size, setSize] = useLabelSize();
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [printer, setPrinter] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (programCanPrintLabels()) void programLabelPrinter().then(setPrinter); }, []);

  async function print() {
    setBusy(true);
    try {
      const r = await printLabels([{ label: product, copies }], size);
      if (!r.ok) toast.error(`Этикетка не напечатана: ${r.error ?? "ошибка принтера"}`);
    } finally { setBusy(false); }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Этикетка товара</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-3 flex justify-center rounded-lg border bg-muted/40 p-3">
          <iframe
            title="Предпросмотр этикетки"
            srcDoc={labelsDocument([product], size)}
            style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm`, border: "1px solid #bbb", background: "#fff" }}
          />
        </div>
        <LabelSizePicker value={size} onChange={setSize} className="mb-3" />
        <label className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Копий</span>
          <input type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} className="h-9 w-16 rounded-md border bg-background px-2 text-right" />
        </label>
        {printer !== undefined && (
          <p className="mb-3 text-xs text-muted-foreground">
            {printer ? `Принтер этикеток: ${printer}` : "Принтер этикеток (XP-365B) не найден — этикетка уйдёт на чековый принтер"}
          </p>
        )}
        <button onClick={() => void print()} disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Печать
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** «Печать этикетки»: pick any product; if it has no barcode yet, one is generated for it on the spot. */
export function LabelPickerModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [label, setLabel] = useState<LabelProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(() => {
      // the server, or this till's own catalogue copy when there is no connection
      fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .catch(async () => (await searchLocal(q.trim(), 30)) as unknown as ProductResult[])
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  async function pick(p: ProductResult) {
    let barcode = p.barcode;
    if (!barcode) {
      setBusyId(p.id);
      try {
        const r = await fetch(`/api/pos/products/${p.id}/barcode`, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error(d.error ?? "Не удалось создать штрихкод"); return; }
        barcode = d.barcode;
      } finally { setBusyId(null); }
    }
    if (barcode) setLabel({ name: p.name, price: Number(p.price), unit: p.unit ?? "pcs", barcode });
  }

  if (label) return <ProductLabelModal product={label} onClose={() => setLabel(null)} />;
  if (creating) {
    // a code the shop does not know: the cashier types the name (and price), the product joins the shop's catalogue
    return (
      <CreateProductModal
        initialBarcode={/^[A-Za-z0-9-]{4,30}$/.test(q.trim()) ? q.trim() : ""}
        submitLabel="Создать и напечатать этикетку"
        overlayClass="z-[75]"
        onClose={() => setCreating(false)}
        onCreated={(product) => {
          void syncCatalog(); // the other tills get it with their next catalogue update
          setCreating(false);
          if (product.barcode) setLabel({ name: product.name, price: Number(product.price), unit: product.unit ?? "pcs", barcode: product.barcode });
        }}
      />
    );
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Печать этикетки</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или штрихкод товара" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" />
        </div>
        <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
          {!q.trim() ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Найдите товар, чтобы напечатать этикетку</p>
            : results.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                <p>Товар «{q.trim()}» не найден в магазине</p>
                <button onClick={() => setCreating(true)} className="mt-3 h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Добавить новый товар</button>
              </div>
            )
            : results.slice(0, 30).map((p) => (
              <button key={p.id} onClick={() => void pick(p)} disabled={busyId === p.id} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50">
                <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.barcode ?? "нет штрихкода — будет создан"}</span></span>
                {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="shrink-0 tabular-nums">{formatCurrency(Number(p.price))}</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
