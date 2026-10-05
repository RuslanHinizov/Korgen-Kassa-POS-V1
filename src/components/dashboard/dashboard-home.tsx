"use client";

import { useCallback, useEffect, useState } from "react";
import { StoreLink as Link } from "@/components/store/store-link";
import { useLocale, useTranslations } from "next-intl";
import { revenueAxis, type CashboxLiveState } from "@/lib/dashboard-helpers";
import { formatCurrency } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Loader2, RefreshCw, ShoppingCart, Wallet, Landmark } from "lucide-react";
import { useStoreId, useStrippedPathname } from "@/components/store/store-provider";

type Range = "today" | "yesterday" | "week" | "month30" | "month90";
interface Summary {
  revenue: number;
  grossProfit: number;
  avgTransaction: number;
  missingCost?: { products: number; revenue: number };
}
interface RevenueDay {
  date: string;
  revenue: number;
  transactions: number;
}
interface Receipt {
  id: string;
  supplierName: string;
  total: number;
  receivedAt: string;
  status: "DRAFT" | "POSTED";
}
interface Stock {
  saleValue: number;
  costValue: number;
  shelf?: { saleValue: number; costValue: number };
  negative?: { products: number; saleValue: number; costValue: number };
}
interface Cashbox {
  id: string;
  name: string;
  balance: number | null;
  state: CashboxLiveState;
  lastSyncAt: string | null;
  appVersion: string | null;
}
interface FinanceAccount {
  id: string;
  name: string;
  balance: number;
}
interface Store {
  id: string;
  name: string;
}

const RANGES: Range[] = ["today", "yesterday", "week", "month30", "month90"];

export function DashboardHome() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rangeLabel = (r: Range) => t(`range_${r}`);
  const storeId = useStoreId();
  const pathname = useStrippedPathname();
  const [range, setRange] = useState<Range>("week");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revenueByDay, setRevenueByDay] = useState<RevenueDay[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [stock, setStock] = useState<Stock | null>(null);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [expenses, setExpenses] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/dashboard?range=${range}&tz=${new Date().getTimezoneOffset()}`);
      if (!r.ok) throw new Error(t("load_error"));
      const d = await r.json();
      setSummary(d.summary ?? null);
      setRevenueByDay(d.revenueByDay ?? []);
      setReceipts(d.receipts ?? []);
      setStock(d.stock ?? null);
      setCashboxes(d.cashboxes ?? []);
      setAccounts(d.accounts ?? []);
      setExpenses(d.expenses ?? 0);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("load_error"));
    } finally {
      setLoading(false);
    }
  }, [range, t]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    fetch("/api/stores")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((d) => setStores(d.stores ?? []))
      .catch(() => setStores([]));
  }, []);

  const axis = revenueAxis(revenueByDay.map((d) => d.revenue));

  function switchStore(nextStoreId: string) {
    if (nextStoreId !== storeId) window.location.assign(`/store/${nextStoreId}${pathname}`);
  }

  return (
    <div className="space-y-4">
      {/* Filters + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={storeId}
            onChange={(e) => switchStore(e.target.value)}
            aria-label={t("choose_store")}
            className="bg-background h-9 min-w-44 rounded-md border px-3 text-sm font-medium"
          >
            {stores.length === 0 ? (
              <option value={storeId}>{t("store_fallback")}</option>
            ) : (
              stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))
            )}
          </select>
          <div className="relative">
            <button
              onClick={() => setRangeOpen((v) => !v)}
              className="bg-background hover:bg-accent inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium"
            >
              {rangeLabel(range)}
            </button>
            {rangeOpen && (
              <div className="bg-card absolute top-10 left-0 z-10 w-44 rounded-md border py-1 shadow-lg">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setRange(r);
                      setRangeOpen(false);
                    }}
                    className="hover:bg-accent block w-full px-3 py-1.5 text-left text-sm"
                  >
                    {rangeLabel(r)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          {updatedAt && (
            <span>
              {t("updated_at")}:{" "}
              {updatedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="hover:bg-accent inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={t("revenue")}
          value={formatCurrency(summary?.revenue ?? 0)}
          loading={loading}
        />
        <KpiCard
          label={t("avg_check")}
          value={formatCurrency(summary?.avgTransaction ?? 0)}
          loading={loading}
        />
        <KpiCard
          label={t("profit")}
          value={formatCurrency(summary?.grossProfit ?? 0)}
          loading={loading}
          note={
            summary?.missingCost && summary.missingCost.products > 0
              ? t("missing_cost", { count: summary.missingCost.products, sum: formatCurrency(summary.missingCost.revenue) })
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* Revenue chart */}
        <div className="bg-card rounded-lg border p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            {t("revenue_chart")}
          </h2>
          <div className="h-64">
            {loading ? (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="currentColor"
                    opacity={0.1}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) =>
                      new Date(d).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })
                    }
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatCurrency(v)}
                    width={70}
                    // no sales at all: a single ₸0 tick instead of invented ₸1…₸4; returns can push a day below zero
                    domain={axis.empty ? [0, 1] : [(min: number) => Math.min(0, min), "auto"]}
                    ticks={axis.ticks}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(v?: number) => formatCurrency(v ?? 0)}
                    labelFormatter={(d) => new Date(d).toLocaleDateString(locale)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#revFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Приёмки panel */}
        <div className="bg-card rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingCart className="text-primary h-4 w-4" /> {t("receipts")}
            </h2>
            <Link href="/purchases" className="text-primary text-xs font-medium hover:underline">
              {t("all_receipts")}
            </Link>
          </div>
          {loading ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="bg-muted/30 mb-3 rounded-md border px-3 py-2 text-center">
                <p className="text-muted-foreground text-xs">{t("expenses")}</p>
                <p className="text-lg font-bold">{expenses > 0 ? "−" : ""}{formatCurrency(expenses)}</p>
              </div>
              {receipts.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-sm">{t("no_receipts_period")}</p>
              )}
              <ul className="divide-y">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <Link
                        href={`/purchases/${r.id}`}
                        className="hover:text-primary font-medium hover:underline"
                      >
                        {r.supplierName}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        <span className="text-primary">
                          ✓ {r.status === "POSTED" ? t("posted") : t("draft")}
                        </span>{" "}
                        · {new Date(r.receivedAt).toLocaleDateString(locale)}
                      </p>
                    </div>
                    <p className="font-semibold">{formatCurrency(r.total)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Bottom panels: Склад / Кассы / Счета */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("stock")}</h2>
          {loading ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : (
            <div className="space-y-2">
              <div>
                <p className="text-lg font-bold">{formatCurrency(stock?.saleValue ?? 0)}</p>
                <p className="text-muted-foreground text-xs">{t("stock_sale_value")}</p>
              </div>
              <div>
                <p className="text-lg font-bold">{formatCurrency(stock?.costValue ?? 0)}</p>
                <p className="text-muted-foreground text-xs">{t("stock_cost_value")}</p>
              </div>
              {stock?.negative && stock.negative.products > 0 && (
                <div className="border-t pt-2 text-xs text-muted-foreground space-y-1">
                  <p>
                    {t("stock_negative", {
                      count: stock.negative.products,
                      sale: `−${formatCurrency(Math.abs(stock.negative.saleValue))}`,
                      cost: `−${formatCurrency(Math.abs(stock.negative.costValue))}`,
                    })}
                  </p>
                  {stock.shelf && (
                    <p>{t("stock_shelf", { sale: formatCurrency(stock.shelf.saleValue), cost: formatCurrency(stock.shelf.costValue) })}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Wallet className="text-muted-foreground h-4 w-4" /> {t("registers")}
          </h2>
          {loading ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : cashboxes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("no_registers")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {cashboxes.map((c) => (
                <div key={c.id} className="rounded-md border p-2">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className={`text-xs ${c.state === "online" ? "text-emerald-600" : c.state === "inactive" ? "text-red-600" : "text-muted-foreground"}`}>
                    {t(`cashbox_${c.state}`)}
                  </p>
                  {c.lastSyncAt && (
                    <p className="text-muted-foreground text-[11px]">
                      {t("cashbox_last_sync", { time: new Date(c.lastSyncAt).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}
                      {c.appVersion ? ` · v${c.appVersion}` : ""}
                    </p>
                  )}
                  <p className="mt-1 text-xs font-medium">
                    {c.balance != null ? formatCurrency(c.balance) : "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Landmark className="text-muted-foreground h-4 w-4" /> {t("accounts")}
          </h2>
          {loading ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("no_accounts")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-md border p-2">
                  <p className="font-semibold">{formatCurrency(a.balance)}</p>
                  <p className="text-muted-foreground truncate text-xs">{a.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, loading, note }: { label: string; value: string; loading: boolean; note?: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold">
        {loading ? <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" /> : value}
      </p>
      {!loading && note && <p className="mt-1 text-xs text-amber-600">{note}</p>}
    </div>
  );
}
