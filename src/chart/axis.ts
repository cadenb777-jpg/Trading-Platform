/**
 * The time axis, Bloomberg style: major labels are months (daily bars) or days (intraday), times in between, and the
 * year sits on a second row under the first label of each year (yearMarks; drawn by YearRow in axisChrome.ts).
 * Pure, so the label rules are tested in axis.test.ts.
 */

/** Lightweight Charts' TickMarkType values (kept here so this file needs no chart library to test). */
export const TICK = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 } as const;

export interface AxisOptions {
  /** Bars a day or longer: dates are read in UTC (daily bars are stamped near midnight in a US zone). */
  daily: boolean;
  /** Zone for intraday clock times (default: the viewer's own). */
  timeZone?: string;
  /** Several years on screen: year boundaries are labelled with the year itself and the year row is not drawn. */
  years?: boolean;
}

/** Years go into the labels themselves once more than about two and a half years are on screen. */
export const yearsOnAxis = (spanSeconds: number) => spanSeconds > 2.5 * 365 * 86400;

const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat('en-US', options)));
  return f;
}

const zoneOf = (o: AxisOptions) => (o.daily ? 'UTC' : o.timeZone);

/** Year, month (1-12) and day of a time in the axis' zone. */
export function dateParts(t: number, o: AxisOptions): { year: number; month: number; day: number } {
  const parts = fmt(`p:${zoneOf(o) ?? ''}`, { timeZone: zoneOf(o), year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(t * 1000);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const month = (t: number, o: AxisOptions) => fmt(`m:${zoneOf(o) ?? ''}`, { timeZone: zoneOf(o), month: 'short' }).format(t * 1000);
const monthDay = (t: number, o: AxisOptions) => fmt(`md:${zoneOf(o) ?? ''}`, { timeZone: zoneOf(o), month: 'short', day: 'numeric' }).format(t * 1000);
const clock = (t: number, o: AxisOptions, seconds = false) =>
  fmt(`c:${zoneOf(o) ?? ''}:${seconds}`, { timeZone: zoneOf(o), hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(t * 1000);

/**
 * The label for one tick mark. The year never goes in the label itself (it is on the row below), so a year boundary
 * reads "Jan" on daily bars and "Jan 2" intraday. Daily: months, with plain day numbers between them when zoomed in.
 * Intraday: "Nov 4" at each new day, 24-hour clock times between.
 */
export function tickLabel(t: number, type: number, o: AxisOptions): string {
  if (o.years && type === TICK.Year) return String(dateParts(t, o).year);
  if (o.daily) return type === TICK.Year || type === TICK.Month ? month(t, o) : String(dateParts(t, o).day);
  if (type === TICK.Time) return clock(t, o);
  if (type === TICK.TimeWithSeconds) return clock(t, o, true);
  return monthDay(t, o);
}

/** The crosshair's time label, trader style: "Thu 05 Nov 2026" on daily bars, "Thu 05 Nov 14:35" intraday. */
export function crosshairLabel(t: number, o: AxisOptions): string {
  const parts = fmt(`x:${zoneOf(o) ?? ''}`, { timeZone: zoneOf(o), weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(t * 1000);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('weekday')} ${get('day')} ${get('month')}`;
  return o.daily ? `${date} ${get('year')}` : `${date} ${clock(t, o)}`;
}

/** The year in the axis' zone; the zone only matters within a day of New Year, so most bars skip Intl. */
function yearOf(t: number, o: AxisOptions): number {
  const d = new Date(t * 1000);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (zoneOf(o) === 'UTC' || !((m === 0 && day === 1) || (m === 11 && day === 31))) return d.getUTCFullYear();
  return dateParts(t, o).year;
}

export interface YearMark {
  /** Bar index the year label sits under. */
  index: number;
  year: number;
  /** The leftmost visible bar (its year is shown at the left edge, like Bloomberg's "Dec / 2014"). */
  edge: boolean;
}

/**
 * Where the year row's labels go for the bars from `from` to `to` (indexes, inclusive): the first visible bar, then
 * the first bar of every new year after it.
 */
export function yearMarks(times: number[], from: number, to: number, o: AxisOptions): YearMark[] {
  const start = Math.max(0, Math.ceil(from));
  const end = Math.min(times.length - 1, Math.floor(to));
  if (start > end) return [];
  const out: YearMark[] = [{ index: start, year: yearOf(times[start], o), edge: true }];
  let year = out[0].year;
  for (let i = start + 1; i <= end; i++) {
    const y = yearOf(times[i], o);
    if (y !== year) {
      out.push({ index: i, year: y, edge: false });
      year = y;
    }
  }
  return out;
}
