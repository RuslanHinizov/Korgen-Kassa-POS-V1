"use client";

import { useEffect, useMemo, useState } from "react";
import { StoreLink as Link } from "@/components/store/store-link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calendar, ChevronDown, Loader2 } from "lucide-react";
import { AnchoredPopover, useAnchoredPopover } from "@/components/ui/anchored-popover";
import { unitLabel } from "@/lib/units";
import { CHANGE_LABEL, MONEY_FIELDS, type ChangeField } from "@/lib/product-changes";

/** Minutes east of UTC of this computer (300 = Almaty): the server cuts days in the viewer's time zone. */
const tzMinutes = () => -new Date().getTimezoneOffset();

const MONTHS_GEN = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];
const money = (n: number) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000).replace(".", ","));
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("ru-RU")} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
};

function Loading() {
  return <div className="p-10 text-center text-muted-foreground"><Loader2 className="inline h-5 w-5 animate-spin" /></div>;
}

// ───────────────────────────── Динамика продаж ─────────────────────────────

export function SalesDynamicsTab({ productId }: { productId: string }) {
  const [days, setDays] = useState<{ label: string; qty: number }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/products/${productId}/sales-dynamics?tz=${tzMinutes()}`)
      .then((r) => r.json())
      .then((d: { days?: { day: string; qty: number }[] }) => {
        if (!alive) return;
        setDays((d.days ?? []).map((x) => {
          const [, m, dd] = x.day.split("-").map(Number);
          return { label: `${dd} ${MONTHS_GEN[m - 1]}`, qty: x.qty };
        }));
      })
      .catch(() => alive && setDays([]));
    return () => { alive = false; };
  }, [productId]);
  if (!days) return <Loading />;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center justify-center gap-2 text-xs text-muted-foreground"><span className="inline-block h-3 w-10 rounded-sm bg-[#4bc0c0]" />Продажи по товару за последний месяц</div>
      <ResponsiveContainer width="100%" height={460}>
        <LineChart data={days} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
          <CartesianGrid stroke="#e5e7eb" />
          <XAxis dataKey="label" interval={0} angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: "#6b7280" }} height={70} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} />
          <Tooltip formatter={(v) => [String(v), "Продано"]} />
          <Line type="linear" dataKey="qty" stroke="#4bc0c0" strokeWidth={2.5} dot={{ r: 3, fill: "#4bc0c0" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ───────────────────────────── История изменения товара ─────────────────────────────

interface ChangeGroup { groupId: string; userName: string; createdAt: string; items: { field: string; oldValue: string | null; newValue: string | null }[] }

function showChange(field: string, v: string | null): string {
  if (v === null || v === "") return "—";
  if (MONEY_FIELDS.includes(field as ChangeField)) return money(Number(v));
  if (field === "unit") return unitLabel(v);
  if (field === "active") return v === "true" ? "Активен" : "Неактивен";
  return v;
}

export function ChangesTab({ productId, refreshKey }: { productId: string; refreshKey: number }) {
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/products/${productId}/changes`)
      .then((r) => r.json())
      .then((d: { groups?: ChangeGroup[] }) => alive && setGroups(d.groups ?? []))
      .catch(() => alive && setGroups([]));
    return () => { alive = false; };
  }, [productId, refreshKey]);
  if (!groups) return <Loading />;
  if (groups.length === 0) return <p className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Изменений товара пока нет</p>;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.groupId}>
          <h3 className="mb-2 text-sm font-semibold">Внёс изменения: {g.userName} , {fmtDateTime(g.createdAt).replace(" ", ", ")}</h3>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="w-1/4 px-4 py-2 font-medium">Что изменилось</th>
                  <th className="w-[35%] px-4 py-2 font-medium">Было</th>
                  <th className="px-4 py-2 font-medium">Стало</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.items.map((it) => (
                  <tr key={it.field}>
                    <td className="px-4 py-3">{CHANGE_LABEL[it.field as ChangeField] ?? it.field}</td>
                    <td className="px-4 py-3 tabular-nums">{showChange(it.field, it.oldValue)}</td>
                    <td className="px-4 py-3 tabular-nums">{showChange(it.field, it.newValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ───────────────────────────── История движения товара ─────────────────────────────

interface Movement { id: string; createdAt: string; userName: string; label: string; documentNo: string | null; href: string | null; supplier: string | null; before: number; after: number; diff: number }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const PERIODS = [
  { key: "today", label: "Сегодня", range: () => ({ from: ymd(new Date()), to: ymd(new Date()) }) },
  { key: "yesterday", label: "Вчера", range: () => ({ from: ymd(daysAgo(1)), to: ymd(daysAgo(1)) }) },
  { key: "7", label: "Последние 7 дней", range: () => ({ from: ymd(daysAgo(6)), to: ymd(new Date()) }) },
  { key: "30", label: "Последние 30 дней", range: () => ({ from: ymd(daysAgo(29)), to: ymd(new Date()) }) },
  { key: "90", label: "Последние 90 дней", range: () => ({ from: ymd(daysAgo(89)), to: ymd(new Date()) }) },
] as const;

export function MovementsTab({ productId, unit, refreshKey }: { productId: string; unit: string; refreshKey: number }) {
  const [period, setPeriod] = useState<string>("30");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ key: string; label: string }[]>([]);
  const [rows, setRows] = useState<Movement[] | null>(null);
  const typePop = useAnchoredPopover();
  const periodPop = useAnchoredPopover();

  const range = useMemo(() => custom ?? PERIODS.find((p) => p.key === period)!.range(), [custom, period]);
  const periodLabel = custom ? `${custom.from.split("-").reverse().join(".")} — ${custom.to.split("-").reverse().join(".")}` : PERIODS.find((p) => p.key === period)!.label;

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ from: range.from, to: range.to, tz: String(tzMinutes()) });
    if (types.length) qs.set("type", types.join(","));
    fetch(`/api/products/${productId}/movements?${qs}`)
      .then((r) => r.json())
      .then((d: { movements?: Movement[]; groups?: { key: string; label: string }[] }) => {
        if (!alive) return;
        setRows(d.movements ?? []);
        if (d.groups) setGroups(d.groups);
      })
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [productId, range, types, refreshKey]);

  const u = unitLabel(unit);
  return (
    <div className="space-y-4">
      {/* eslint-disable react-hooks/refs -- canary rule false positive on the anchored-popover hook, same pattern as employees-list.tsx */}
      <div className="flex flex-wrap items-center gap-3">
        <button ref={typePop.anchorRef} onClick={typePop.toggle} className="inline-flex h-10 min-w-48 items-center justify-between gap-2 rounded-md border bg-card px-3 text-sm">
          <span className={types.length ? "" : "text-muted-foreground"}>{types.length ? groups.filter((g) => types.includes(g.key)).map((g) => g.label).join(", ") : "Тип операции"}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
        <button ref={periodPop.anchorRef} onClick={periodPop.toggle} className="inline-flex h-10 min-w-56 items-center justify-between gap-2 rounded-md border bg-card px-3 text-sm">
          <span className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />{periodLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {typePop.open && typePop.pos && (
        <AnchoredPopover pos={typePop.pos} onClose={typePop.close} className="w-64 space-y-1">
          {groups.map((g) => (
            <label key={g.key} className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={types.includes(g.key)} onChange={() => setTypes((t) => (t.includes(g.key) ? t.filter((x) => x !== g.key) : [...t, g.key]))} /> {g.label}
            </label>
          ))}
          {types.length > 0 && <button onClick={() => setTypes([])} className="pt-1 text-xs text-primary hover:underline">Сбросить</button>}
        </AnchoredPopover>
      )}
      {periodPop.open && periodPop.pos && (
        <AnchoredPopover pos={periodPop.pos} onClose={periodPop.close} className="w-64 space-y-2">
          <div className="flex flex-col gap-1">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => { setCustom(null); setPeriod(p.key); periodPop.close(); }} className={`rounded px-2 py-1 text-left hover:bg-accent ${!custom && period === p.key ? "font-semibold text-primary" : ""}`}>{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t pt-2">
            <input type="date" value={range.from} onChange={(e) => e.target.value && setCustom({ from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })} className="h-8 w-full rounded-md border bg-background px-1 text-xs" />
            <span>—</span>
            <input type="date" value={range.to} onChange={(e) => e.target.value && setCustom({ from: range.from > e.target.value ? e.target.value : range.from, to: e.target.value })} className="h-8 w-full rounded-md border bg-background px-1 text-xs" />
          </div>
        </AnchoredPopover>
      )}

      {/* eslint-enable react-hooks/refs */}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Дата изменения</th>
              <th className="px-4 py-2.5 font-medium">Провел операцию</th>
              <th className="px-4 py-2.5 font-medium">Тип операции</th>
              <th className="px-4 py-2.5 font-medium">Поставщик</th>
              <th className="px-4 py-2.5 font-medium">Было</th>
              <th className="px-4 py-2.5 font-medium">Стало</th>
              <th className="px-4 py-2.5 font-medium">Разница</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows === null ? (
              <tr><td colSpan={7}><Loading /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">За этот период движений нет</td></tr>
            ) : rows.map((m) => {
              const text = `${m.label}${m.documentNo ? ` ${m.documentNo}` : ""}`;
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmtDateTime(m.createdAt).replace(/ (\d)/, " $1")}</td>
                  <td className="px-4 py-3">{m.userName}</td>
                  <td className="px-4 py-3">{m.href ? <Link href={m.href} className="text-primary hover:underline">{text}</Link> : <span className="text-primary">{text}</span>}</td>
                  <td className="px-4 py-3">{m.supplier ?? ""}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{qty(m.before)} {u}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{qty(m.after)} {u}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{m.diff > 0 ? "+" : ""}{qty(m.diff)} {u}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
