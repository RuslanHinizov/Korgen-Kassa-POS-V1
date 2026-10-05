"use client";

import { useEffect, useRef, useState } from "react";
import { keyToChar } from "@/lib/scanner-decode";

interface Row { id: number; ms: number; key: string; code: string; shift: boolean }

/**
 * ТЕСТ СКАНЕРА — shows what a barcode scanner really types: each key as Windows reports it (the character and the physical
 * key) and the code the till reads from the physical keys. Used to find out why a scan comes out garbled or does not end.
 */
export function ScannerTestDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const last = useRef(0);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { onClose(); return; }
      const now = Date.now();
      const ms = last.current ? now - last.current : 0;
      last.current = now;
      setRows((r) => [...(ms > 1500 ? [] : r), { id: ++seq.current, ms, key: e.key, code: e.code, shift: e.shiftKey }].slice(-60));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const typed = rows.map((r) => (r.key.length === 1 ? r.key : "")).join("");
  const read = rows.map((r) => keyToChar({ code: r.code, key: r.key, shiftKey: r.shift }) ?? "").join("");
  const cyrillic = /[А-Яа-яЁё]/.test(typed);
  const enter = rows.some((r) => r.key === "Enter" || r.code === "NumpadEnter");
  const tab = rows.some((r) => r.key === "Tab");
  const fast = rows.length > 1 && rows.slice(1).every((r) => r.ms < 80);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-bold">ТЕСТ СКАНЕРА</h2>
        <p className="mt-1 text-sm text-slate-600">Отсканируйте любой штрихкод. Ниже видно, что именно «печатает» сканер. Esc — закрыть.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded border p-3"><p className="text-xs text-slate-500">Напечатано (как видит Windows)</p><p className="mt-1 min-h-6 break-all font-mono text-base">{typed || "—"}</p></div>
          <div className="rounded border p-3"><p className="text-xs text-slate-500">Код, который прочтёт касса</p><p className="mt-1 min-h-6 break-all font-mono text-base font-bold text-emerald-700">{read || "—"}</p></div>
        </div>
        {rows.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            <li>{fast ? "✔ Скорость как у сканера." : "Ввод медленный — это не похоже на сканер (или вы печатаете руками)."}</li>
            <li>{enter ? "✔ В конце сканер отправляет Enter." : tab ? "В конце сканер отправляет Tab — касса это понимает." : "✖ В конце нет Enter/Tab — касса завершит чтение сама по паузе."}</li>
            {cyrillic && <li className="font-medium text-red-700">✖ На экране русские буквы: в Windows включена русская раскладка. Переключите на ENG (Win+Пробел). Касса при этом читает код правильно сама.</li>}
          </ul>
        )}
        <div className="mt-3 max-h-56 overflow-y-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left"><tr><th className="px-2 py-1">мс</th><th className="px-2 py-1">символ</th><th className="px-2 py-1">клавиша</th><th className="px-2 py-1">Shift</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">Жду сканирования…</td></tr> : rows.map((r) => (
                <tr key={r.id} className="border-t"><td className="px-2 py-0.5">{r.ms}</td><td className="px-2 py-0.5 font-mono">{r.key.length === 1 ? r.key : `<${r.key}>`}</td><td className="px-2 py-0.5 font-mono">{r.code}</td><td className="px-2 py-0.5">{r.shift ? "да" : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-sm bg-[#c0392b] px-8 py-2.5 text-sm font-bold text-white hover:bg-[#a5321f]">ЗАКРЫТЬ</button>
        </div>
      </div>
    </div>
  );
}
