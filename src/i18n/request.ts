import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getStoreId } from "@/lib/store-context";

// Only the two complete translations are offered; the other files in messages/ lack ~130 keys and would show raw key names.
const SUPPORTED_LOCALES = ["ru", "en"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function isValidLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export default getRequestConfig(async () => {
  // Try cookie first (fast path — no DB needed on most requests)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("olgax_locale")?.value;
  if (cookieLocale && isValidLocale(cookieLocale)) {
    const messages = (await import(`../../messages/${cookieLocale}.json`)).default;
    return { locale: cookieLocale, messages };
  }

  // Fallback: the market's own language setting. The product is made for Kazakhstan, so a page that has no market (the
  // till screens, sign-in) or a missing setting is Russian, never English.
  let locale: Locale = "ru";
  try {
    const storeId = await getStoreId();
    const settings = await prisma.businessSettings.findUnique({
      where: { storeId },
      select: { language: true },
    });
    const lang = settings?.language ?? "ru";
    if (isValidLocale(lang)) locale = lang;
  } catch {
    // DB not available — use Russian
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
