"use client";

import { useState } from "react";
import { LABEL_PRESETS, clampLabelSize, getLabelSize, setLabelSize, type LabelSize } from "@/lib/label-print";

/** The size of the sticky label in the label printer (width × height, mm). Remembered on this device. */
export function useLabelSize(): [LabelSize, (s: LabelSize) => void] {
  const [size, setSize] = useState<LabelSize>(() => getLabelSize());
  function change(next: LabelSize) {
    const clamped = clampLabelSize(next);
    setSize(clamped);
    setLabelSize(clamped);
  }
  return [size, change];
}

const key = (s: LabelSize) => `${s.widthMm}x${s.heightMm}`;

export function LabelSizePicker({ value, onChange, className = "" }: { value: LabelSize; onChange: (s: LabelSize) => void; className?: string }) {
  const preset = LABEL_PRESETS.find((p) => key(p) === key(value));
  const [custom, setCustom] = useState(!preset);
  const showCustom = custom || !preset;
  return (
    <div className={`no-print flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <span className="text-muted-foreground">Размер этикетки, мм</span>
      <select
        value={showCustom ? "custom" : key(value)}
        onChange={(e) => {
          if (e.target.value === "custom") { setCustom(true); return; }
          setCustom(false);
          const [w, h] = e.target.value.split("x").map(Number);
          onChange({ widthMm: w, heightMm: h });
        }}
        className="h-9 rounded-md border bg-background px-2"
      >
        {LABEL_PRESETS.map((p) => <option key={key(p)} value={key(p)}>{p.widthMm} × {p.heightMm}</option>)}
        <option value="custom">Другой…</option>
      </select>
      {showCustom && (
        <span className="flex items-center gap-1">
          <input key={`w${value.widthMm}`} type="number" min={20} max={82} defaultValue={value.widthMm} onBlur={(e) => onChange({ ...value, widthMm: Number(e.target.value) })} className="h-9 w-16 rounded-md border bg-background px-2 text-right" aria-label="Ширина, мм" />
          ×
          <input key={`h${value.heightMm}`} type="number" min={10} max={200} defaultValue={value.heightMm} onBlur={(e) => onChange({ ...value, heightMm: Number(e.target.value) })} className="h-9 w-16 rounded-md border bg-background px-2 text-right" aria-label="Высота, мм" />
        </span>
      )}
    </div>
  );
}
