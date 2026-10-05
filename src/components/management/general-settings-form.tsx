"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLocale } from "@/app/actions/locale-actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const schema = z.object({
  name: z.string().min(1, "Название бизнеса обязательно"),
  // No length cap here: real uploads go through /api/upload and stay short
  // ("/uploads/…"), but existing stores may still have a legacy base64 data
  // URI in this field from before that upload flow existed — a strict cap
  // would silently block saving anything else until the logo is replaced.
  logoUrl: z.string().optional().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Некорректный цвет"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Некорректный цвет"),
  currency: z.string().min(1).max(5),
  currencyDecimals: z.number().int().min(0).max(4),
  taxRate: z.number().min(0).max(100),
  taxName: z.string().min(1),
  language: z.string().min(2).max(10),
  loyaltyEarnRate: z.number().min(0),
  loyaltyRedeemValue: z.number().min(1),
  lowStockThreshold: z.number().int().min(0),
  maxCashierDiscountPercent: z.number().min(0).max(100),
  requireOpenShift: z.boolean().optional(),
  managerPin: z.string().default(""),
  storageProvider: z.string().default("local"),
  storageRegion: z.string().default(""),
  storageBucket: z.string().default(""),
  storageEndpoint: z.string().default(""),
  storageAccessKey: z.string().default(""),
  storageSecretKey: z.string().default(""),
  storagePublicUrl: z.string().default(""),
});

type FormValues = {
  name: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  currency: string;
  currencyDecimals: number;
  taxRate: number;
  taxName: string;
  language: string;
  loyaltyEarnRate: number;
  loyaltyRedeemValue: number;
  lowStockThreshold: number;
  maxCashierDiscountPercent: number;
  requireOpenShift?: boolean;
  managerPin: string;
  storageProvider: string;
  storageRegion: string;
  storageBucket: string;
  storageEndpoint: string;
  storageAccessKey: string;
  storageSecretKey: string;
  storagePublicUrl: string;
};

type LoadedSettings = FormValues & { hasManagerPin: boolean; hasStorageSecretKey: boolean };

/** Управление → Настройки: branding, currency/tax, loyalty rates, low-stock threshold,
 * manager PIN, and image storage — the fields with no other home. Receipt text lives at
 * Управление → Управление чеком, and the pricing/workflow toggles live at
 * Управление → Настройки разрешений; both edit the same BusinessSettings row but through
 * their own dedicated endpoints, so this page never touches those columns. */
export function GeneralSettingsForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [hasManagerPin, setHasManagerPin] = useState(false);
  const [hasStorageSecretKey, setHasStorageSecretKey] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
  });

  useEffect(() => {
    fetch("/api/management/general-settings")
      .then((r) => r.json())
      .then((d: LoadedSettings & { taxRate: string; loyaltyEarnRate: string; loyaltyRedeemValue: string; maxCashierDiscountPercent: string }) => {
        setHasManagerPin(d.hasManagerPin);
        setHasStorageSecretKey(d.hasStorageSecretKey);
        reset({
          name: d.name,
          logoUrl: d.logoUrl ?? "",
          primaryColor: d.primaryColor,
          accentColor: d.accentColor,
          currency: d.currency,
          currencyDecimals: d.currencyDecimals,
          taxRate: parseFloat(d.taxRate) * 100,
          taxName: d.taxName,
          language: d.language,
          loyaltyEarnRate: parseFloat(d.loyaltyEarnRate),
          loyaltyRedeemValue: parseFloat(d.loyaltyRedeemValue),
          lowStockThreshold: d.lowStockThreshold,
          maxCashierDiscountPercent: parseFloat(d.maxCashierDiscountPercent),
          requireOpenShift: d.requireOpenShift,
          managerPin: "",
          storageProvider: d.storageProvider,
          storageRegion: d.storageRegion ?? "",
          storageBucket: d.storageBucket ?? "",
          storageEndpoint: d.storageEndpoint ?? "",
          storageAccessKey: d.storageAccessKey ?? "",
          storageSecretKey: "",
          storagePublicUrl: d.storagePublicUrl ?? "",
        });
      })
      .finally(() => setLoading(false));
  }, [reset]);

  const storageProvider = watch("storageProvider");
  const logoUrl = watch("logoUrl");
  const currency = watch("currency");

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Не удалось загрузить логотип"); return; }
      setValue("logoUrl", d.url, { shouldDirty: true });
    } finally { setUploading(false); }
  }

  async function onSubmit(values: FormValues) {
    try {
      const r = await fetch("/api/management/general-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Не удалось сохранить"); return; }
      await setLocale(values.language);
      toast.success("Сохранено");
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить");
    }
  }

  function field(label: string, name: keyof FormValues, props?: React.InputHTMLAttributes<HTMLInputElement>) {
    const isNum = props?.type === "number";
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{label}</label>
        <input
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...register(name as any, isNum ? { valueAsNumber: true } : undefined)}
          {...props}
          className={cn(
            "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            errors[name] && "border-destructive"
          )}
        />
        {errors[name] && <p className="text-xs text-destructive">{String(errors[name]?.message)}</p>}
      </div>
    );
  }

  if (loading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Business */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Бизнес</h2>
        {field("Название бизнеса *", "name", { placeholder: "Мой магазин" })}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Логотип</label>
          <input type="hidden" {...register("logoUrl")} />
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-16 w-16 rounded-lg border object-contain bg-white" />
            ) : (
              <span className="text-muted-foreground flex h-16 w-16 items-center justify-center rounded-lg border">
                <ImageOff className="h-6 w-6" />
              </span>
            )}
            <input
              ref={logoFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              disabled={uploading}
              className="hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50"
            >
              {uploading ? "Загрузка…" : logoUrl ? "Заменить логотип" : "Загрузить логотип"}
            </button>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Оформление</h2>
        <div className="grid grid-cols-2 gap-4">
          {field("Основной цвет", "primaryColor", { type: "color" })}
          {field("Акцентный цвет", "accentColor", { type: "color" })}
        </div>
      </section>

      {/* Currency & Tax */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Валюта и налог</h2>
        <div className="grid grid-cols-2 gap-4">
          {field("Символ валюты", "currency", { placeholder: "$" })}
          {field("Знаков после запятой", "currencyDecimals", { type: "number", min: "0", max: "4" })}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {field("Ставка налога (%)", "taxRate", { type: "number", step: "0.01", min: "0", max: "100" })}
          {field("Название налога", "taxName", { placeholder: "НДС" })}
        </div>
      </section>

      {/* Language */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Язык</h2>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Язык</label>
          <select
            {...register("language")}
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>

      {/* Loyalty rates — the on/off toggle lives at Настройки разрешений («cashback»);
          this is only the earn/redeem rate, which has no other home. */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Ставки лояльности</h2>
        <div className="grid grid-cols-2 gap-4">
          {field(`Начисление (баллов за ${currency || "1"})`, "loyaltyEarnRate", { type: "number", step: "0.01", min: "0", placeholder: "1" })}
          {field(`Списание (${currency || "1"} за 100 баллов)`, "loyaltyRedeemValue", { type: "number", step: "1", min: "1", placeholder: "100" })}
        </div>
      </section>

      {/* Inventory */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Склад</h2>
        {field("Порог низкого остатка", "lowStockThreshold", { type: "number", min: "0", step: "1", placeholder: "5" })}
        <p className="text-xs text-muted-foreground">Товары с остатком ниже этого значения помечаются как «заканчивается».</p>
      </section>

      {/* Manager controls */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Права менеджера</h2>
        {field("Макс. скидка кассира (%)", "maxCashierDiscountPercent", { type: "number", min: "0", max: "100", step: "1" })}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Требовать открытую смену</p>
            <p className="text-xs text-muted-foreground">Кассир не сможет принять оплату без открытой смены.</p>
          </div>
          <input type="checkbox" {...register("requireOpenShift")} className="h-4 w-4 rounded border-input accent-primary cursor-pointer" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">PIN менеджера</label>
          <input
            {...register("managerPin")}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder={hasManagerPin ? "Установлен — введите новый, чтобы изменить" : "Не установлен"}
            className="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
          <p className="text-xs text-muted-foreground">Требуется для подтверждения возвратов и других действий, ограниченных для кассира.</p>
        </div>
      </section>

      {/* Image Storage */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold border-b pb-2">Хранилище изображений</h2>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Провайдер хранилища</label>
          <select
            {...register("storageProvider")}
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <option value="local">Локально (public/uploads/)</option>
            <option value="vercel_blob">Vercel Blob</option>
            <option value="cloudflare_r2">Cloudflare R2</option>
            <option value="s3">AWS S3</option>
          </select>
          <p className="text-xs text-muted-foreground">Где хранятся изображения товаров после загрузки.</p>
        </div>

        {storageProvider === "local" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
            Файлы сохраняются в public/uploads/ на вашем сервере. Это не работает на бессерверных платформах вроде Vercel — выберите облачный провайдер.
          </div>
        )}

        {(storageProvider === "cloudflare_r2" || storageProvider === "s3") && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {field("Bucket", "storageBucket", { placeholder: "my-bucket" })}
              {field("Регион", "storageRegion", { placeholder: storageProvider === "cloudflare_r2" ? "auto" : "us-east-1" })}
            </div>
            {storageProvider === "cloudflare_r2" &&
              field("Endpoint", "storageEndpoint", { placeholder: "https://<account-id>.r2.cloudflarestorage.com" })
            }
            {field("Access key", "storageAccessKey", { placeholder: "Access key ID", autoComplete: "off" })}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Secret key</label>
              <input
                {...register("storageSecretKey")}
                type="password"
                autoComplete="new-password"
                placeholder={hasStorageSecretKey ? "Сохранён — введите новый, чтобы изменить" : "Введите secret key"}
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              />
            </div>
            {field("Публичный URL", "storagePublicUrl", {
              placeholder: storageProvider === "cloudflare_r2" ? "https://pub-xxx.r2.dev" : "https://cdn.example.com",
              type: "url",
            })}
          </div>
        )}
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-6 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Сохранение…" : "Сохранить настройки"}
        </button>
      </div>
    </form>
  );
}
