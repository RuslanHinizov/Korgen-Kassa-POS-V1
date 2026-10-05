"use client";

import { ScanBurst, SCAN_IDLE_MS, isScanTerminator, keyToChar } from "@/lib/scanner-decode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Keyboard, Scale, Search, X, Zap } from "lucide-react";
import { useCartStore } from "@/store/cart";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { getDeviceSettings, playErrorBeep } from "@/hooks/use-device-settings";
import { isFractionalUnit, unitLabel } from "@/lib/units";
import { searchLocal } from "@/lib/offline/catalog";
import { cacheConfig, getCachedConfig } from "@/lib/offline/config-cache";

export interface ProductResult {
  id: string;
  name: string;
  price: number;
  wholesalePrice?: number | null;
  stock: number;
  lowStockThreshold?: number;
  unit?: "pcs" | "kg" | "l" | "m";
  barcode?: string | null;
  sku?: string | null;
  category?: string | null;
  categoryId?: string | null;
  scanQuantity?: number;
}

interface QuickGroup {
  id: string;
  name: string;
  itemCount: number;
}
interface QuickItem {
  id: string;
  groupId: string | null;
  displayName: string | null;
  product: {
    id: string;
    name: string;
    price: number;
    stock: number;
    unit: string;
    barcode: string | null;
    categoryId?: string | null;
  } | null;
}

export function QuickProductsDialog({
  onSelect,
  onClose,
}: {
  onSelect: (p: ProductResult) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pos");
  const [groups, setGroups] = useState<QuickGroup[]>([]);
  const [items, setItems] = useState<QuickItem[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [gRes, iRes] = await Promise.all([
          fetch("/api/quick-product-groups"),
          fetch("/api/quick-products"),
        ]);
        if (!gRes.ok || !iRes.ok) throw new Error("offline");
        const gData = await gRes.json();
        const iData = await iRes.json();
        setGroups(gData.groups ?? []);
        setItems(iData.items ?? []);
        void cacheConfig("quickProductGroups", gData.groups ?? []);
        void cacheConfig("quickProducts", iData.items ?? []);
      } catch {
        // No connection: fall back to whatever this till last downloaded (see src/lib/offline/config-cache.ts).
        const [cachedGroups, cachedItems] = await Promise.all([
          getCachedConfig<QuickGroup[]>("quickProductGroups"),
          getCachedConfig<QuickItem[]>("quickProducts"),
        ]);
        setGroups(cachedGroups ?? []);
        setItems(cachedItems ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(
    () => items.filter((i) => i.product && (activeGroup === "all" || i.groupId === activeGroup)),
    [items, activeGroup]
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
          <div className="text-primary flex items-center gap-2">
            <Zap className="h-5 w-5" />
            <h2 className="font-semibold">{t("quick_products")}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:bg-muted rounded-md p-1"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {groups.length > 0 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b p-3">
            <button
              onClick={() => setActiveGroup("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium",
                activeGroup === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {t("all_groups")}
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setActiveGroup(g.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium",
                  activeGroup === g.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="bg-muted h-20 animate-pulse rounded-xl border" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 text-center text-sm">
              <Zap className="h-6 w-6" />
              <p>{t("quick_products_empty")}</p>
              <p className="text-xs">{t("quick_products_empty_hint")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visible.map((item) => {
                const p = item.product!;
                return (
                  <button
                    key={item.id}
                    disabled={p.stock <= 0}
                    onClick={() =>
                      onSelect({
                        id: p.id,
                        name: item.displayName || p.name,
                        price: p.price,
                        stock: p.stock,
                        unit: (p.unit as ProductResult["unit"]) ?? "pcs",
                        barcode: p.barcode,
                        categoryId: p.categoryId ?? null,
                      })
                    }
                    className={cn(
                      "flex min-h-[5.5rem] flex-col justify-between rounded-xl border p-3 text-left transition-all",
                      p.stock <= 0
                        ? "bg-muted cursor-not-allowed opacity-50"
                        : "bg-card hover:border-primary/40 hover:bg-accent active:scale-[.98]"
                    )}
                  >
                    <p className="line-clamp-2 text-xs leading-tight font-semibold">
                      {item.displayName || p.name}
                    </p>
                    <span className="text-primary text-sm font-bold">
                      {formatCurrency(p.price)}
                      {isFractionalUnit(p.unit) && (
                        <span className="text-[10px] font-medium">
                          {" "}
                          {t("per_unit", { unit: unitLabel(p.unit, true) })}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeightDialog({
  product,
  onAdd,
  onClose,
}: {
  product: ProductResult;
  onAdd: (weight: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pos");
  const maxStock = Math.max(0, Number(product.stock) || 0);
  const [weight, setWeight] = useState(() => String(Math.min(1, maxStock)));
  const value = Number(weight.replace(",", "."));
  const valid = Number.isFinite(value) && value > 0 && value <= maxStock;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card w-full max-w-sm rounded-2xl border p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-primary mb-1 flex items-center gap-2">
              <Scale className="h-5 w-5" />
              <h2 className="font-semibold">{t("weight_title")}</h2>
            </div>
            <p className="text-muted-foreground text-sm">{product.name}</p>
            <p className="mt-1 text-sm font-medium">
              {formatCurrency(product.price)}{" "}
              {t("per_unit", { unit: unitLabel(product.unit, true) })}
            </p>
            <p className="mt-1 text-xs font-semibold text-emerald-800">
              Остаток: {maxStock} {unitLabel(product.unit, true)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:bg-muted rounded-md p-1"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="weight-input">
          {t("weight_label", { unit: unitLabel(product.unit, true) })}
        </label>
        <input
          id="weight-input"
          autoFocus
          inputMode="decimal"
          value={weight}
          max={maxStock}
          onChange={(e) => setWeight(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) onAdd(value);
          }}
          className="bg-background focus:ring-primary h-12 w-full rounded-lg border px-3 text-center text-xl font-bold outline-none focus:ring-2"
        />
        <div className="my-3 grid grid-cols-4 gap-2">
          {[0.25, 0.5, 1, 2].map((n) => (
            <button
              key={n}
            disabled={n > maxStock}
            onClick={() => setWeight(String(n))}
            className="hover:bg-accent rounded-md border py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {n} {unitLabel(product.unit, true)}
            </button>
          ))}
        </div>
        <button
          disabled={!valid}
          onClick={() => onAdd(value)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 w-full rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("weight_add")}
        </button>
      </div>
    </div>
  );
}

/** Built into the POS so a cash monitor never depends on Windows' keyboard. */
export function TouchSearchKeyboard({
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<"RU" | "EN">("RU");
  const rows = language === "RU"
    ? ["1234567890", "йцукенгшщзх", "фывапролджэ", "ячсмитьбю"]
    : ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] border-t bg-white p-3 shadow-[0_-12px_30px_rgba(0,0,0,0.18)]">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
        <span>Экранная клавиатура</span>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="Закрыть клавиатуру"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row} className="flex justify-center gap-1.5">
            {[...row].map((key) => (
              <button key={key} type="button" onClick={() => onChange(value + key)} className="h-11 min-w-10 flex-1 rounded-lg border bg-slate-50 text-base font-medium active:bg-emerald-100">{key}</button>
            ))}
          </div>
        ))}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setLanguage((current) => current === "RU" ? "EN" : "RU")} className="h-11 rounded-lg border bg-slate-100 px-4 font-semibold">{language}</button>
          <button type="button" onClick={() => onChange(value.slice(0, -1))} className="h-11 rounded-lg border bg-slate-100 px-4 font-semibold">⌫</button>
          <button type="button" onClick={() => onChange("")} className="h-11 rounded-lg border bg-slate-100 px-4 text-sm font-semibold">Очистить</button>
          <button type="button" onClick={onSubmit} className="h-11 flex-1 rounded-lg bg-[#15503A] px-5 font-semibold text-white">Найти</button>
        </div>
      </div>
    </div>
  );
}

/** Kiosk-mode search bar: a single input with a dropdown of results underneath,
 * matching UMAG's kassa search field (no persistent category-browsing panel —
 * barcode-less browsing lives in БЫСТРЫЕ ТОВАРЫ instead, see QuickProductsDialog). */
export function KioskSearchBar() {
  const t = useTranslations("pos");
  const addItem = useCartStore((s) => s.addItem);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [weightedProduct, setWeightedProduct] = useState<ProductResult | null>(null);
  const [touchKeyboardOpen, setTouchKeyboardOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeypressRef = useRef(0);
  const priorEmptyQuery = useRef("");
  const queryRef = useRef("");

  const search = useCallback(async (q: string): Promise<ProductResult[]> => {
    if (!q.trim()) {
      setResults([]);
      return [];
    }
    setLoading(true);
    try {
      // Server first; with no connection (or a server that does not answer) the till searches its own copy.
      let found: ProductResult[];
      if (typeof navigator === "undefined" || navigator.onLine) {
        try {
          const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
          found = res.ok ? await res.json() as ProductResult[] : (await searchLocal(q)) as unknown as ProductResult[];
        } catch {
          found = (await searchLocal(q)) as unknown as ProductResult[];
        }
      } else {
        found = (await searchLocal(q)) as unknown as ProductResult[];
      }
      setResults(found);
      const code = q.trim();
      if (
        /^[A-Za-z0-9]{6,20}$/.test(code) &&
        found.length === 0 &&
        queryRef.current.trim() === code &&
        priorEmptyQuery.current !== code
      ) {
        priorEmptyQuery.current = code;
        toast.error(t("product_not_found_named", { query: code }), {
          id: "barcode-not-found",
          duration: 8000,
          action: { label: "Создать товар", onClick: () => window.dispatchEvent(new CustomEvent("pos-create-product", { detail: { barcode: code } })) },
        });
        if (getDeviceSettings().scannerBeepEnabled) playErrorBeep();
      }
      return found;
    } catch {
      setResults([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [t]);

  const searchMode = Boolean(query.trim());

  function addProduct(product: ProductResult, amount = 1) {
    addItem(
      {
        productId: product.id,
        name: product.name,
        price: product.price,
        wholesalePrice: product.wholesalePrice ?? null,
        stock: product.stock,
        lowStockThreshold: product.lowStockThreshold,
        unit: product.unit ?? "pcs",
        categoryId: product.categoryId ?? null,
      },
      amount
    );
    queryRef.current = "";
    setQuery("");
    setResults([]);
    setWeightedProduct(null);
  }
  function selectProduct(product: ProductResult) {
    if (product.scanQuantity) addProduct(product, product.scanQuantity);
    else if (isFractionalUnit(product.unit)) setWeightedProduct(product);
    else addProduct(product);
  }
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    queryRef.current = next;
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const now = Date.now();
    const fast = now - lastKeypressRef.current < 30;
    lastKeypressRef.current = now;
    debounceRef.current = setTimeout(() => search(next), fast ? 50 : 250);
  }

  function setSearchText(next: string) {
    queryRef.current = next;
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(next), 120);
  }

  /** `raw` = what the input really holds right now (a scanner is faster than React state). */
  async function submitSearch(raw?: string) {
    const code = (raw ?? query).trim();
    if (!code) return;
    if (/^[A-Za-z0-9]{6,20}$/.test(code)) window.dispatchEvent(new Event("pos-scanner-read"));
    // A scanner sends the full barcode and Enter before the result list renders.
    const found = await search(code);
    const product = found.find((item) => item.barcode === code) ?? found[0];
    if (product) {
      selectProduct(product);
      setTouchKeyboardOpen(false);
    } else if (/^[A-Za-z0-9]{6,20}$/.test(code)) {
      // an unknown barcode: the toast already told the cashier; empty the box so the next scan does not
      // get glued onto this one («232123349232123349» → "not found" forever)
      queryRef.current = "";
      priorEmptyQuery.current = "";
      setQuery("");
      setResults([]);
    }
  }

  // A scanner types like a very fast keyboard. Its keys are read by the PHYSICAL key (src/lib/scanner-decode.ts), so the
  // Windows layout (Russian letters instead of Latin) or a scanner made for another country does not garble the code, and a
  // scan counts as finished by Enter, numpad Enter, Tab — or by a short silence when the scanner sends no terminator at all.
  const submitRef = useRef(submitSearch);
  useEffect(() => { submitRef.current = submitSearch; });
  const burstRef = useRef(new ScanBurst());
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishScan = useCallback((): string | null => {
    const text = burstRef.current.text();
    burstRef.current.clear();
    if (burstTimer.current) clearTimeout(burstTimer.current);
    return text;
  }, []);
  const noteScanKey = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = keyToChar(e);
    if (c === null) return;
    burstRef.current.push(c);
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => {
      const text = finishScan();
      if (!text) return;
      queryRef.current = text;
      setQuery(text);
      void submitRef.current(text);
    }, SCAN_IDLE_MS);
  }, [finishScan]);
  useEffect(() => {
    // no field has the focus (the cashier tapped a button…): the keystrokes would vanish, so they are taken from here
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return; // payment / other windows own the keyboard
      if (isScanTerminator(e)) {
        const scanned = finishScan();
        if (scanned) { e.preventDefault(); void submitRef.current(scanned); }
        return;
      }
      noteScanKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishScan, noteScanKey]);

  return (
    <div className="relative w-full shrink-0 sm:w-[28rem]">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          id="pos-search-input"
          value={query}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (isScanTerminator(e.nativeEvent)) {
              // a scan ends here: use the code read from the physical keys (right whatever the layout), else what was typed
              const scanned = finishScan();
              if (scanned || e.key === "Enter" || e.code === "NumpadEnter") {
                e.preventDefault();
                void submitSearch(scanned ?? e.currentTarget.value);
              }
              return;
            }
            noteScanKey(e.nativeEvent);
            if (e.key === "Escape") {
              queryRef.current = "";
              setQuery("");
              setResults([]);
            }
          }}
          placeholder="Поиск"
          className="border-input bg-background focus:ring-primary flex h-11 w-full rounded-md border py-2 pr-10 pl-9 text-sm outline-none focus:ring-2"
          autoFocus
          onPointerDown={() => setTouchKeyboardOpen(true)}
        />
        <button type="button" onClick={() => setTouchKeyboardOpen(true)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-700 hover:bg-slate-100" aria-label="Экранная клавиатура"><Keyboard className="h-4 w-4" /></button>
      </div>

      {touchKeyboardOpen && <TouchSearchKeyboard value={query} onChange={setSearchText} onSubmit={() => void submitSearch()} onClose={() => setTouchKeyboardOpen(false)} />}

      {searchMode && (
        <div className="bg-popover absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border shadow-lg">
          {loading ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">{t("searching")}</p>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">{t("no_products_found")}</p>
          ) : (
            <div className="divide-y">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProduct(p)}
                  className="hover:bg-accent flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {isFractionalUnit(p.unit)
                        ? `${formatCurrency(p.price)} ${t("per_unit", { unit: unitLabel(p.unit, true) })}`
                        : p.sku
                          ? `${t("sku")}: ${p.sku}`
                          : (p.category ?? "")}
                    </p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("stock")}: {p.stock}
                    {isFractionalUnit(p.unit) ? ` ${unitLabel(p.unit, true)}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {weightedProduct && (
        <WeightDialog
          product={weightedProduct}
          onAdd={(weight) => addProduct(weightedProduct, weight)}
          onClose={() => setWeightedProduct(null)}
        />
      )}
    </div>
  );
}
