/**
 * Research → Overview tear sheet (Fincept "Equity Research" layout, the platform's colours): what the company does
 * (Wikipedia via its SEC CIK, helper research.about) above three columns.
 * - left: valuation and share figures as label-value lists;
 * - centre: the pictures (52-week range track, quality gauge, margin rings);
 * - right: growth, returns and balance-sheet lists.
 * Every picture carries a plain-words line made from the numbers by rules (no AI cost, tested); the page's AI
 * summary button gives the full read.
 */
import { getProvider } from '../data';
import { engineRequest, helper } from '../data/schwab';
import type { Bar } from '../types';
import { createLineChart } from '../ui/charts';
import { THEME } from '../ui/theme';
import { money, pct } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { gauge, rangeTrack, ring, type Tone } from '../ui/viz';
import { fScore, fScoreWords } from './quality';
import type { CompanyData } from '../pages/researchPage';

export const ABOUT_HELPER_VERSION = 81;

// ---------- words from numbers (pure, tested) ----------

/** "Trading 82% of the way up its 52-week range, 6% below the high." */
export function rangeWords(price: number | null | undefined, low?: number, high?: number): string {
  if (price == null || !low || !high || !(high > low)) return 'No 52-week range yet.';
  const pos = Math.round(((price - low) / (high - low)) * 100);
  const offHigh = (1 - price / high) * 100;
  const offLow = (price / low - 1) * 100;
  if (pos >= 95) return `At the top of its 52-week range: ${offHigh.toFixed(1)}% below the high.`;
  if (pos <= 5) return `At the bottom of its 52-week range: ${offLow.toFixed(1)}% above the low.`;
  return `${pos}% of the way up its 52-week range: ${offHigh.toFixed(1)}% below the high, ${offLow.toFixed(1)}% above the low.`;
}

/** "Investors pay $34 for each $1 of yearly profit." */
export function peWords(pe: number | null | undefined): string {
  if (pe == null || !Number.isFinite(pe)) return 'No P/E: the company has no profit over the last 12 months, or no price yet.';
  if (pe <= 0) return 'Loss-making over the last 12 months, so there is no meaningful P/E.';
  return `Investors pay $${pe.toFixed(pe < 10 ? 1 : 0)} for each $1 of the last 12 months’ profit.`;
}

/** "Keeps 25¢ of every $1 of sales as net profit." */
export function marginWords(m: number | null | undefined, what: string): string {
  if (m == null || !Number.isFinite(m)) return `No ${what} figure.`;
  if (m < 0) return `Loses ${Math.round(-m * 100)}¢ on every $1 of sales (${what}).`;
  return `Keeps ${Math.round(m * 100)}¢ of every $1 of sales as ${what}.`;
}

/** Tone for a margin: green when positive and better than last year, red when negative, amber otherwise. */
export function marginTone(now: number | null | undefined, before: number | null | undefined): Tone {
  if (now == null) return 'muted';
  if (now < 0) return 'down';
  if (before != null && now < before) return 'warn';
  return 'up';
}

const last = (xs: (number | null)[] | undefined, back = 0) => {
  const vals = (xs ?? []).filter((x): x is number => x != null);
  return vals.length > back ? vals[vals.length - 1 - back] : null;
};

export const PERIODS = [
  ['1M', 31],
  ['3M', 92],
  ['6M', 183],
  ['1Y', 366],
  ['5Y', 1827],
] as const;
export type Period = (typeof PERIODS)[number][0];

/** The bars inside the last `days` (by time), and the change over them (pure, tested). */
export function periodSlice<T extends { time: number; close: number }>(bars: T[], days: number) {
  if (!bars.length) return { bars, change: null as number | null };
  const from = bars[bars.length - 1].time - days * 86400;
  const kept = bars.filter((b) => b.time >= from);
  const first = kept[0]?.close;
  const last = kept[kept.length - 1]?.close;
  return { bars: kept, change: first && last ? last / first - 1 : null };
}

// ---------- drawing ----------

/** The price over 1M-5Y (daily bars, weekly for 5 years), green when the period is up, red when down. */
function priceBlock(symbol: string): HTMLElement {
  const box = h('div', { class: 'ts-chart' });
  const note = h('div', { class: 'ts-chart-note muted small' }, 'Loading prices…');
  const buttons = new Map<Period, HTMLButtonElement>();
  let chart: ReturnType<typeof createLineChart> | null = null;
  const cache = new Map<'1D' | '1W', Promise<Bar[]>>();
  const bars = (tf: '1D' | '1W') => {
    if (!cache.has(tf)) cache.set(tf, getProvider('schwab').loadHistory(symbol, tf, new AbortController().signal, tf === '1W' ? 1900 : 400));
    return cache.get(tf)!;
  };
  const show = async (period: Period) => {
    for (const [p, b] of buttons) b.classList.toggle('active', p === period);
    const days = PERIODS.find(([p]) => p === period)![1];
    try {
      const all = await bars(period === '5Y' ? '1W' : '1D');
      const { bars: kept, change } = periodSlice(all, days);
      if (!kept.length) throw new Error('no prices');
      chart ??= createLineChart(box, { height: 200, format: (v) => formatPrice(v), title: `${symbol} price` });
      chart.set([{ name: '', color: change != null && change < 0 ? THEME.down : THEME.up, data: kept.map((b) => ({ time: b.time, value: b.close })) }]);
      note.textContent = change == null ? '' : `${period}: ${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}% · ${formatPrice(kept[0].close)} → ${formatPrice(kept[kept.length - 1].close)}`;
      note.className = `ts-chart-note small ${change == null ? 'muted' : change >= 0 ? 'up' : 'down'}`;
    } catch (err) {
      note.textContent = `No price history: ${(err as Error).message}`;
    }
  };
  const row = h(
    'div',
    { class: 'segmented small ts-periods', role: 'group', 'aria-label': 'Chart period' },
    ...PERIODS.map(([p]) => {
      const b = h('button', { type: 'button', onclick: () => void show(p) }, p) as HTMLButtonElement;
      buttons.set(p, b);
      return b;
    }),
  );
  void show('1Y');
  return h('div', { class: 'ts-price-block' }, h('div', { class: 'ts-chart-head' }, h('span', { class: 'viz-title' }, 'Price'), row), box, note);
}

function kvList(title: string, rows: [string, string, ('up' | 'down' | '')?][]) {
  return h(
    'section',
    { class: 'panel ts-list' },
    h('div', { class: 'panel-head' }, h('h3', {}, title)),
    h('dl', { class: 'kv' }, ...rows.flatMap(([k, v, tone]) => [h('dt', {}, k), h('dd', { class: tone ?? '' }, v)])),
  );
}

function aboutBlock(d: CompanyData) {
  const fallback = `${d.profile.name} · ${d.profile.industry || 'industry not reported'}${d.profile.exchange ? ` · ${d.profile.exchange}` : ''}.`;
  const box = h('p', { class: 'ts-about' }, fallback);
  if ((helper.version ?? 0) >= ABOUT_HELPER_VERSION && d.profile.cik) {
    engineRequest<{ about: string | null; source?: string; url?: string }>('research.about', { cik: d.profile.cik }, 30000).then(
      (r) => {
        if (r.about) box.replaceChildren(r.about, ' ', h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', class: 'muted small' }, `(${r.source})`));
      },
      () => undefined,
    );
  }
  return box;
}

export function tearSheet(d: CompanyData): HTMLElement {
  const v = d.valuation;
  const q = d.quote;
  const r = d.ratios;
  const tr = d.totalReturn;
  const signedPct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  const tone = (x: number | null | undefined): 'up' | 'down' | '' => (x == null ? '' : x >= 0 ? 'up' : 'down');
  const x = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}×`);

  const fs = fScore(d.annual);
  const qualityGauge = gauge({
    title: 'Financial strength (F-score)',
    value: fs?.score ?? null,
    min: 0,
    max: 9,
    zones: [
      { to: 3, tone: 'down' },
      { to: 6, tone: 'warn' },
      { to: 9, tone: 'up' },
    ],
    valueText: fs ? `${fs.score}/9` : '—',
    caption: fs ? fScoreWords(fs) : 'Needs two years of filed statements.',
  });

  const rings = h(
    'div',
    { class: 'ts-rings' },
    ...(
      [
        ['grossMargin', 'Gross margin', 'gross profit'],
        ['operatingMargin', 'Operating margin', 'operating profit'],
        ['netMargin', 'Net margin', 'net profit'],
        ['fcfMargin', 'Cash margin', 'free cash flow'],
      ] as const
    ).map(([k, title, what]) => {
      const now = last(r[k]);
      return ring({ title, share: now == null ? null : Math.max(0, now), valueText: now == null ? '—' : `${Math.round(now * 100)}%`, tone: marginTone(now, last(r[k], 1)), caption: marginWords(now, what) });
    }),
  );

  const range =
    q.low52 && q.high52
      ? rangeTrack({ title: '52-week range', low: q.low52, high: q.high52, value: v.price ?? q.price ?? null, format: formatPrice, caption: rangeWords(v.price ?? q.price, q.low52, q.high52) })
      : h('p', { class: 'muted small' }, 'No 52-week range yet.');

  return h(
    'div',
    { class: 'ts' },
    aboutBlock(d),
    h(
      'div',
      { class: 'ts-grid' },
      h(
        'div',
        { class: 'ts-col' },
        kvList('Valuation', [
          ['Market cap', money(v.marketCap)],
          ['Enterprise value', money(v.enterpriseValue)],
          ['P/E (trailing)', x(v.pe ?? q.peRatio)],
          ['Price / sales', x(v.ps)],
          ['Price / free cash', x(v.pfcf)],
          ['EV / EBITDA', x(v.evEbitda)],
          ['Free cash yield', pct(v.fcfYield), tone(v.fcfYield)],
          ['Dividend yield', q.divYield ? `${q.divYield.toFixed(2)}%` : '—'],
        ]),
        h('p', { class: 'ts-note' }, peWords(v.pe ?? q.peRatio)),
        kvList('Share stats', [
          ['Shares', v.shares ? `${(v.shares / 1e9 >= 1 ? (v.shares / 1e9).toFixed(2) + 'B' : (v.shares / 1e6).toFixed(1) + 'M')}` : '—'],
          ['Beta (5y)', v.beta != null ? v.beta.toFixed(2) : '—'],
          ['Cash', money(v.cash)],
          ['Debt', money(v.debt)],
        ]),
      ),
      h('div', { class: 'ts-col ts-centre panel' }, priceBlock(d.symbol), range, qualityGauge, rings),
      h(
        'div',
        { class: 'ts-col' },
        kvList('Growth (latest year)', [
          ['Revenue', signedPct(last(r.revenueGrowth)), tone(last(r.revenueGrowth))],
          ['EPS', signedPct(last(r.epsGrowth)), tone(last(r.epsGrowth))],
          ['Revenue (TTM)', money(d.ttm.revenue)],
          ['Net income (TTM)', money(d.ttm.netIncome), tone(d.ttm.netIncome)],
        ]),
        kvList('Returns', [
          ['Total return 1y', signedPct(tr?.tr1y), tone(tr?.tr1y)],
          ['Total return 3y / yr', signedPct(tr?.tr3y), tone(tr?.tr3y)],
          ['Total return 5y / yr', signedPct(tr?.tr5y), tone(tr?.tr5y)],
          ['Return on equity', pct(last(r.roe), 1), tone(last(r.roe))],
          ['Return on assets', pct(last(r.roa), 1), tone(last(r.roa))],
        ]),
        kvList('Balance sheet', [
          ['Current ratio', last(r.currentRatio)?.toFixed(2) ?? '—'],
          ['Debt / equity', last(r.debtToEquity)?.toFixed(2) ?? '—'],
        ]),
      ),
    ),
  );
}
