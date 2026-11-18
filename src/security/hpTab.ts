/**
 * Security → Prices (Bloomberg HP, owner's spec 7.2): the price history as a dense table that fills a wide screen in
 * side-by-side blocks (newest first, reading down then across), with Daily / Weekly / Monthly, a range, the range's
 * high / average / low with their dates and the total change on top, and a CSV download. Schwab daily bars.
 */
import { saveText } from '../prospect/compare';
import { formatPrice, h } from '../ui/dom';
import { pct } from '../ui/charts';
import { loadDaily } from './data';
import { lastDays, priceCsv, priceRows, summarise, type Periodicity, type PriceRow } from './priceHistory';
import type { TabCtx } from './tabs';
import { note, panel, reasonOf } from './ui';

const KEY = 'tp-sec-hp';
const RANGES: [label: string, days: number][] = [
  ['3M', 92],
  ['6M', 183],
  ['1Y', 366],
  ['5Y', 1827],
  ['Max', 0],
];
const PERIODS: [Periodicity, string][] = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
];

function readPrefs(): { period: Periodicity; range: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { period: ['daily', 'weekly', 'monthly'].includes(v.period) ? v.period : 'daily', range: Number.isFinite(v.range) ? v.range : 183 };
  } catch {
    return { period: 'daily', range: 183 };
  }
}
const savePrefs = (p: { period: Periodicity; range: number }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: the choice just isn't remembered */
  }
};

const dateText = (t: number, p: Periodicity) =>
  new Date(t * 1000).toLocaleDateString('en-US', p === 'monthly' ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
const volText = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)));
const tone = (v: number | null) => (v == null || Math.abs(v) < 5e-5 ? '' : v > 0 ? 'up' : 'down');

export function hpTab(ctx: TabCtx) {
  const s = ctx.symbol;
  let prefs = readPrefs();
  const body = h('div', { class: 'hp-body' }, note('Loading price history…'));
  const seg = (items: [string | number, string][], on: string | number, pick: (v: string) => void) =>
    h(
      'div',
      { class: 'segmented', role: 'group' },
      ...items.map(([v, label]) => h('button', { type: 'button', class: String(v) === String(on) ? 'active' : '', 'aria-pressed': String(String(v) === String(on)), onclick: () => pick(String(v)) }, label)),
    );
  const controls = h('div', { class: 'hp-controls' });
  ctx.body.replaceChildren(panel('Historical prices', 'Schwab daily bars', null, controls, body));

  let daily: PriceRow[] = [];
  const BLOCK = 21;
  let shown = BLOCK * 3;
  const draw = () => {
    const rows = lastDays(priceRows(daily.map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })), prefs.period), prefs.range);
    const sum = summarise(rows);
    controls.replaceChildren(
      seg(PERIODS, prefs.period, (v) => ((prefs = { ...prefs, period: v as Periodicity }), (shown = BLOCK * 3), savePrefs(prefs), draw())),
      seg(RANGES.map(([l, d]) => [d, l]), prefs.range, (v) => ((prefs = { ...prefs, range: Number(v) }), (shown = BLOCK * 3), savePrefs(prefs), draw())),
      h('button', { type: 'button', class: 'btn small', title: 'Download these rows as a spreadsheet file (CSV)', onclick: () => saveText(`${s}-prices-${prefs.period}.csv`, priceCsv(s, rows)) }, 'Download CSV'),
    );
    if (!sum) {
      body.replaceChildren(note('No price history for this symbol.'));
      return;
    }
    const stat = (label: string, value: string, sub = '', cls = '') => h('div', { class: 'hp-stat' }, h('span', {}, label), h('b', { class: `num ${cls}` }, value), sub ? h('small', {}, sub) : '');
    const newest = [...rows].reverse();
    // Bloomberg-style blocks side by side: newest first, reading down a block then across to the next
    const head = () => h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'num' }, 'Close'), h('th', { class: 'num' }, 'Change'), h('th', { class: 'num hp-wide' }, 'High'), h('th', { class: 'num hp-wide' }, 'Low'), h('th', { class: 'num' }, 'Volume')));
    const line = (r: PriceRow) =>
      h(
        'tr',
        { class: r.time === sum.high.time ? 'hp-hi' : r.time === sum.low.time ? 'hp-lo' : '', title: r.time === sum.high.time ? 'Highest close in this range' : r.time === sum.low.time ? 'Lowest close in this range' : '' },
        h('td', {}, dateText(r.time, prefs.period)),
        h('td', { class: 'num' }, formatPrice(r.close)),
        h('td', { class: `num ${tone(r.change)}` }, pct(r.change)),
        h('td', { class: 'num hp-wide' }, formatPrice(r.high)),
        h('td', { class: 'num hp-wide' }, formatPrice(r.low)),
        h('td', { class: 'num' }, volText(r.volume)),
      );
    const visible = newest.slice(0, shown);
    const blocks = h('div', { class: 'hp-blocks' });
    for (let i = 0; i < visible.length; i += BLOCK) blocks.append(h('table', { class: 'hp-table' }, head(), h('tbody', {}, ...visible.slice(i, i + BLOCK).map(line))));
    body.replaceChildren(
      h(
        'div',
        { class: 'hp-summary' },
        stat('Change', pct(sum.change), `${sum.rows} ${prefs.period === 'daily' ? 'days' : prefs.period === 'weekly' ? 'weeks' : 'months'}`, tone(sum.change)),
        stat('High close', formatPrice(sum.high.value), dateText(sum.high.time, 'daily')),
        stat('Average close', formatPrice(sum.average)),
        stat('Low close', formatPrice(sum.low.value), dateText(sum.low.time, 'daily')),
        stat('Last', formatPrice(newest[0].close), dateText(newest[0].time, 'daily')),
      ),
      blocks,
      newest.length > shown ? h('button', { type: 'button', class: 'btn small hp-more', onclick: () => ((shown += BLOCK * 3), draw()) }, `Show older (${newest.length - shown} more)`) : '',
    );
  };
  loadDaily(s).then(
    (bars) => {
      if (!ctx.still()) return;
      daily = bars.map((b) => ({ ...b, change: null }));
      ctx.share('prices', { symbol: s, rows: daily.length });
      draw();
    },
    (err) => ctx.still() && body.replaceChildren(note(`Not available: ${reasonOf(err)}`, 'sv-error')),
  );
}
