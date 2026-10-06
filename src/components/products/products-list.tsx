"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StoreLink as Link } from "@/components/store/store-link";
import { toast } from "sonner";
import { deleteProduct } from "@/app/actions/product-actions";
import { formatCurrency } from "@/lib/utils";
import {
  Plus, Search, SlidersHorizontal, Printer, Upload, Settings2, Pencil, Trash2, X, Check,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUpDown,
} from "lucide-react";
import { useAnchoredPopover, AnchoredPopover } from "@/components/ui/anchored-popover";
import { BarcodeLabelButton } from "./barcode-label-button";
import { MultiLabelModal } from "./multi-label-modal";
import { UNIT_OPTIONS, unitLabel } from "@/lib/units";

interface Row {
  id: string; name: string; barcode: string | null; ntin: string | null; sku: string | null; articleId: string | null;
  additionalCode: string | null; cost: number; price: number; unit: string; scalePlu: string | null;
  markup: number; margin: number; updatedAt: string; supplierName: string | null; active: boolean;
  productType: "REGULAR" | "SERVICE" | "BUNDLE";
}
interface CategoryOption { id: string; name: string; parentId: string | null; productCount: number }
interface SupplierOption { id: string; name: string }

const TYPE_TABS = [
  { key: "all", label: "Все" },
  { key: "factory", label: "Заводские" },
  { key: "weight", label: "Весовые" },
  { key: "internal", label: "Внутренние" },
  { key: "service", label: "Услуги" },
  { key: "bundle", label: "Комплект" },
  { key: "article", label: "Артикул" },
] as const;
type TypeTab = (typeof TYPE_TABS)[number]["key"];

function editHref(p: Row): string {
  if (p.productType === "BUNDLE") return `/products/bundle/${p.id}/edit`;
  if (p.productType === "SERVICE") return `/products/service/${p.id}/edit`;
  return `/products/${p.id}/edit`;
}

const COLUMN_DEFS = [
  { key: "ntin", label: "Код НКТ (NTIN)" },
  { key: "sku", label: "Артикул" },
  { key: "additionalCode", label: "Доп. код" },
  { key: "cost", label: "Закуп. цена" },
  { key: "unit", label: "Ед. изм" },
  { key: "price", label: "Прод. цена" },
  { key: "markup", label: "Наценка" },
  { key: "margin", label: "Маржа" },
  { key: "scalePlu", label: "Номер на весах" },
  { key: "updatedAt", label: "Дата изм." },
  { key: "supplierName", label: "Поставщик" },
] as const;
type ColumnKey = (typeof COLUMN_DEFS)[number]["key"];

const COLUMNS_STORAGE_KEY = "korgen-products-columns";
const SIDEBAR_STORAGE_KEY = "korgen-products-sidebar-open";

function loadColumnPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function ProductsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<"cost" | "price" | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiLabelOpen, setMultiLabelOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryMarkup, setNewCategoryMarkup] = useState("");
  const [newCategoryCashback, setNewCategoryCashback] = useState("");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);

  const [typeTab, setTypeTab] = useState<TypeTab>("all");
  const [supplierId, setSupplierId] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [selectedSupplierName, setSelectedSupplierName] = useState("");
  const [supplierSuggestions, setSupplierSuggestions] = useState<SupplierOption[]>([]);
  const [unitFilter, setUnitFilter] = useState("");
  const [priceField, setPriceField] = useState<"" | "price" | "cost" | "wholesalePrice">("");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [markupSign, setMarkupSign] = useState<"" | "positive" | "negative">("");
  const [markupFrom, setMarkupFrom] = useState("");
  const [markupTo, setMarkupTo] = useState("");
  const [ntinFilter, setNtinFilter] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    type: "all" as TypeTab, supplierId: "", unit: "",
    priceField: "" as "" | "price" | "cost" | "wholesalePrice", priceFrom: "", priceTo: "",
    markupSign: "" as "" | "positive" | "negative", markupFrom: "", markupTo: "",
    ntin: "",
  });

  const action = useAnchoredPopover();
  const columnsPopover = useAnchoredPopover();
  const filter = useAnchoredPopover();

  useEffect(() => {
    setVisible(() => { const stored = loadColumnPrefs(); const merged: Record<string, boolean> = {}; for (const c of COLUMN_DEFS) merged[c.key] = stored[c.key] ?? true; return merged; });
    try { const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY); if (stored !== null) setSidebarOpen(stored === "1"); } catch { /* ignore */ }
  }, []);

  function toggleColumn(key: ColumnKey) {
    setVisible((v) => {
      const next = { ...v, [key]: !v[key] };
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function toggleSidebar() {
    setSidebarOpen((v) => {
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }

  const loadCategories = useCallback(() => {
    fetch("/api/categories").then((r) => r.json()).then((d) => setCategories(d.categories ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  useEffect(() => {
    if (!supplierQuery.trim() || supplierQuery === selectedSupplierName) { setSupplierSuggestions([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/suppliers?q=${encodeURIComponent(supplierQuery.trim())}`).then((r) => r.json()).then((d) => setSupplierSuggestions(d.suppliers ?? [])).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q.trim()) sp.set("q", q.trim());
    if (categoryId) sp.set("categoryId", categoryId);
    if (sortBy) { sp.set("sortBy", sortBy); sp.set("sortOrder", sortOrder); }
    if (appliedFilters.type !== "all") sp.set("type", appliedFilters.type);
    if (appliedFilters.supplierId) sp.set("supplierId", appliedFilters.supplierId);
    if (appliedFilters.unit) sp.set("unit", appliedFilters.unit);
    if (appliedFilters.priceField) sp.set("priceField", appliedFilters.priceField);
    if (appliedFilters.priceFrom) sp.set("priceFrom", appliedFilters.priceFrom);
    if (appliedFilters.priceTo) sp.set("priceTo", appliedFilters.priceTo);
    if (appliedFilters.markupSign) sp.set("markupSign", appliedFilters.markupSign);
    if (appliedFilters.markupFrom) sp.set("markupFrom", appliedFilters.markupFrom);
    if (appliedFilters.markupTo) sp.set("markupTo", appliedFilters.markupTo);
    if (appliedFilters.ntin) sp.set("ntin", appliedFilters.ntin);
    try {
      const r = await fetch(`/api/products?${sp.toString()}`);
      const d = await r.json();
      setRows(d.products ?? []);
      setTotal(d.total ?? 0);
    } finally { setLoading(false); }
  }, [page, pageSize, q, categoryId, sortBy, sortOrder, appliedFilters]);
  useEffect(() => { load(); }, [load]);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { setPage(1); setQ(next); }, 300);
  }

  function toggleSort(col: "cost" | "price") {
    if (sortBy === col) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortOrder("desc"); }
  }

  function toggleSelected(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function createCategory() {
    if (!newCategoryName.trim()) return;
    const markup = newCategoryMarkup.trim() ? Number(newCategoryMarkup) : null;
    const cashback = newCategoryCashback.trim() ? Number(newCategoryCashback) : null;
    const r = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCategoryName.trim(), defaultMarkup: markup, cashbackPercent: cashback }) });
    if (!r.ok) { toast.error((await r.json()).error ?? "Не удалось создать категорию"); return; }
    setNewCategoryName(""); setNewCategoryMarkup(""); setNewCategoryCashback(""); setNewCategoryOpen(false);
    loadCategories();
  }

  async function applyBulkCategory(targetCategoryId: string | null) {
    const r = await fetch("/api/products/bulk", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: [...selected], categoryId: targetCategoryId }) });
    if (!r.ok) { toast.error("Не удалось изменить категорию"); return; }
    setBulkCategoryOpen(false); action.close();
    toast.success("Категория обновлена");
    load(); loadCategories();
  }

  async function deleteSelected() {
    if (!confirm(`Удалить ${selected.size} товар(ов)?`)) return;
    action.close();
    let okCount = 0;
    for (const id of selected) {
      try { await deleteProduct(id); okCount++; } catch { /* skip, report below */ }
    }
    if (okCount < selected.size) toast.error(`Удалено: ${okCount} из ${selected.size}`);
    else toast.success(`Удалено: ${okCount}`);
    load();
  }

  function applyFilters() {
    setAppliedFilters({ type: typeTab, supplierId, unit: unitFilter, priceField, priceFrom, priceTo, markupSign, markupFrom, markupTo, ntin: ntinFilter });
    setPage(1); filter.close();
  }
  function clearFilters() {
    setTypeTab("all"); setSupplierId(""); setSupplierQuery(""); setSelectedSupplierName(""); setUnitFilter("");
    setPriceField(""); setPriceFrom(""); setPriceTo(""); setMarkupSign(""); setMarkupFrom(""); setMarkupTo(""); setNtinFilter("");
    setAppliedFilters({ type: "all", supplierId: "", unit: "", priceField: "", priceFrom: "", priceTo: "", markupSign: "", markupFrom: "", markupTo: "", ntin: "" });
    setPage(1);
  }
  function pickSupplier(s: SupplierOption) {
    setSupplierId(s.id); setSupplierQuery(s.name); setSelectedSupplierName(s.name); setSupplierSuggestions([]);
  }

  const filteredCategories = categories.filter((c) => !c.parentId && c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()));

  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIndex = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCategoryName = categoryId === "uncategorized" ? "Незаданные" : categoryId ? categories.find((c) => c.id === categoryId)?.name : null;

  const categoryListBody = (onSelect?: () => void) => (
    <div className="flex-1 space-y-0.5 overflow-y-auto text-sm">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => { setCategoryId(null); setPage(1); onSelect?.(); }}
          className={`flex-1 rounded-md px-2 py-1.5 text-left ${!categoryId ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          Все категории
        </button>
        <button onClick={() => setNewCategoryOpen(true)} className="rounded-full p-1 text-primary hover:bg-primary/10" aria-label="Добавить категорию"><Plus className="h-4 w-4" /></button>
      </div>
      {filteredCategories.map((c) => (
        <button
          key={c.id}
          onClick={() => { setCategoryId(c.id); setPage(1); onSelect?.(); }}
          className={`block w-full truncate rounded-md px-2 py-1.5 text-left ${categoryId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          {c.name}
        </button>
      ))}
      <button
        onClick={() => { setCategoryId("uncategorized"); setPage(1); onSelect?.(); }}
        className={`block w-full rounded-md px-2 py-1.5 text-left ${categoryId === "uncategorized" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      >
        Незаданные
      </button>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Category rail / panel — desktop only; on mobile it's a drawer opened via the toolbar button below */}
      <div className={`hidden sm:block ${sidebarOpen ? "w-64 shrink-0 border-r bg-card" : "w-8 shrink-0 border-r bg-primary/10"}`}>
        {sidebarOpen ? (
          <div className="flex h-full flex-col p-3">
            <button onClick={toggleSidebar} className="mb-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">Скрыть категории</button>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} placeholder="Поиск" className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm" />
            </div>
            {categoryListBody()}
          </div>
        ) : (
          <button onClick={toggleSidebar} className="flex h-full w-full flex-col items-center justify-start gap-1 pt-4 text-xs font-medium text-primary">
            {"Категории".split("").map((ch, i) => <span key={i}>{ch}</span>)}
          </button>
        )}
      </div>

      {/* Category drawer — mobile only */}
      {mobileCategoryOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileCategoryOpen(false)} />
          <div className="relative z-10 flex h-full w-72 flex-col bg-card p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Категории</span>
              <button onClick={() => setMobileCategoryOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Закрыть"><X className="h-4 w-4" /></button>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} placeholder="Поиск" className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm" />
            </div>
            {categoryListBody(() => setMobileCategoryOpen(false))}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">Список товаров</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setMobileCategoryOpen(true)} className="sm:hidden inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            {activeCategoryName ?? "Все категории"}
          </button>
          <Link href="/products/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Товар
          </Link>
          <Link href="/products/bundle/create" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:bg-accent">
            <Plus className="h-4 w-4" /> Комплект
          </Link>
          <Link href="/products/service/create" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:bg-accent">
            <Plus className="h-4 w-4" /> Услуга
          </Link>
          <Link href="/products/sku/create" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:bg-accent">
            <Plus className="h-4 w-4" /> Артикул
          </Link>
          <button onClick={() => setNewCategoryOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:bg-accent">
            <Plus className="h-4 w-4" /> Категория
          </button>
          <button ref={filter.anchorRef} onClick={filter.toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <SlidersHorizontal className="h-4 w-4" /> Фильтр
          </button>
          <div className="relative min-w-[14rem] flex-1">
            <input onChange={handleSearchChange} placeholder="Поиск по названию товара / штрихкоду" className="h-9 w-full rounded-md border bg-background px-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <button className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground"><Search className="h-3.5 w-3.5" /></button>
          </div>
          <button ref={action.anchorRef} onClick={action.toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <span className="flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-xs">{selected.size}</span> Действие
          </button>
          <button
            onClick={() => {
              if (selected.size === 0) { toast.error("Выберите хотя бы один товар"); return; }
              if (selected.size > 1) { setMultiLabelOpen(true); return; }
              window.dispatchEvent(new CustomEvent("print-single-label", { detail: [...selected][0] }));
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent"
          >
            <Printer className="h-4 w-4" /> Печать
          </button>
          <Link href="/inventory" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" /> Импорт/Экспорт
          </Link>
        </div>

        {action.open && action.pos && (
          <AnchoredPopover pos={action.pos} onClose={action.close} className="w-56 p-1">
            {!bulkCategoryOpen ? (
              <>
                <button
                  onClick={() => { if (selected.size === 0) { toast.error("Выберите хотя бы один товар"); return; } setBulkCategoryOpen(true); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" /> Изменить категорию
                </button>
                <button onClick={() => { if (selected.size === 0) { toast.error("Выберите хотя бы один товар"); return; } deleteSelected(); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" /> Удалить выбранные
                </button>
              </>
            ) : (
              <div className="max-h-64 overflow-y-auto p-1">
                <button onClick={() => applyBulkCategory(null)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent">Без категории</button>
                {categories.filter((c) => !c.parentId).map((c) => (
                  <button key={c.id} onClick={() => applyBulkCategory(c.id)} className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-accent">{c.name}</button>
                ))}
              </div>
            )}
          </AnchoredPopover>
        )}

        {filter.open && filter.pos && (
          <AnchoredPopover pos={filter.pos} onClose={filter.close} className="w-[28rem] space-y-3">
            <div className="flex flex-wrap gap-1 border-b pb-2">
              {TYPE_TABS.map((t) => (
                <button key={t.key} onClick={() => setTypeTab(t.key)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${typeTab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Поставщик</label>
                <input
                  value={supplierQuery}
                  onChange={(e) => { setSupplierQuery(e.target.value); if (!e.target.value.trim()) setSupplierId(""); }}
                  placeholder="Введите название"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
                {supplierSuggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-background shadow-lg">
                    {supplierSuggestions.map((s) => (
                      <button key={s.id} onClick={() => pickSupplier(s)} className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-muted">{s.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Ед. измерения</label>
                <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Все</option>
                  {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Цена</label>
                <select value={priceField} onChange={(e) => setPriceField(e.target.value as typeof priceField)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Выберите тип</option>
                  <option value="price">Продажная</option>
                  <option value="cost">Закупочная</option>
                  <option value="wholesalePrice">Оптовая</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">От</label>
                  <input type="number" min={0} disabled={!priceField} value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">До</label>
                  <input type="number" min={0} disabled={!priceField} value={priceTo} onChange={(e) => setPriceTo(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Наценка</label>
                <select value={markupSign} onChange={(e) => setMarkupSign(e.target.value as typeof markupSign)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Все</option>
                  <option value="positive">Положительная</option>
                  <option value="negative">Отрицательная</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">От</label>
                  <input type="number" disabled={!markupSign} value={markupFrom} onChange={(e) => setMarkupFrom(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">До</label>
                  <input type="number" disabled={!markupSign} value={markupTo} onChange={(e) => setMarkupTo(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Код НКТ (NTIN)</label>
                <select value={ntinFilter} onChange={(e) => setNtinFilter(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Все</option>
                  <option value="set">Есть</option>
                  <option value="unset">Нет</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={clearFilters} className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Очистить</button>
              <button onClick={applyFilters} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Применить</button>
            </div>
          </AnchoredPopover>
        )}

        {(activeCategoryName || appliedFilters.type !== "all") && (
          <div className="flex flex-wrap gap-2">
            {activeCategoryName && (
              <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                {activeCategoryName}
                <button onClick={() => { setCategoryId(null); setPage(1); }} aria-label="Сбросить фильтр"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {appliedFilters.type !== "all" && (
              <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                {TYPE_TABS.find((t) => t.key === appliedFilters.type)?.label}
                <button onClick={clearFilters} aria-label="Сбросить фильтр"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-3 py-2.5"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleSelectAll} className="h-4 w-4 accent-primary" /></th>
                <th className="px-3 py-2.5 text-left">Название товара</th>
                <th className="px-3 py-2.5 text-left">Штрихкод</th>
                {visible.ntin && <th className="px-3 py-2.5 text-left">Код НКТ (NTIN)</th>}
                {visible.sku && <th className="px-3 py-2.5 text-left">Артикул</th>}
                {visible.additionalCode && <th className="px-3 py-2.5 text-left">Доп. код</th>}
                {visible.cost && (
                  <th className="px-3 py-2.5 text-right">
                    <button onClick={() => toggleSort("cost")} className={`inline-flex items-center gap-1 ${sortBy === "cost" ? "text-primary" : ""}`}>Закуп. цена <ArrowUpDown className="h-3 w-3" /></button>
                  </th>
                )}
                {visible.unit && <th className="px-3 py-2.5 text-left">Ед. изм</th>}
                {visible.price && (
                  <th className="px-3 py-2.5 text-right">
                    <button onClick={() => toggleSort("price")} className={`inline-flex items-center gap-1 ${sortBy === "price" ? "text-primary" : ""}`}>Прод. цена <ArrowUpDown className="h-3 w-3" /></button>
                  </th>
                )}
                {visible.markup && <th className="px-3 py-2.5 text-right">Наценка %</th>}
                {visible.margin && <th className="px-3 py-2.5 text-right">Маржа %</th>}
                {visible.scalePlu && <th className="px-3 py-2.5 text-left">Номер на весах</th>}
                {visible.updatedAt && <th className="px-3 py-2.5 text-left">Дата изм.</th>}
                {visible.supplierName && <th className="px-3 py-2.5 text-left">Поставщик</th>}
                <th className="w-24 px-3 py-2.5"></th>
                <th className="w-8 px-3 py-2.5 relative">
                  <button ref={columnsPopover.anchorRef} onClick={columnsPopover.toggle} className="rounded p-1 hover:bg-accent"><Settings2 className="h-4 w-4" /></button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={16} className="px-4 py-8 text-center text-muted-foreground">Загрузка…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={16} className="px-4 py-8 text-center text-muted-foreground">Нет данных</td></tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} className="h-4 w-4 accent-primary" /></td>
                    <td className="px-3 py-2.5 font-medium">
                      <Link href={editHref(p)} className="text-primary hover:underline">{p.name}</Link>
                      {!p.active && <span className="ml-1.5 text-xs text-muted-foreground">(неактивен)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{p.barcode ?? "—"}</td>
                    {visible.ntin && <td className="px-3 py-2.5 text-muted-foreground">{p.ntin ?? "—"}</td>}
                    {visible.sku && (
                      <td className="px-3 py-2.5">
                        {p.articleId ? <Link href={`/products/sku/${p.articleId}/edit`} className="text-primary hover:underline">{p.sku}</Link> : (p.sku ?? "—")}
                      </td>
                    )}
                    {visible.additionalCode && <td className="px-3 py-2.5 text-muted-foreground">{p.additionalCode ?? "—"}</td>}
                    {visible.cost && <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(p.cost)}</td>}
                    {visible.unit && <td className="px-3 py-2.5 text-muted-foreground">{unitLabel(p.unit)}</td>}
                    {visible.price && <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(p.price)}</td>}
                    {visible.markup && <td className="px-3 py-2.5 text-right tabular-nums">{p.markup}</td>}
                    {visible.margin && <td className="px-3 py-2.5 text-right tabular-nums">{p.margin}</td>}
                    {visible.scalePlu && <td className="px-3 py-2.5 text-muted-foreground">{p.scalePlu ?? "Товар не весовой"}</td>}
                    {visible.updatedAt && <td className="px-3 py-2.5 text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString("ru-RU")}</td>}
                    {visible.supplierName && <td className="px-3 py-2.5 text-muted-foreground">{p.supplierName ?? "—"}</td>}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <BarcodeLabelButton productId={p.id} productName={p.name} initialBarcode={p.barcode} price={p.price} unit={p.unit} iconOnly />
                        <Link href={editHref(p)} className="rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label="Изменить"><Pencil className="h-3.5 w-3.5" /></Link>
                        <button
                          onClick={async () => { if (!confirm(`Удалить «${p.name}»?`)) return; await deleteProduct(p.id); load(); }}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {columnsPopover.open && columnsPopover.pos && (
          <AnchoredPopover pos={columnsPopover.pos} onClose={columnsPopover.close} className="w-56 space-y-1 p-3">
            <p className="mb-1 text-xs font-semibold">Видимость столбцов</p>
            <p className="mb-2 text-xs text-muted-foreground">Настройте таблицу под себя и ваш выбор сохранится</p>
            {COLUMN_DEFS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                <input type="checkbox" checked={visible[c.key] ?? true} onChange={() => toggleColumn(c.key)} className="h-3.5 w-3.5 accent-primary" />
                {c.label}
              </label>
            ))}
          </AnchoredPopover>
        )}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronsLeft className="h-4 w-4" /></button>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-2 tabular-nums">{firstIndex}-{lastIndex} / {total}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="rounded p-1.5 hover:bg-accent disabled:opacity-30"><ChevronsRight className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-3">
            <span>Общее количество товаров: {total.toLocaleString("ru-RU")}</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded-md border bg-background px-2 text-sm">
              {[25, 50, 100, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {newCategoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setNewCategoryOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg space-y-4">
            <h3 className="text-lg font-semibold">Создание категории</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Категория *</label>
              <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Название категории" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Наценка %</label>
              <input type="number" min={0} step="0.1" value={newCategoryMarkup} onChange={(e) => setNewCategoryMarkup(e.target.value)} placeholder="0" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Cashback %</label>
              <input type="number" min={0} step="0.1" value={newCategoryCashback} onChange={(e) => setNewCategoryCashback(e.target.value)} placeholder="0" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </div>
            <button onClick={createCategory} disabled={!newCategoryName.trim()} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Check className="h-4 w-4" /> Сохранить
            </button>
          </div>
        </div>
      )}
      {multiLabelOpen && (
        <MultiLabelModal
          products={rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, name: r.name, barcode: r.barcode, price: r.price, unit: r.unit }))}
          onClose={() => setMultiLabelOpen(false)}
        />
      )}
    </div>
  );
}
