"use server";

import { cookies, headers } from "next/headers";

const SUPPORTED_LOCALES = ["ru", "en"];

export async function setLocale(locale: string) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;

  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);

  cookieStore.set("olgax_locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    // Docker runs Next in production mode even when the browser reaches it over
    // http://localhost. Secure cookies are discarded in that environment.
    secure:
      !isLocalhost && (forwardedProtocol === "https" || process.env.NODE_ENV === "production"),
  });
}
