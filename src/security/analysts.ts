/**
 * Analysts and earnings for the security Overview (Bloomberg ANR / EE-SURP layout, owner's spec 7.9): a consensus box
 * beside a month-by-month buy / hold / sell chart, and earnings per share reported against the analysts' estimate for
 * the last quarters. Finnhub free tier (the owner's key, via the helper). Pure parts tested in analysts.test.ts.
 */
import { h } from '../ui/dom';

export interface Trend {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  consensus: string;
  score?: number;
}

export interface Surprise {
  period: string;
  quarter?: number | null;
  year?: number | null;
  actual: number;
  estimate: number | null;
  surprise: number | null;
  surprisePct: number | null;
}

/** Oldest month first, each as shares of buy / hold / sell (strong ones folded in). */
export function ratingMonths(trends: Trend[]): { period: string; buy: number; hold: number; sell: number; total: number }[] {
  return [...trends]
    .filter((t) => t.total > 0)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((t) => ({ period: t.period, buy: (t.strongBuy + t.buy) / t.total, hold: t.hold / t.total, sell: (t.sell + t.strongSell) / t.total, total: t.total }));
}

/** "Analysts have turned more positive" etc., comparing the newest month to the oldest shown. */
export function ratingWords(trends: Trend[]): string {
  const m = ratingMonths(trends);
  if (!m.length) return '';
  const now = m[m.length - 1];
  const head = `${Math.round(now.buy * 100)}% of ${now.total} analysts say buy, ${Math.round(now.hold * 100)}% hold, ${Math.round(now.sell * 100)}% sell.`;
  if (m.length < 2) return head;
  const d = now.buy - m[0].buy;
  const span = `${m.length} months`;
  if (d >= 0.05) return `${head} More positive than ${span} ago (buy share up ${Math.round(d * 100)} points).`;
  if (d <= -0.05) return `${head} Less positive than ${span} ago (buy share down ${Math.round(-d * 100)} points).`;
  return `${head} About the same as ${span} ago.`;
}

/** "Beat the estimate in 6 of the last 8 quarters (by 4.1% on average)". */
export function surpriseWords(q: Surprise[]): string {
  const known = q.filter((x) => x.surprise != null);
  if (!known.length) return '';
  const beats = known.filter((x) => (x.surprise as number) > 0).length;
  const misses = known.filter((x) => (x.surprise as number) < 0).length;
  const pcts = known.map((x) => x.surprisePct).filter((v): v is number => v != null);
  const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  const last = known[0];
  const lastWord = (last.surprise as number) > 0 ? 'beat' : (last.surprise as number) < 0 ? 'missed' : 'matched';
  return `Beat the estimate in ${beats} of the last ${known.length} quarters${misses ? `, missed ${misses}` : ''}${avg != null ? ` (average surprise ${avg >= 0 ? '+' : '−'}${Math.abs(avg * 100).toFixed(1)}%)` : ''}. Latest quarter ${lastWord}.`;
}

const monthLabel = (p: string) => new Date(`${p.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const quarterLabel = (s: Surprise) => (s.quarter && s.year ? `Q${s.quarter} ${String(s.year).slice(2)}` : s.period.slice(0, 7));

/** Stacked bars, one per month: buy (green) at the bottom, hold (amber), sell (red) on top. */
export function ratingChart(trends: Trend[]): HTMLElement {
  const m = ratingMonths(trends);
  return h(
    'div',
    { class: 'anr-chart', role: 'img', 'aria-label': ratingWords(trends) },
    ...m.map((x) =>
      h(
        'div',
        { class: 'anr-col', title: `${monthLabel(x.period)}: buy ${Math.round(x.buy * 100)}%, hold ${Math.round(x.hold * 100)}%, sell ${Math.round(x.sell * 100)}% (${x.total} analysts)` },
        h('div', { class: 'anr-stack' }, h('span', { class: 'anr-sell', style: `height:${(x.sell * 100).toFixed(1)}%` }), h('span', { class: 'anr-hold', style: `height:${(x.hold * 100).toFixed(1)}%` }), h('span', { class: 'anr-buy', style: `height:${(x.buy * 100).toFixed(1)}%` })),
        h('small', {}, monthLabel(x.period)),
      ),
    ),
  );
}

/** Earnings per share: the estimate as an outline bar, the actual as a solid bar (green beat, red miss), oldest first. */
export function surpriseChart(q: Surprise[]): HTMLElement {
  const rows = [...q].reverse();
  const top = Math.max(1e-9, ...rows.flatMap((x) => [Math.abs(x.actual), Math.abs(x.estimate ?? 0)]));
  const ht = (v: number | null) => (v == null ? 0 : (Math.abs(v) / top) * 100);
  return h(
    'div',
    { class: 'eps-chart', role: 'img', 'aria-label': surpriseWords(q) },
    ...rows.map((x) => {
      const tone = x.surprise == null ? '' : x.surprise > 0 ? 'up' : x.surprise < 0 ? 'down' : '';
      return h(
        'div',
        { class: 'eps-col', title: `${quarterLabel(x)}: reported ${x.actual.toFixed(2)}, expected ${x.estimate == null ? '—' : x.estimate.toFixed(2)}${x.surprisePct != null ? ` (${x.surprisePct > 0 ? '+' : ''}${(x.surprisePct * 100).toFixed(1)}%)` : ''}` },
        h('span', { class: `eps-pct ${tone}` }, x.surprisePct == null ? '' : `${x.surprisePct > 0 ? '+' : ''}${(x.surprisePct * 100).toFixed(0)}%`),
        h('div', { class: 'eps-bars' }, h('span', { class: 'eps-est', style: `height:${ht(x.estimate).toFixed(1)}%` }), h('span', { class: `eps-act ${tone}`, style: `height:${ht(x.actual).toFixed(1)}%` })),
        h('small', {}, quarterLabel(x)),
      );
    }),
  );
}
