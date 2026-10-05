"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StoreLink as Link } from "@/components/store/store-link";
import { useStoreRouter as useRouter } from "@/components/store/use-store-router";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { AlertCircle, Camera, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Loader2, Plus, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { isFractionalUnit, parseQuantityInput, unitLabel } from "@/lib/units";
import { useSession } from "@/lib/auth-client";
import { useAnchoredPopover, AnchoredPopover } from "@/components/ui/anchored-popover";
import { ImportItemsModal } from "@/components/ui/import-items-modal";
import { AddProductsModal } from "./add-products-modal";

type Status = "DRAFT" | "COUNTING" | "REVIEWING" | "POSTED" | "CANCELLED";
const STATUS_LABEL: Record<Status, string> = {
  DRAFT: "Черновик", COUNTING: "Подсчёт", REVIEWING: "Проведение", POSTED: "Проведён", CANCELLED: "Отменён",
};
const dateTimeFmt = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Item {
  id: string; productId: string; productName: string; barcode: string | null; unit: string; productType: string;
  currentStock: number; cost: number | null; price: number; expectedQty: number; countedQty: number | null; difference: number | null;
  scannedAt: string | null;
}
interface Doc {
  id: string; documentNo: number; status: Status; note: string | null; valuateAtCost: boolean;
  countedAt: string; postedAt: string | null; userName: string; items: Item[];
  /** lines in the whole document / those already scanned / those matching the filters; money totals of the filtered lines */
  itemCount: number; scannedCount: number; filteredCount: number; totalCost: number; totalSale: number;
}
interface PickProduct { id: string; name: string; price: number; stock: number; unit?: string; barcode?: string | null }

export function StocktakeDetail({ id }: { id: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const role = useSession().data?.user.role;
  const [hideStock, setHideStock] = useState(false);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductBarcode, setNewProductBarcode] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const loadSeq = useRef(0);

  const action = useAnchoredPopover();
  const filter = useAnchoredPopover();
  const method = useAnchoredPopover();
  const exportMenu = useAnchoredPopover();

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setHideStock(Boolean(d?.hideStockDuringStocktake));
      setHideAmounts(Boolean(d?.hideAmountsDuringStocktake));
    }).catch(() => {});
  }, []);

  // A document can hold every product of the market, so only ONE page of lines is ever fetched and drawn. Search and the
  // filters run on the server; an older answer that arrives late is dropped.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) qs.set("q", search.trim());
    if (typeFilter) qs.set("type", typeFilter);
    if (diffFilter) qs.set("diff", diffFilter);
    const r = await fetch(`/api/inventory/stocktakes/${id}?${qs}`);
    if (seq !== loadSeq.current) return;
    if (!r.ok) { toast.error("Документ не найден"); router.push("/products/stocktake"); return; }
    const d = await r.json();
    if (seq !== loadSeq.current) return;
    setDoc(d.stocktake);
    setLoading(false);
    // lines were deleted and this page no longer exists: go to the last one
    const pages = Math.max(1, Math.ceil(d.stocktake.filteredCount / pageSize));
    if (page > pages) setPage(pages);
  }, [id, router, page, pageSize, search, typeFilter, diffFilter]);
  useEffect(() => {
    // typing in the search box is not sent letter by letter
    const t = setTimeout(() => { void load(); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Matches real UMAG: no separate review stage — Провести is available directly
  // from Черновик/Подсчёт, the document just isn't editable once Проведён.
  const editable = doc?.status === "DRAFT" || doc?.status === "COUNTING";

  async function addProduct(p: PickProduct) {
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: p.id }),
      });
      if (!r.ok) { toast.error((await r.json()).error ?? "Не удалось добавить"); return; }
      load();
    } finally { setBusy(false); }
  }

  // Entering a count changes just that line on the screen (and the totals by the difference) — the whole document is
  // not fetched again for every typed number.
  async function updateCounted(itemId: string, countedQty: number) {
    const r = await fetch(`/api/inventory/stocktakes/${id}/items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countedQty }) });
    if (!r.ok) { toast.error("Не удалось сохранить"); return; }
    const saved = (await r.json()).item as { scannedAt: string | null };
    setDoc((d) => {
      if (!d) return d;
      const old = d.items.find((i) => i.id === itemId);
      if (!old) return d;
      const diff = countedQty - old.expectedQty;
      const oldDiff = old.difference ?? 0;
      return {
        ...d,
        scannedCount: d.scannedCount + (old.scannedAt ? 0 : 1),
        totalCost: d.totalCost + (diff - oldDiff) * (old.cost ?? 0),
        totalSale: d.totalSale + (diff - oldDiff) * old.price,
        items: d.items.map((i) => (i.id === itemId ? { ...i, countedQty, difference: diff, scannedAt: saved.scannedAt ?? i.scannedAt } : i)),
      };
    });
  }

  async function deleteItem(itemId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/items/${itemId}`, { method: "DELETE" });
      if (!r.ok) { toast.error("Не удалось удалить"); return; }
      setSelected((s) => { const next = new Set(s); next.delete(itemId); return next; });
      load();
    } finally { setBusy(false); }
  }

  async function deleteSelectedItems() {
    if (selected.size === 0) return;
    action.close();
    if (!confirm(`Удалить выбранные строки (${selected.size})?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/items/delete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: [...selected] }),
      });
      if (!r.ok) { toast.error("Не удалось удалить"); return; }
      setSelected(new Set());
      load();
    } finally { setBusy(false); }
  }

  function toggleSelected(itemId: string) {
    setSelected((s) => { const next = new Set(s); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; });
  }
  // the header checkbox works on the lines of the page on screen
  function toggleSelectAll(rows: Item[]) {
    setSelected((s) => {
      const next = new Set(s);
      if (rows.length > 0 && rows.every((r) => next.has(r.id))) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function createProduct() {
    if (!newProductName.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/products/quick-create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProductName.trim(), barcode: newProductBarcode.trim() || undefined }),
      });
      if (!r.ok) { toast.error((await r.json()).error ?? "Не удалось создать товар"); return; }
      const d = await r.json();
      const ar = await fetch(`/api/inventory/stocktakes/${id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: d.product.id }),
      });
      if (!ar.ok) { toast.error("Товар создан, но не добавлен в подсчёт"); return; }
      setNewProductName(""); setNewProductBarcode("");
      load();
    } finally { setBusy(false); }
  }

  async function importItems(rows: { barcode: string; quantity: number }[]) {
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/items/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Не удалось импортировать"); return; }
      setImportOpen(false);
      if (d.notFound?.length > 0) toast.error(`Добавлено: ${d.added}. Не найдено по штрихкоду: ${d.notFound.length}`);
      else toast.success(`Добавлено товаров: ${d.added}`);
      load();
    } finally { setBusy(false); }
  }

  function openComment() {
    setCommentDraft(doc?.note ?? "");
    setCommentOpen(true);
  }
  async function saveComment() {
    const r = await fetch(`/api/inventory/stocktakes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: commentDraft }) });
    if (!r.ok) { toast.error("Не удалось сохранить комментарий"); return; }
    setCommentOpen(false);
    load();
  }

  async function toggleValuateAtCost(next: boolean) {
    method.close();
    setDoc((d) => (d ? { ...d, valuateAtCost: next } : d));
    const r = await fetch(`/api/inventory/stocktakes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valuateAtCost: next }) });
    if (!r.ok) { toast.error("Не удалось изменить метод оприходования"); load(); }
  }

  async function saveDoc() {
    setBusy(true);
    try { await load(); toast.success("Изменения сохранены"); } finally { setBusy(false); }
  }

  async function postDoc() {
    if (!doc) return;
    if (!confirm(`Провести инвентаризацию №${doc.documentNo}? Остатки товаров будут скорректированы.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/post`, { method: "POST" });
      if (!r.ok) { toast.error((await r.json()).error ?? "Не удалось провести"); return; }
      toast.success("Инвентаризация проведена");
      load();
    } finally { setBusy(false); }
  }

  async function deleteDoc() {
    if (!confirm("Удалить эту инвентаризацию?")) return;
    const r = await fetch(`/api/inventory/stocktakes/${id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Не удалось удалить"); return; }
    router.push("/products/stocktake");
  }

  if (loading || !doc) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;
  }

  // Matches real UMAG: Остаток/Разница are shown openly at every stage — the
  // business setting is the only thing that hides them, same as Прод./Закуп. цена.
  const hideStockCols = hideStock;
  const hideAmountCols = editable && hideAmounts;
  // UMAG never shows Закупочная цена to Складской работник, regardless of the inventory-hide setting.
  const canSeeCost = role !== "WAREHOUSE";

  const rows = doc.items;
  const totalPages = Math.max(1, Math.ceil(doc.filteredCount / pageSize));
  const firstIndex = doc.filteredCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIndex = Math.min(doc.filteredCount, page * pageSize);
  const colCount = 3 + (hideStockCols ? 0 : 2) + 1 + (hideAmountCols ? 0 : (canSeeCost ? 2 : 1)) + (editable ? 2 : 1);
  const totalCost = doc.totalCost;
  const totalSale = doc.totalSale;

  return (
    <div className="p-4 sm:p-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Инвентаризация №{doc.documentNo}</h1>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{STATUS_LABEL[doc.status]}</span>
        <span className="ml-auto text-xs text-muted-foreground">Создатель: {doc.userName}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {editable && doc.items.length > 0 && (
          <button onClick={postDoc} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Провести
          </button>
        )}
        {editable && (
          <button onClick={saveDoc} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
            Сохранить
          </button>
        )}
        {editable && (
          <Link href={`/products/stocktake/${id}/scan`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10">
            <Camera className="h-4 w-4" /> Сканирование
          </Link>
        )}
        <Link href="/products/stocktake" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
          Закрыть
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && (
            <button ref={method.anchorRef} onClick={method.toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
              Метод оприходования
            </button>
          )}
          {editable && (
            <button onClick={openComment} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
              {doc.note ? "Изменить комментарий" : "Добавить комментарий"}
            </button>
          )}
          {editable && (
            <button onClick={deleteDoc} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 px-3 text-sm font-medium text-destructive hover:bg-destructive/10">
              Удалить инвентаризацию
            </button>
          )}
          <button ref={exportMenu.anchorRef} onClick={exportMenu.toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" /> Экспорт
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Позиций в документе: {doc.itemCount} · отсканировано: {doc.scannedCount}</p>

      {doc.note && !editable && <p className="text-sm text-muted-foreground">Комментарий: {doc.note}</p>}

      {method.open && method.pos && (
        <AnchoredPopover pos={method.pos} onClose={method.close} className="w-72">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={doc.valuateAtCost} onChange={(e) => toggleValuateAtCost(e.target.checked)} />
            Оприходовать по закупочной цене
          </label>
        </AnchoredPopover>
      )}

      {exportMenu.open && exportMenu.pos && (
        <AnchoredPopover pos={exportMenu.pos} onClose={exportMenu.close} className="w-44 p-1">
          <button onClick={() => { exportMenu.close(); window.open(`/api/inventory/stocktakes/${id}/export`, "_blank"); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent">
            Экспорт в Excel
          </button>
        </AnchoredPopover>
      )}

      {commentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Добавить комментарий</h2>
              <button onClick={() => setCommentOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-5 w-5" /></button>
            </div>
            <textarea
              value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} rows={3} autoFocus
              placeholder="Введите свой комментарий для обозначения данной операции"
              className="w-full resize-none rounded-md border bg-background p-2 text-sm"
            />
            <button onClick={saveComment} className="mt-3 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Добавить
            </button>
          </div>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button ref={action.anchorRef} onClick={action.toggle} disabled={selected.size === 0} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
            <span className="flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-xs">{selected.size}</span> Действие
          </button>
          <button ref={filter.anchorRef} onClick={filter.toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <SlidersHorizontal className="h-4 w-4" /> Фильтр
          </button>
          <div className="flex-1 min-w-[16rem]">
            <ProductPicker onPick={addProduct} busy={busy} />
          </div>
        </div>
      )}

      {action.open && action.pos && (
        <AnchoredPopover pos={action.pos} onClose={action.close} className="w-52 p-1">
          <button onClick={deleteSelectedItems} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10">
            Удалить выбранное
          </button>
        </AnchoredPopover>
      )}

      {filter.open && filter.pos && (
        <AnchoredPopover pos={filter.pos} onClose={filter.close} className="w-72 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Название / штрихкод</label>
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Найти в документе" className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип товара</label>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Все</option>
              <option value="factory">Заводские</option>
              <option value="weight">Весовые</option>
              <option value="internal">Внутренние</option>
              <option value="service">Услуга</option>
              <option value="bundle">Комплект</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Количество и разница</label>
            <select value={diffFilter} onChange={(e) => { setDiffFilter(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Не выбрано</option>
              <option value="diff">С расхождением</option>
              <option value="nodiff">Без расхождения</option>
              <option value="surplus">Излишек</option>
              <option value="shortage">Недостача</option>
            </select>
          </div>
        </AnchoredPopover>
      )}

      {addModalOpen && (
        <AddProductsModal
          stocktakeId={id}
          onClose={() => setAddModalOpen(false)}
          onAdded={load}
        />
      )}
      {importOpen && <ImportItemsModal busy={busy} onClose={() => setImportOpen(false)} onImport={importItems} />}

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {editable && (
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={() => toggleSelectAll(rows)} />
                </th>
              )}
              <th className="px-3 py-2 text-left">№</th>
              <th className="px-3 py-2 text-left">Название товара</th>
              <th className="px-3 py-2 text-left">Штрихкод</th>
              <th className="px-3 py-2 text-left">Время сканирования</th>
              <th className="px-3 py-2 text-right">Сканировано</th>
              {!hideStockCols && <th className="px-3 py-2 text-right">Остаток на время сканирования</th>}
              {!hideStockCols && <th className="px-3 py-2 text-right">Разница</th>}
              <th className="px-3 py-2 text-left">Ед. изм</th>
              {!hideAmountCols && canSeeCost && <th className="px-3 py-2 text-right">Сумма закуп. цены и за ед</th>}
              {!hideAmountCols && <th className="px-3 py-2 text-right">Сумма прод. цены и за ед</th>}
              {editable && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((item, idx) => {
              // Matches real UMAG: a line not yet actually scanned shows a warning
              // once its (0-default) count leaves a nonzero difference — not "hidden",
              // just openly flagged so it isn't mistaken for a confirmed count.
              const unscanned = item.scannedAt === null;
              const diff = item.difference ?? 0;
              return (
              <tr key={item.id} className="hover:bg-muted/40">
                {editable && (
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} /></td>
                )}
                <td className="px-3 py-2 text-muted-foreground">{(page - 1) * pageSize + idx + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/products/${item.productId}/edit`} target="_blank" className="font-medium text-primary hover:underline">{item.productName}</Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{item.barcode ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">
                  {item.scannedAt ? dateTimeFmt(item.scannedAt) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? (
                    <input
                      type="number" inputMode={isFractionalUnit(item.unit) ? "decimal" : "numeric"} min="0" step={isFractionalUnit(item.unit) ? "0.001" : "1"} defaultValue={item.countedQty ?? 0}
                      onBlur={(e) => { const v = parseQuantityInput(e.target.value, item.unit, true); if (v !== null && v !== item.countedQty) updateCounted(item.id, v); }}
                      className="h-8 w-24 rounded-md border bg-background px-2 text-right text-xs"
                    />
                  ) : (
                    <>
                      {unscanned && <span className="mr-1 text-xs text-muted-foreground">(будет обнулен)</span>}
                      {item.countedQty ?? 0}
                    </>
                  )}
                </td>
                {!hideStockCols && <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{item.expectedQty}</td>}
                {!hideStockCols && (
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {unscanned && diff !== 0 && <AlertCircle className="h-3.5 w-3.5" />}
                      {diff > 0 ? "+" : ""}{diff}
                    </span>
                  </td>
                )}
                <td className="px-3 py-2 text-muted-foreground">{unitLabel(item.unit)}</td>
                {!hideAmountCols && canSeeCost && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.cost != null ? (
                      <>
                        <span className="block">{formatCurrency(diff * item.cost)}</span>
                        <span className="block text-xs text-muted-foreground">за ед {formatCurrency(item.cost)}</span>
                      </>
                    ) : "—"}
                  </td>
                )}
                {!hideAmountCols && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="block">{formatCurrency(diff * item.price)}</span>
                    <span className="block text-xs text-muted-foreground">за ед {formatCurrency(item.price)}</span>
                  </td>
                )}
                {editable && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => deleteItem(item.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Удалить">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">Товаров пока нет</td></tr>
            )}
          </tbody>
        </table>

        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-t p-3">
            <span className="text-xs font-medium text-muted-foreground">Добавление товара</span>
            <input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Поиск по названию" className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
            <input value={newProductBarcode} onChange={(e) => setNewProductBarcode(e.target.value)} placeholder="Штрихкод" className="h-9 w-40 rounded-md border bg-background px-2 text-sm" />
            <button onClick={() => setAddModalOpen(true)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
              Добавить из номенклатуры
            </button>
            <button onClick={createProduct} disabled={busy || !newProductName.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40">
              <Plus className="h-4 w-4" /> Создать товар
            </button>
            <button onClick={() => setImportOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10">
              <Upload className="h-4 w-4" /> Импорт товаров
            </button>
          </div>
        )}

        <div className="flex justify-between border-t px-4 py-2.5 text-sm font-semibold">
          <span>Итого</span>
          <span className="flex gap-8">
            {!hideAmountCols && canSeeCost && <span>{formatCurrency(totalCost)}</span>}
            {!hideAmountCols && <span>{formatCurrency(totalSale)}</span>}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage(1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronsLeft className="h-4 w-4" /></button>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-2 text-muted-foreground">{firstIndex}-{lastIndex} / {doc.filteredCount}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronsRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>На страницу</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded-md border bg-background px-2 text-sm">
            {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function ProductPicker({ onPick, busy }: { onPick: (p: PickProduct) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(next: string) {
    if (!next.trim()) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/products/search?q=${encodeURIComponent(next)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setQ(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(next), 250);
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q} onChange={handleChange}
        placeholder="Поиск товаров по названию/штрихкоду"
        className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {q.trim() && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md divide-y">
          {loading ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">Поиск…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">Ничего не найдено</p>
          ) : (
            results.slice(0, 20).map((p) => {
              return (
                <button
                  key={p.id} disabled={busy}
                  onClick={() => { onPick(p); setQ(""); setResults([]); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-50"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{`остаток: ${p.stock}`}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
