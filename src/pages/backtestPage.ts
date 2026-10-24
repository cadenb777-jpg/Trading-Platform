/**
 * Backtest: test a strategy on past prices, either a ready-made one or rules built from the indicators on your
 * chart, then stress-test the result like a research desk would: Monte Carlo, a random-walk test, a parameter
 * sweep, monthly returns and the full trade list.
 */
import { backtest, type BacktestOptions, type BacktestResult, type Signals } from '../backtest/engine';
import {
  OPERATORS,
  computeSeries,
  deepStats,
  binsOf,
  monteCarlo,
  monthlyReturns,
  randomWalkTest,
  rangeAround,
  ruleSignals,
  suggestRules,
  sweep,
  type ChartIndicator,
  type Operand,
  type Rule,
  type RuleSet,
  type SweepCell,
} from '../backtest/research';
import { STRATEGIES } from '../backtest/strategies';
import { insightButton } from '../ai/insight';
import { getProvider } from '../data';
import { guessMarket } from '../data/quotes';
import { getIndicator, indicatorLabel } from '../indicators/library';
import type { NumberInput } from '../indicators/types';
import { state } from '../state';
import type { Bar, Timeframe } from '../types';
import { createLineChart, dataTable, money, numberField, pageFrame, pct, statCards, pctU } from '../ui/charts';
import { formatPrice, h, toast } from '../ui/dom';
import { withTableTools } from '../ui/tableTools';
import { displaySymbol } from '../ui/watchlist';

const BASE_TIMEFRAMES: Timeframe[] = ['1D', '1W', '4h', '1h', '30m', '15m', '5m'];
const CHART_ID = 'chart';
const ratio = (v: number | null | undefined) => (v == null ? '—' : Number.isFinite(v) ? v.toFixed(2) : '∞');
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : v >= 0 ? 'up' : 'down');
const tfLabel = (t: string) => (t === '1D' ? 'Daily' : t === '1W' ? 'Weekly' : t);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ResultTab = 'summary' | 'montecarlo' | 'randomwalk' | 'sweep' | 'monthly' | 'trades';
const RESULT_TABS: [ResultTab, string][] = [
  ['summary', 'Summary'],
  ['montecarlo', 'Monte Carlo'],
  ['randomwalk', 'Random-walk test'],
  ['sweep', 'Parameter sweep'],
  ['monthly', 'Monthly returns'],
  ['trades', 'Trades'],
];

/** Vertical bar histogram (SVG) with an optional marker line, e.g. where the real backtest landed. */
function histogram(bins: { from: number; to: number; count: number }[], marker?: { value: number; label: string }) {
  const W = 640;
  const H = 200;
  const pad = { l: 10, r: 10, t: 16, b: 26 };
  const max = Math.max(1, ...bins.map((b) => b.count));
  const lo = bins[0]?.from ?? 0;
  const hi = bins[bins.length - 1]?.to ?? 1;
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  for (const b of bins) {
    const bh = ((H - pad.t - pad.b) * b.count) / max;
    add('rect', { x: x(b.from) + 1, y: H - pad.b - bh, width: Math.max(1, x(b.to) - x(b.from) - 2), height: bh, fill: b.to <= 0 ? '#ef535099' : '#26a69a99', rx: 2 });
    // Hover a bar for its range and count (a full-height invisible target makes short bars easy to hover).
    const target = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x: x(b.from), y: pad.t, width: Math.max(1, x(b.to) - x(b.from)), height: H - pad.t - pad.b, fill: 'transparent' })) target.setAttribute(k, String(v));
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${pct(b.from, 1)} to ${pct(b.to, 1)}: ${b.count} result${b.count === 1 ? '' : 's'}`;
    target.append(title);
    svg.append(target);
  }
  [lo, (lo + hi) / 2, hi].forEach((v, i) => add('text', { x: x(v), y: H - 8, 'text-anchor': ['start', 'middle', 'end'][i], class: 'curve-label' }, pct(v, 0)));
  if (lo < 0 && hi > 0) add('line', { x1: x(0), x2: x(0), y1: pad.t, y2: H - pad.b, stroke: '#787b86', 'stroke-dasharray': '3 3' });
  if (marker) {
    const mx = Math.min(W - pad.r, Math.max(pad.l, x(marker.value)));
    add('line', { x1: mx, x2: mx, y1: 4, y2: H - pad.b, stroke: '#2962ff', 'stroke-width': 2.5 });
    add('text', { x: mx + 4, y: 12, class: 'curve-label strong' }, marker.label);
  }
  return h('div', { class: 'curve-wrap' }, svg);
}

/** Monte Carlo fan: percentile bands of account value by trade number (SVG, trade count on the x-axis). */
function fanChart(bands: { trade: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]) {
  const W = 700;
  const H = 280;
  const pad = { l: 62, r: 14, t: 12, b: 30 };
  const lo = Math.min(...bands.map((b) => b.p5));
  const hi = Math.max(...bands.map((b) => b.p95));
  const maxT = bands[bands.length - 1]?.trade || 1;
  const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'curve-label' }, money(v));
  }
  [0, Math.round(maxT / 2), maxT].forEach((t, i) => add('text', { x: x(t), y: H - 8, 'text-anchor': ['start', 'middle', 'end'][i], class: 'curve-label' }, `${t} trades`));
  const area = (a: 'p5' | 'p25', b: 'p95' | 'p75') => [...bands.map((p) => `${x(p.trade)},${y(p[b])}`), ...[...bands].reverse().map((p) => `${x(p.trade)},${y(p[a])}`)].join(' ');
  add('polygon', { points: area('p5', 'p95'), fill: '#2962ff22' });
  add('polygon', { points: area('p25', 'p75'), fill: '#2962ff44' });
  add('polyline', { points: bands.map((p) => `${x(p.trade)},${y(p.p50)}`).join(' '), fill: 'none', stroke: '#2962ff', 'stroke-width': 2.5 });
  const legend = h('div', { class: 'line-legend static' }, h('span', {}, h('i', { style: 'background:#2962ff' }), 'Median'), h('span', {}, h('i', { style: 'background:#2962ff66' }), 'Middle 50%'), h('span', {}, h('i', { style: 'background:#2962ff22' }), '90% of outcomes'));
  return h('div', { class: 'curve-wrap' }, legend, svg);
}

export function createBacktestPage() {
  let strategyId = CHART_ID;
  let params: Record<string, number> = {};
  let chartInds: ChartIndicator[] = [];
  let rules: RuleSet = { entry: [], entryMode: 'all', exit: [], exitMode: 'any' };
  let chartKey = '';
  let resultTab: ResultTab = 'summary';
  let last: { bars: Bar[]; result: BacktestResult; label: string; symbol: string; timeframe: string; randomWalk?: { pValue: number; verdict: string; median: number; runs: number } } | null = null;
  const research = { mcRuns: 2000, rwRuns: 200 };
  const opts = { capital: 10000, positionSize: 1, commission: 0.0005, slippage: 0.0005, stopLoss: 0, takeProfit: 0, allowShort: false };

  const symbolInput = h('input', { class: 'input symbol', value: 'SPY', 'aria-label': 'Symbol', spellcheck: false });
  const tfSelect = h('select', { class: 'input', 'aria-label': 'Timeframe' }, ...BASE_TIMEFRAMES.map((t) => h('option', { value: t }, tfLabel(t))));
  const stratSelect = h('select', { class: 'input', 'aria-label': 'Strategy' }, h('option', { value: CHART_ID }, 'My chart’s indicators (rules)'), ...STRATEGIES.map((s) => h('option', { value: s.id }, s.name)));
  const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, 'Run backtest');
  const frame = pageFrame('Backtest', 'Test a strategy on history, then stress-test it: Monte Carlo, random-walk test and parameter sweep. Signals on a bar’s close are traded at the next bar’s open.', [
    h('button', { class: 'btn', onclick: () => fromChart(true) }, 'Use my chart'),
    symbolInput,
    tfSelect,
    stratSelect,
    runBtn,
  ]);
  const settings = h('section', { class: 'panel' });
  // After a run the settings fold away so the results are in view; this bar brings them back.
  const settingsBar = h('button', { class: 'btn settings-toggle', hidden: true, onclick: () => toggleSettings() }, 'Show strategy settings');
  function toggleSettings(show = settings.hidden) {
    settings.hidden = !show;
    settingsBar.textContent = show ? 'Hide strategy settings' : 'Show strategy settings';
  }
  const resultTabs = h('div', { class: 'tabs inv-tabs', role: 'tablist', hidden: true }, ...RESULT_TABS.map(([t, l]) => h('button', { class: `tab${t === resultTab ? ' active' : ''}`, 'data-tab': t, onclick: () => showTab(t) }, l)));
  const results = h('div', { class: 'ap-body' });
  frame.body.replaceChildren(settingsBar, settings, resultTabs, results);
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  stratSelect.addEventListener('change', () => {
    strategyId = stratSelect.value;
    renderSettings();
  });

  const preset = () => STRATEGIES.find((s) => s.id === strategyId);

  // ----- Chart link -----

  const snapKey = (snap: ReturnType<typeof chartSnapshot>) => JSON.stringify([snap.symbol, snap.timeframe, snap.inds.map((c) => [c.instance.defId, c.instance.params])]);

  function chartSnapshot() {
    const provider = state.provider;
    // The chart shows the market's default symbol until you pick another one.
    const symbol = state.symbols[provider] || getProvider(provider).defaultSymbol;
    const inds = state.indicators
      .map((instance) => ({ instance, def: getIndicator(instance.defId) }))
      .filter((c): c is ChartIndicator => !!c.def && c.def.placement !== 'volume' && c.def.plots.some((p) => p.type !== 'marker'));
    return { provider, symbol, timeframe: state.timeframe, inds };
  }

  /** Copies the chart's symbol, timeframe and indicators, and suggests rules from them. */
  function fromChart(announce = false) {
    const snap = chartSnapshot();
    if (!snap.symbol) return announce && toast('Open a chart first');
    symbolInput.value = snap.symbol;
    if (![...tfSelect.options].some((o) => o.value === snap.timeframe)) tfSelect.append(h('option', { value: snap.timeframe }, tfLabel(snap.timeframe)));
    tfSelect.value = snap.timeframe;
    chartInds = snap.inds;
    rules = suggestRules(chartInds);
    strategyId = CHART_ID;
    stratSelect.value = CHART_ID;
    chartKey = snapKey(snap);
    renderSettings();
    if (announce) toast(`Loaded ${displaySymbol(snap.symbol)} ${tfLabel(snap.timeframe)} with ${chartInds.length} indicator${chartInds.length === 1 ? '' : 's'} from your chart`);
  }

  function operandOptions(): [string, string][] {
    const out: [string, string][] = [
      ['price:close', 'Price (close)'],
      ['price:high', 'Price (high)'],
      ['price:low', 'Price (low)'],
    ];
    for (const c of chartInds) for (const p of c.def.plots.filter((x) => x.type !== 'marker')) out.push([`ind:${c.instance.uid}:${p.key}`, `${indicatorLabel(c.def, c.instance)} · ${p.title}`]);
    out.push(['value', 'A number']);
    return out;
  }

  const operandKey = (o: Operand) => (o.kind === 'price' ? `price:${o.field}` : o.kind === 'ind' ? `ind:${o.uid}:${o.plot}` : 'value');
  function parseOperand(key: string, value: number): Operand {
    if (key.startsWith('price:')) return { kind: 'price', field: key.slice(6) as 'close' };
    if (key.startsWith('ind:')) {
      const [, uid, plot] = key.split(':');
      return { kind: 'ind', uid, plot };
    }
    return { kind: 'value', value };
  }

  function ruleRow(list: Rule[], i: number, redraw: () => void) {
    const r = list[i];
    const opsList = operandOptions();
    const sel = (o: Operand, onChange: (o: Operand) => void) => {
      const s = h('select', { class: 'input' }, ...opsList.map(([k, l]) => h('option', { value: k, selected: k === operandKey(o) }, l)));
      const n = h('input', { class: 'input rule-num', type: 'number', step: 'any', value: o.kind === 'value' ? o.value : 0, hidden: o.kind !== 'value' });
      const update = () => {
        n.hidden = s.value !== 'value';
        onChange(parseOperand(s.value, parseFloat(n.value) || 0));
      };
      s.addEventListener('change', update);
      n.addEventListener('input', update);
      return [s, n];
    };
    const op = h('select', { class: 'input' }, ...OPERATORS.map(([k, l]) => h('option', { value: k, selected: k === r.op }, l)));
    op.addEventListener('change', () => (r.op = op.value as Rule['op']));
    return h(
      'div',
      { class: 'rule-row' },
      h('div', { class: 'rule-fields' }, ...sel(r.left, (o) => (r.left = o)), op, ...sel(r.right, (o) => (r.right = o))),
      h('button', { class: 'icon-btn', title: 'Remove rule', 'aria-label': 'Remove rule', onclick: () => (list.splice(i, 1), redraw()) }, '✕'),
    );
  }

  function ruleBlock(title: string, which: 'entry' | 'exit') {
    const box = h('div', { class: 'rule-block' });
    const draw = () => {
      const list = rules[which];
      const modeKey = which === 'entry' ? 'entryMode' : 'exitMode';
      const mode = h('select', { class: 'input' }, h('option', { value: 'all', selected: rules[modeKey] === 'all' }, 'when ALL of these are true'), h('option', { value: 'any', selected: rules[modeKey] === 'any' }, 'when ANY of these is true'));
      mode.addEventListener('change', () => (rules[modeKey] = mode.value as 'all' | 'any'));
      box.replaceChildren(
        h('div', { class: 'rule-head' }, h('b', {}, title), mode),
        ...list.map((_, i) => ruleRow(list, i, draw)),
        list.length ? '' : h('p', { class: 'muted small' }, which === 'entry' ? 'No entry rules yet.' : 'No exit rules: trades only close on stop-loss, take-profit or the end of the data.'),
        h('button', { class: 'btn small', onclick: () => (list.push({ left: { kind: 'price', field: 'close' }, op: 'crossAbove', right: chartInds[0] ? { kind: 'ind', uid: chartInds[0].instance.uid, plot: chartInds[0].def.plots[0].key } : { kind: 'value', value: 0 } }), draw()) }, '+ Add rule'),
      );
    };
    draw();
    return box;
  }

  // ----- Settings -----

  function renderSettings() {
    toggleSettings(true);
    const p = preset();
    const short = h('input', { type: 'checkbox', checked: opts.allowShort });
    short.addEventListener('change', () => (opts.allowShort = short.checked));
    let strategyPart: (Node | string)[];
    if (p) {
      params = Object.fromEntries(p.params.map((x) => [x.key, x.default]));
      strategyPart = [h('div', { class: 'panel-head' }, h('h3', {}, p.name)), h('p', { class: 'muted' }, p.description), h('div', { class: 'field-grid' }, ...p.params.map((x) => numberField(x.label, x.default, (v) => (params[x.key] = v), { step: x.step })))];
    } else {
      const external = chartInds.filter((c) => c.def.external).map((c) => c.def.shortName);
      strategyPart = [
        h('div', { class: 'panel-head' }, h('h3', {}, 'Strategy from my chart'), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => ((rules = suggestRules(chartInds)), renderSettings()) }, 'Suggest rules again')),
        chartInds.length
          ? h('div', { class: 'chip-row' }, h('span', { class: 'muted small' }, 'Indicators:'), ...chartInds.map((c) => h('span', { class: 'chip on' }, indicatorLabel(c.def, c.instance))))
          : h('p', { class: 'muted' }, 'No indicators loaded. Add indicators on the Chart page, then click "Use my chart" (or the Backtest button on the chart). You can still build rules on price.'),
        external.length ? h('p', { class: 'muted small' }, `${external.join(', ')} use weekly outside data; it's loaded for the backtest and applied from the day it was published.`) : '',
        h('div', { class: 'two-col rules-grid' }, ruleBlock('Buy', 'entry'), ruleBlock('Sell', 'exit')),
      ];
    }
    const sel = (values: number[], current: number, label: (v: number) => string, set: (v: number) => void) => {
      const s = h('select', { class: 'input' }, ...values.map((v) => h('option', { value: v, selected: v === current }, label(v))));
      s.addEventListener('change', () => set(Number(s.value)));
      return s;
    };
    settings.replaceChildren(
      ...strategyPart,
      h('h4', {}, 'Money and costs'),
      h(
        'div',
        { class: 'field-grid' },
        numberField('Starting capital ($)', opts.capital, (v) => (opts.capital = v)),
        numberField('Position size (% of equity)', opts.positionSize, (v) => (opts.positionSize = v), { percent: true, step: 5 }),
        numberField('Commission per trade', opts.commission, (v) => (opts.commission = v), { percent: true, step: 0.01, hint: 'Webull charges no stock commission, but regulatory fees apply on sales' }),
        numberField('Slippage per trade', opts.slippage, (v) => (opts.slippage = v), { percent: true, step: 0.01, hint: 'The gap between the price you see and the price you get' }),
        numberField('Stop-loss (0 = off)', opts.stopLoss, (v) => (opts.stopLoss = v), { percent: true }),
        numberField('Take-profit (0 = off)', opts.takeProfit, (v) => (opts.takeProfit = v), { percent: true }),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Short selling'), h('span', { class: 'field-input' }, short, h('span', {}, 'Also bet on falls'))),
      ),
      h('h4', {}, 'Research'),
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Monte Carlo simulations'), sel([1000, 2000, 5000, 10000], research.mcRuns, (v) => v.toLocaleString('en-US'), (v) => (research.mcRuns = v))),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Random-walk runs'), sel([100, 200, 500, 1000], research.rwRuns, (v) => v.toLocaleString('en-US'), (v) => (research.rwRuns = v))),
      ),
    );
  }

  // ----- Running -----

  const backtestOpts = (): BacktestOptions => ({ ...opts, stopLoss: opts.stopLoss || undefined, takeProfit: opts.takeProfit || undefined });

  /** Signals for these bars, with optional setting overrides (for the parameter sweep). */
  function signalsFor(bars: Bar[], overrides: Record<string, number> = {}): Signals {
    const p = preset();
    if (p) return p.signals(bars, { ...params, ...overrides }, opts.allowShort);
    return ruleSignals(bars, computeSeries(bars, chartInds, overrides), rules, opts.allowShort);
  }

  async function loadExternal(symbol: string) {
    if (preset()) return;
    for (const c of chartInds) {
      if (!c.def.external) continue;
      try {
        c.external = await c.def.external.load(symbol);
      } catch (err) {
        c.external = [];
        toast(`${c.def.shortName}: ${(err as Error).message}`);
      }
    }
  }

  async function run() {
    const ref = guessMarket(symbolInput.value.trim());
    if (!ref) return;
    if (!preset() && !rules.entry.length) return toast('Add at least one Buy rule');
    const tf = tfSelect.value as Timeframe;
    results.replaceChildren(h('div', { class: 'muted pad' }, `Loading ${displaySymbol(ref.symbol)} history…`));
    resultTabs.hidden = true;
    try {
      const [bars] = await Promise.all([getProvider(ref.provider).loadHistory(ref.symbol, tf, new AbortController().signal), loadExternal(ref.symbol)]);
      if (bars.length < 50) throw new Error('Not enough history for a backtest.');
      const result = backtest(bars, signalsFor(bars), backtestOpts());
      last = { bars, result, label: `${displaySymbol(ref.symbol)} · ${tfLabel(tf)} · ${preset()?.name ?? 'Chart rules'}`, symbol: displaySymbol(ref.symbol), timeframe: tfLabel(tf) };
      ai.panel.hidden = true;
      resultTabs.hidden = false;
      settingsBar.hidden = false;
      toggleSettings(false);
      showTab(resultTab);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  const operandText = (o: Operand) => (o.kind === 'value' ? String(o.value) : (operandOptions().find(([k]) => k === operandKey(o))?.[1] ?? operandKey(o)));
  const ruleText = (r: Rule) => `${operandText(r.left)} ${r.op} ${operandText(r.right)}`;
  const ai = insightButton(() => {
    if (!last) return null;
    const { result: r, bars } = last;
    const p = preset();
    const mc = monteCarlo(r.trades, opts.capital, opts.positionSize, r.stats.maxDrawdown, research.mcRuns, 7, opts.commission);
    return {
      topic: 'backtest',
      symbol: last.symbol,
      timeframe: last.timeframe,
      title: `AI review: ${last.label}`,
      data: {
        strategy: p ? { name: p.name, params: { ...Object.fromEntries(p.params.map((x) => [x.key, x.default])), ...params } } : { buyWhen: `${rules.entryMode.toUpperCase()} of: ${rules.entry.map(ruleText).join('; ')}`, sellWhen: rules.exit.length ? `${rules.exitMode.toUpperCase()} of: ${rules.exit.map(ruleText).join('; ')}` : 'no exit rules' },
        settings: opts,
        history: { bars: bars.length, from: date(bars[0].time), to: date(bars[bars.length - 1].time) },
        stats: r.stats,
        deepStats: deepStats(r, opts.capital),
        monteCarlo: mc && { runs: mc.runs, finalReturn: mc.finalReturn, maxDrawdown: mc.maxDrawdown, lossChance: mc.lossChance, worseDrawdownChance: mc.worseDrawdownChance },
        randomWalk: last.randomWalk ?? 'not run yet (open the Random-walk tab to include it)',
      },
    };
  }, 'AI review');

  function showTab(t: ResultTab) {
    resultTab = t;
    resultTabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    if (!last) return;
    const { bars, result } = last;
    const header = h('div', { class: 'home-ai-row' }, h('span', { class: 'muted small' }, `${last.label} · ${bars.length} bars from ${date(bars[0].time)} to ${date(bars[bars.length - 1].time)}`), h('span', { class: 'spacer' }), ai.button);
    const body =
      t === 'summary'
        ? summaryView(result)
        : t === 'montecarlo'
          ? monteCarloView(result)
          : t === 'randomwalk'
            ? randomWalkView(bars, result)
            : t === 'sweep'
              ? sweepView(bars)
              : t === 'monthly'
                ? monthlyView(result)
                : tradesView(result);
    results.replaceChildren(header, ai.panel, ...body);
  }

  // ----- Result views -----

  function summaryView(r: BacktestResult): Node[] {
    const s = r.stats;
    const d = deepStats(r, opts.capital);
    const curve = h('div');
    const dd = h('div');
    requestAnimationFrame(() => {
      createLineChart(curve, { height: 320, format: money }).set([
        { name: 'Strategy', color: '#2962ff', data: r.equity.map((e) => ({ time: e.time, value: e.value })) },
        { name: 'Buy and hold', color: '#9598a1', width: 1, data: r.buyHold },
      ]);
      let peak = -Infinity;
      createLineChart(dd, { height: 160, format: (v) => `${(v * 100).toFixed(0)}%` }).set([
        {
          name: 'Drawdown',
          color: '#ef5350',
          data: r.equity.map((e) => {
            peak = Math.max(peak, e.value);
            return { time: e.time, value: e.value / peak - 1 };
          }),
        },
      ]);
    });
    const tradeReturns = r.trades.map((x) => x.returnPct);
    return [
      statCards([
        { label: 'Strategy return', value: pct(s.totalReturn, 1), hint: s.cagr != null ? `${pct(s.cagr, 1)} a year` : '', tone: tone(s.totalReturn) },
        { label: 'Buy and hold', value: pct(s.buyHoldReturn, 1), tone: tone(s.buyHoldReturn) },
        { label: 'Max drawdown', value: pctU(s.maxDrawdown, 1), hint: `Longest underwater stretch ${d.longestDrawdownDays} days`, tone: 'down' },
        { label: 'Sharpe ratio', value: ratio(s.sharpe), hint: `Sortino ${ratio(d.sortino)} · Calmar ${ratio(d.calmar)}` },
        { label: 'Trades', value: String(s.trades), hint: `In the market ${(s.exposure * 100).toFixed(0)}% of the time · avg ${d.avgBars?.toFixed(1) ?? '—'} bars` },
        { label: 'Win rate', value: s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`, hint: `Max ${d.maxConsecutiveLosses} losses in a row` },
        { label: 'Profit factor', value: ratio(s.profitFactor), hint: 'Total won ÷ total lost. Above 1.5 is good.' },
        { label: 'Expectancy per trade', value: pct(d.expectancy, 2), hint: `Wins ${pct(s.avgWin, 1)} · losses ${pct(s.avgLoss, 1)}`, tone: tone(d.expectancy) },
        { label: 'Kelly fraction', value: d.kelly == null ? '—' : pctU(d.kelly, 0), hint: 'Theoretical best bet size; most pros use a quarter to half of it' },
        { label: 'Recovery factor', value: ratio(d.recoveryFactor), hint: 'Net profit ÷ worst drawdown ($)' },
        { label: 'Best / worst trade', value: `${pct(d.bestTrade, 1)} / ${pct(d.worstTrade, 1)}` },
        { label: 'Costs paid', value: money(s.costs) },
      ]),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Equity curve')), curve),
      h('div', { class: 'two-col' }, h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Drawdown')), dd), h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Trade returns'), h('span', { class: 'muted small' }, 'How the wins and losses are spread')), tradeReturns.length > 2 ? histogram(binsOf(tradeReturns, 20)) : h('p', { class: 'muted' }, 'Not enough trades.'))),
      h('p', { class: 'ap-note' }, 'Backtests flatter strategies: they ignore taxes, can’t include every real-world cost, and settings tuned on the past often fail later. Check the Monte Carlo and random-walk tabs, and paper trade before using real money.'),
    ];
  }

  function monteCarloView(r: BacktestResult): Node[] {
    const mc = monteCarlo(r.trades, opts.capital, opts.positionSize, r.stats.maxDrawdown, research.mcRuns, 7, opts.commission);
    if (!mc) return [h('p', { class: 'muted' }, 'Monte Carlo needs at least 5 trades. Try a longer history or a faster timeframe.')];
    return [
      h('p', { class: 'muted' }, `${mc.runs.toLocaleString('en-US')} simulations: the strategy's ${r.trades.length} trades drawn at random (with replacement), in random order. It shows the range of results the same edge could have produced through luck alone.`),
      statCards([
        { label: 'Median outcome', value: pct(mc.finalReturn.p50, 1), tone: tone(mc.finalReturn.p50), hint: `Backtest: ${pct(r.stats.totalReturn, 1)}` },
        { label: 'Bad case (5th percentile)', value: pct(mc.finalReturn.p5, 1), tone: tone(mc.finalReturn.p5) },
        { label: 'Good case (95th percentile)', value: pct(mc.finalReturn.p95, 1), tone: tone(mc.finalReturn.p95) },
        { label: 'Chance of losing money', value: pctU(mc.lossChance, 0), tone: mc.lossChance > 0.2 ? 'down' : '' },
        { label: 'Typical max drawdown', value: pctU(mc.maxDrawdown.p50, 1), tone: 'down', hint: `1 in 20 runs worse than ${pctU(mc.maxDrawdown.p95, 1)}` },
        { label: 'Chance of a deeper drawdown than the backtest', value: pctU(mc.worseDrawdownChance, 0), hint: 'Plan for drawdowns bigger than the one you saw' },
      ]),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Account value by trade number'), h('span', { class: 'muted small' }, 'The fan of possible paths')), fanChart(mc.bands)),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Distribution of final returns')), histogram(mc.histogram, { value: r.stats.totalReturn, label: 'Backtest' })),
    ];
  }

  function randomWalkView(bars: Bar[], r: BacktestResult): Node[] {
    if (!r.trades.length) return [h('p', { class: 'muted' }, 'The strategy made no trades on this history, so there is nothing to test against random walks. Try a longer history or different settings.')];
    const out = h('div', { class: 'ap-body' }, h('div', { class: 'muted pad' }, `Running the strategy on ${research.rwRuns} random walks…`));
    setTimeout(() => {
      const test = randomWalkTest(bars, (fake) => backtest(fake, signalsFor(fake), backtestOpts()).stats.totalReturn, r.stats.totalReturn, research.rwRuns);
      if (last?.result === r) last.randomWalk = { pValue: test.pValue, verdict: test.verdict, median: test.median, runs: test.runs };
      const verdict = {
        edge: ['Likely a real edge', 'up', `Only ${pctU(test.pValue, 1)} of random price histories did as well. That's unlikely to be luck alone.`],
        maybe: ['Inconclusive', '', `${pctU(test.pValue, 0)} of random histories did as well. Some evidence of an edge, but not strong; test on other symbols and periods.`],
        luck: ['Probably luck or market drift', 'down', `${pctU(test.pValue, 0)} of random histories did as well, so the result can be explained by chance (or just the market going up).`],
      }[test.verdict];
      out.replaceChildren(
        statCards([
          { label: 'Verdict', value: verdict[0], tone: verdict[1] as 'up' | 'down' | '', hint: verdict[2] },
          { label: 'p-value', value: test.pValue.toFixed(3), hint: 'Below 0.05 is the usual bar for "statistically significant"' },
          { label: 'Beat random runs', value: pctU(test.percentileRank, 0) },
          { label: 'Median random-walk result', value: pct(test.median, 1), tone: tone(test.median), hint: `Backtest: ${pct(test.actual, 1)}` },
        ]),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Strategy results on random walks'), h('span', { class: 'muted small' }, 'Blue line = the real backtest')), histogram(binsOf(test.returns), { value: test.actual, label: 'Real backtest' })),
        h('p', { class: 'ap-note' }, `How it works: each random walk reuses ${displaySymbol(symbolInput.value)}'s own daily moves in a shuffled order, so it has the same volatility and drift but no real patterns. A strategy with a genuine edge should do clearly better on the real prices than on these.`),
      );
    }, 30);
    return [out];
  }

  function sweepView(bars: Bar[]): Node[] {
    const p = preset();
    const choices: { key: string; label: string; value: number; integer: boolean }[] = p
      ? p.params.map((x) => ({ key: x.key, label: x.label, value: params[x.key] ?? x.default, integer: (x.step ?? 1) >= 1 }))
      : chartInds.flatMap((c) =>
          c.def.inputs
            .filter((i): i is NumberInput => i.type === 'number')
            .map((i) => ({ key: `${c.instance.uid}.${i.key}`, label: `${c.def.shortName}: ${i.label}`, value: Number(c.instance.params[i.key] ?? i.default), integer: (i.step ?? 1) >= 1 })),
        );
    if (!choices.length) return [h('p', { class: 'muted' }, 'This strategy has no adjustable settings to sweep.')];
    const xSel = h('select', { class: 'input' }, ...choices.map((c, i) => h('option', { value: i }, c.label)));
    const ySel = h('select', { class: 'input' }, h('option', { value: -1 }, '(none)'), ...choices.map((c, i) => h('option', { value: i, selected: i === 1 }, c.label)));
    const xVals = h('input', { class: 'input', style: 'min-width:220px' });
    const yVals = h('input', { class: 'input', style: 'min-width:220px' });
    const metric = h('select', { class: 'input' }, h('option', { value: 'totalReturn' }, 'Total return'), h('option', { value: 'sharpe' }, 'Sharpe ratio'), h('option', { value: 'maxDrawdown' }, 'Max drawdown'));
    const fill = () => {
      const x = choices[Number(xSel.value)];
      const y = choices[Number(ySel.value)];
      xVals.value = rangeAround(x.value, 7, x.integer).join(', ');
      yVals.value = y ? rangeAround(y.value, 6, y.integer).join(', ') : '';
    };
    xSel.addEventListener('change', fill);
    ySel.addEventListener('change', fill);
    fill();
    const out = h('div');
    let cells: SweepCell[] = [];
    const draw = () => {
      if (!cells.length) return;
      const m = metric.value as 'totalReturn' | 'sharpe' | 'maxDrawdown';
      const xs = [...new Set(cells.map((c) => c.x))];
      const ys = [...new Set(cells.map((c) => c.y))];
      // Settings that never traded have no result to compare: leave them out of the colours and the "best".
      const traded = cells.filter((c) => c.trades > 0);
      if (!traded.length) return out.replaceChildren(h('p', { class: 'muted' }, 'None of these settings produced a single trade on this history. Try a longer history, a faster timeframe or shorter settings.'));
      const vals = traded.map((c) => c[m] ?? NaN).filter(Number.isFinite);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const color = (v: number | null) => {
        if (v == null || !Number.isFinite(v)) return '';
        const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        return `background:rgba(${Math.round(239 - 201 * t)},${Math.round(83 + 83 * t)},${Math.round(80 + 74 * t)},0.35)`;
      };
      const fmt = (v: number | null) => (m === 'sharpe' ? ratio(v) : m === 'maxDrawdown' ? pctU(v, 1) : pct(v, 1));
      const best = traded.reduce((a, c) => ((c[m] ?? -Infinity) > (a[m] ?? -Infinity) ? c : a), traded[0]);
      const xLabel = choices[Number(xSel.value)].label;
      const yLabel = Number(ySel.value) >= 0 ? choices[Number(ySel.value)].label : '';
      out.replaceChildren(
        h('p', { class: 'muted small' }, `Best: ${xLabel} = ${best.x}${best.y != null ? `, ${yLabel} = ${best.y}` : ''} (${fmt(best[m])}). Look for a broad area of good results, not one bright cell: a lone peak usually means curve-fitting.`),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data-table heat-table' },
            h('thead', {}, h('tr', {}, h('th', {}, yLabel ? `${yLabel} ↓ / ${xLabel} →` : xLabel), ...xs.map((x) => h('th', {}, String(x))))),
            h(
              'tbody',
              {},
              ...ys.map((y) =>
                h(
                  'tr',
                  {},
                  h('td', { class: 'label' }, y == null ? m : String(y)),
                  ...xs.map((x) => {
                    const c = cells.find((k) => k.x === x && k.y === y);
                    if (c && !c.trades) return h('td', { class: 'muted small', title: 'This setting never traded on this history (e.g. the average is longer than the data)' }, 'no trades');
                    return h('td', { style: color(c?.[m] ?? null), title: c ? `${c.trades} trades · return ${pct(c.totalReturn, 1)} · Sharpe ${ratio(c.sharpe)} · max DD ${pctU(c.maxDrawdown, 1)}` : '' }, c ? fmt(c[m]) : '—');
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    };
    metric.addEventListener('change', draw);
    const go = () => {
      const x = choices[Number(xSel.value)];
      const y = Number(ySel.value) >= 0 && Number(ySel.value) !== Number(xSel.value) ? choices[Number(ySel.value)] : undefined;
      const parse = (s: string) => s.split(/[,\s]+/).map(Number).filter(Number.isFinite).slice(0, 12);
      out.replaceChildren(h('div', { class: 'muted pad' }, 'Running…'));
      setTimeout(() => {
        cells = sweep(bars, (ov) => signalsFor(bars, ov), backtestOpts(), x.key, parse(xVals.value), y?.key, y ? parse(yVals.value) : []);
        draw();
      }, 20);
    };
    return [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Parameter sweep'), h('span', { class: 'muted small' }, 'Re-runs the backtest across many settings to check the result is robust')),
        h(
          'div',
          { class: 'field-grid' },
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Setting across'), xSel),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Values'), xVals),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Setting down (optional)'), ySel),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Values'), yVals),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Colour by'), metric),
        ),
        h('div', { class: 'ap-controls', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: go }, 'Run sweep')),
        out,
      ),
    ];
  }

  function monthlyView(r: BacktestResult): Node[] {
    const rows = monthlyReturns(r.equity);
    const cell = (v: number | null) => h('td', { class: v == null ? 'muted' : '', style: v == null ? '' : `background:${v >= 0 ? `rgba(38,166,154,${Math.min(0.55, Math.abs(v) * 6)})` : `rgba(239,83,80,${Math.min(0.55, Math.abs(v) * 6)})`}` }, v == null ? '' : `${(v * 100).toFixed(1)}%`);
    return [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Monthly returns'), h('span', { class: 'muted small' }, 'Of the whole account (cash included)')),
        h(
          'div',
          { class: 'table-wrap' },
          withTableTools(
            h(
              'table',
              { class: 'data-table heat-table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Year'), ...MONTHS.map((m) => h('th', {}, m)), h('th', {}, 'Year'))),
              h('tbody', {}, ...[...rows.entries()].reverse().map(([y, vals]) => h('tr', {}, h('td', { class: 'label' }, String(y)), ...vals.map(cell)))),
            ),
            { id: 'backtest:monthly' },
          ),
        ),
      ),
    ];
  }

  function tradesView(r: BacktestResult): Node[] {
    return [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Trades'), h('span', { class: 'muted small' }, 'Newest first')),
        r.trades.length
          ? dataTable(
              ['Side', 'Entry', 'Entry price', 'Exit', 'Exit price', 'Bars', 'Return', 'P&L', 'Exit reason'],
              [...r.trades].reverse().map((t) => [
                { v: t.side === 'long' ? 'Long' : 'Short', cls: t.side === 'long' ? 'up' : 'down' },
                date(t.entryTime),
                formatPrice(t.entryPrice),
                date(t.exitTime),
                formatPrice(t.exitPrice),
                String(t.bars),
                { v: pct(t.returnPct, 2), cls: t.returnPct >= 0 ? 'up' : 'down' },
                { v: money(t.pnl), cls: t.pnl >= 0 ? 'up' : 'down' },
                t.reason === 'signal' ? 'Signal' : t.reason === 'stop' ? 'Stop-loss' : t.reason === 'target' ? 'Take-profit' : 'Still open at end',
              ]),
            )
          : h('p', { class: 'muted' }, 'No trades. Try different rules or a longer history.'),
      ),
    ];
  }

  renderSettings();
  let started = false;
  return {
    el: frame.el,
    /** Called by the chart's Backtest button. */
    fromChart() {
      fromChart(true);
    },
    start() {
      // First visit, or the chart changed since: offer the chart's setup.
      const snap = chartSnapshot();
      const key = snapKey(snap);
      if (!started) {
        started = true;
        if (snap.symbol) fromChart(false);
      } else if (key !== chartKey && strategyId === CHART_ID && snap.symbol) {
        fromChart(false);
      }
    },
  };
}
