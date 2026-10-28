/**
 * COT (CFTC Commitment of Traders) has one home: the Futures page. It holds the board's COT table and this panel,
 * "Any market or stock": every CFTC market's net positions, or a stock's related futures market (moved here from
 * Flow's old COT tab). Other pages show cotSummary(): one line and "See all on Futures".
 */
import { insightButton, type InsightRequest } from '../ai/insight';
import { engineRequest, helper } from '../data/schwab';
import { compact, createLineChart, statCards } from '../ui/charts';
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { tickerAttr } from '../ui/tickerCard';
import { cotSummaryText } from './view';

export interface CotData {
  name: string;
  rows: { date: string; openInterest: number; specNet: number; commNet: number; smallNet: number }[];
  latest: { date: string; openInterest: number; specNet: number; commNet: number; specLong: number; specShort: number };
  weeklyChange: { specNet: number; commNet: number };
  specIndex: number | null;
  commIndex: number | null;
}

export interface CotSymbolData {
  symbol: string;
  code: string;
  market: string;
  reason: string;
  rows: { date: string; specNet: number; commNet: number; smallNet: number; openInterest: number; specIndex: number | null; commIndex: number | null }[];
}

const idx = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(0)} / 100`);

/** Asks the Futures page to show a CFTC market (by code) or a stock's related market in its COT panel. */
export function openCotOnFutures(target: { code?: string; symbol?: string } = {}) {
  window.dispatchEvent(new CustomEvent('tp:open-cot', { detail: target }));
}

/**
 * One line of COT for a stock's (or index's) related futures market, with "See all on Futures →". Pass the data when
 * the page already has it (Flow's positioning reply), or a symbol to look it up (flow.cot_for_symbol, cached).
 * quiet: hide the line when it can't be read (Home without the helper) and try again once the helper connects.
 */
export function cotSummary(source: string | CotSymbolData | null, error?: string, opts: { quiet?: boolean } = {}): HTMLElement {
  const el = h('p', { class: 'cot-summary small' }, h('span', { class: 'muted' }, 'Futures positioning (COT)… '));
  const link = (d?: CotSymbolData) =>
    h('a', { href: '#futures/cot', class: 'cot-summary-link', onclick: (e: Event) => (e.preventDefault(), openCotOnFutures(d ? { code: d.code } : typeof source === 'string' ? { symbol: source } : {})) }, 'See all on Futures →');
  const draw = (d: CotSymbolData | null, err?: string) =>
    el.replaceChildren(h('b', {}, 'COT '), d ? cotSummaryText(d) : h('span', { class: 'muted' }, err ?? 'not available'), ' ', link(d ?? undefined));
  const fetch = (symbol: string) =>
    engineRequest<CotSymbolData>('flow.cot_for_symbol', { symbol: symbol.replace(/^\$/, '') }, 60_000).then(
      (d) => {
        el.hidden = false;
        draw(d);
      },
      (err) => {
        if (!opts.quiet) return draw(null, (err as Error).message);
        el.hidden = true;
        const off = helper.onAvailability((up) => up && (off(), void fetch(symbol)));
      },
    );
  if (source == null) draw(null, error);
  else if (typeof source !== 'string') draw(source);
  else void fetch(source);
  return el;
}

/** The Futures page's "Any market or stock" COT panel: a CFTC market list and a stock box, with charts. */
export function createCotPanel() {
  let insight: InsightRequest | null = null;
  const marketSelect = h('select', { class: 'input', 'aria-label': 'CFTC market' }, h('option', { value: '' }, 'Pick a CFTC market…')) as HTMLSelectElement;
  const symbolInput = h('input', { class: 'input symbol', placeholder: 'or stock', 'aria-label': 'Stock symbol (uses its related futures market)', spellcheck: false }) as HTMLInputElement;
  const go = h('button', { class: 'btn', onclick: () => void showSymbol(symbolInput.value) }, 'Show');
  const ai = insightButton(() => insight, 'AI summary');
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Pick any market the CFTC reports (currencies, rates, grains, metals, energy, indexes) or type a stock to see the futures market closest to it.'));
  const el = h(
    'section',
    { class: 'panel', id: 'fut-cot-any' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'COT: any market or stock'), marketSelect, symbolInput, go, ai.button),
    body,
    ai.panel,
  );
  marketSelect.addEventListener('change', () => marketSelect.value && void showMarket(marketSelect.value));
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && void showSymbol(symbolInput.value));
  let request = 0;
  let marketsLoaded: Promise<void> | null = null;

  function loadMarkets() {
    marketsLoaded ??= engineRequest<{ markets: { code: string; name: string }[] }>('flow.cot_markets').then(
      ({ markets }) => void marketSelect.append(...markets.map((m) => h('option', { value: m.code }, m.name))),
      () => {
        marketsLoaded = null; // filled in once the helper is running
      },
    );
    return marketsLoaded;
  }

  async function showMarket(code: string) {
    const mine = ++request;
    body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading…'));
    ai.panel.hidden = true;
    try {
      const d = await engineRequest<CotData>('flow.cot', { code });
      if (mine !== request) return;
      if (marketSelect.value !== code) marketSelect.value = code;
      renderCot(d);
      insight = { topic: 'cot', symbol: d.name, market: d.name, title: `Positioning read: ${d.name}`, data: { latest: d.latest, weeklyChange: d.weeklyChange, specIndex: d.specIndex, commIndex: d.commIndex, recent: d.rows.slice(-26) } };
    } catch (err) {
      if (mine === request) body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  async function showSymbol(raw: string) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    symbolInput.value = symbol;
    const mine = ++request;
    body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading…'));
    ai.panel.hidden = true;
    try {
      const d = await engineRequest<CotSymbolData>('flow.cot_for_symbol', { symbol });
      if (mine !== request) return;
      renderCotForSymbol(d);
      insight = { topic: 'cot', symbol: d.symbol, market: d.market, title: `Futures positioning read: ${d.symbol} (${d.market})`, data: { reason: d.reason, recent: d.rows.slice(-26) } };
    } catch (err) {
      if (mine === request) body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  function renderCot(d: CotData) {
    const chartBox = h('div', {});
    body.replaceChildren(
      statCards([
        { label: 'Report date', value: d.latest.date },
        { label: 'Speculators net', value: compact(d.latest.specNet), hint: `Week change ${compact(d.weeklyChange.specNet)}`, tone: d.latest.specNet >= 0 ? 'up' : 'down' },
        { label: 'Speculator index (3y)', value: idx(d.specIndex), hint: 'Near 100 = most bullish in 3 years; near 0 = most bearish. Extremes often precede reversals.' },
        { label: 'Commercials (hedgers) net', value: compact(d.latest.commNet), hint: `Week change ${compact(d.weeklyChange.commNet)}`, tone: d.latest.commNet >= 0 ? 'up' : 'down' },
        { label: 'Open interest', value: compact(d.latest.openInterest) },
      ]),
      h('h4', { class: 'section-label' }, `${d.name}: net positions (contracts) · weekly CFTC report, released Fridays for the prior Tuesday`),
      chartBox,
    );
    createLineChart(chartBox, { height: 320 }).set([
      { name: 'Speculators (large)', color: '#2962ff', data: d.rows.map((r) => ({ time: r.date, value: r.specNet })) },
      { name: 'Commercials (hedgers)', color: '#ff9800', data: d.rows.map((r) => ({ time: r.date, value: r.commNet })) },
      { name: 'Small traders', color: '#787b86', width: 1, data: d.rows.map((r) => ({ time: r.date, value: r.smallNet })) },
    ]);
  }

  function renderCotForSymbol(d: CotSymbolData) {
    const latest = d.rows[d.rows.length - 1];
    if (!latest) return body.replaceChildren(h('p', { class: 'muted' }, `No COT report for ${d.market}.`));
    const prev = d.rows[d.rows.length - 2] ?? latest;
    const chartBox = h('div', {});
    const netBox = h('div', {});
    body.replaceChildren(
      h('div', { class: 'callout' }, h('b', {}, h('span', tickerAttr(d.symbol), d.symbol), ` → ${d.market} futures. `), d.reason, ' The CFTC only publishes positioning for futures, so this is the closest view of how big traders are positioned for this stock’s market.'),
      statCards([
        { label: 'Report date', value: latest.date },
        { label: 'Speculator index (3y)', value: idx(latest.specIndex), hint: 'Near 100 = most bullish in 3 years; near 0 = most bearish. Extremes often come before reversals.', tone: (latest.specIndex ?? 50) >= 50 ? 'up' : 'down' },
        { label: 'Hedger index (3y)', value: idx(latest.commIndex), hint: 'Commercial hedgers usually trade against the trend; their extremes are often the better signal.' },
        { label: 'Speculators net', value: compact(latest.specNet), hint: `Week change ${compact(latest.specNet - prev.specNet)}`, tone: latest.specNet >= 0 ? 'up' : 'down' },
        { label: 'Open interest', value: compact(latest.openInterest) },
      ]),
      h('div', { class: 'panel-head' }, h('h4', {}, 'Positioning index (0-100, 3-year range)'), asOfStamp('cftc').set(latest.date, { prefix: 'report', source: 'CFTC (weekly)' }).el, h('span', { class: 'muted small' }, 'Above 80 or below 20 = crowded')),
      chartBox,
      h('h4', { class: 'section-label' }, 'Net positions (contracts)'),
      netBox,
    );
    const recent = d.rows.slice(-260);
    createLineChart(chartBox, { height: 260, format: (v) => v.toFixed(0) }).set([
      { name: 'Speculators', color: '#2962ff', data: recent.map((r) => ({ time: r.date, value: r.specIndex ?? NaN })) },
      { name: 'Hedgers', color: '#ff9800', data: recent.map((r) => ({ time: r.date, value: r.commIndex ?? NaN })) },
    ]);
    createLineChart(netBox, { height: 240 }).set([
      { name: 'Speculators (large)', color: '#2962ff', data: recent.map((r) => ({ time: r.date, value: r.specNet })) },
      { name: 'Commercials (hedgers)', color: '#ff9800', data: recent.map((r) => ({ time: r.date, value: r.commNet })) },
      { name: 'Small traders', color: '#787b86', width: 1, data: recent.map((r) => ({ time: r.date, value: r.smallNet })) },
    ]);
  }

  return {
    el,
    /** Fills the market list (once the helper answers). */
    start: () => void loadMarkets(),
    /** Shows a market by CFTC code, or a stock's related market. */
    async show(target: { code?: string; symbol?: string }) {
      if (target.code) {
        await loadMarkets();
        return showMarket(target.code);
      }
      if (target.symbol) return showSymbol(target.symbol);
    },
  };
}
