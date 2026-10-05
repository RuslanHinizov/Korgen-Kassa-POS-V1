"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStorePath } from "@/components/store/store-provider";
import { unitLabel } from "@/lib/units";
import { Camera, CameraOff, CheckCircle2, Loader2, Minus, Plus, ScanLine, X, XCircle } from "lucide-react";
import { CameraScanner } from "@/components/scan/camera-scanner";
import { CreateProductModal } from "@/components/pos/create-product-modal";
import type { ProductResult } from "@/components/pos/product-search";
import { ScanBurst, SCAN_IDLE_MS, isScanTerminator, keyToChar } from "@/lib/scanner-decode";
import { toast } from "sonner";

interface Header { documentNo: number; status: string; itemCount: number; scannedCount: number }
interface Line { itemId: string; productId: string; name: string; barcode: string | null; unit: string; expectedQty: number; countedQty: number }
/** `code` = a barcode that matched nothing: the worker may create the product right here */
type Feedback = { kind: "ok" | "missing"; text: string; code?: string } | null;
type ScanRequest = { code: string } | { productId: string };

/** A short synth beep — no audio asset needed, works offline. */
function beep(freq: number, ms: number) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    osc.onended = () => ctx.close();
  } catch {
    // Audio may be blocked before any user gesture — scanning still works, just silent.
  }
}

/** The counted quantity: tap the number and type how many there really are. */
function QtyInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  function commit() {
    setEditing(false);
    const n = Number(text.replace(",", ".").trim());
    if (!Number.isFinite(n) || n < 0) return;
    if (n !== value) onCommit(n);
  }
  return (
    <input
      inputMode="decimal"
      value={editing ? text : String(value)}
      onFocus={(e) => { setText(String(value)); setEditing(true); e.currentTarget.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      aria-label="Количество"
      className="h-10 w-20 rounded-md border bg-background px-1 text-center text-base font-semibold tabular-nums focus:border-primary focus:outline-none"
    />
  );
}

/**
 * Инвентаризация → Сканирование: a full-screen counting mode for the warehouse worker. Every scan (USB/Bluetooth scanner
 * or the phone camera) adds 1 to that product's «Сканировано» in the document; a product that is not in the document yet
 * is added by the scan. Each scan is one small request, so a document with any number of products stays fast.
 */
export function StocktakeScan({ id }: { id: string }) {
  const router = useRouter();
  const storePath = useStorePath();
  const [head, setHead] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [newProductCode, setNewProductCode] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { try { if (localStorage.getItem("stocktake-scan-camera") === "1") setCameraOn(true); } catch { /* private mode */ } }, []);
  function toggleCamera() {
    const next = !cameraOn;
    setCameraOn(next);
    try { localStorage.setItem("stocktake-scan-camera", next ? "1" : "0"); } catch { /* ignore */ }
  }

  useEffect(() => {
    fetch(`/api/inventory/stocktakes/${id}?pageSize=1`).then(async (r) => {
      if (!r.ok) { toast.error("Документ не найден"); router.push(storePath("/products/stocktake")); return; }
      const d = (await r.json()).stocktake;
      setHead({ documentNo: d.documentNo, status: d.status, itemCount: d.itemCount, scannedCount: d.scannedCount });
    });
  }, [id, router, storePath]);

  // with the camera on, do not grab focus: it would pop up the phone keyboard over the camera
  const focusInput = useCallback(() => { if (!cameraOn) inputRef.current?.focus(); }, [cameraOn]);
  useEffect(() => { focusInput(); }, [focusInput]);

  function flash(next: Feedback) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(next);
    if (next?.kind === "missing" && next.code) return; // stays until the worker acts on it or scans something else
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2200);
  }

  /** put (or move) a line to the top of the list of what was just scanned */
  function touchLine(line: Line) {
    setLines((prev) => [line, ...prev.filter((l) => l.itemId !== line.itemId)].slice(0, 60));
  }

  // Scans that arrive while one is still being processed wait their turn instead of being lost.
  const queue = useRef<ScanRequest[]>([]);
  const draining = useRef(false);
  function submitScan(code: string) {
    const raw = code.trim();
    if (!raw) return;
    queue.current.push({ code: raw });
    void drain();
  }
  async function drain() {
    if (draining.current) return;
    draining.current = true;
    try { while (queue.current.length) await processScan(queue.current.shift()!); } finally { draining.current = false; }
  }

  async function processScan(body: ScanRequest) {
    try {
      const r = await fetch(`/api/inventory/stocktakes/${id}/items/scan`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 404 && "code" in body) {
        beep(220, 220);
        flash({ kind: "missing", text: `Товар не найден: ${body.code}`, code: body.code });
        return;
      }
      if (!r.ok) {
        beep(220, 220);
        flash({ kind: "missing", text: d.error ?? "Не удалось записать" });
        return;
      }
      beep(880, 120);
      const item = d.item as { id: string; productId: string; productName: string; barcode: string | null; unit: string; expectedQty: number; countedQty: number };
      touchLine({ itemId: item.id, productId: item.productId, name: item.productName, barcode: item.barcode, unit: item.unit, expectedQty: item.expectedQty, countedQty: item.countedQty });
      setHead((h) => (h ? { ...h, scannedCount: d.scannedCount, itemCount: h.itemCount + (d.created ? 1 : 0) } : h));
      flash({ kind: "ok", text: `${item.productName} — всего ${item.countedQty} ${unitLabel(item.unit, true)}` });
    } finally {
      focusInput();
    }
  }

  /** A product the worker just created on the spot: count it once. */
  function addCreated(product: ProductResult) {
    setNewProductCode(null);
    queue.current.push({ productId: product.id });
    void drain();
  }

  async function setQty(line: Line, next: number) {
    const value = Math.max(0, next);
    const r = await fetch(`/api/inventory/stocktakes/${id}/items/${line.itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countedQty: value }) });
    if (!r.ok) { toast.error("Не удалось изменить количество"); return; }
    setLines((prev) => prev.map((l) => (l.itemId === line.itemId ? { ...l, countedQty: value } : l)));
    focusInput();
  }

  // A hardware scanner types like a very fast keyboard. Its keys are read by the PHYSICAL key (src/lib/scanner-decode.ts),
  // so the Windows layout does not garble the code; a scan ends with Enter/Tab or a short silence.
  const submitRef = useRef(submitScan);
  useEffect(() => { submitRef.current = submitScan; });
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
      if (inputRef.current) inputRef.current.value = "";
      submitRef.current(text);
    }, SCAN_IDLE_MS);
  }, [finishScan]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return; // a field handles its own typing
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (isScanTerminator(e)) {
        const scanned = finishScan();
        if (scanned) { e.preventDefault(); submitRef.current(scanned); }
        return;
      }
      noteScanKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishScan, noteScanKey]);

  if (!head) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  const finished = head.status !== "DRAFT" && head.status !== "COUNTING";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold">Инвентаризация №{head.documentNo} — Сканирование</h1>
          <p className="text-muted-foreground text-sm">Позиций в документе: {head.itemCount} · отсканировано: {head.scannedCount}</p>
        </div>
        <button onClick={() => router.push(storePath(`/products/stocktake/${id}`))} className="hover:bg-accent inline-flex h-10 items-center gap-1.5 rounded-md border px-4 text-sm font-medium">
          <X className="h-4 w-4" /> Завершить сканирование
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center overflow-y-auto p-4 sm:p-8">
        <div className="w-full max-w-xl space-y-3">
          {finished && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive">Документ уже проведён — сканировать нельзя.</p>}
          <button
            onClick={toggleCamera}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 text-base font-medium ${cameraOn ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-accent"}`}
          >
            {cameraOn ? <><CameraOff className="h-5 w-5" /> Выключить камеру</> : <><Camera className="h-5 w-5" /> Сканировать камерой телефона</>}
          </button>
          {cameraOn && <CameraScanner onScan={(c) => submitScan(c)} />}

          <div className="relative">
            <ScanLine className="text-muted-foreground absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2" />
            <input
              ref={inputRef}
              onKeyDown={(e) => {
                if (isScanTerminator(e.nativeEvent)) {
                  const scanned = finishScan();
                  if (scanned || e.key === "Enter" || e.code === "NumpadEnter") {
                    e.preventDefault();
                    const v = scanned ?? e.currentTarget.value;
                    e.currentTarget.value = "";
                    submitScan(v);
                  }
                  return;
                }
                noteScanKey(e.nativeEvent);
              }}
              onBlur={(e) => { if (e.relatedTarget instanceof HTMLInputElement) return; focusInput(); }}
              autoFocus={!cameraOn}
              placeholder={cameraOn ? "Или введите штрихкод вручную…" : "Отсканируйте штрихкод…"}
              className="h-16 w-full rounded-xl border-2 bg-background pl-12 pr-4 text-xl font-medium focus:border-primary focus:outline-none"
            />
          </div>

          {feedback && (
            <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${feedback.kind === "ok" ? "border-primary/40 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
              <span className="min-w-0 flex-1 break-words">{feedback.text}</span>
              {feedback.code && (
                <>
                  <button onClick={() => setNewProductCode(feedback.code ?? "")} className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">Создать товар</button>
                  <button onClick={() => setFeedback(null)} className="shrink-0 rounded p-1 hover:bg-black/10" aria-label="Закрыть"><X className="h-4 w-4" /></button>
                </>
              )}
            </div>
          )}

          <div className="divide-y rounded-lg border">
            {lines.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">Пока ничего не отсканировано</p>
            ) : (
              lines.map((line) => (
                <div key={line.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <p className="truncate text-sm font-medium">{line.name}</p>
                    <p className="text-muted-foreground text-xs">{line.barcode ?? "без штрихкода"} · по учёту: {line.expectedQty} {unitLabel(line.unit, true)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => void setQty(line, line.countedQty - 1)} className="hover:bg-accent flex h-10 w-10 items-center justify-center rounded-md border" aria-label="Уменьшить"><Minus className="h-3.5 w-3.5" /></button>
                    <QtyInput value={line.countedQty} onCommit={(n) => void setQty(line, n)} />
                    <span className="text-muted-foreground w-8 text-xs">{unitLabel(line.unit, true)}</span>
                    <button onClick={() => void setQty(line, line.countedQty + 1)} className="hover:bg-accent flex h-10 w-10 items-center justify-center rounded-md border" aria-label="Увеличить"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {newProductCode !== null && (
        <CreateProductModal
          initialBarcode={newProductCode}
          hideStock
          submitLabel="Создать и посчитать"
          overlayClass="z-[110]"
          onClose={() => setNewProductCode(null)}
          onCreated={addCreated}
        />
      )}
    </div>
  );
}
