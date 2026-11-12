/**
 * Maths for the Macro page (pure, tested): where a reading sits in its own history, a small trend line, and the
 * growth / inflation regime macro desks use to frame the economy (is each one speeding up or slowing down?).
 */

export interface Point {
  time: string;
  value: number;
}

/** Share of past readings at or below the latest (0-1), over everything since `since`. */
export function percentileNow(data: Point[], since = '2006-01-01'): number | null {
  const vals = data.filter((p) => p.time >= since && Number.isFinite(p.value)).map((p) => p.value);
  if (vals.length < 12) return null;
  const now = vals[vals.length - 1];
  return vals.filter((v) => v <= now).length / vals.length;
}

/** SVG polyline points for a small trend line of the last `days` days in a w x h box. */
export function sparkPoints(data: Point[], w: number, h: number, days = 730, today = new Date()): string {
  const cut = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const pts = data.filter((p) => p.time >= cut && Number.isFinite(p.value));
  if (pts.length < 2) return '';
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  return pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 1 - ((p.value - lo) / span) * (h - 2)).toFixed(1)}`).join(' ');
}

/** The value about `days` before the latest reading (the last one on or before that date). */
export function valueAgo(data: Point[], days: number): number | null {
  if (!data.length) return null;
  const last = new Date(`${data[data.length - 1].time}T00:00:00Z`).getTime();
  const cut = new Date(last - days * 86400000).toISOString().slice(0, 10);
  let best: number | null = null;
  for (const p of data) {
    if (p.time > cut) break;
    best = p.value;
  }
  return best;
}

export type Direction = 'rising' | 'falling' | 'flat';
export interface RegimeInput {
  name: string;
  /** Change over the last ~3 months, in the series' own units. */
  change: number | null;
  /** How big a change counts (in the same units); smaller is "flat". */
  threshold: number;
  /** -1 when a rise means weaker (jobless claims). */
  sign?: 1 | -1;
}
export interface Regime {
  growth: Direction;
  inflation: Direction;
  growthScore: number;
  inflationScore: number;
  label: string;
  meaning: string;
  votes: { name: string; side: 'growth' | 'inflation'; direction: Direction }[];
}

function vote(i: RegimeInput): Direction | null {
  if (i.change == null || !Number.isFinite(i.change)) return null;
  const c = i.change * (i.sign ?? 1);
  return c > i.threshold ? 'rising' : c < -i.threshold ? 'falling' : 'flat';
}

function score(dirs: Direction[]): number {
  return dirs.length ? dirs.reduce((s, d) => s + (d === 'rising' ? 1 : d === 'falling' ? -1 : 0), 0) / dirs.length : 0;
}

/**
 * The regime from 3-month changes: growth (jobs, retail sales, jobless claims, GDP) and inflation (CPI, core PCE,
 * inflation expectations). Each side is the average vote (-1 to +1); beyond +-0.25 it counts as rising/falling.
 * The four quadrants are the usual macro framing (e.g. growth up + inflation down = "goldilocks").
 */
export function regime(growth: RegimeInput[], inflation: RegimeInput[]): Regime {
  const votes: Regime['votes'] = [];
  const g: Direction[] = [], f: Direction[] = [];
  for (const i of growth) {
    const d = vote(i);
    if (d) (g.push(d), votes.push({ name: i.name, side: 'growth', direction: d }));
  }
  for (const i of inflation) {
    const d = vote(i);
    if (d) (f.push(d), votes.push({ name: i.name, side: 'inflation', direction: d }));
  }
  const gs = score(g), fs = score(f);
  const dir = (s: number): Direction => (s > 0.25 ? 'rising' : s < -0.25 ? 'falling' : 'flat');
  const growthDir = dir(gs), inflDir = dir(fs);
  const up = growthDir !== 'falling';
  const hot = inflDir === 'rising';
  const [label, meaning] = up
    ? hot
      ? ['Reflation', 'Growth and inflation both picking up: historically better for commodities, value and cyclical stocks; rate-cut hopes fade.']
      : ['Goldilocks', 'Growth holding up while inflation cools: historically the friendliest mix for stocks and for bonds.']
    : hot
      ? ['Stagflation risk', 'Growth slowing while inflation rises: historically the hardest mix for both stocks and bonds; cash and real assets held up best.']
      : ['Disinflationary slowdown', 'Growth and inflation both cooling: historically good for Treasuries and defensive stocks; rate cuts get priced in.'];
  return { growth: growthDir, inflation: inflDir, growthScore: gs, inflationScore: fs, label, meaning, votes };
}
