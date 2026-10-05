export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  unit?: "pcs" | "kg" | "l" | "m" | string;
  notes?: string;
}

export interface ReceiptData {
  saleId?: string;
  documentNo?: number;
  /** Receipt number the till made itself while offline (e.g. "A1F3-000123"); shown until the server numbers the sale. */
  receiptNo?: string;
  /** Document reference for returns that were created without an original sale receipt. */
  referenceText?: string;
  isRefund?: boolean;
  reason?: string;
  customerName?: string;
  /** Who rang the sale up («Кассир: …»). */
  cashierName?: string;
  /** The register the sale was rung up on («Касса: Касса-1»). */
  cashboxName?: string;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount?: number;
  total: number;
  paymentMethod: string;
  paymentLines?: { method: string; amount: number }[];
  amountTendered?: number;
  changeDue?: number;
  createdAt?: Date;
}

export interface ReceiptSettings {
  name: string;
  logoUrl: string | null;
  currency: string;
  currencyDecimals: number;
  taxName: string;
  receiptFooter: string;
  /** false = compact legacy layout (one line per item); undefined/true = detailed layout. */
  posNewReceiptFormat?: boolean;
  /** «Верхняя часть чека»; falls back to the store name. */
  receiptHeader?: string;
  /** «Печатать НДС в чеке»; undefined/true prints the tax line. */
  receiptPrintVat?: boolean;
}

import { useTranslations, useLocale } from "next-intl";

interface ReceiptProps {
  data: ReceiptData;
  settings: ReceiptSettings;
}

function fmt(amount: number, currency = "$", decimals = 2, locale = "en") {
  let n: string;
  try {
    n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    n = amount.toFixed(decimals);
  }
  return `${currency}${n}`;
}

export function Receipt({ data, settings }: ReceiptProps) {
  const t = useTranslations("receipt");
  const tp = useTranslations("pos");
  const locale = useLocale();
  const c = settings.currency;
  const d = settings.currencyDecimals;
  const now = data.createdAt ?? new Date();
  const unitLabel = (unit?: string) => ({ pcs: "шт", kg: "кг", l: "л", m: "м" })[unit ?? "pcs"] ?? unit ?? "шт";
  const formatQuantity = (quantity: number | string, unit?: string) => {
    const value = Number(quantity);
    const safeValue = Number.isFinite(value) ? value : 0;
    const shown = Number.isInteger(safeValue) ? String(safeValue) : safeValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    return `${shown} ${unitLabel(unit)}`;
  };

  const payMethod = (m: string) => {
    const key = m.toLowerCase();
    if (key === "cash" || key === "card" || key === "other" || key === "credit") return tp(key);
    if (key === "refund") return t("refund_stamp");
    return m;
  };

  return (
    <div
      id="receipt-print"
      className="font-mono text-xs w-72 mx-auto bg-white text-black p-4 print:w-full print:text-[10pt] print:p-0"
      style={{ fontFamily: "monospace" }}
    >
      {/* Header */}
      <div className="text-center mb-3">
        {settings.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={settings.logoUrl}
            alt=""
            // a logo file that is gone (deleted upload) must not print as a broken-image box
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            className="h-[4.5rem] mx-auto mb-2 object-contain"
          />
        )}
        <p className="font-bold text-sm whitespace-pre-line">{settings.receiptHeader || settings.name}</p>
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* Date & Sale ID */}
      <div className="flex justify-between text-[10px] mb-2">
        <span>{now.toLocaleDateString()}</span>
        <span>{now.toLocaleTimeString()}</span>
      </div>
      {data.isRefund && <p className="mb-2 text-center text-sm font-black tracking-wide">ВОЗВРАТ</p>}
      {data.referenceText ? (
        <p className="text-[10px] text-center mb-2">{data.referenceText}</p>
      ) : data.documentNo != null ? (
        <p className="text-[10px] text-center mb-2">
          {data.isRefund ? `К чеку №${data.documentNo}` : t("sale_no", { id: data.documentNo })}
        </p>
      ) : data.receiptNo ? (
        <p className="text-[10px] text-center mb-2">{`Чек №${data.receiptNo}`}</p>
      ) : null}
      {data.cashboxName && <p className="text-[10px] text-center mb-1">Касса: {data.cashboxName}</p>}
      {data.cashierName && <p className="text-[10px] text-center mb-2">Кассир: {data.cashierName}</p>}
      {data.customerName && (
        <p className="text-[10px] text-center mb-2">{t("for", { name: data.customerName })}</p>
      )}
      {data.reason && <p className="text-[10px] text-center mb-2">Причина: {data.reason}</p>}

      <div className="border-t border-dashed border-black my-2" />

      {/* Items */}
      <div className="space-y-2 mb-2">
        {data.items.map((item, i) => settings.posNewReceiptFormat === false ? (
          <div key={i} className="flex justify-between gap-2 leading-tight">
            <span className="break-words">{item.name} {formatQuantity(item.quantity, item.unit)}</span>
            <span className="shrink-0">{fmt(item.total, c, d, locale)}</span>
          </div>
        ) : (
          <div key={i} className="border-b border-dotted border-slate-300 pb-1.5 last:border-0">
            <div className="break-words font-semibold leading-snug">{item.name}</div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-600">
              <span>{formatQuantity(item.quantity, item.unit)} × {fmt(item.price, c, d, locale)}</span>
              <span className="shrink-0 font-bold text-black">{fmt(item.total, c, d, locale)}</span>
            </div>
            {item.notes && (
              <div className="mt-0.5 text-[10px] text-gray-500 italic">{item.notes}</div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* Totals */}
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between">
          <span>{t("subtotal")}</span>
          <span>{fmt(data.subtotal, c, d, locale)}</span>
        </div>
        {data.discountAmount > 0 && (
          <div className="flex justify-between">
            <span>{t("discount")}</span>
            <span>-{fmt(data.discountAmount, c, d, locale)}</span>
          </div>
        )}
        {data.taxAmount > 0 && settings.receiptPrintVat !== false && (
          <div className="flex justify-between">
            <span>{settings.taxName}</span>
            <span>{fmt(data.taxAmount, c, d, locale)}</span>
          </div>
        )}
        {data.tipAmount != null && data.tipAmount > 0 && (
          <div className="flex justify-between">
            <span>{t("tip")}</span>
            <span>{fmt(data.tipAmount, c, d, locale)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-sm border-t border-black pt-1 mt-1">
          <span>{t("total")}</span>
          <span>{fmt(data.total, c, d, locale)}</span>
        </div>
      </div>

      {/* Payment */}
      <div className="space-y-0.5 mb-2 text-[10px]">
        {data.paymentLines && data.paymentLines.length > 0 ? (
          data.paymentLines.map((line, i) => (
            <div key={i} className="flex justify-between">
              <span>{payMethod(line.method)}</span>
              <span>{fmt(line.amount, c, d, locale)}</span>
            </div>
          ))
        ) : (
          <div className="flex justify-between">
            <span>{t("payment")}</span>
            <span>{payMethod(data.paymentMethod)}</span>
          </div>
        )}
        {data.amountTendered != null && data.amountTendered > 0 && !data.paymentLines?.length && (
          <div className="flex justify-between">
            <span>{t("tendered")}</span>
            <span>{fmt(data.amountTendered, c, d, locale)}</span>
          </div>
        )}
        {data.changeDue != null && data.changeDue > 0 && (
          <div className="flex justify-between">
            <span>{t("change")}</span>
            <span>{fmt(data.changeDue, c, d, locale)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* Footer */}
      {settings.receiptFooter && (
        <p className="text-center text-[10px] mt-2">{settings.receiptFooter}</p>
      )}
      <p className="text-center text-[9px] mt-2">Korgen Kassa</p>
    </div>
  );
}
