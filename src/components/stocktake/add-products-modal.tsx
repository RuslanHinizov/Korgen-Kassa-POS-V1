"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

interface Row { inStocktake?: boolean; id: string; name: string; barcode: string | null; stock: number; categoryName: string | null; supplierName: string | null; unit: string; cost: number; price: number }
interface CategoryOption { id: string; name: string }
interface SupplierOption { id: string; name: string }

/** UMAG's real "Добавление товаров" — a filterable, paginated, checkbox-select
 * product picker (По поставщикам / Категория / Тип товара / Остаток), not just a
 * search box. Adds every checked product to the stocktake in one call. */
export function AddProductsModal({ stocktakeId, onClose, onAdded }: {
  stocktakeId: string; onClose: () => void; onAdded: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [type, setType] = useState("");
  const [stock, setStock] = useState("nonzero");

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then((d) => setCategories(d.categories ?? [])).catch(() => {});
    fetch("/api/suppliers").then((r) => r.json()).then((d) => setSuppliers(d.suppliers ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize), stocktakeId });
    if (categoryId) sp.set("categoryId", categoryId);
    if (supplierId) sp.set("supplierId", supplierId);
    if (type) sp.set("type", type);
    if (stock) sp.set("stock", stock);
    fetch(`/api/products?${sp}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.products ?? []); setTotal(d.total ?? 0); })
      .finally(() => setLoading(false));
  }, [page, categoryId, supplierId, type, stock, stocktakeId]);

  const pageIds = rows.filter((r) => !r.inStocktake).map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${stocktakeId}/items/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: [...selected] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Не удалось добавить"); return; }
      toast.success(`Добавлено товаров: ${d.added}`);
      onAdded();
      onClose();
    } finally { setAdding(false); }
  }

  async function addAllFound() {
    if (total === 0) return;
    if (!confirm(`Добавить в инвентаризацию все найденные товары (${total})?`)) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/inventory/stocktakes/${stocktakeId}/items/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter: { categoryId: categoryId || undefined, supplierId: supplierId || undefined, type: type || undefined, stock: stock || undefined } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Не удалось добавить"); return; }
      toast.success(`Добавлено товаров: ${d.added}`);
      onAdded();
      onClose();
    } finally { setAdding(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-base font-semibold">Добавление товаров</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b p-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">По поставщикам</label>
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Все</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Категория</label>
            <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Все</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип товара</label>
            <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Все</option>
              <option value="factory">Заводские</option>
              <option value="weight">Весовые</option>
              <option value="internal">Внутренние</option>
              <option value="service">Услуга</option>
              <option value="bundle">Комплект</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Остаток</label>
            <select value={stock} onChange={(e) => { setStock(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Все</option>
              <option value="nonzero">Ненулевой остаток</option>
              <option value="zero">Нулевой остаток</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" checked={allPageSelected} onChange={toggleAll} /></th>
                  <th className="px-3 py-2 text-left">Название</th>
                  <th className="px-3 py-2 text-left">Штрихкод</th>
                  <th className="px-3 py-2 text-left">Поставщик</th>
                  <th className="px-3 py-2 text-right">Цена по накладной</th>
                  <th className="px-3 py-2 text-right">Продажная цена</th>
                  <th className="px-3 py-2 text-left">Категория</th>
                  <th className="px-3 py-2 text-right">Остаток</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const already = Boolean(r.inStocktake);
                  return (
                    <tr key={r.id} className={already ? "opacity-40" : "hover:bg-muted/40"}>
                      <td className="px-3 py-2"><input type="checkbox" disabled={already} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                      <td className="px-3 py-2">{r.name}{already && <span className="ml-2 text-xs text-muted-foreground">уже добавлен</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.barcode ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.supplierName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.price)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.categoryName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.stock} {r.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-30">←</button>
            <span>{page} / {totalPages} ({total})</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-30">→</button>
          </div>
          <button
            onClick={addAllFound}
            disabled={total === 0 || adding}
            className="ml-auto mr-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            Добавить все найденные ({total})
          </button>
          <button
            onClick={addSelected}
            disabled={selected.size === 0 || adding}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {adding && <Loader2 className="h-4 w-4 animate-spin" />} Добавить{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
