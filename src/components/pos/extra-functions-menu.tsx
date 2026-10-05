"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { exitProgram as closeProgram, checkForProgramUpdate, installProgramUpdate } from "@/lib/till-shell";
import { PRINTER_ENABLED_KEY } from "@/lib/program-print";
import { flushQueue } from "@/lib/offline/queue";
import { syncCatalog } from "@/lib/offline/catalog";
import { toast } from "sonner";
import type { ReceiptData } from "@/components/receipt/receipt";
import { BarcodeSearchModal } from "./barcode-search-modal";
import { ScannerTestDialog } from "./scanner-test-dialog";
import { QuickReceivingModal } from "./quick-receiving-modal";
import { DebtScreen, type Debtor } from "./debt-screen";
import { ManagerGate } from "./manager-gate";

const EXTRA_PRINTERS_KEY = "korgen-extra-printers";

function readPrinterEnabled(): boolean {
  try { return localStorage.getItem(PRINTER_ENABLED_KEY) !== "0"; } catch { return true; }
}
function readExtraPrinters(): string[] {
  try { return JSON.parse(localStorage.getItem(EXTRA_PRINTERS_KEY) ?? "[]"); } catch { return []; }
}

/**
 * ДОП. ФУНКЦИИ — UMAG's own 12-button grid, matching the real menu exactly (2026-09-27 screenshots,
 * `_umag-sandbox/shots/14-dop.png`/`133-dop.png`): white modal, 5-column button grid, red ЗАКРЫТЬ at the
 * bottom. Replaces the mismatched popover that used to sit behind this same "Доп. функции" button (that
 * popover was really the customer/discount-card/consultant panel — it now only opens from its own
 * "Не выбран консультант" trigger, see pos-screen.tsx).
 */
export function ExtraFunctionsMenu({
  onClose,
  onLock,
  canPriceCheck,
  onOpenPriceCheck,
  canCollapse,
  onToggleCollapse,
  onShowReceipt,
}: {
  onClose: () => void;
  /** ЗАБЛОКИРОВАТЬ КАССУ — the lock itself lives in pos-screen.tsx (localStorage-backed, see
   * src/lib/till-lock.ts) so it survives a reload; this just triggers it and closes the menu. */
  onLock: () => void;
  canPriceCheck: boolean;
  onOpenPriceCheck: () => void;
  canCollapse: boolean;
  onToggleCollapse: () => void;
  onShowReceipt: (data: ReceiptData) => void;
}) {
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [quickReceivingOpen, setQuickReceivingOpen] = useState(false);
  const [quickReceivingGateOpen, setQuickReceivingGateOpen] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const [debtGateOpen, setDebtGateOpen] = useState(false);
  const [debtBusy, setDebtBusy] = useState(false);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [printerEnabled, setPrinterEnabled] = useState(readPrinterEnabled);
  const [addPrinterOpen, setAddPrinterOpen] = useState(false);
  const [scannerTestOpen, setScannerTestOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function exitProgram() {
    await closeProgram();
  }

  async function checkUpdate() {
    const status = await checkForProgramUpdate();
    if (!status) {
      window.location.reload(); // a browser register: reloading is the update
      return;
    }
    if (status.state === "ready") {
      if (window.confirm(`Скачана новая версия ${status.version}. Установить сейчас? Программа перезапустится.`)) installProgramUpdate();
      else toast.info("Обновление установится при следующем закрытии программы");
    } else if (status.state === "downloading") toast.info(`Загружается версия ${status.version}. Она установится при закрытии программы.`);
    else if (status.state === "error") toast.error("Не удалось проверить обновление: нет связи с сервером");
    else toast.success("Установлена последняя версия");
  }

  const zoomShell = typeof window === "undefined" ? undefined : (window as unknown as { korgenShell?: { getZoom?: () => number; setZoom?: (p: number) => number } }).korgenShell;
  const [zoom, setZoomState] = useState<number | null>(() => zoomShell?.getZoom?.() ?? null);
  function changeZoom(delta: number) {
    if (zoom === null || !zoomShell?.setZoom) return;
    setZoomState(zoomShell.setZoom(zoom + delta));
  }

  function togglePrinter() {
    const next = !printerEnabled;
    setPrinterEnabled(next);
    try { localStorage.setItem(PRINTER_ENABLED_KEY, next ? "1" : "0"); } catch { /* best effort */ }
  }

  async function reprintLast() {
    try {
      const res = await fetch("/api/pos/sales?pageSize=1");
      const data = await res.json();
      const sale = data.sales?.[0];
      if (!sale) { toast.error("Продаж пока нет"); return; }
      onShowReceipt({
        saleId: sale.id,
        documentNo: sale.documentNo,
        receiptNo: sale.receiptNo,
        items: sale.items.map((i: { name: string; quantity: number; price: number; total: number; unit: string }) => ({
          name: i.name, quantity: i.quantity, price: i.price, total: i.total, unit: i.unit,
        })),
        subtotal: Number(sale.subtotal),
        discountAmount: Number(sale.discountAmount),
        taxAmount: Number(sale.taxAmount),
        total: Number(sale.total),
        paymentMethod: sale.paymentMethod,
        amountTendered: sale.amountTendered ?? undefined,
        changeDue: sale.changeDue ?? undefined,
        createdAt: new Date(sale.createdAt),
        cashierName: sale.user?.name ?? undefined,
        cashboxName: sale.cashbox?.name ?? undefined,
      });
      onClose();
    } catch {
      toast.error("Не удалось загрузить последнюю продажу");
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await Promise.all([flushQueue(), syncCatalog()]);
      toast.success("Синхронизировано");
    } finally {
      setSyncing(false);
    }
  }

  async function repayDebt(debtor: Debtor, amount: number) {
    setDebtBusy(true);
    setDebtError(null);
    try {
      const res = await fetch(`/api/customers/${debtor.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) { setDebtError(typeof data.error === "string" ? data.error : "Не удалось погасить долг"); return; }
      toast.success("Долг погашен");
      setDebtOpen(false);
      onClose();
    } finally {
      setDebtBusy(false);
    }
  }

  if (debtOpen) {
    return (
      <DebtScreen
        mode="repay"
        onBack={() => setDebtOpen(false)}
        onRepay={(debtor, amount) => void repayDebt(debtor, amount)}
        recording={debtBusy}
        error={debtError}
      />
    );
  }

  const BUTTON = "flex min-h-[4.5rem] items-center justify-center rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-[#172b1d] hover:bg-slate-100";
  const DISABLED_BUTTON = "flex min-h-[4.5rem] items-center justify-center rounded-sm border border-slate-100 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-300 cursor-not-allowed";

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-sm border bg-white p-6 shadow-2xl">
        <div className="grid grid-cols-5 gap-3">
          <button className={BUTTON} onClick={() => void exitProgram()}>ВЫХОД ИЗ ПРОГРАММЫ</button>
          <button className={BUTTON} onClick={() => { onLock(); onClose(); }}>ЗАБЛОКИРОВАТЬ КАССУ</button>
          <button className={BUTTON} onClick={togglePrinter}>
            ВКЛ/ВЫКЛ ПРИНТЕР {printerEnabled ? "ВКЛЮЧЕН" : "ВЫКЛЮЧЕН"}
          </button>
          <button className={BUTTON} onClick={() => void reprintLast()}>РАСПЕЧАТАТЬ ЧЕК ПОСЛЕДНЕЙ ПРОДАЖИ</button>
          <button className={BUTTON} onClick={() => void syncNow()} disabled={syncing}>
            {syncing ? "СИНХРОНИЗАЦИЯ…" : "СИНХ. С СЕРВЕРОМ"}
          </button>

          <button className={BUTTON} onClick={() => setBarcodeOpen(true)}>ПОИСК ПО ШТРИХКОДУ</button>
          <button className={BUTTON} onClick={onToggleCollapse} disabled={!canCollapse}>СВЕРНУТЬ</button>
          <button className={BUTTON} onClick={() => setDebtGateOpen(true)}>ДОЛГ</button>
          <button className={BUTTON} onClick={() => void checkUpdate()}>ПРОВЕРИТЬ ОБНОВЛЕНИЕ</button>
          <button className={BUTTON} onClick={() => setAddPrinterOpen(true)}>ДОБАВИТЬ ДОП ПРИНТЕР</button>
          <button className={BUTTON} onClick={() => setScannerTestOpen(true)}>ТЕСТ СКАНЕРА</button>
          {zoom !== null && (
            <div className={BUTTON + " flex-col gap-1"}>
              <span>РАЗМЕР ЭКРАНА: {zoom}%</span>
              <span className="flex gap-2">
                <button type="button" aria-label="Уменьшить" className="rounded border border-slate-300 bg-white px-4 py-1 text-base font-bold" onClick={() => changeZoom(-10)}>−</button>
                <button type="button" aria-label="Увеличить" className="rounded border border-slate-300 bg-white px-4 py-1 text-base font-bold" onClick={() => changeZoom(10)}>+</button>
              </span>
            </div>
          )}

          <button className={canPriceCheck ? BUTTON : DISABLED_BUTTON} disabled={!canPriceCheck} onClick={() => { onOpenPriceCheck(); onClose(); }}>
            ПРОВЕРКА ЦЕНЫ
          </button>
          <button className={BUTTON} onClick={() => setQuickReceivingGateOpen(true)}>БЫСТРАЯ ПРИЁМКА</button>
        </div>

        <div className="mt-6 flex justify-center">
          <button onClick={onClose} className="rounded-sm bg-[#c0392b] px-10 py-3 text-sm font-bold text-white hover:bg-[#a5321f]">
            ЗАКРЫТЬ
          </button>
        </div>
      </div>

      {barcodeOpen && <BarcodeSearchModal onClose={() => setBarcodeOpen(false)} />}

      {quickReceivingGateOpen && (
        <ManagerGate
          open
          context="quick_receiving"
          onAuthorized={() => { setQuickReceivingGateOpen(false); setQuickReceivingOpen(true); }}
          onCancel={() => setQuickReceivingGateOpen(false)}
        />
      )}
      {quickReceivingOpen && (
        <QuickReceivingModal
          onClose={() => setQuickReceivingOpen(false)}
          onDone={() => { setQuickReceivingOpen(false); toast.success("Приёмка сохранена"); onClose(); }}
        />
      )}

      {debtGateOpen && (
        <ManagerGate
          open
          context="debt_repay"
          onAuthorized={() => { setDebtGateOpen(false); setDebtOpen(true); }}
          onCancel={() => setDebtGateOpen(false)}
        />
      )}

      {addPrinterOpen && <AddPrinterModal onClose={() => setAddPrinterOpen(false)} />}
      {scannerTestOpen && <ScannerTestDialog onClose={() => setScannerTestOpen(false)} />}
    </div>
  );
}

/** ДОБАВИТЬ ДОП ПРИНТЕР — this kiosk runs in a browser with no real multi-printer driver layer (only the
 * single detected USB/serial device used elsewhere), so this keeps a simple named list a cashier can see
 * and remove — honest about what it is: a label list, not a live driver registration. */
function AddPrinterModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [printers, setPrinters] = useState<string[]>(readExtraPrinters);

  function add() {
    if (!name.trim()) return;
    const next = [...printers, name.trim()];
    setPrinters(next);
    try { localStorage.setItem(EXTRA_PRINTERS_KEY, JSON.stringify(next)); } catch { /* best effort */ }
    setName("");
  }
  function remove(i: number) {
    const next = printers.filter((_, idx) => idx !== i);
    setPrinters(next);
    try { localStorage.setItem(EXTRA_PRINTERS_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-sm border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Добавить доп принтер</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 space-y-1">
          {printers.length === 0 && <p className="text-xs text-slate-400">Дополнительных принтеров нет</p>}
          {printers.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-sm border border-slate-200 px-3 py-1.5 text-sm">
              <span>{p}</span>
              <button onClick={() => remove(i)} className="text-slate-400 hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Название принтера"
            className="h-9 flex-1 rounded-sm border border-slate-300 px-3 text-sm outline-none focus:border-[#1a9ba8]"
          />
          <button onClick={add} className="rounded-sm bg-[#24bb69] px-4 text-xs font-bold text-white hover:bg-[#1fa45c]">Добавить</button>
        </div>
      </div>
    </div>
  );
}
