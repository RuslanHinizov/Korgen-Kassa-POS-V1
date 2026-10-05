import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { cookie: undefined as string | undefined, settings: null as { language: string } | null, dbDown: false };

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "olgax_locale" && state.cookie ? { value: state.cookie } : undefined) }) }));
vi.mock("@/lib/store-context", () => ({ getStoreId: async () => "s1" }));
vi.mock("@/lib/db", () => ({
  prisma: { businessSettings: { findUnique: async () => { if (state.dbDown) throw new Error("db down"); return state.settings; } } },
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));

async function localeOf() {
  const mod = (await import("@/i18n/request")) as unknown as { default: () => Promise<{ locale: string }> };
  return (await mod.default()).locale;
}

describe("language of a page", () => {
  beforeEach(() => { state.cookie = undefined; state.settings = null; state.dbDown = false; vi.resetModules(); });

  it("no cookie and no market settings (till screens, sign-in): Russian, not English", async () => {
    expect(await localeOf()).toBe("ru");
  });
  it("database unreachable: Russian", async () => {
    state.dbDown = true;
    expect(await localeOf()).toBe("ru");
  });
  it("the market's own language wins", async () => {
    state.settings = { language: "en" };
    expect(await localeOf()).toBe("en");
  });
  it("a language that is not fully translated is not offered: it falls back to Russian", async () => {
    state.settings = { language: "de" };
    expect(await localeOf()).toBe("ru");
    state.cookie = "de";
    expect(await localeOf()).toBe("ru");
  });
  it("the cookie of a complete language is used", async () => {
    state.cookie = "en";
    expect(await localeOf()).toBe("en");
  });
});
