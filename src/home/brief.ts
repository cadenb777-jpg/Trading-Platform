/**
 * The morning brief's maths (Home): my accounts' value, today's change and biggest movers; the alerts that need
 * attention (fired recently or close to firing); the setups at their entry; today's events that matter. Pure and
 * tested (brief.test.ts); src/home/morningBrief.ts draws it.
 */
import type { HelperAlert } from '../ui/alertsLogic';
import { combinedValue, todayChange, type CombinedHolding } from '../portfolio/account';
import { dayTotal } from '../portfolio/returns';
import { entryZone } from './entryZone';
import type { Setup } from './setupsPanel';

export interface PriceLike {
  price: number | null;
  /** Today's change as a fraction (0.01 = +1%). */
  change?: number | null;
}

export interface Mover {
  symbol: string;
  value: number;
  /** Dollars today and the % move. */
  today: number;
  pct: number;
}

export interface AccountsBrief {
  total: number | null;
  today: number | null;
  todayPct: number | null;
  /** Holdings that moved the most in dollars today (up to `max`). */
  movers: Mover[];
  /** Holdings with no live price yet (left out of the total). */
  unpriced: string[];
}

export function accountsBrief(rows: CombinedHolding[], prices: Record<string, PriceLike | undefined>, max = 3): AccountsBrief {
  let total = 0;
  const moved: { value: number; today: number }[] = [];
  const movers: Mover[] = [];
  const unpriced: string[] = [];
  for (const r of rows) {
    const info = prices[r.symbol];
    const value = combinedValue(r, info?.price);
    if (value == null) {
      unpriced.push(r.symbol);
      continue;
    }
    total += value;
    if (!r.shares) continue; // cash and dollar amounts don't move with a quote
    const sharesValue = r.shares * (info!.price as number);
    const d = todayChange(sharesValue, info?.change);
    if (d == null) continue;
    moved.push({ value: sharesValue, today: d });
    movers.push({ symbol: r.symbol, value, today: d, pct: (info!.change as number) * 100 });
  }
  movers.sort((a, b) => Math.abs(b.today) - Math.abs(a.today) || a.symbol.localeCompare(b.symbol));
  const has = rows.length > unpriced.length;
  // Same as the Account page: today's % is of yesterday's value of the holdings that have a quote (cash left out).
  const day = dayTotal(moved);
  return {
    total: has ? total : null,
    today: day.usd,
    todayPct: day.pct != null ? day.pct * 100 : null,
    movers: movers.filter((m) => m.today !== 0).slice(0, max),
    unpriced,
  };
}

/** How close (as a share of the price) a price alert must be to count as "near". */
export const NEAR_ALERT = 0.02;
/** Fired alerts stay on the brief for this long. */
export const FIRED_WINDOW_S = 24 * 3600;

export interface AlertItem {
  id: string;
  symbol: string;
  kind: 'fired' | 'near';
  text: string;
  /** For fired: unix seconds; for near: the distance as a share of the price. */
  at?: number;
  distance?: number;
}

/** Alerts that fired in the last day (newest first), then active price alerts within NEAR_ALERT of the price (closest first). */
export function alertAttention(alerts: HelperAlert[], prices: Record<string, number | null | undefined>, nowS: number, describe: (a: HelperAlert) => string): AlertItem[] {
  const fired = alerts
    .filter((a) => a.firedAt != null && nowS - a.firedAt <= FIRED_WINDOW_S && nowS >= a.firedAt - 60)
    .sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0))
    .map((a): AlertItem => ({ id: a.id, symbol: a.symbol, kind: 'fired', text: describe(a), at: a.firedAt }));
  const firedIds = new Set(fired.map((f) => f.id));
  const near = alerts
    .filter((a) => a.active && a.kind === 'price' && a.price != null && !firedIds.has(a.id))
    .flatMap((a): AlertItem[] => {
      const p = prices[a.symbol];
      if (!(p != null && p > 0)) return [];
      // still to fire: below the "rises to" level, or above the "falls to" level
      const gap = a.condition === 'below' ? (p - a.price!) / p : (a.price! - p) / p;
      return gap >= 0 && gap <= NEAR_ALERT ? [{ id: a.id, symbol: a.symbol, kind: 'near', text: describe(a), distance: gap }] : [];
    })
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  return [...fired, ...near];
}

export interface ReadySetup {
  setup: Setup;
  horizon: string;
  zone: 'entry' | 'approaching';
  label: string;
}

/** A and B buy setups (not forming, not already in) whose price is at the entry or getting close, best grade first; entry before approaching. */
export function readySetups(byHorizon: Partial<Record<string, { setups: Setup[] }>>, today?: string, max = 4): ReadySetup[] {
  const out: ReadySetup[] = [];
  for (const [horizon, hr] of Object.entries(byHorizon)) {
    for (const s of hr?.setups ?? []) {
      // buys only: the platform never sells short, so a sell setup isn't something to act on here
      if (s.direction <= 0 || !(s.tier === 'A' || s.tier === 'B') || s.status === 'forming' || s.trade) continue;
      const z = entryZone(s, s.price, today);
      if (z.zone === 'entry' || z.zone === 'approaching') out.push({ setup: s, horizon, zone: z.zone, label: z.label });
    }
  }
  const tier = { A: 0, B: 1, C: 2 } as const;
  return out.sort((a, b) => Number(a.zone !== 'entry') - Number(b.zone !== 'entry') || tier[a.setup.tier ?? 'C'] - tier[b.setup.tier ?? 'C'] || b.setup.score - a.setup.score).slice(0, max);
}

export interface CalEvent {
  time: number;
  country: string;
  impact: string;
  title: string;
}

/** High-impact US events from an hour ago to the end of the local day (what can move markets today). */
export function todaysEvents<T extends CalEvent>(events: T[], now: Date): T[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000;
  const from = now.getTime() / 1000 - 3600;
  return events.filter((e) => e.country === 'USD' && e.impact === 'high' && e.time >= from && e.time < end).sort((a, b) => a.time - b.time);
}

/** Seconds after which Home reloads its brief when it is shown again. */
export const BRIEF_STALE_S = 120;

/** Whether Home should (re)load the brief now: connected, and never loaded or older than BRIEF_STALE_S. */
export function briefNeedsLoad(loadedAtS: number, nowS: number, connected: boolean, staleS = BRIEF_STALE_S): boolean {
  return connected && (!loadedAtS || nowS - loadedAtS >= staleS);
}
