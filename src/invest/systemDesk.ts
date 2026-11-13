/**
 * Credit and reserves (helper 67, engine/creditdesk.py `bonds.system`): bank reserves vs GDP against the level where
 * money markets broke in September 2019, the commercial paper spread over T-bills and banks' lending standards.
 * Types and readings, pure and tested (systemDesk.test.ts); drawing in systemDeskView.ts.
 */

import { bn, yearOf as yr } from './moneyDesk';

export interface Reserves {
  date: string;
  reserves: number;
  ratio: number;
  /** The quarter's GDP isn't published yet: estimated from the last published quarter's growth. */
  gdpEstimated: boolean;
  gdpQuarter: string;
  stressRatio: number | null;
  stressDate: string;
  aboveStress: number | null;
  ratio3m: number | null;
  ratio12m: number | null;
  from: string;
  series: { date: string; ratio: number }[];
}
export interface Paper {
  date: string;
  cp: number;
  bill: number;
  spreadBp: number;
  percentile: number | null;
  monthAgoBp: number | null;
  high1yBp: number;
  stressed: boolean;
  from: string;
  series: { date: string; spreadBp: number }[];
}
export interface Lending {
  date: string;
  netTightening: number;
  previous: number | null;
  percentile: number | null;
  reading: 'tightening' | 'easing' | 'about steady';
  from: string;
  series: { date: string; net: number }[];
}
export interface SystemReply {
  reserves: Reserves | null;
  paper: Paper | null;
  lending: Lending | null;
  notes: string[];
  sources: Record<'reserves' | 'paper' | 'lending', { name: string; url: string }>;
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function reservesWords(r: Reserves): string {
  const level = `Banks hold ${bn(r.reserves / 1e9)} of reserves at the Fed, ${r.ratio.toFixed(1)}% of the economy (GDP).`;
  if (!ok(r.stressRatio) || !ok(r.aboveStress)) return level;
  const when = monthYear(r.stressDate);
  if (r.aboveStress >= 0)
    return `${level} That is ${bn(Math.abs(r.aboveStress))} above the level of ${when} (${r.stressRatio.toFixed(1)}% of GDP), when overnight money markets broke.`;
  return `${level} That is ${bn(Math.abs(r.aboveStress))} below the level of ${when} (${r.stressRatio.toFixed(1)}% of GDP), when overnight money markets broke: reserves are scarce by that yardstick.`;
}

export function trendWords(r: Reserves): string {
  if (!ok(r.ratio12m)) return '';
  const d = r.ratio - r.ratio12m;
  if (Math.abs(d) < 0.05) return 'About the same share of GDP as a year ago.';
  return `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d).toFixed(1)} points of GDP in a year.`;
}

export function paperWords(p: Paper): string {
  const s = Math.round(p.spreadBp);
  const rel = s === 0 ? 'the same as' : s > 0 ? `${s} bp more than` : `${-s} bp less than`;
  const base = `Big financial companies borrow for 3 months at ${p.cp.toFixed(2)}%, ${rel} the Treasury (3-month bill ${p.bill.toFixed(2)}%).`;
  if (p.stressed) return `${base} Higher than on ${Math.round(p.percentile ?? 0)}% of days since ${yr(p.from)}: short-term credit is under stress, as in 2007, 2008 and March 2020.`;
  if (ok(p.percentile) && p.percentile <= 5) return `${base} Lower than on ${100 - Math.round(p.percentile)}% of days since ${yr(p.from)}: lenders ask almost nothing extra for company paper over T-bills.`;
  return `${base} In its usual range: no sign of short-term credit stress.`;
}

export function lendingWords(l: Lending): string {
  const v = l.netTightening;
  const what = v > 0 ? `A net ${v.toFixed(1)}% of banks tightened` : v < 0 ? `A net ${Math.abs(v).toFixed(1)}% of banks eased` : 'As many banks eased as tightened';
  const prev = ok(l.previous) ? ` (previous survey: ${l.previous > 0 ? '+' : l.previous < 0 ? '−' : ''}${Math.abs(l.previous).toFixed(1)}%)` : '';
  const read = l.reading === 'tightening' ? ' Broad tightening like this has come before weaker lending and wider credit spreads.' : l.reading === 'easing' ? ' Banks are loosening: credit is getting easier to get.' : ' About steady.';
  return `${what} their standards for loans to large and mid-sized companies in the ${monthYear(l.date)} survey${prev}.${read}`;
}
