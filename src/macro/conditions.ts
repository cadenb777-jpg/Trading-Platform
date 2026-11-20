/**
 * Macro → Right now: this quarter's growth nowcast and financial conditions. Pure and tested (conditions.test.ts);
 * drawn in conditionsView.ts from FRED series the helper already serves raw (macro.series): GDPNOW, A191RL1Q225SBEA,
 * NFCI and ANFCI. No helper change.
 *
 * GDP nowcast: the Atlanta Fed's GDPNow, a running model estimate of this quarter's real GDP growth (annualised) built
 * from the month's data releases as they come out (Higgins, "GDPNow: A Model for GDP 'Nowcasting'", Federal Reserve Bank
 * of Atlanta Working Paper 2014-7). FRED keeps the latest estimate for each quarter; its record here is measured
 * against today's revised official figures, so it includes revisions the model could not have known.
 *
 * Financial conditions: the Chicago Fed's National Financial Conditions Index, a weighted average of 105 measures of
 * risk, credit and leverage, scaled so zero is the average since 1971 and below zero is looser than average (Brave and
 * Butters, "Monitoring Financial Stability: A Financial Conditions Index Approach", Economic Perspectives 35, 2011).
 * ANFCI removes the part explained by the economy and inflation. Readings, not signals.
 */
import type { MonthPoint } from './sahm';

export type Point = MonthPoint;

/** 'Q4 2026' for a quarter's first day ('2026-10-01'). */
export function quarterLabel(iso: string): string {
  return `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(0, 4)}`;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Nowcast {
  /** quarter of the newest nowcast (first day) */
  quarter: string;
  value: number;
  /** the newest official quarter (null when the official series couldn't be loaded) */
  official: Point | null;
  /** the nowcast is for a quarter without an official figure yet; null = unknown (no official series) */
  running: boolean | null;
  /** quarters with both, and the median gap between them (points) */
  record: { n: number; medianMiss: number } | null;
}

/** gdp null = the official series couldn't be loaded (whether the quarter is still running is then unknown). */
export function nowcast(gdpnow: Point[], gdp: Point[] | null): Nowcast | null {
  if (!gdpnow.length) return null;
  const latest = gdpnow[gdpnow.length - 1];
  const official = gdp?.length ? gdp[gdp.length - 1] : null;
  const byDate = new Map((gdp ?? []).map((p) => [p.time, p.value]));
  const misses = gdpnow.filter((p) => byDate.has(p.time)).map((p) => Math.abs(p.value - byDate.get(p.time)!));
  const m = median(misses);
  return {
    quarter: latest.time,
    value: latest.value,
    official,
    running: official ? latest.time > official.time : null,
    record: m == null ? null : { n: misses.length, medianMiss: m },
  };
}

/** v rounded to `d` decimals the way it is printed (toFixed on the size, then the sign): the one rounding rule for
 * figures, signs, sides and badges, so -0.005 is -0.01 everywhere and -0.004 is 0 everywhere. */
export function rounded(v: number, d: number): number {
  const t = Number(Math.abs(v).toFixed(d));
  return t === 0 ? 0 : v < 0 ? -t : t;
}

/** A figure to `d` decimals with a real minus sign (never −0.0). */
export function signed(v: number, d: number): string {
  const r = rounded(v, d);
  return `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
}
const pc = (v: number) => `${signed(v, 1)}%`;

export function nowcastWords(n: Nowcast): string {
  let t =
    n.running === true
      ? `The Atlanta Fed’s GDPNow model puts real growth in ${quarterLabel(n.quarter)} at ${pc(n.value)} a year, from the data out so far; the official figure comes about a month after the quarter ends.`
      : n.running === false
        ? `GDPNow’s last estimate for ${quarterLabel(n.quarter)} was ${pc(n.value)} a year; the official figure is out.`
        : `The Atlanta Fed’s GDPNow model’s latest estimate for ${quarterLabel(n.quarter)} is ${pc(n.value)} a year.`;
  if (n.official) t += ` The newest official figure: ${pc(n.official.value)} for ${quarterLabel(n.official.time)}.`;
  if (n.record) t += ` Over ${n.record.n} quarters its final estimate has been ${n.record.medianMiss.toFixed(1)} points away from today’s official figures in a typical (median) quarter, so read it as a range, not a point.`;
  return t;
}

export interface Conditions {
  date: string;
  value: number;
  /** first week loaded (FRED via the helper starts in 2006, not 1971) */
  since: string;
  /** weeks loaded, and how many were looser / tighter than today (ties are neither) */
  weeks: number;
  looser: number;
  tighter: number;
  change13w: number | null;
  /** the adjusted index (ANFCI) on the same date, when FRED has it */
  adjusted: number | null;
}

/** Value n weeks before the newest (weekly series; by position, so a missing week shortens the gap). */
const ago = (xs: Point[], n: number) => (xs.length > n ? xs[xs.length - 1].value - xs[xs.length - 1 - n].value : null);

export function conditions(nfci: Point[], anfci: Point[]): Conditions | null {
  if (!nfci.length) return null;
  const latest = nfci[nfci.length - 1];
  const looser = nfci.filter((p) => p.value < latest.value).length;
  const tighter = nfci.filter((p) => p.value > latest.value).length;
  const adj = anfci.find((p) => p.time === latest.time);
  return {
    date: latest.time,
    value: latest.value,
    since: nfci[0].time,
    weeks: nfci.length,
    looser,
    tighter,
    change13w: ago(nfci, 13),
    adjusted: adj ? adj.value : null,
  };
}

/** Plain words: zero is the index's own average since 1971 (its design); the share of weeks is over the weeks loaded. */
export function conditionsWords(c: Conditions, day: (iso: string) => string): string {
  const v = rounded(c.value, 2);
  const side = v < 0 ? 'looser than' : v > 0 ? 'tighter than' : 'at';
  const from = c.since.slice(0, 4);
  let t = `In the week to ${day(c.date)} the Chicago Fed’s index stood at ${signed(c.value, 2)}: money and credit were ${side} the index’s average since 1971 (zero).`;
  const looserPct = Math.round((c.looser / c.weeks) * 100);
  const tighterPct = Math.round((c.tighter / c.weeks) * 100);
  t +=
    c.looser === 0
      ? ` No week since ${from} was looser.`
      : c.tighter === 0
        ? ` No week since ${from} was tighter.`
        : looserPct <= 10
          ? ` Only ${Math.max(1, looserPct)}% of weeks since ${from} were looser.`
          : tighterPct <= 10
            ? ` Only ${Math.max(1, tighterPct)}% of weeks since ${from} were tighter.`
            : ` ${looserPct}% of weeks since ${from} were looser, so it sits within its usual range.`;
  if (c.change13w != null) {
    const d = c.change13w;
    t += Math.abs(d) < 0.05 ? ' Little changed over the last 13 weeks.' : ` Over the last 13 weeks conditions ${d < 0 ? 'eased' : 'tightened'} by ${Math.abs(d).toFixed(2)}.`;
  }
  if (c.adjusted != null) {
    const a = rounded(c.adjusted, 2);
    t += ` Allowing for the state of the economy (ANFCI), ${a < 0 ? 'looser' : a > 0 ? 'tighter' : 'average'} too, at ${signed(c.adjusted, 2)}.`;
  }
  return t;
}
