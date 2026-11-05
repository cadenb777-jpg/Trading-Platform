/**
 * The security view's GP tab: the platform's own chart engine (ChartView) with the security header row, timeframes
 * and the range bar, a few standard studies, the legend box and a compare line on its own left axis (Bloomberg's
 * L1 / R1). "Open in Chart" (the action bar) carries the
 * symbol and timeframe to the full Chart page.
 */
import { LineSeries, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { ChartView } from '../chart/ChartView';
import { createChartState } from '../chart/chartState';
import { LegendBox } from '../chart/legendBox';
import { marketTimeZone } from '../chart/range';
import { createRangeBar } from '../chart/rangeBar';
import { createSecurityHeader } from '../chart/securityHeader';
import { daySummary, formatPrice } from '../chart/summary';
import { TIMEFRAME_SECONDS } from '../types';
import { getProvider } from '../data';
import { guessMarket } from '../data/quotes';
import { getIndicator } from '../indicators/library';
import { newIndicatorInstance } from '../state';
import type { IndicatorInstance } from '../indicators/types';
import type { Timeframe } from '../types';
import { h } from '../ui/dom';
import { THEME } from '../ui/theme';
import { cleanSymbol } from './codes';
import { fmtPct } from './format';
import { note, reasonOf } from './ui';

export const CHART_TIMEFRAMES: { tf: Timeframe; label: string }[] = [
  { tf: '5m', label: '5m' },
  { tf: '15m', label: '15m' },
  { tf: '1h', label: '1H' },
  { tf: '1D', label: '1D' },
  { tf: '1W', label: '1W' },
];

const STUDIES: { key: string; label: string; def: string; params?: Record<string, number>; color?: string; on?: boolean }[] = [
  { key: 'vol', label: 'Volume', def: 'volume', on: true },
  { key: 'sma50', label: 'SMA 50', def: 'sma', params: { length: 50 }, color: '#2962ff', on: true },
  { key: 'sma200', label: 'SMA 200', def: 'sma', params: { length: 200 }, color: '#ff9800', on: true },
  { key: 'bb', label: 'Bollinger', def: 'bb' },
  { key: 'rsi', label: 'RSI', def: 'rsi' },
  { key: 'macd', label: 'MACD', def: 'macd' },
];

let lastTimeframe: Timeframe = '1D';
const studiesOn = new Set(STUDIES.filter((s) => s.on).map((s) => s.key));

export interface ChartTab {
  el: HTMLElement;
  timeframe(): Timeframe;
  destroy(): void;
}

export function chartTab(symbol: string, still: () => boolean): ChartTab {
  const chartEl = h('div', { class: 'sv-chart' });
  const message = h('div', { class: 'sv-chart-msg', hidden: true });
  const tfBar = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Timeframe' });
  const studyBar = h('div', { class: 'sv-studies', role: 'group', 'aria-label': 'Studies' });
  const compareInput = h('input', { class: 'input sv-compare', placeholder: 'Compare: SPY', 'aria-label': 'Compare with another symbol', spellcheck: false, maxlength: 12 });
  const compareNote = h('span', { class: 'muted small' });
  const header = createSecurityHeader();
  const state = createChartState();
  const wrap = h('div', { class: 'sv-chart-wrap' }, chartEl, state.el, message);
  const rangeBar = createRangeBar({ view: () => view, timeframe: () => tf, reload: (days) => void load(days) });
  const el = h(
    'div',
    { class: 'sv-chart-tab' },
    header.el,
    h('div', { class: 'sv-subbar' }, tfBar, rangeBar.el, studyBar, h('span', { class: 'sv-compare-box' }, compareInput, compareNote)),
    wrap,
  );
  const view = new ChartView(chartEl);
  view.symbol = symbol;
  view.market = guessMarket(symbol)?.provider ?? 'schwab';
  const legend = new LegendBox(view, { autoRows: true, title: `${symbol.replace(/^\$/, '')}` });
  wrap.append(legend.el);
  view.onDataError = (text) => ((message.hidden = false), message.replaceChildren(note(text)));
  const instances = new Map<string, IndicatorInstance>();
  let tf = lastTimeframe;
  let compare: { symbol: string; series: ISeriesApi<'Line'> } | null = null;
  let seq = 0;
  let alive = true;
  /** The history request on its way (aborted when the timeframe changes or the tab closes). */
  let pending: AbortController | null = null;
  let pendingCompare: AbortController | null = null;

  const addStudy = (key: string) => {
    const spec = STUDIES.find((s) => s.key === key)!;
    const def = getIndicator(spec.def);
    if (!def) return;
    const inst = newIndicatorInstance(def);
    Object.assign(inst.params, spec.params ?? {});
    if (spec.color) inst.colors = { ...inst.colors, ma: spec.color };
    instances.set(key, inst);
    view.addIndicator(inst);
    legend.schedule();
  };
  for (const k of studiesOn) addStudy(k);

  const paintBars = () => {
    tfBar.replaceChildren(...CHART_TIMEFRAMES.map((t) => h('button', { type: 'button', class: t.tf === tf ? 'active' : '', 'aria-pressed': String(t.tf === tf), onclick: () => ((tf = lastTimeframe = t.tf), paintBars(), void load()) }, t.label)));
    rangeBar.render();
    studyBar.replaceChildren(...STUDIES.map((s) => h('label', { class: 'sv-study' }, h('input', { type: 'checkbox', checked: studiesOn.has(s.key), onchange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on) studiesOn.add(s.key), addStudy(s.key);
      else {
        studiesOn.delete(s.key);
        const inst = instances.get(s.key);
        if (inst) view.removeIndicator(inst.uid);
        instances.delete(s.key);
        legend.schedule();
      }
    } }), s.label)));
  };
  paintBars();

  async function load(days?: number) {
    const mine = ++seq;
    const ref = guessMarket(symbol);
    if (!ref) return;
    message.hidden = true;
    pending?.abort();
    const ctl = (pending = new AbortController());
    if (!view.barCount) state.loading(`Loading ${symbol.replace(/^\$/, '')} · ${tf}…`);
    try {
      const bars = await getProvider(ref.provider).loadHistory(ref.symbol, tf, ctl.signal, Math.max(days ?? 0, rangeBar.daysWanted() ?? 0) || undefined);
      if (!alive || mine !== seq || !still()) return;
      state.hide();
      view.setBars(bars, tf);
      rangeBar.apply();
      if (!bars.length) state.empty(`No price history for ${symbol.replace(/^\$/, '')} at ${tf}`);
      header.update({ symbol: symbol.replace(/^\$/, ''), summary: daySummary(bars, tf, marketTimeZone(view.market)), daily: TIMEFRAME_SECONDS[tf] >= 86400, market: view.market, price: (v) => view.formatPrice(v) });
      legend.refresh();
      if (compare) await drawCompare(compare.symbol);
    } catch (err) {
      if (!alive || mine !== seq || ctl.signal.aborted) return;
      state.hide();
      view.setBars([], tf);
      message.hidden = false;
      message.replaceChildren(note(`${symbol}: ${reasonOf(err)}`, 'sv-error'));
    }
  }

  async function drawCompare(sym: string) {
    const ref = guessMarket(sym);
    if (!ref) return;
    pendingCompare?.abort();
    const ctl = (pendingCompare = new AbortController());
    try {
      const bars = await getProvider(ref.provider).loadHistory(ref.symbol, tf, ctl.signal);
      if (!alive || ctl.signal.aborted) return;
      // Bloomberg's multi-line chart: the compare symbol is read on its own left axis (L1), the security on the right (R1).
      compare ??= { symbol: sym, series: view.chart.addSeries(LineSeries, { color: THEME.viz2, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceScaleId: 'left', title: '' }) };
      compare.symbol = sym;
      compare.series.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
      view.chart.applyOptions({ leftPriceScale: { visible: true } });
      const a = bars[0]?.close;
      const z = bars[bars.length - 1]?.close;
      compareNote.textContent = a && z ? `${sym} ${fmtPct(z / a - 1, 1, true)} over the loaded bars` : '';
      legend.setExtra([
        { axis: 'L1', label: sym, color: THEME.viz2, value: z ? formatPrice(z) : '—' },
        { axis: 'R1', label: symbol.replace(/^\$/, ''), color: THEME.accent, value: view.barCount ? view.formatPrice(view.barAt(view.barCount - 1)!.close) : '—' },
      ]);
    } catch (err) {
      if (alive && !ctl.signal.aborted) compareNote.textContent = `${sym}: ${reasonOf(err)}`;
    }
  }

  function clearCompare() {
    if (compare) view.chart.removeSeries(compare.series);
    compare = null;
    compareNote.textContent = '';
    view.chart.applyOptions({ leftPriceScale: { visible: false } });
    legend.setExtra([]);
  }

  compareInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const sym = cleanSymbol(compareInput.value);
    if (!sym) return clearCompare();
    void drawCompare(sym);
  });
  compareInput.addEventListener('input', () => !compareInput.value.trim() && clearCompare());

  void load();
  return {
    el,
    timeframe: () => tf,
    destroy() {
      alive = false;
      pending?.abort();
      pendingCompare?.abort();
      header.destroy();
      legend.destroy();
      try {
        view.destroy();
      } catch {
        // already gone
      }
    },
  };
}
