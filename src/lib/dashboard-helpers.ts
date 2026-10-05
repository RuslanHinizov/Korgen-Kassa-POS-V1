/** Small pure helpers of the Главная page (kept apart so they can be tested without a database). */

/** A till counts as "in the network" when it last talked to the server this recently (it syncs at least every few minutes). */
export const CASHBOX_ONLINE_WINDOW_MS = 10 * 60 * 1000;

export type CashboxLiveState = "inactive" | "online" | "offline" | "unbound";

/**
 * What the Кассы card says about a register: switched off in the admin, never connected, or connected and heard from lately.
 * "active" alone only means the register is enabled — not that a till is installed or reachable.
 */
export function cashboxLiveState(c: { active: boolean; lastSyncAt: Date | string | null }, now = Date.now()): CashboxLiveState {
  if (!c.active) return "inactive";
  if (!c.lastSyncAt) return "unbound";
  const last = new Date(c.lastSyncAt).getTime();
  return Number.isFinite(last) && now - last <= CASHBOX_ONLINE_WINDOW_MS ? "online" : "offline";
}

/**
 * Y axis of the revenue chart. With no sales at all the axis would invent ticks like ₸1…₸4; show only ₸0 then.
 * Days with returns can be negative, so the lower end follows the data.
 */
export function revenueAxis(values: number[]): { empty: boolean; ticks?: number[] } {
  const empty = values.every((v) => !v);
  return empty ? { empty: true, ticks: [0] } : { empty: false };
}
