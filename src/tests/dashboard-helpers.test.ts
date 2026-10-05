import { describe, expect, it } from "vitest";
import { CASHBOX_ONLINE_WINDOW_MS, cashboxLiveState, revenueAxis } from "@/lib/dashboard-helpers";

const NOW = Date.parse("2026-10-05T10:00:00Z");

describe("Кассы card state", () => {
  it("a register switched off is «inactive» whatever else is true", () => {
    expect(cashboxLiveState({ active: false, lastSyncAt: new Date(NOW) }, NOW)).toBe("inactive");
  });
  it("never heard from = not connected", () => {
    expect(cashboxLiveState({ active: true, lastSyncAt: null }, NOW)).toBe("unbound");
  });
  it("heard from within the window = in the network", () => {
    expect(cashboxLiveState({ active: true, lastSyncAt: new Date(NOW - 60_000) }, NOW)).toBe("online");
    expect(cashboxLiveState({ active: true, lastSyncAt: new Date(NOW - CASHBOX_ONLINE_WINDOW_MS) }, NOW)).toBe("online");
  });
  it("silent for longer = not in the network (an ISO string works too)", () => {
    expect(cashboxLiveState({ active: true, lastSyncAt: new Date(NOW - CASHBOX_ONLINE_WINDOW_MS - 1) }, NOW)).toBe("offline");
    expect(cashboxLiveState({ active: true, lastSyncAt: new Date(NOW - 3 * 3600_000).toISOString() }, NOW)).toBe("offline");
  });
});

describe("revenue chart axis", () => {
  it("no sales: only ₸0, no invented ticks", () => {
    expect(revenueAxis([0, 0, 0])).toEqual({ empty: true, ticks: [0] });
    expect(revenueAxis([])).toEqual({ empty: true, ticks: [0] });
  });
  it("any revenue (even a negative day of returns) lets the chart choose its own ticks", () => {
    expect(revenueAxis([0, 120, 0])).toEqual({ empty: false });
    expect(revenueAxis([0, -50])).toEqual({ empty: false });
  });
});
