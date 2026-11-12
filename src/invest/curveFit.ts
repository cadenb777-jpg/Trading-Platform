/**
 * Bonds → What the curve says: types and plain-language readings for helper `bonds.curvefit` (engine/curvefit.py:
 * Nelson-Siegel-Svensson fit to Treasury par yields, rich/cheap gaps against each maturity's own year, forwards,
 * breakevens and the yield-curve recession probit). Pure and tested (curveFit.test.ts); drawing is in curveView.ts.
 */

export interface CurveRow {
  label: string;
  years: number;
  /** Treasury's par yield, %. */
  yield: number;
  /** The fitted curve's par yield, %. */
  fitted: number;
  /** yield − fitted, basis points (positive = above the curve = cheap). */
  gapBp: number;
  /** The same maturity's average gap over the last year (weekly samples), bp. */
  usualBp: number | null;
  sdBp: number | null;
  z: number | null;
  days: number;
  reading: string;
}
export interface CurvePoint {
  years: number;
  par: number;
  zero: number;
  forward: number;
}
export interface Forward {
  from: number;
  to: number;
  label: string;
  rate: number;
  monthAgo: number | null;
}
export interface Breakeven {
  label: string;
  nominal: number;
  real: number;
  breakeven: number;
  monthAgo: number | null;
}
export interface RecessionEpisode {
  from: string;
  to: string;
  recession: boolean;
  judged: boolean;
}
export interface Recession {
  probability: number | null;
  spread: number | null;
  monthDays: number;
  month: string;
  a: number;
  b: number;
  n: number;
  /** Out of sample: refitted each January on what was known then (engine/curvefit.py recession_model). */
  auc: number | null;
  /** The first month scored out of sample. */
  testFrom: string;
  fitFrom: string;
  fitTo: string;
  history: { month: string; spread: number; p: number }[];
  record: { recessions: { start: string; flagged: boolean }[]; falseAlarms: RecessionEpisode[]; open: RecessionEpisode[] };
  alarm: number;
}
export interface CurveFit {
  date: string;
  rmseBp: number;
  fittedDays: number;
  rows: CurveRow[];
  curve: CurvePoint[];
  forwards: Forward[];
  monthAgoDate: string | null;
  breakevens: Breakeven[];
  realDate: string | null;
  recession: Recession | null;
  richest: { label: string; z: number; gapBp: number } | null;
  cheapest: { label: string; z: number; gapBp: number } | null;
  notes: string[];
  sources: { name: string; asOf: string | null; url: string }[];
}

/** The engine's threshold for "unusual" (engine/curvefit.py UNUSUAL_Z). */
export const UNUSUAL_Z = 2.5;

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** "+6.2 bp" / "−3.0 bp" / "0.0 bp". */
export function bp(v: number | null | undefined, digits = 1): string {
  if (!ok(v)) return '—';
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)} bp`;
}

/** A change in percentage points shown as basis points ("−11 bp"). */
export function changeBp(now: number, then: number | null): string {
  return ok(then) ? bp((now - then) * 100, 0) : '—';
}

export const pct2 = (v: number | null | undefined) => (ok(v) ? `${v.toFixed(2)}%` : '—');

/** Maturities sitting unusually far from the curve, most unusual first. */
export function standouts(rows: CurveRow[]): CurveRow[] {
  return rows.filter((r) => ok(r.z) && Math.abs(r.z) >= UNUSUAL_Z).sort((a, b) => Math.abs(b.z!) - Math.abs(a.z!));
}

/** "rich" / "cheap" for a row's direction (yield below the curve = price high = rich). */
export const side = (r: { gapBp: number }) => (r.gapBp < 0 ? 'rich' : 'cheap');

/** One sentence on the curve's shape: 10-year minus 2-year, the slope desks quote first. */
export function shapeWords(rows: CurveRow[]): string {
  const two = rows.find((r) => r.label === '2Y');
  const ten = rows.find((r) => r.label === '10Y');
  if (!two || !ten) return '';
  const s = Math.round((ten.yield - two.yield) * 100);
  if (Math.abs(s) < 10) return `Nearly flat: the 10-year pays ${Math.abs(s)} bp ${s >= 0 ? 'more' : 'less'} than the 2-year.`;
  return s > 0 ? `Upward sloping: the 10-year pays ${s} bp more than the 2-year.` : `Inverted: the 10-year pays ${-s} bp less than the 2-year.`;
}

/** The headline about rich and cheap maturities. */
export function standoutWords(rows: CurveRow[]): string {
  const s = standouts(rows);
  if (!rows.some((r) => ok(r.z))) return 'Each maturity is compared with its own last year once there are 26 weeks of fits.';
  if (!s.length) return 'Every maturity sits within its usual distance of the fitted curve.';
  return s.map((r) => `${r.label} is unusually ${side(r)} (${bp(r.gapBp)} off the curve, usually ${bp(r.usualBp)})`).join('; ') + '.';
}

/** How the recession model has done, in one sentence. */
export function recordWords(rec: Recession): string {
  const r = rec.record;
  const flagged = r.recessions.filter((x) => x.flagged).length;
  const fa = r.falseAlarms;
  const last = fa[fa.length - 1];
  const alarm = Math.round(rec.alarm * 100);
  return (
    `Tested since ${rec.testFrom.slice(0, 4)} using only what was known at the time: its odds reached ${alarm}% before ${flagged} of ${r.recessions.length} recessions` +
    (fa.length ? `, with ${fa.length} false alarm${fa.length > 1 ? 's' : ''}${last ? ` (latest ${monthName(last.from)}–${monthName(last.to)})` : ''}.` : ' and no false alarms.')
  );
}

export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "Low", "Moderate", "High" for the recession odds. */
export function oddsWord(p: number): string {
  return p < 0.2 ? 'Low' : p < 0.4 ? 'Moderate' : 'High';
}

/** A range bar's geometry on a shared scale: where the usual band (mean ± 2.5 SD) and today's gap sit, 0-100. */
export function gapScale(rows: CurveRow[]): (v: number) => number {
  const ext = rows.flatMap((r) => [Math.abs(r.gapBp), ok(r.usualBp) && ok(r.sdBp) ? Math.abs(r.usualBp) + UNUSUAL_Z * r.sdBp : 0]);
  const m = Math.max(5, ...ext.filter(ok)) * 1.08;
  return (v: number) => Math.min(100, Math.max(0, 50 + (v / m) * 50));
}

/** The Home "Edge today" line (src/home/edge.ts): recession odds plus the most unusual maturity. */
export function curveEdgeLine(d: CurveFit | null) {
  const rec = d?.recession;
  if (!d || !rec || !ok(rec.probability)) return null;
  const s = standouts(d.rows)[0];
  const spread = ok(rec.spread) ? `10y − 3m ${rec.spread >= 0 ? '+' : '−'}${Math.abs(rec.spread).toFixed(2)} pts` : '';
  return {
    label: 'Recession odds, next 12 months',
    value: `${Math.round(rec.probability * 100)}%`,
    tone: (rec.probability >= 0.4 ? 'down' : '') as 'down' | '',
    detail: [spread, s ? `${s.label} unusually ${side(s)} vs the curve` : 'no maturity unusually off the curve'].filter(Boolean).join(' · '),
    href: '#invest/bonds/curve',
    source: `U.S. Treasury yield curve ${d.date}, FRED, yield-curve probit`,
  };
}
