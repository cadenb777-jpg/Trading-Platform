/**
 * The crosshair's time label, trader style. (The time-axis labels and the year row are drawn by the square grid,
 * src/chart/grid.ts, at its vertical lines.) Pure, tested in chartFeel.test.ts.
 */

export interface AxisOptions {
  /** Bars a day or longer: dates are read in UTC (daily bars are stamped near midnight in a US zone). */
  daily: boolean;
  /** Zone for intraday clock times (default: the viewer's own). */
  timeZone?: string;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat('en-US', options)));
  return f;
}

const zoneOf = (o: AxisOptions) => (o.daily ? 'UTC' : o.timeZone);

/** "Thu 05 Nov 2026" on daily bars, "Thu 05 Nov 14:35" intraday. */
export function crosshairLabel(t: number, o: AxisOptions): string {
  const zone = zoneOf(o);
  const parts = fmt(`x:${zone ?? ''}`, { timeZone: zone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t * 1000);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('weekday')} ${get('day')} ${get('month')}`;
  return o.daily ? `${date} ${get('year')}` : `${date} ${get('hour')}:${get('minute')}`;
}
