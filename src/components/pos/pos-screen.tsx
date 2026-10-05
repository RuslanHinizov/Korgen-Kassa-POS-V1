"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCartStore, roundQty, setOversellGuard } from "@/store/cart";
import { evaluatePromotions, type PromotionRule } from "@/lib/promotions";
import { formatCurrency, cn } from "@/lib/utils";
import { unitLabel } from "@/lib/units";
import { User, X } from "lucide-react";
import { KioskSearchBar, QuickProductsDialog, type ProductResult } from "./product-search";
import { PaymentModal } from "./payment-modal";
import { CustomerCapture, type CustomerSummary } from "./customer-capture";
import { HeldOrdersModal } from "./held-orders-modal";
import { VoidItemModal } from "./void-item-modal";
import { NumberDialog } from "./number-dialog";
import { ProductEditDialog } from "./product-edit-dialog";
import { editProductAtTill } from "@/lib/offline/product-edit";
import { CreateProductModal } from "./create-product-modal";
import { LabelPickerModal, ProductLabelModal, type LabelProduct } from "./product-label";
import { PriceCheckModal } from "./price-check-modal";
import { GlobalSearchModal } from "./global-search-modal";
import { KioskTopBar } from "./kiosk-top-bar";
import { OfflineManager } from "./offline-manager";
import { ShiftScreen } from "./shift-screen";
import { ExtraFunctionsMenu } from "./extra-functions-menu";
import { LockScreen } from "./lock-screen";
import { isTillLocked, setTillLocked } from "@/lib/till-lock";
import { collapseWindow } from "@/lib/till-shell";
import { loadCurrentShift } from "@/lib/offline/shift";
import { getTillAuth, tillAuthValid } from "@/lib/offline/auth";
import { cacheConfig, getCachedConfig } from "@/lib/offline/config-cache";
import { rememberDiscountCard, getCachedDiscountCard } from "@/lib/offline/discount-cards";
import { addLocalHeldOrder } from "@/lib/offline/held-orders";
import { UnsyncedBanner } from "./unsynced-banner";
import { idbGet } from "@/lib/offline/idb";
import { POSSalesPanel } from "./pos-sales-modal";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { ReceiptModal } from "@/components/receipt/receipt-modal";
import { KeyboardShortcutsModal } from "./keyboard-shortcuts-modal";
import { usePosKeyboardShortcuts } from "@/hooks/use-pos-keyboard-shortcuts";
import { useAnchoredPopover, AnchoredPopover } from "@/components/ui/anchored-popover";
import type { ReceiptData, ReceiptSettings } from "@/components/receipt/receipt";
import { canUsePosAction, type PosAccessRole } from "@/lib/pos-permissions";
import { toast } from "sonner";

const DEFAULT_TAX_RATE = 0; // overridden via business settings

const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  name: "My Shop",
  logoUrl: null,
  currency: "$",
  currencyDecimals: 2,
  taxName: "Tax",
  receiptFooter: "Thank you for your business!",
};

type KioskPermissions = {
  posUniversalProduct: boolean;
  posCreateProduct: boolean;
  posEditProductAtPos: boolean;
  posHoldOrder: boolean;
  posDiscount: boolean;
  posCashInOut: boolean;
  posCardPayment: boolean;
  posChangePriceAtPos: boolean;
  posBanPriceDecrease: boolean;
  posBlockOversell: boolean;
  wholesaleAtPos: boolean;
  posPriceCheck: boolean;
  posGlobalSearch: boolean;
  posCollapseWindow: boolean;
  posInstantSync: boolean;
  posAccessReturn: PosAccessRole;
  posAccessReturnNoReceipt: PosAccessRole;
  posAccessDeleteItem: PosAccessRole;
  posAccessDecreaseQty: PosAccessRole;
};

const DEFAULT_KIOSK_PERMISSIONS: KioskPermissions = {
  posUniversalProduct: true, posCreateProduct: true, posEditProductAtPos: true, posHoldOrder: true,
  posDiscount: true, posCashInOut: true, posCardPayment: true, posChangePriceAtPos: true, posBanPriceDecrease: false, posBlockOversell: false,
  wholesaleAtPos: false, posPriceCheck: false, posGlobalSearch: false, posCollapseWindow: true, posInstantSync: true,
  posAccessReturn: "ALL", posAccessReturnNoReceipt: "ALL", posAccessDeleteItem: "ALL", posAccessDecreaseQty: "ALL",
};

export function POSScreen({ cashierName: serverCashierName, cashierRole: serverCashierRole, cashierId, storeId }: { cashierName: string; cashierRole: string; cashierId: string; storeId: string }) {
  // Signed in without a connection (see src/lib/offline/auth.ts): the page may have come from the cache and still carry
  // the previous cashier's name, so the till's own record of who is working wins.
  const [tillWho, setTillWho] = useState<{ name: string; role: string } | null>(null);
  useEffect(() => {
    getTillAuth().then((a) => { if (a && a.mode === "offline" && tillAuthValid(a)) setTillWho({ name: a.name, role: a.role }); }).catch(() => {});
  }, []);
  const cashierName = tillWho?.name ?? serverCashierName;
  // the register this till program was activated for (from its market package), for the receipt
  const [tillCashboxName, setTillCashboxName] = useState<string | null>(null);
  useEffect(() => {
    void idbGet<{ name: string }>("meta", "tillCashbox").then((c) => setTillCashboxName(c?.name ?? null)).catch(() => {});
  }, []);
  const cashierRole = tillWho?.role ?? serverCashierRole;
  const t = useTranslations("pos");
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE);
  const [showHeldOrders, setShowHeldOrders] = useState(false);
  const [holdLoading, setHoldLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [closeCartPrompt, setCloseCartPrompt] = useState(false);
  const [voidTargetIds, setVoidTargetIds] = useState<string[] | null>(null);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [discountText, setDiscountText] = useState("");
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  // the last sale's amounts stay in the totals card (ИТОГО/ПОЛУЧЕНО/СДАЧА) until the next sale is started
  const [lastSale, setLastSale] = useState<{ total: number; received: number; change: number } | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [consultants, setConsultants] = useState<{ id: string; name: string; photoUrl: string | null }[]>([]);
  const [consultantId, setConsultantId] = useState("");

  useEffect(() => {
    fetch("/api/consultants?activeOnly=1")
      .then((r) => (r.ok ? r.json() : { consultants: [] }))
      .then((d) => setConsultants(d.consultants ?? []))
      .catch(() => {});
  }, []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [requireShift, setRequireShift] = useState(false);
  const [creditSaleEnabled, setCreditSaleEnabled] = useState(true);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [permissions, setPermissions] = useState<KioskPermissions>(DEFAULT_KIOSK_PERMISSIONS);
  // «Запретить продажу больше остатка»: the cart refuses a quantity above the stock and says what is left
  useEffect(() => {
    setOversellGuard(permissions.posBlockOversell, (stock, unit) => toast.error(stock > 0 ? `Недостаточно на складе: осталось ${stock} ${unitLabel(unit, true)}` : "Товара нет на складе"));
    return () => setOversellGuard(false, () => {});
  }, [permissions.posBlockOversell]);
  const [hasOpenShift, setHasOpenShift] = useState(true);
  const [shiftRefreshKey, setShiftRefreshKey] = useState(0);
  const [settingsTick, setSettingsTick] = useState(0);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [extraFunctionsOpen, setExtraFunctionsOpen] = useState(false);
  // Lazy-initialized from localStorage so a reload/re-navigation shows the lock immediately instead of
  // flashing the sale screen first (see src/lib/till-lock.ts — found live 2026-09-28: it didn't persist).
  const [tillLockedState, setTillLockedState] = useState(isTillLocked);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS);

  // Load the configured business tax rate (stored as a decimal, e.g. 0.12) and receipt branding.
  const applySettings = useCallback((d: Record<string, unknown>) => {
    const rate = Number(d?.taxRate);
    if (!Number.isNaN(rate)) setTaxRate(rate);
    setRequireShift(Boolean(d?.requireOpenShift));
    setCreditSaleEnabled(d?.posCreditSale !== false);
    setShowSalesHistory(Boolean(d?.posShowSalesHistory));
    setPermissions({
      posUniversalProduct: d?.posUniversalProduct !== false,
      posCreateProduct: d?.posCreateProduct !== false,
      posEditProductAtPos: d?.posEditProductAtPos !== false,
      posHoldOrder: d?.posHoldOrder !== false,
      posDiscount: d?.posDiscount !== false,
      posCashInOut: d?.posCashInOut !== false,
      posCardPayment: d?.posCardPayment !== false,
      posChangePriceAtPos: d?.posChangePriceAtPos !== false,
      posBanPriceDecrease: d?.posBanPriceDecrease === true,
      posBlockOversell: d?.posBlockOversell === true,
      wholesaleAtPos: d?.posWholesaleAtPos === true && d?.allowWholesale === true,
      posPriceCheck: d?.posPriceCheck === true,
      posGlobalSearch: d?.posGlobalSearch === true,
      posCollapseWindow: d?.posCollapseWindow !== false,
      posInstantSync: d?.posInstantSync !== false,
      posAccessReturn: (d?.posAccessReturn as PosAccessRole) ?? "ALL",
      posAccessReturnNoReceipt: (d?.posAccessReturnNoReceipt as PosAccessRole) ?? "ALL",
      posAccessDeleteItem: (d?.posAccessDeleteItem as PosAccessRole) ?? "ALL",
      posAccessDecreaseQty: (d?.posAccessDecreaseQty as PosAccessRole) ?? "ALL",
    });
    setRounding((d?.posRoundingWeightItems as string) ?? "NONE", (d?.posRoundingDiscount as string) ?? "NONE");
    setReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, ...d });
    // setRounding comes from useCartStore, declared further down in this component — adding it to the
    // deps array below would be a TDZ reference, not a real missing dep (the Zustand action is stable
    // across renders anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      // An error answer (server down behind the till program, session gone, ...) is NOT settings: never apply it, and above
      // all never write it over the copy this till has saved.
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        applySettings(d);
        void cacheConfig("settings", d);
      })
      // No connection: keep working with the last settings/permissions this till downloaded, not with
      // hard-coded defaults — those default permissions to "ALL", which would be a silent, wrong loosening
      // of whatever the market actually configured (e.g. "returns: managers only").
      .catch(() => {
        void getCachedConfig<Record<string, unknown>>("settings").then((cached) => {
          if (cached) applySettings(cached);
        });
      });
  }, [settingsTick, applySettings]);

  // "Мгновенная синхронизация": re-read settings/permissions periodically and when the tab regains focus.
  useEffect(() => {
    if (!permissions.posInstantSync) return;
    const bump = () => setSettingsTick((n) => n + 1);
    const id = setInterval(bump, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [permissions.posInstantSync]);

  // Track whether the cashier has an open shift.
  useEffect(() => {
    // the server, or this till's own record of its shift when there is no connection
    loadCurrentShift()
      .then((r) => setHasOpenShift(Boolean(r.shift)))
      .catch(() => {});
  }, [shiftRefreshKey]);

  const focusSearch = useCallback(() => {
    const el = document.getElementById("pos-search-input") as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, []);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [salesPanel, setSalesPanel] = useState<"returns" | "history" | "shift" | null>(null);

  usePosKeyboardShortcuts({
    onFocusSearch: focusSearch,
    onOpenPayment: () => setPaymentOpen(true),
    onHoldOrders: () => setShowHeldOrders(true),
    onShowHelp: () => setShowShortcuts((v) => !v),
    onEscape: () => {
      setShowShortcuts(false);
      setShowHeldOrders(false);
      setPaymentOpen(false);
      setCustomOpen(false);
      setEditOpen(false);
      setQuickOpen(false);
    },
  });

  const {
    items,
    removeItems,
    updateQuantity,
    updateLineDiscount,
    updateItemPrice,
    applyProductEdit,
    updateItemDetails,
    lineGrossOf,
    setRounding,
    addItem,
    addCustomItem,
    subtotal,
    discountValue,
    taxAmount,
    total,
    clearCart,
    setAutoDiscounts,
    discountCardPercent,
    setDiscountCard,
  } = useCartStore();

  // Electron asks the till screen before closing so a scanned, unpaid order cannot vanish silently.
  useEffect(() => {
    const shell = (window as unknown as { korgenShell?: {
      onCloseRequested?: (handler: () => void) => () => void;
      deferClose?: () => void;
      confirmClose?: () => void;
    } }).korgenShell;
    if (!shell?.onCloseRequested) return;
    return shell.onCloseRequested(() => {
      if (useCartStore.getState().items.length === 0) shell.confirmClose?.();
      else {
        shell.deferClose?.();
        setCloseCartPrompt(true);
      }
    });
  }, []);

  function respondToCloseWithCart(action: "sell" | "delete" | "stay") {
    const shell = (window as unknown as { korgenShell?: {
      cancelClose?: () => void;
      confirmClose?: () => void;
    } }).korgenShell;
    setCloseCartPrompt(false);
    if (action === "stay") {
      shell?.cancelClose?.();
      return;
    }
    if (action === "sell") {
      shell?.cancelClose?.();
      setPaymentOpen(true);
      return;
    }
    clearCart();
    setCustomer(null);
    setConsultantId("");
    setSelected(new Set());
    setActiveItemId(null);
    shell?.confirmClose?.();
  }

  // Load active promotions once
  const [promos, setPromos] = useState<PromotionRule[]>([]);
  useEffect(() => {
    fetch("/api/promotions/active")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        const promotions: PromotionRule[] = d.promotions ?? [];
        setPromos(promotions);
        void cacheConfig("promotions", promotions);
      })
      // No connection: use the last copy this till downloaded instead of silently running with none.
      .catch(() => {
        void getCachedConfig<PromotionRule[]>("promotions").then((cached) => {
          if (cached) setPromos(cached);
        });
      });
  }, []);

  // Re-evaluate promotions whenever the cart / card changes
  const cartSig = items.map((i) => `${i.productId}:${i.quantity}`).join("|");
  useEffect(() => {
    if (items.length === 0) {
      setAutoDiscounts([], 0);
      return;
    }
    const lines = items.map((i) => ({
      productId: i.productId ?? "",
      categoryId: i.categoryId ?? null,
      price: i.price,
      quantity: i.quantity,
    }));
    const { discounts, totalDiscount } = evaluatePromotions(lines, promos, { discountCardPercent });
    setAutoDiscounts(discounts, totalDiscount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSig, promos, discountCardPercent]);

  const [cardInput, setCardInput] = useState("");
  const [cardMsg, setCardMsg] = useState("");
  async function applyCard() {
    const code = cardInput.trim();
    if (!code) {
      setDiscountCard("", 0);
      setCardMsg("");
      return;
    }
    try {
      const r = await fetch(`/api/discount-cards?code=${encodeURIComponent(code)}`);
      if (!r.ok) throw new Error("discount-card-unavailable");
      const { card } = await r.json();
      setDiscountCard(card.code, card.percent);
      setCardMsg(`${card.holderName ? card.holderName + " · " : ""}−${card.percent}%`);
      void rememberDiscountCard({ code: card.code, holderName: card.holderName ?? null, percent: card.percent });
    } catch {
      // No connection: fall back to a card this till has already looked up successfully before.
      const cached = await getCachedDiscountCard(code);
      if (cached) {
        setDiscountCard(cached.code, cached.percent);
        setCardMsg(`${cached.holderName ? cached.holderName + " · " : ""}−${cached.percent}%`);
      } else {
        setCardMsg(t("card_not_found"));
      }
    }
  }

  const sub = subtotal();
  const disc = discountValue();
  const tax = taxAmount(taxRate);
  const tot = total(taxRate);

  // Selection / active row
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const activeItem = items.find((i) => i.id === activeItemId) ?? null;
  const activeRole = cashierRole;
  const canReturn = canUsePosAction(permissions.posAccessReturn, activeRole);
  const canReturnWithoutReceipt = canUsePosAction(permissions.posAccessReturnNoReceipt, activeRole);
  const canDeleteItem = canUsePosAction(permissions.posAccessDeleteItem, activeRole);
  const canDecreaseQty = canUsePosAction(permissions.posAccessDecreaseQty, activeRole);

  const [customOpen, setCustomOpen] = useState(false);
  const [createProduct, setCreateProduct] = useState<{ barcode: string } | null>(null);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [newLabel, setNewLabel] = useState<LabelProduct | null>(null);

  // The search bar offers "Создать товар" when a scanned barcode is unknown.
  useEffect(() => {
    const open = (e: Event) => {
      if (!permissions.posCreateProduct) { toast.error("Создание товаров на кассе отключено администратором"); return; }
      setCreateProduct({ barcode: String((e as CustomEvent<{ barcode?: string }>).detail?.barcode ?? "") });
    };
    window.addEventListener("pos-create-product", open);
    return () => window.removeEventListener("pos-create-product", open);
  }, [permissions.posCreateProduct]);
  const [editOpen, setEditOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const extra = useAnchoredPopover();

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))
    );
  }
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setActiveItemId(id);
  }
  // A tap anywhere on a line selects that line (and only it); the tick boxes are for choosing two or more lines.
  function selectRow(id: string) {
    setActiveItemId(id);
    setSelected((prev) => (prev.size === 1 && prev.has(id) ? prev : new Set([id])));
  }

  // UMAG's «СКИДКА» box in the table header: a percent for the ticked lines (or the active line when none is ticked).
  function applyDiscountPercent() {
    if (!permissions.posDiscount) return;
    // an empty field means "nothing typed" (e.g. the field lost focus after Enter): it must not wipe the discount just set
    if (discountText.trim() === "") return;
    const pct = Math.min(100, Math.max(0, Number(discountText.replace(",", "."))));
    if (!Number.isFinite(pct)) return;
    const ids = selected.size > 0 ? [...selected] : activeItemId ? [activeItemId] : [];
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (item) updateLineDiscount(id, Math.round(lineGrossOf(item) * pct) / 100);
    }
    setDiscountText("");
  }

  async function holdCurrentOrder() {
    if (!permissions.posHoldOrder || holdLoading) return;
    if (items.length === 0) {
      setShowHeldOrders(true);
      return;
    }
    const state = useCartStore.getState();
    setHoldLoading(true);
    const cartSnapshot = {
      items: state.items,
      paymentMethod: state.paymentMethod,
      amountTendered: state.amountTendered,
      discountAmount: state.discountAmount,
      discountType: state.discountType,
    };
    const label = `Отложено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    try {
      const response = await fetch("/api/held-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartSnapshot, label }),
      });
      if (!response.ok) throw new Error();
      clearCart();
      setSelected(new Set());
      setActiveItemId(null);
      toast.success("Чек отложен");
      setShowHeldOrders(true);
    } catch {
      // No connection: hold it purely on this till, it still shows up in the list below.
      try {
        await addLocalHeldOrder({ serverId: null, label, cartSnapshot });
        clearCart();
        setSelected(new Set());
        setActiveItemId(null);
        toast.success("Чек отложен (офлайн)");
        setShowHeldOrders(true);
      } catch {
        toast.error("Не удалось отложить чек");
      }
    } finally {
      setHoldLoading(false);
    }
  }

  if (!isClient) {
    return (
      <div className="bg-background flex h-full flex-col items-center justify-center space-y-4 rounded-lg border shadow-sm">
        <div className="bg-muted flex h-12 w-12 animate-pulse items-center justify-center rounded-full" />
        <div className="text-muted-foreground animate-pulse text-sm font-medium">
          {t("initializing")}
        </div>
      </div>
    );
  }

  function handleSaleComplete(saleId: string, sale?: unknown) {
    // The server's created-sale record is the source of truth for totals: it applies
    // discounts (e.g. loyalty-point redemption) that this component's own cart-derived
    // sub/disc/tax/tot don't know about, since those are computed only in PaymentPanel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (sale ?? null) as any;
    const saleTotal = s ? Number(s.total) : tot;
    const saleAmountTendered = s
      ? Number(s.amountTendered ?? 0)
      : (useCartStore.getState().amountTendered ?? 0);
    const data: ReceiptData = {
      saleId,
      documentNo: s && s.documentNo != null ? Number(s.documentNo) : undefined,
      receiptNo: s?.receiptNo ? String(s.receiptNo) : undefined,
      customerName: customer?.name || undefined,
      items: items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        total: lineGrossOf(i) - i.lineDiscount,
        unit: i.unit,
        notes: i.notes || undefined,
      })),
      subtotal: s ? Number(s.subtotal) : sub,
      discountAmount: s ? Number(s.discountAmount) : disc,
      taxAmount: s ? Number(s.taxAmount) : tax,
      tipAmount: s
        ? Number(s.tipAmount) > 0
          ? Number(s.tipAmount)
          : undefined
        : useCartStore.getState().tipAmount > 0
          ? useCartStore.getState().tipAmount
          : undefined,
      total: saleTotal,
      paymentMethod: useCartStore.getState().paymentMethod,
      paymentLines:
        useCartStore.getState().paymentLines.length > 0
          ? useCartStore.getState().paymentLines
          : undefined,
      amountTendered: saleAmountTendered,
      changeDue: Math.max(0, saleAmountTendered - saleTotal),
      createdAt: new Date(),
      cashierName,
      cashboxName: s?.cashboxName ?? tillCashboxName ?? undefined,
    };
    setReceiptData(data);
    setLastSale({ total: data.total, received: data.amountTendered ?? data.total, change: data.changeDue ?? 0 });
    clearCart();
    setCustomer(null);
    setConsultantId("");
    setSelected(new Set());
    setActiveItemId(null);
    setPaymentOpen(false);
  }

  function logCancelledItem(
    item: { productId: string | null; name: string },
    beforeQty: number,
    afterQty: number | null,
    reason?: string,
    action: "DELETE" | "DECREASE" = "DELETE"
  ) {
    if (!item.productId) return;
    fetch("/api/pos/cancelled-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: item.productId,
        productName: item.name,
        beforeQty,
        afterQty,
        reason: reason || undefined,
        action,
      }),
    }).catch(() => {});
  }

  function handleVoidConfirm(reason?: string) {
    if (!voidTargetIds || !canDeleteItem) return;
    for (const id of voidTargetIds) {
      const target = items.find((i) => i.id === id);
      if (target) logCancelledItem(target, target.quantity, null, reason);
    }
    removeItems(voidTargetIds);
    setSelected(new Set());
    if (activeItemId && voidTargetIds.includes(activeItemId)) setActiveItemId(null);
    setVoidTargetIds(null);
  }

  function addProductToCart(product: ProductResult) {
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      unit: product.unit ?? "pcs",
      categoryId: product.categoryId ?? null,
    });
  }

  function adjustActiveQty(delta: number) {
    if (!activeItem) return;
    if (delta < 0 && !canDecreaseQty) return;
    const step = activeItem.unit && activeItem.unit !== "pcs" ? 0.1 : 1;
    const next = activeItem.quantity + delta * step;
    if (next <= 0) {
      if (!canDeleteItem) return;
      logCancelledItem(activeItem, activeItem.quantity, null, undefined, "DELETE");
      removeItems([activeItem.id]);
      setActiveItemId(null);
      return;
    }
    if (delta < 0) logCancelledItem(activeItem, activeItem.quantity, next, undefined, "DECREASE");
    updateQuantity(activeItem.id, next);
  }

  const voidTargetLabel = voidTargetIds
    ? voidTargetIds.length === 1
      ? (items.find((i) => i.id === voidTargetIds[0])?.name ?? "")
      : `${voidTargetIds.length} товаров`
    : "";

  return (
    <div className="pos-screen flex h-full min-h-0 flex-col bg-white text-[#172b1d]">
      <KioskTopBar
        cashierName={cashierName}
        showSalesHistory={showSalesHistory}
          canReturn={canReturn || canReturnWithoutReceipt}
        onShowShortcuts={() => setShowShortcuts(true)}
        onShowReturns={() => canReturn && setSalesPanel("returns")}
        onShowSalesHistory={() => setSalesPanel("history")}
        onShowShift={() => setSalesPanel("shift")}
        activeTab={salesPanel ?? "sales"}
        onShowSales={() => setSalesPanel(null)}
        hasOpenShift={hasOpenShift}
      />
      <OfflineManager cashierId={cashierId} cashierName={serverCashierName} cashierRole={serverCashierRole} storeId={storeId} />

      <div className={salesPanel ? "hidden" : "contents"}>

      {/* Search / sale parameters row */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-300 px-3 py-2">
        <KioskSearchBar />
        <UnsyncedBanner />
        <div className="text-muted-foreground ml-auto flex items-center gap-2 text-sm">
          {customer ? (
            <span className="rounded-md border px-2 py-1.5 text-xs">{customer.name}</span>
          ) : null}
          {consultantId ? (
            <span className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
              {consultants.find((c) => c.id === consultantId)?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={consultants.find((c) => c.id === consultantId)!.photoUrl!}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <User className="text-muted-foreground h-4 w-4" />
              )}
              {consultants.find((c) => c.id === consultantId)?.name}
            </span>
          ) : (
            <button
              type="button"
              ref={extra.anchorRef}
              onClick={extra.toggle}
              className="h-9 min-w-52 rounded-md border-2 border-[#15ad68] bg-white px-3 text-xs text-slate-600 hover:bg-emerald-50"
            >
              Не выбран консультант
            </button>
          )}
        </div>
      </div>

      {/* Cart table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-base">
          <thead className="sticky top-0 z-10 bg-[#e4f5f1] text-sm font-semibold tracking-wide text-[#263b38] uppercase [&_th]:border-x [&_th]:border-[#bfe3dc]">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-2 py-2 text-left">№</th>
              <th className="px-3 py-2 text-left">Наименование</th>
              <th className="px-3 py-2 text-right">Цена</th>
              <th className="px-3 py-2 text-right">Количество</th>
              <th className="px-2 py-1 text-right">
                <input
                  value={discountText}
                  onChange={(e) => setDiscountText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyDiscountPercent()}
                  onBlur={applyDiscountPercent}
                  disabled={!permissions.posDiscount}
                  inputMode="decimal"
                  placeholder="Скидка"
                  className="h-7 w-24 rounded border bg-white px-2 text-right text-xs font-normal normal-case disabled:opacity-50"
                />
              </th>
              <th className="px-3 py-2 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-x [&_td]:border-b [&_td]:border-[#c9e6e0]">
            {(
              items.map((item, idx) => (
                <tr
                  key={item.id}
                  onClick={() => selectRow(item.id)}
                  className={cn(
                    "hover:bg-muted/40 cursor-pointer",
                    (activeItemId === item.id || selected.has(item.id)) && "bg-slate-300/70"
                  )}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </td>
                  <td className="text-muted-foreground px-2 py-2">{idx + 1}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium">{item.name}</span>
                    {item.unit && item.unit !== "pcs" && (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 uppercase">{unitLabel(item.unit, true)}</span>
                    )}
                    {item.stock <= 0 ? (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">НЕТ В НАЛИЧИИ</span>
                    ) : item.lowStockThreshold !== undefined && item.stock <= item.lowStockThreshold ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">ОСТАЛОСЬ {item.stock} {unitLabel(item.unit, true)}</span>
                    ) : null}
                    {item.notes && (
                      <span className="text-muted-foreground ml-1.5 text-xs">({item.notes})</span>
                    )}
                    {item.productId === null && (
                      <span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 text-[10px]">
                        своб.
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatCurrency(item.price)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" onClick={() => { selectRow(item.id); setQuantityOpen(true); }}>
                    {roundQty(item.quantity)}
                    {item.unit && item.unit !== "pcs" ? ` ${unitLabel(item.unit, true)}` : ""}
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-right tabular-nums">
                    {`${lineGrossOf(item) > 0 ? ((item.lineDiscount / lineGrossOf(item)) * 100).toFixed(2) : "0.00"} %`}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(lineGrossOf(item) - item.lineDiscount)}
                  </td>
                </tr>
              ))
            )}
            {/* UMAG draws the ruled sheet to the bottom of the table: empty ruled rows fill the free space */}
            {Array.from({ length: Math.max(0, 14 - items.length) }, (_, i) => (
              <tr key={`filler-${i}`} aria-hidden data-pos-filler className="h-[3.1rem]">
                {Array.from({ length: 7 }, (_, c) => <td key={c} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom bar */}
      {requireShift && !hasOpenShift && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t-4 border-amber-500 bg-amber-50 px-5 py-4 text-center text-amber-950">
          <span className="text-2xl">⚠</span>
          <div><p className="text-lg font-bold">Сначала откройте смену</p><p className="text-sm">Откройте вкладку «Смена», затем можно будет принять оплату.</p></div>
        </div>
      )}
      <div data-pos-footer className="flex shrink-0 flex-col gap-3 border-t border-slate-700 bg-[#404040] p-5 sm:flex-row sm:items-stretch">
        <div data-pos-total className="flex min-h-56 shrink-0 flex-col justify-center gap-4 rounded-xl bg-white px-8 py-6 text-[#14231b] shadow-sm sm:w-[26rem]">
          {(() => {
            const showLast = lastSale !== null && items.length === 0;
            return (
              <>
                <Row label="ИТОГО" value={formatCurrency(showLast ? lastSale.total : tot)} bold />
                <Row label="ПОЛУЧЕНО" value={formatCurrency(showLast ? lastSale.received : 0)} />
                <Row label="СДАЧА" value={formatCurrency(showLast ? lastSale.change : 0)} />
              </>
            );
          })()}
          {disc > 0 && <Row label="Скидка" value={`−${formatCurrency(disc)}`} />}
          {tax > 0 && <Row label={t("tax")} value={formatCurrency(tax)} />}
        </div>

        <div className="ml-auto grid w-full max-w-[38rem] grid-cols-4 gap-2 self-end">
          <span />
          <BottomButton label="Быстрые товары" onClick={() => setQuickOpen(true)} />
          <BottomButton label="Количество" onClick={() => setQuantityOpen(true)} disabled={!activeItem} />
          <BottomButton label="+" big onClick={() => adjustActiveQty(1)} disabled={!activeItem} />
          <BottomButton
            label="Изменить товар"
            onClick={() => setEditOpen(true)}
            disabled={!activeItem || !(permissions.posEditProductAtPos || permissions.posChangePriceAtPos)}
          />
          <BottomButton label={holdLoading ? "…" : "Отложка"} onClick={() => void holdCurrentOrder()} disabled={!permissions.posHoldOrder || holdLoading} />
          <BottomButton label="Доп. функции" onClick={() => setExtraFunctionsOpen(true)} />
          <BottomButton label="−" big onClick={() => adjustActiveQty(-1)} disabled={!activeItem || !canDecreaseQty} />
          <BottomButton label="Универсальный продукт" onClick={() => setCustomOpen(true)} disabled={!permissions.posUniversalProduct} />
          <BottomButton
            label="Удалить"
            variant="destructive"
            disabled={selected.size === 0 || !canDeleteItem}
            onClick={() => setVoidTargetIds([...selected])}
          />
          <button
            data-charge-btn
            data-pos-action
            onClick={() => setPaymentOpen(true)}
            disabled={items.length === 0 || (requireShift && !hasOpenShift)}
            className={cn(
              "col-span-2 flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg bg-[#26877c] px-3 py-2 font-bold text-white uppercase hover:bg-[#1e7068] disabled:pointer-events-none disabled:opacity-50",
              requireShift && !hasOpenShift ? "text-base" : "text-2xl"
            )}
          >
            {requireShift && !hasOpenShift ? "Сначала откройте смену" : `Оплата ${items.length > 0 ? formatCurrency(tot) : ""}`}
          </button>
        </div>
      </div>
      </div>

      {(salesPanel === "returns" || salesPanel === "history") && (
        <POSSalesPanel mode={salesPanel} canReturnWithReceipt={canReturn} canReturnWithoutReceipt={canReturnWithoutReceipt} />
      )}
      {salesPanel === "shift" && (
        <ShiftScreen
          onDone={() => { setSalesPanel(null); setShiftRefreshKey((k) => k + 1); }}
          onShiftChange={() => setShiftRefreshKey((k) => k + 1)}
          cashMovementEnabled={permissions.posCashInOut}
        />
      )}

      {extra.open && extra.pos && (
        <AnchoredPopover pos={extra.pos} onClose={extra.close} className="w-72 space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("discount_card")}
            </label>
            <div className="flex items-center gap-2">
              <input
                value={cardInput}
                onChange={(e) => setCardInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyCard();
                }}
                onBlur={applyCard}
                className="bg-background h-9 flex-1 rounded-md border px-2 text-sm"
              />
              {discountCardPercent > 0 && (
                <button
                  onClick={() => {
                    setCardInput("");
                    setDiscountCard("", 0);
                    setCardMsg("");
                  }}
                  className="text-muted-foreground hover:text-destructive rounded p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {cardMsg && <p className="text-muted-foreground mt-1 text-[11px]">{cardMsg}</p>}
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Клиент</label>
            <CustomerCapture value={customer} onChange={setCustomer} />
          </div>
          {consultants.length > 0 && (
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Консультант
              </label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                <button
                  type="button"
                  onClick={() => setConsultantId("")}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    consultantId === "" && "bg-muted"
                  )}
                >
                  <span className="bg-muted text-muted-foreground flex h-6 w-6 items-center justify-center rounded-full">
                    <User className="h-3.5 w-3.5" />
                  </span>
                  Не выбран
                </button>
                {consultants.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setConsultantId(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      consultantId === c.id && "bg-muted"
                    )}
                  >
                    {c.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="bg-muted text-muted-foreground flex h-6 w-6 items-center justify-center rounded-full">
                        <User className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {permissions.posCreateProduct && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <button onClick={() => { extra.close(); setCreateProduct({ barcode: "" }); }} className="rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-muted">+ Создать новый товар</button>
              <button onClick={() => { extra.close(); setLabelPickerOpen(true); }} className="rounded-md px-2 py-2 text-left text-sm hover:bg-muted">Печать этикетки товара</button>
            </div>
          )}
          {permissions.posGlobalSearch && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <button onClick={() => { extra.close(); setGlobalSearchOpen(true); }} className="rounded-md px-2 py-2 text-left text-sm hover:bg-muted">Поиск по глобальной базе</button>
            </div>
          )}
        </AnchoredPopover>
      )}

      {priceCheckOpen && <PriceCheckModal onClose={() => setPriceCheckOpen(false)} showWholesale={permissions.wholesaleAtPos} />}
      {extraFunctionsOpen && (
        <ExtraFunctionsMenu
          onClose={() => setExtraFunctionsOpen(false)}
          onLock={() => { setTillLocked(true); setTillLockedState(true); }}
          canPriceCheck={permissions.posPriceCheck}
          onOpenPriceCheck={() => setPriceCheckOpen(true)}
          canCollapse={permissions.posCollapseWindow}
          onToggleCollapse={collapseWindow}
          onShowReceipt={(data) => setReceiptData({ cashierName, cashboxName: tillCashboxName ?? undefined, ...data })}
        />
      )}
      {/* ЗАБЛОКИРОВАТЬ КАССУ — localStorage-backed (src/lib/till-lock.ts) so a reload or re-navigating to
          /pos can't silently drop the lock; must render above everything else the cashier could touch. */}
      {tillLockedState && (
        <LockScreen onUnlock={() => { setTillLocked(false); setTillLockedState(false); }} />
      )}
      {globalSearchOpen && <GlobalSearchModal onClose={() => setGlobalSearchOpen(false)} canAdd={permissions.posEditProductAtPos} />}

      {/* Held orders modal */}
      <HeldOrdersModal open={showHeldOrders} onClose={() => setShowHeldOrders(false)} />

      {/* Void item(s) modal */}
      <VoidItemModal
        open={!!voidTargetIds}
        itemName={voidTargetLabel}
        onConfirm={handleVoidConfirm}
        onCancel={() => setVoidTargetIds(null)}
      />

      {quickOpen && (
        <QuickProductsDialog
          onSelect={(p) => {
            setQuickOpen(false);
            addProductToCart(p);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {createProduct && (
        <CreateProductModal
          initialBarcode={createProduct.barcode}
          onCreated={(product) => {
            setCreateProduct(null);
            addProductToCart(product);
            // The new item's label is shown right away so it can be printed and stuck on the goods.
            if (product.barcode) setNewLabel({ name: product.name, price: Number(product.price), unit: product.unit ?? "pcs", barcode: product.barcode });
          }}
          onClose={() => setCreateProduct(null)}
        />
      )}

      {labelPickerOpen && <LabelPickerModal onClose={() => setLabelPickerOpen(false)} />}
      {newLabel && <ProductLabelModal product={newLabel} onClose={() => setNewLabel(null)} />}

      {customOpen && (
        <NumberDialog
          title={<>Редактирование универсального продукта.<br />Укажите цену</>}
          initial="0"
          onOk={(price) => {
            if (price <= 0) return;
            addCustomItem({ name: "Универсальный продукт", price, quantity: 1 });
            setCustomOpen(false);
          }}
          onCancel={() => setCustomOpen(false)}
        />
      )}

      {editOpen && activeItem && (
        <ProductEditDialog
          key={activeItem.id}
          name={activeItem.name}
          price={activeItem.price}
          catalogPrice={activeItem.catalogPrice ?? activeItem.price}
          canEditName={permissions.posEditProductAtPos}
          canEditPrice={permissions.posChangePriceAtPos}
          banPriceDecrease={permissions.posBanPriceDecrease}
          wholesalePrice={permissions.wholesaleAtPos && activeItem.wholesalePrice != null ? activeItem.wholesalePrice : null}
          onCancel={() => setEditOpen(false)}
          onSave={async (patch) => {
            const item = activeItem;
            if (!item.productId) {
              updateItemDetails(item.id, patch);
              setEditOpen(false);
              return;
            }
            const catalog = item.catalogPrice ?? item.price;
            const wholesale = item.wholesalePrice ?? null;
            const priceChanged = Math.abs(patch.price - item.price) > 0.0001;
            // choosing the retail or wholesale price is a choice for this line only; any other price is a product edit
            const lineOnly = priceChanged && (Math.abs(patch.price - catalog) < 0.005 || (wholesale != null && Math.abs(patch.price - wholesale) < 0.005));
            const edit: { name?: string; price?: number } = {};
            if (patch.name !== item.name) edit.name = patch.name;
            if (priceChanged && !lineOnly) edit.price = patch.price;
            if (edit.name !== undefined || edit.price !== undefined) {
              const result = await editProductAtTill(item.productId, edit, "Не удалось сохранить товар");
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              applyProductEdit(item.productId, edit);
            }
            if (lineOnly) updateItemPrice(item.id, patch.price);
            setEditOpen(false);
          }}
        />
      )}

      {quantityOpen && activeItem && (
        <NumberDialog
          title="Количество"
          initial={String(activeItem.quantity)}
          allowDecimal={activeItem.unit !== "pcs"}
          onOk={(value) => {
            const val = activeItem.unit === "pcs" ? Math.floor(value) : value;
            // Not limited by stock — same as UMAG (see docs/kasa-offline-plan.md).
            if (val > 0) updateQuantity(activeItem.id, val);
            setQuantityOpen(false);
          }}
          onCancel={() => setQuantityOpen(false)}
        />
      )}

      {paymentOpen && (
        <PaymentModal
          onClose={() => setPaymentOpen(false)}
          onCancel={() => setPaymentOpen(false)}
          taxRate={taxRate}
          checkoutBlocked={requireShift && !hasOpenShift}
          onClear={() => {
            if (items.length > 0) setConfirmClear(true);
          }}
          onSaleComplete={handleSaleComplete}
          onHoldOrders={() => {
            setPaymentOpen(false);
            setShowHeldOrders(true);
          }}
          customerId={customer?.id}
          consultantId={consultantId || undefined}
          creditSaleEnabled={creditSaleEnabled}
          holdEnabled={permissions.posHoldOrder}
          cardPaymentEnabled={permissions.posCardPayment}
        />
      )}

      {/* Receipt modal */}
      {receiptData && (
        <ReceiptModal
          open={true}
          onClose={() => setReceiptData(null)}
          data={receiptData}
          settings={receiptSettings}
          autoPrint
        />
      )}

      {/* Clear cart confirmation */}
      <AlertDialog
        open={confirmClear}
        title={t("clear_cart_title")}
        description={t("clear_cart_desc")}
        confirmLabel={t("clear")}
        cancelLabel={t("keep")}
        variant="destructive"
        onConfirm={() => {
          clearCart();
          setConfirmClear(false);
          setPaymentOpen(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />

      {closeCartPrompt && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" role="presentation">
          <section className="mx-4 w-full max-w-md rounded-lg border bg-background p-6 shadow-xl" role="alertdialog" aria-modal="true" aria-labelledby="close-cart-title">
            <h2 id="close-cart-title" className="text-base font-semibold">В корзине есть товары</h2>
            <p className="mt-2 text-sm text-muted-foreground">Перед закрытием выберите, что сделать с текущей продажей.</p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button className="h-10 rounded-md border px-4 text-sm" onClick={() => respondToCloseWithCart("stay")}>Остаться</button>
              <button className="h-10 rounded-md border border-destructive px-4 text-sm text-destructive" onClick={() => respondToCloseWithCart("delete")}>Удалить и закрыть</button>
              <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={() => respondToCloseWithCart("sell")}>Перейти к оплате</button>
            </div>
          </section>
        </div>
      )}

      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between text-xl", bold && "text-3xl font-bold")}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function BottomButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant,
  big,
  anchorRef,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  big?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "destructive";
  anchorRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      data-pos-action
      ref={anchorRef}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-[4.75rem] flex-col items-center justify-center gap-1 rounded-lg border border-slate-300 bg-[#f2f2f2] px-2 py-2 text-center text-xs leading-tight font-semibold text-[#353535] uppercase shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "destructive"
          ? "border-[#8c4e48] bg-[#8d514c] text-white hover:bg-[#773f3a]"
          : "hover:text-foreground hover:bg-white"
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      <span className={big ? "text-4xl leading-none" : undefined}>{label}</span>
    </button>
  );
}
