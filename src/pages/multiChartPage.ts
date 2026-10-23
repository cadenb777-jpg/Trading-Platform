/** Several live charts side by side, each with its own symbol and timeframe. */
import { ChartView } from '../chart/ChartView';
import { SessionShading, isRegularHours, regularHoursOnly } from '../chart/session';
import { getProvider } from '../data';
import type { ProviderId } from '../data/provider';
import { guessMarket, type MarketRef } from '../data/quotes';
import { getIndicator } from '../indicators/library';
import { newIndicatorInstance, persist, state } from '../state';
import { TIMEFRAMES, TIMEFRAME_SECONDS, applyTrade, type Bar, type Timeframe } from '../types';
import { formatNumber, h } from '../ui/dom';
import { icon } from '../ui/icons';
import { displaySymbol } from '../ui/watchlist';

export interface MultiCell {
  provider: ProviderId;
  symbol: string;
  timeframe: Timeframe;
}

export type MultiLayout = '2h' | '2v' | '4';

const CELL_TIMEFRAMES = TIMEFRAMES.filter((t) => !t.endsWith('s'));

function createCell(index: number, onOpen: (ref: MarketRef) => void) {
  const cfg = () => state.multi.cells[index];
  const symbolInput = h('input', { class: 'input mc-symbol', spellcheck: false, 'aria-label': `Chart ${index + 1} symbol` });
  const tfSelect = h('select', { class: 'input mc-tf', 'aria-label': `Chart ${index + 1} timeframe` }, ...CELL_TIMEFRAMES.map((t) => h('option', { value: t }, t)));
  const price = h('span', { class: 'mc-price' });
  const status = h('span', { class: 'status' });
  const chartEl = h('div', { class: 'chart' });
  const message = h('div', { class: 'chart-message', hidden: true });
  const el = h(
    'section',
    { class: 'mc-cell' },
    h(
      'header',
      { class: 'mc-head' },
      symbolInput,
      tfSelect,
      price,
      h('span', { class: 'spacer' }),
      status,
      h('button', { class: 'icon-btn', title: 'Open in the full chart', 'aria-label': 'Open in full chart', onclick: () => onOpen({ provider: cfg().provider, symbol: cfg().symbol }) }, icon('chart', 18)),
    ),
    h('div', { class: 'chart-wrap' }, chartEl, message),
  );

  let chart: ChartView | null = null;
  let shading: SessionShading | null = null;
  let bars: Bar[] = [];
  let stopLive = () => {};
  let controller: AbortController | null = null;
  let pendingFrom: number | null = null;

  async function load() {
    stopLive();
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    const { provider, symbol, timeframe } = cfg();
    symbolInput.value = displaySymbol(symbol);
    tfSelect.value = timeframe;
    message.hidden = true;
    status.className = 'status connecting';
    chart ??= (() => {
      const view = new ChartView(chartEl);
      view.onDataError = (text) => {
        message.hidden = false;
        message.replaceChildren(h('p', {}, text));
      };
      view.addIndicator(newIndicatorInstance(getIndicator('volume')!));
      shading = new SessionShading(view);
      return view;
    })();
    chart.symbol = symbol;
    try {
      bars = await getProvider(provider).loadHistory(symbol, timeframe, ctl.signal);
    } catch (err) {
      if (ctl.signal.aborted) return;
      bars = [];
      chart.setBars(bars, timeframe);
      status.className = 'status error';
      message.hidden = false;
      message.replaceChildren(h('p', {}, `${displaySymbol(symbol)}: ${(err as Error).message}`));
      return;
    }
    if (ctl.signal.aborted) return;
    // Same extended-hours setting as the main chart.
    const ext = provider === 'schwab' && TIMEFRAME_SECONDS[timeframe] < 86400;
    if (ext && !state.extendedHours) bars = regularHoursOnly(bars);
    shading?.setEnabled(ext && state.extendedHours);
    chart.setBars(bars, timeframe);
    price.textContent = bars.length ? formatNumber(bars[bars.length - 1].close) : '';
    stopLive = getProvider(provider).subscribe(
      symbol,
      {
        onTrade: (t) => {
          if (ext && !state.extendedHours && !isRegularHours(t.time)) return;
          if (!applyTrade(bars, timeframe, t.price, t.size, t.time)) return;
          const i = bars.length - 1;
          if (pendingFrom === null)
            requestAnimationFrame(() => {
              if (pendingFrom === null || !chart) return;
              chart.updateFrom(pendingFrom);
              pendingFrom = null;
              price.textContent = formatNumber(bars[bars.length - 1].close);
            });
          pendingFrom = Math.min(pendingFrom ?? i, i);
        },
        onStatus: (s, msg) => {
          status.className = `status ${s}`;
          status.title = msg ?? s;
        },
      },
      bars[bars.length - 1]?.close ?? 100,
    );
  }

  symbolInput.addEventListener('change', () => {
    const ref = guessMarket(symbolInput.value.startsWith('$') || /^(SPX|DJI|COMPX|VIX|RUT)$/i.test(symbolInput.value) ? `$${symbolInput.value.replace('$', '')}` : symbolInput.value);
    if (!ref) return;
    state.multi.cells[index] = { ...cfg(), ...ref };
    persist();
    load();
  });
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && symbolInput.blur());
  tfSelect.addEventListener('change', () => {
    state.multi.cells[index] = { ...cfg(), timeframe: tfSelect.value as Timeframe };
    persist();
    load();
  });

  return {
    el,
    load,
    stop: () => {
      stopLive();
      stopLive = () => {};
      controller?.abort();
    },
  };
}

export function createMultiChartPage(onOpen: (ref: MarketRef) => void) {
  const grid = h('div', { class: 'mc-grid' });
  const layoutButtons = (['2h', '2v', '4'] as MultiLayout[]).map((l) =>
    h('button', { 'data-layout': l, onclick: () => setLayout(l) }, l === '2h' ? '2 side by side' : l === '2v' ? '2 stacked' : '4 grid'),
  );
  const el = h(
    'div',
    { class: 'multi-page' },
    h('header', { class: 'toolbar' }, h('b', {}, 'Multi-chart'), h('div', { class: 'segmented' }, ...layoutButtons), h('span', { class: 'muted small' }, 'Type a symbol in any chart (e.g. NVDA, BTC, SPX) and press Enter.')),
    grid,
  );
  const cells = [0, 1, 2, 3].map((i) => createCell(i, onOpen));
  let active = false;

  function render() {
    const count = state.multi.layout === '4' ? 4 : 2;
    grid.className = `mc-grid layout-${state.multi.layout}`;
    layoutButtons.forEach((b) => b.classList.toggle('active', b.dataset.layout === state.multi.layout));
    grid.replaceChildren(...cells.slice(0, count).map((c) => c.el));
    cells.forEach((c, i) => (i < count && active ? c.load() : c.stop()));
  }

  function setLayout(layout: MultiLayout) {
    state.multi.layout = layout;
    persist();
    render();
  }

  return {
    el,
    start() {
      if (active) return;
      active = true;
      render();
    },
    stop() {
      active = false;
      cells.forEach((c) => c.stop());
    },
  };
}
