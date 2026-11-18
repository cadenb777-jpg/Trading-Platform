/**
 * 12-hour or 24-hour clock for chart times (axis labels, crosshair, legend). 12-hour by default; the choice is kept
 * per browser and every chart repaints when it changes (event `tp:clock`). Pure formatting is tested.
 */
export type Clock = '12h' | '24h';
const KEY = 'tp-clock';

let current: Clock | null = null;

export function getClock(): Clock {
  if (current) return current;
  try {
    current = localStorage.getItem(KEY) === '24h' ? '24h' : '12h';
  } catch {
    current = '12h';
  }
  return current;
}

export function setClock(c: Clock) {
  current = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // private window: this visit only
  }
  window.dispatchEvent(new CustomEvent('tp:clock', { detail: c }));
}

/** "9:30 AM" / "12:00 PM" on the 12-hour clock, "09:30" on the 24-hour clock. */
export function clockText(hour: number, minute: number, clock: Clock = getClock()): string {
  const mm = String(minute).padStart(2, '0');
  if (clock === '24h') return `${String(hour).padStart(2, '0')}:${mm}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The exchange's own clock for US stocks (Bloomberg shows exchange time; the status bar says "NY"). */
export const MARKET_ZONE = 'America/New_York';
/** Time zone a chart's intraday times are shown in: New York for US stocks, the viewer's own clock otherwise. */
export const chartTimeZone = (market: string): string | undefined => (market === 'schwab' ? MARKET_ZONE : undefined);
/** "ET" after New York clock times so nobody reads them as local time. */
export const zoneTag = (tz: string | undefined) => (tz === MARKET_ZONE ? ' ET' : '');

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
const zoneMemo = new Map<string, { y: number; mo: number; d: number; h: number; mi: number; wd: number }>();
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar parts of a moment in a time zone (undefined = the viewer's own), memoised for the chart grid. */
export function zonedParts(ms: number, tz?: string): { y: number; mo: number; d: number; h: number; mi: number; wd: number } {
  if (!tz) {
    const d = new Date(ms);
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), wd: d.getDay() };
  }
  const key = `${tz}|${ms}`;
  const hit = zoneMemo.get(key);
  if (hit) return hit;
  let f = zoneFormats.get(tz);
  if (!f) zoneFormats.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' })));
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const out = { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), wd: WD[p.weekday] ?? 0 };
  if (zoneMemo.size > 60000) zoneMemo.clear();
  zoneMemo.set(key, out);
  return out;
}

/** "9:30 AM" in a time zone. */
export const zonedClock = (ms: number, tz?: string) => {
  const p = zonedParts(ms, tz);
  return clockText(p.h, p.mi);
};
