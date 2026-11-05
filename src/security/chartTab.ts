/**
 * The security view's GP tab: the platform's own chart engine (ChartView) with timeframes, a few standard studies
 * and a compare overlay (both lines in % from the first bar on screen). "Open in Chart" (the action bar) carries the
 * symbol and timeframe to the full Chart page.
 */
import { LineSeries, PriceScaleMode, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { ChartView } from '../chart/ChartView';
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
  const el = h(
    'div',
    { class: 'sv-chart-tab' },
    h('div', { class: 'sv-subbar' }, tfBar, studyBar, h('span', { class: 'sv-compare-box' }, compareInput, compareNote)),
    h('div', { class: 'sv-chart-wrap' }, chartEl, message),
  );
  const view = new ChartView(chartEl);
  view.symbol = symbol;
  view.market = guessMarket(symbol)?.provider ?? 'schwab';
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
  };
  for (const k of studiesOn) addStudy(k);

  const paintBars = () => {
    tfBar.replaceChildren(...CHART_TIMEFRAMES.map((t) => h('button', { type: 'button', class: t.tf === tf ? 'active' : '', 'aria-pressed': String(t.tf === tf), onclick: () => ((tf = lastTimeframe = t.tf), paintBars(), void load()) }, t.label)));
    studyBar.replaceChildren(...STUDIES.map((s) => h('label', { class: 'sv-study' }, h('input', { type: 'checkbox', checked: studiesOn.has(s.key), onchange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on) studiesOn.add(s.key), addStudy(s.key);
      else {
        studiesOn.delete(s.key);
        const inst = instances.get(s.key);
        if (inst) view.removeIndicator(inst.uid);
        instances.delete(s.key);
      }
    } }), s.label)));
  };
  paintBars();

  async function load() {
    const mine = ++seq;
    const ref = guessMarket(symbol);
    if (!ref) return;
    message.hidden = true;
    pending?.abort();
    const ctl = (pending = new AbortController());
    try {
      const bars = await getProvider(ref.provider).loadHistory(ref.symbol, tf, ctl.signal);
      if (!alive || mine !== seq || !still()) return;
      view.setBars(bars, tf);
      if (compare) await drawCompare(compare.symbol);
    } catch (err) {
      if (!alive || mine !== seq || ctl.signal.aborted) return;
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
      compare ??= { symbol: sym, series: view.chart.addSeries(LineSeries, { color: THEME.text, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: sym }) };
      compare.symbol = sym;
      compare.series.applyOptions({ title: sym });
      compare.series.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
      view.chart.priceScale('right').applyOptions({ mode: PriceScaleMode.Percentage });
      const a = bars[0]?.close;
      const z = bars[bars.length - 1]?.close;
      compareNote.textContent = a && z ? `${sym} ${fmtPct(z / a - 1, 1, true)} over the loaded bars` : '';
    } catch (err) {
      if (alive && !ctl.signal.aborted) compareNote.textContent = `${sym}: ${reasonOf(err)}`;
    }
  }

  function clearCompare() {
    if (compare) view.chart.removeSeries(compare.series);
    compare = null;
    compareNote.textContent = '';
    view.chart.priceScale('right').applyOptions({ mode: PriceScaleMode.Normal });
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
      try {
        view.destroy();
      } catch {
        // already gone
      }
    },
  };
}
