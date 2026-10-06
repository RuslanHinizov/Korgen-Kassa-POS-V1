"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen, Pencil, Plus, X } from "lucide-react";
import { useStoreRouter } from "@/components/store/use-store-router";
import { createProduct, deleteProduct, updateProduct } from "@/app/actions/product-actions";
import { editPrice, markupOf, parseMoney, priceFrom, type PriceFields } from "@/lib/product-pricing";
import { UNIT_OPTIONS } from "@/lib/units";
import { cn } from "@/lib/utils";
import { ChangesTab, MovementsTab, SalesDynamicsTab } from "./history-tabs";

export interface EditorProduct {
  id: string; name: string; unit: string; barcode: string; additionalCode: string; ntin: string; lowStockThreshold: number;
  cost: number | null; price: number; wholesalePrice: number | null; categoryId: string | null; supplierId: string | null;
}
export interface EditorCategory { id: string; name: string; parentId: string | null; defaultMarkup: number | null }

const TABS = ["Основное", "Динамика продаж", "История изменения товара", "История движения товара"] as const;
const INPUT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function Row({ label, required, error, children, aside }: { label: ReactNode; required?: boolean; error?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid items-start gap-1 md:grid-cols-[200px_minmax(0,1fr)] md:gap-4">
      <label className="pt-2.5 text-sm text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</label>
      <div>
        <div className="flex items-center gap-3">{children}{aside}</div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function LockButton({ locked, onToggle, label }: { locked: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-label={label} aria-pressed={locked} title={locked ? "Цена зафиксирована" : "Зафиксировать"} className={cn("shrink-0 rounded p-1.5", locked ? "text-blue-600" : "text-blue-500/70 hover:text-blue-600")}>
      {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
    </button>
  );
}

function Adornment({ children }: { children: ReactNode }) {
  return <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{children}</span>;
}

/**
 * «Товар | Редактирование» / «Создание» — the product screen laid out like UMAG's: tabs (Основное, Динамика продаж, История
 * изменения товара, История движения товара), and inside «Основное» two sections: «Основная информация и Цены» and
 * «Категории и быстрые товары».
 */
export function ProductEditor({ product, categories: initialCategories, suppliers, creatorName, canSeeCost }: {
  product?: EditorProduct;
  categories: EditorCategory[];
  suppliers: { id: string; name: string }[];
  creatorName?: string | null;
  canSeeCost: boolean;
}) {
  const router = useStoreRouter();
  const isEdit = Boolean(product);
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined" || !isEdit) return 0;
    const t = Number(new URLSearchParams(window.location.search).get("tab"));
    return t >= 0 && t < TABS.length ? t : 0;
  });
  const [section, setSection] = useState<"main" | "categories">("main");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [categories, setCategories] = useState(initialCategories);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const startCat = product?.categoryId ? catById.get(product.categoryId) : undefined;

  const [name, setName] = useState(product?.name ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "pcs");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [additionalCode, setAdditionalCode] = useState(product?.additionalCode ?? "");
  const [ntin, setNtin] = useState(product?.ntin ?? "");
  const [lowStock, setLowStock] = useState(product ? String(product.lowStockThreshold) : "5");
  const [prices, setPrices] = useState<PriceFields>(() => {
    const cost = product?.cost ?? null;
    const price = product?.price ?? 0;
    const m = cost ? markupOf(cost, price) : null;
    return { cost: num(cost), markup: m === null ? "" : String(m), price: product ? String(price) : "" };
  });
  const [locks, setLocks] = useState({ cost: true, price: false });
  const [wholesale, setWholesale] = useState(product ? num(product.wholesalePrice ?? 0) : "");
  const [topCategoryId, setTopCategoryId] = useState(startCat ? startCat.parentId ?? startCat.id : "");
  const [subCategoryId, setSubCategoryId] = useState(startCat?.parentId ? startCat.id : "");
  const [supplierId, setSupplierId] = useState(product?.supplierId ?? "");
  const [quickOpen, setQuickOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);

  const topCategories = categories.filter((c) => !c.parentId);
  const subCategories = categories.filter((c) => c.parentId === topCategoryId);

  function setPrice(field: keyof PriceFields, value: string) {
    setPrices((p) => editPrice(p, locks, field, value));
  }
  function pickCategory(id: string, isSub: boolean) {
    if (isSub) setSubCategoryId(id);
    else { setTopCategoryId(id); setSubCategoryId(""); }
    // a new product takes the markup of its category (the category's «Наценка по умолчанию»)
    const cat = catById.get(id);
    if (!isEdit && cat?.defaultMarkup != null && parseMoney(prices.price) === null) {
      setPrices((p) => {
        const cost = parseMoney(p.cost);
        return { ...p, markup: String(cat.defaultMarkup), price: cost !== null ? String(priceFrom(cost, Number(cat.defaultMarkup))) : p.price };
      });
    }
  }
  async function generate(target: "barcode" | "additional") {
    const r = await fetch("/api/products/generate-barcode");
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.barcode) { toast.error(d.error ?? "Не удалось создать штрихкод"); return; }
    if (target === "barcode") setBarcode(d.barcode); else setAdditionalCode(d.barcode);
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Укажите название товара";
    if (!isEdit && !barcode.trim()) e.barcode = "Укажите штрихкод";
    if (parseMoney(prices.price) === null) e.price = "Укажите продажную цену";
    if (canSeeCost && prices.cost.trim() !== "" && parseMoney(prices.cost) === null) e.cost = "Некорректная цена";
    if (!/^\d+$/.test(lowStock.trim() || "0")) e.lowStock = "Целое число";
    setErrors(e);
    if (Object.keys(e).length) { setSection("main"); toast.error(Object.values(e)[0]); return; }

    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("unit", unit);
    if (!isEdit || !product!.barcode) fd.set("barcode", barcode.trim());
    fd.set("additionalCode", additionalCode.trim());
    fd.set("ntin", ntin.trim());
    fd.set("lowStockThreshold", lowStock.trim() || "0");
    fd.set("price", String(parseMoney(prices.price)));
    if (canSeeCost) {
      if (prices.cost.trim() !== "") fd.set("cost", String(parseMoney(prices.cost)));
      if (wholesale.trim() !== "") fd.set("wholesalePrice", String(parseMoney(wholesale) ?? 0));
    }
    fd.set("categoryId", subCategoryId || topCategoryId || "");
    fd.set("supplierId", supplierId);

    setBusy(true);
    try {
      const res = isEdit ? await updateProduct(product!.id, fd) : await createProduct(fd);
      const error = res && "error" in res ? res.error : undefined;
      if (error) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fieldErrors ?? {})) fe[k === "lowStockThreshold" ? "lowStock" : k] = (v as string[])[0];
        setErrors(fe);
        toast.error(Object.values(fe)[0] ?? error.formErrors?.[0] ?? "Не удалось сохранить");
        return;
      }
      toast.success("Изменения сохранены");
      setRefreshKey((k) => k + 1);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!product || !confirm("Удалить этот товар?")) return;
    setBusy(true);
    try {
      await deleteProduct(product.id);
      toast.success("Товар удалён");
      router.push("/products");
    } finally { setBusy(false); }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Товар <span className="ml-2 border-l pl-3 text-sm font-normal italic text-muted-foreground">{isEdit ? "Редактирование" : "Создание"}</span></h1>
        {isEdit && creatorName && <span className="text-sm font-medium">Создатель: {creatorName}</span>}
      </div>

      {isEdit && (
        <div className="mb-5 flex gap-1 overflow-x-auto border-b">
          {TABS.map((label, i) => (
            <button
              key={label}
              onClick={() => { setTab(i); window.history.replaceState(null, "", i === 0 ? window.location.pathname : `?tab=${i}`); }}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", tab === i ? "border-primary text-primary" : "border-transparent hover:text-primary")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 0 && (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <button onClick={() => void save()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
            </button>
            {isEdit && <button onClick={() => void remove()} disabled={busy} className="inline-flex h-10 items-center rounded-md border border-destructive px-6 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60">Удалить</button>}
            <button onClick={() => router.push("/products")} className="inline-flex h-10 items-center rounded-md bg-muted px-6 text-sm font-medium text-muted-foreground hover:bg-accent">Закрыть</button>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <nav className="rounded-lg border bg-card p-3">
              <p className="px-3 py-4 text-lg">Редактирование товара</p>
              {([["main", "Основная информация и Цены"], ["categories", "Категории и быстрые товары"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setSection(key)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm", section === key ? "bg-primary/10 font-semibold text-primary" : "hover:bg-accent")}>
                  <span className="w-3 text-muted-foreground">{section === key ? "›" : ""}</span>{label}
                </button>
              ))}
            </nav>

            <div className="max-w-4xl rounded-lg border bg-card p-6 sm:p-8">
              {section === "main" ? (
                <div className="space-y-5">
                  <h2 className="text-sm font-semibold">Основная информация</h2>
                  <Row label="Название товара" required error={errors.name}>
                    <div className="relative w-full">
                      <input value={name} onChange={(e) => setName(e.target.value)} className={cn(INPUT, "pr-9", errors.name && "border-destructive")} />
                      {name && <button type="button" onClick={() => setName("")} aria-label="Очистить" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>}
                    </div>
                  </Row>
                  <Row label="Единица измерения" required>
                    <select value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT}>
                      {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </Row>
                  <Row label="Штрихкод" required error={errors.barcode} aside={!isEdit || !product!.barcode ? <button type="button" onClick={() => void generate("barcode")} className="shrink-0 text-sm font-medium text-blue-600 hover:underline">Сгенерировать</button> : undefined}>
                    <input value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={isEdit && Boolean(product!.barcode)} placeholder="Введите штрихкод" className={cn(INPUT, "max-w-sm", errors.barcode && "border-destructive")} />
                  </Row>
                  <Row label="Дополнительный код" error={errors.additionalCode} aside={<button type="button" onClick={() => void generate("additional")} className="shrink-0 text-sm font-medium text-blue-600 hover:underline">Сгенерировать</button>}>
                    <input value={additionalCode} onChange={(e) => setAdditionalCode(e.target.value)} placeholder="Введите доп. штрихкод" className={cn(INPUT, "max-w-sm")} />
                  </Row>
                  <Row label="Код НКТ (NTIN)">
                    <input value={ntin} onChange={(e) => setNtin(e.target.value)} placeholder="Введите код НКТ" className={INPUT} />
                  </Row>
                  <Row label="Критический остаток" error={errors.lowStock}>
                    <input value={lowStock} onChange={(e) => setLowStock(e.target.value)} inputMode="numeric" placeholder="Введите остаток" className={cn(INPUT, "max-w-sm")} />
                  </Row>
                  <p className="-mt-3 text-xs text-muted-foreground md:ml-[216px]">Покажем уведомление, когда товар начнёт заканчиваться</p>

                  <h2 className="pt-3 text-sm font-semibold">Цены</h2>
                  {canSeeCost && (
                    <Row label="Закупочная цена" error={errors.cost} aside={<LockButton locked={locks.cost} onToggle={() => setLocks((l) => ({ ...l, cost: !l.cost }))} label="Зафиксировать закупочную цену" />}>
                      <div className="relative w-full"><input value={prices.cost} onChange={(e) => setPrice("cost", e.target.value)} inputMode="decimal" className={cn(INPUT, "pr-9")} /><Adornment>₸</Adornment></div>
                    </Row>
                  )}
                  {canSeeCost && (
                    <>
                      <Row label="Наценка" aside={<span className="w-[30px] shrink-0" />}>
                        <div className="relative w-full"><input value={prices.markup} onChange={(e) => setPrice("markup", e.target.value)} inputMode="decimal" className={cn(INPUT, "pr-16")} /><Adornment>% ₸</Adornment></div>
                      </Row>
                      <p className="-mt-3 text-xs text-muted-foreground md:ml-[216px]">Наценка по умолчанию устанавливается от выбранной категории, но Вы можете установить свою фиксируя одну из цен</p>
                    </>
                  )}
                  <Row label="Продажная цена" required error={errors.price} aside={canSeeCost ? <LockButton locked={locks.price} onToggle={() => setLocks((l) => ({ ...l, price: !l.price }))} label="Зафиксировать продажную цену" /> : undefined}>
                    <div className="relative w-full"><input value={prices.price} onChange={(e) => setPrice("price", e.target.value)} inputMode="decimal" className={cn(INPUT, "pr-9", errors.price && "border-destructive")} /><Adornment>₸</Adornment></div>
                  </Row>
                  {canSeeCost && (
                    <Row label="Оптовая цена" aside={<span className="w-[30px] shrink-0" />}>
                      <div className="relative w-full"><input value={wholesale} onChange={(e) => setWholesale(e.target.value)} inputMode="decimal" className={cn(INPUT, "pr-9")} /><Adornment>₸</Adornment></div>
                    </Row>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  <h2 className="text-sm font-semibold">Категории и быстрые товары</h2>
                  <Row label="Категория" aside={<a href="categories" onClick={(e) => { e.preventDefault(); router.push("/products/categories"); }} className="shrink-0 rounded p-1.5 text-blue-600 hover:bg-accent" aria-label="Категории"><Pencil className="h-4 w-4" /></a>}>
                    <select value={topCategoryId} onChange={(e) => pickCategory(e.target.value, false)} className={INPUT}>
                      <option value="">Незаданные</option>
                      {topCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Row>
                  <Row label="Подкатегория" aside={<button type="button" disabled={!topCategoryId} onClick={() => setSubOpen(true)} aria-label="Добавить подкатегорию" className="shrink-0 rounded-full bg-emerald-500 p-1 text-white hover:bg-emerald-600 disabled:opacity-40"><Plus className="h-4 w-4" /></button>}>
                    <select value={subCategoryId} onChange={(e) => pickCategory(e.target.value, true)} disabled={!topCategoryId} className={INPUT}>
                      <option value="">Укажите подкатегорию</option>
                      {subCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Row>
                  <Row label="Поставщик" aside={<a href="suppliers" onClick={(e) => { e.preventDefault(); router.push(supplierId ? `/suppliers/${supplierId}` : "/suppliers"); }} className="shrink-0 rounded p-1.5 text-blue-600 hover:bg-accent" aria-label="Поставщик"><Pencil className="h-4 w-4" /></a>}>
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={INPUT}>
                      <option value="">Не выбран</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Row>
                  <div className="md:ml-[216px]">
                    <button type="button" disabled={!isEdit} onClick={() => setQuickOpen(true)} title={isEdit ? undefined : "Сначала сохраните товар"} className="h-10 rounded-md border border-blue-500 px-5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">Добавить в быстрые товары</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {isEdit && tab === 1 && <SalesDynamicsTab productId={product!.id} />}
      {isEdit && tab === 2 && <ChangesTab productId={product!.id} refreshKey={refreshKey} />}
      {isEdit && tab === 3 && <MovementsTab productId={product!.id} unit={unit} refreshKey={refreshKey} />}

      {quickOpen && product && <QuickProductDialog productId={product.id} onClose={() => setQuickOpen(false)} />}
      {subOpen && topCategoryId && (
        <SubcategoryDialog
          parentId={topCategoryId}
          onClose={() => setSubOpen(false)}
          onCreated={(c) => { setCategories((list) => [...list, c]); setSubCategoryId(c.id); setSubOpen(false); }}
        />
      )}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** «Добавить в быстрые товары»: choose the folder of Быстрые товары the product goes to. */
function QuickProductDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/quick-product-groups").then((r) => r.json()).then((d) => setGroups(d.groups ?? [])).catch(() => setGroups([])); }, []);
  async function add() {
    setBusy(true);
    try {
      const r = await fetch("/api/quick-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, groupId: groupId || null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(typeof d.error === "string" ? d.error : "Не удалось добавить"); return; }
      toast.success("Товар добавлен в быстрые товары");
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <Dialog title="Добавить в быстрые товары" onClose={onClose}>
      {!groups ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
        <>
          <label className="mb-1 block text-sm text-muted-foreground">Папка</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={INPUT}>
            <option value="">Без папки</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button onClick={() => void add()} disabled={busy} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">Добавить</button>
        </>
      )}
    </Dialog>
  );
}

function SubcategoryDialog({ parentId, onClose, onCreated }: { parentId: string; onClose: () => void; onCreated: (c: EditorCategory) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), parentId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(typeof d.error === "string" ? d.error : "Не удалось создать подкатегорию"); return; }
      onCreated({ id: d.category.id, name: d.category.name, parentId, defaultMarkup: d.category.defaultMarkup == null ? null : Number(d.category.defaultMarkup) });
    } finally { setBusy(false); }
  }
  return (
    <Dialog title="Новая подкатегория" onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} placeholder="Название подкатегории" className={INPUT} />
      <button onClick={() => void create()} disabled={busy || !name.trim()} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">Создать</button>
    </Dialog>
  );
}
