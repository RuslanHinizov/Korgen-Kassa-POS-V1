"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getSession } from "@/lib/auth-client";
import { Eye, EyeOff } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";

const WHATSAPP_CONTACTS = [
  { name: "Жандос", phone: "77756131326", label: "+7 775 613 13 26" },
  { name: "Руслан", phone: "77759897660", label: "+7 775 989 76 60" },
];

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.84 9.84 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 5.83 2.42 8.2 8.2 0 0 1 2.41 5.83c0 4.55-3.7 8.23-8.25 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.23-.16-.48-.29z" />
    </svg>
  );
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/login/phone", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim(), password: password.trim() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? t("sign_in_failed"));
      setLoading(false);
      return;
    }

    const session = await getSession();
    // This is the office/account entrance. Cashiers may use it to view their
    // own profile, but the dedicated /kasa-giris screen is the only entrance
    // to the cash register itself.
    window.location.href = session.data?.user.role === "CASHIER" ? "/profile" : "/";
  }

  const inputClass =
    "flex h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#15503A] focus:bg-white focus:ring-2 focus:ring-[#15503A]/10 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-slate-50 px-4">
      {/* Soft decorative blob */}
      <div
        className="pointer-events-none fixed top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #15503A 0%, transparent 70%)" }}
      />
      <div
        className="pointer-events-none fixed bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #22B24C 0%, transparent 70%)" }}
      />

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="rounded-3xl border border-gray-100 bg-white px-8 py-10 shadow-xl shadow-gray-200/80 space-y-7">
          {/* Logo / Brand */}
          <div className="flex flex-col items-center space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/korgen-kassa-mark.png"
              alt="Korgen Kassa POS"
              className="h-16 w-16 rounded-2xl shadow-md shadow-gray-200 bg-white object-contain"
            />
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-[#15503A]">Korgen Kassa POS</h1>
              <p className="text-sm text-gray-500 mt-0.5">Вход в офис и управление</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Номер телефона
              </label>
              <PhoneInput id="phone" required value={phone} onChange={setPhone} className={inputClass} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {t("password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                  tabIndex={-1}
                  aria-label={showPassword ? t("hide_password") : t("show_password")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#15503A] px-4 py-2 text-sm font-bold text-white shadow-md shadow-[#15503A]/30 transition-all hover:bg-[#1a6349] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22B24C] disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? t("signing_in") : t("sign_in")}
            </button>
          </form>
        </div>

        {/* Help: two WhatsApp chats of the people who set the system up */}
        <div className="mt-5 flex items-center justify-center gap-3">
          {WHATSAPP_CONTACTS.map((c) => (
            <a
              key={c.phone}
              href={`https://wa.me/${c.phone}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp: ${c.name} ${c.label}`}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pr-4 pl-1.5 shadow-sm transition hover:border-[#25D366] hover:shadow"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366]"><WhatsAppIcon /></span>
              <span className="text-left leading-tight"><span className="block text-xs font-semibold text-[#15503A]">{c.name}</span><span className="block text-xs text-gray-500">{c.label}</span></span>
            </a>
          ))}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400">
          {t("footer")}
        </p>
      </div>
    </div>
  );
}
