/**
 * Peers (Bloomberg RV, owner's spec 7.17): the company first, its peers below, the peer median and average at the
 * bottom, and a scatter of growth against a multiple with a fitted line (is it dear or cheap for its growth?).
 * Pure parts, tested in peers.test.ts; data from quant.comps (SEC XBRL trailing 12 months + Schwab prices).
 */
import type { CompRow } from '../research/comps';

export type PeerField = 'marketCap' | 'pe' | 'evEbitda' | 'ps' | 'evSales' | 'revenueGrowth' | 'operatingMargin' | 'netMargin';

export const PEER_COLUMNS: { key: PeerField; label: string; kind: 'money' | 'x' | 'pct'; tip: string }[] = [
  { key: 'marketCap', label: 'Market cap', kind: 'money', tip: 'Share price × shares' },
  { key: 'pe', label: 'P/E', kind: 'x', tip: 'Price ÷ earnings per share (last 12 months)' },
  { key: 'evEbitda', label: 'EV/EBITDA', kind: 'x', tip: 'Company value incl. debt ÷ operating profit before depreciation' },
  { key: 'ps', label: 'P/S', kind: 'x', tip: 'Market cap ÷ sales' },
  { key: 'revenueGrowth', label: 'Sales growth', kind: 'pct', tip: 'Sales growth over the year before' },
  { key: 'operatingMargin', label: 'Op. margin', kind: 'pct', tip: 'Operating profit ÷ sales' },
  { key: 'netMargin', label: 'Net margin', kind: 'pct', tip: 'Profit ÷ sales' },
];

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Median and average of a field over the peers (multiples at or below zero are left out: they mean losses). */
export function peerStats(peers: CompRow[], key: PeerField): { median: number | null; mean: number | null; n: number } {
  const multiple = key === 'pe' || key === 'evEbitda' || key === 'ps' || key === 'evSales';
  const vals = peers.map((p) => p[key]).filter(finite).filter((v) => !multiple || v > 0).sort((a, b) => a - b);
  if (!vals.length) return { median: null, mean: null, n: 0 };
  const mid = Math.floor(vals.length / 2);
  return { median: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2, mean: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
}

/** Least-squares line y = a + b·x (null with fewer than 3 points or no spread in x). */
export function linearFit(points: { x: number; y: number }[]): { a: number; b: number; r2: number } | null {
  const pts = points.filter((p) => finite(p.x) && finite(p.y));
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (!sxx) return null;
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const b = sxy / sxx;
  const a = my - b * mx;
  const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  return { a, b, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

const x = (v: number) => `${v.toFixed(1)}×`;
const p = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Two plain sentences: how the company's main multiple and growth compare with the peer medians. */
export function peerWords(target: CompRow, peers: CompRow[]): string {
  const parts: string[] = [];
  const pe = peerStats(peers, 'pe').median;
  if (finite(target.pe) && target.pe > 0 && pe) {
    const d = target.pe / pe - 1;
    parts.push(`${target.symbol} trades at ${x(target.pe)} earnings against a peer median of ${x(pe)} (${Math.abs(d * 100).toFixed(0)}% ${d >= 0 ? 'above' : 'below'}).`);
  } else {
    const ev = peerStats(peers, 'evSales').median;
    if (finite(target.evSales) && ev) parts.push(`${target.symbol} is valued at ${x(target.evSales)} sales against a peer median of ${x(ev)}.`);
  }
  const g = peerStats(peers, 'revenueGrowth').median;
  const m = peerStats(peers, 'operatingMargin').median;
  if (finite(target.revenueGrowth) && g != null) parts.push(`Sales grew ${p(target.revenueGrowth)} against ${p(g)} for the median peer${finite(target.operatingMargin) && m != null ? `, with an operating margin of ${p(target.operatingMargin)} against ${p(m)}` : ''}.`);
  return parts.join(' ');
}
