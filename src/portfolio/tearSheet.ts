/**
 * Portfolio tear sheet (Account, Portfolios; the client report draws the same reply): value-at-risk and expected
 * shortfall, correlation heat map, rolling 6-month beta and Sharpe vs SPY, the five deepest drawdowns, monthly
 * returns, a block-bootstrap Monte Carlo of the portfolio's value and each holding's share of the risk. The maths is
 * in the helper (engine/tearsheet.py, tested); this file draws it.
 */
import { engineRequest } from '../data/schwab';
import { createLineChart, dataTable, money, pct, pctU } from '../ui/charts';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { THEME } from '../ui/theme';
import { fanSvg } from '../ui/quantCharts';
import { heatScale, heatStyle } from './heat';

export interface TearSheet {
  symbols: string[];
  weights: number[];
  value: number;
  start: string;
  end: string;
  days: number;
  riskFree: number;
  priceOnly: string[];
  volatility: number;
  var: { level: number; days: number; historical: number; historicalCvar: number; parametric: number; parametricCvar: number; samples: number }[];
  correlation: { symbols: string[]; matrix: number[][] };
  rolling: { window: number; dates: string[]; beta: (number | null)[]; sharpe: (number | null)[] };
  drawdowns: { start: string; trough: string; recovered: string | null; depth: number; days: number; toTrough: number }[];
  drawdownNow: number;
  monthly: { year: number; months: (number | null)[]; total: number }[];
  monteCarlo: { years: number; paths: number; block: number; start: number; percentiles: Record<string, number[]>; lossChance: number[] } | null;
  risk: { symbol: string; weight: number; share: number; volatility: number }[];
  sources: string;
  asOf: string;
}

export interface TearSheetHolding {
  symbol: string;
  weight: number;
}

export type TearSection = 'var' | 'correlation' | 'rolling' | 'drawdowns' | 'monthly' | 'montecarlo' | 'risk';

export const fetchTearSheet = (holdings: TearSheetHolding[], value: number, horizon = 10) =>
  engineRequest<TearSheet>('quant.tearsheet', { holdings, value, horizon, years: 5 }, 180000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const panel = (title: string, note: Node | string | null, ...body: (Node | null)[]) =>
  h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), note ? h('span', { class: 'muted small' }, note) : null), ...body);

/**
 * The tear sheet as a self-loading block. `label` names a symbol for display (e.g. cash stand-ins), `omit` leaves out
 * sections a page already shows elsewhere.
 */
export function tearSheetBlock(holdings: TearSheetHolding[], value: number, opts: { omit?: TearSection[]; label?: (symbol: string) => string; title?: string } = {}) {
  const omit = new Set(opts.omit ?? []);
  const label = opts.label ?? ((s: string) => (s === 'CASH' ? 'Cash' : s));
  const el = h('div', { class: 'qp-tear' });
  let horizon = 10;
  const head = h('h2', { class: 'section-label acct-section' }, opts.title ?? 'Risk tear sheet');

  async function load() {
    el.replaceChildren(head, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Measuring value-at-risk, drawdowns and correlations from up to 5 years of daily prices…')));
    try {
      const t = await fetchTearSheet(holdings, value, horizon);
      draw(t);
    } catch (err) {
      el.replaceChildren(head, h('section', { class: 'panel' }, h('div', { class: 'ap-error' }, (err as Error).message)));
    }
  }

  function draw(t: TearSheet) {
    const parts: (Node | null)[] = [head, h('p', { class: 'muted small' }, `Today's weights held ${t.start} to ${t.end} (${t.days.toLocaleString('en-US')} trading days; the youngest holding sets the start). Cash earns nothing. ${t.priceOnly.length ? `Price-only (no dividend data): ${t.priceOnly.join(', ')}. ` : ''}Sources: ${t.sources}.`)];
    if (!omit.has('var')) parts.push(varPanel(t));
    const pair: Node[] = [];
    if (!omit.has('drawdowns')) pair.push(drawdownPanel(t));
    if (!omit.has('risk')) pair.push(riskPanel(t, label));
    if (pair.length) parts.push(pair.length > 1 ? h('div', { class: 'two-col' }, ...pair) : pair[0]);
    if (!omit.has('rolling')) parts.push(rollingPanel(t));
    if (!omit.has('monthly')) parts.push(monthlyPanel(t));
    if (!omit.has('correlation') && t.correlation.symbols.length > 1) parts.push(correlationPanel(t, label));
    if (!omit.has('montecarlo') && t.monteCarlo) parts.push(monteCarloPanel(t));
    parts.push(h('p', { class: 'ap-note' }, 'Past prices describe how the holdings behaved, not what they will do. Value-at-risk is a typical bad day, not the worst case. Not investment advice.'));
    el.replaceChildren(...parts.filter((p): p is Node => !!p));
  }

  function monteCarloPanel(t: TearSheet) {
    const mc = t.monteCarlo!;
    const pick = h('select', { class: 'input', 'aria-label': 'Years ahead' }, ...Array.from({ length: 10 }, (_, k) => h('option', { value: k + 1, selected: k + 1 === mc.years }, `${k + 1} year${k ? 's' : ''}`)));
    pick.addEventListener('change', () => ((horizon = +pick.value), load()));
    const end = (p: string) => mc.percentiles[p][mc.years];
    return panel(
      `Monte Carlo: ${money(mc.start)} over the next ${mc.years} year${mc.years > 1 ? 's' : ''}`,
      h('span', {}, `${mc.paths.toLocaleString('en-US')} paths, ${mc.block}-day blocks of past daily returns `, pick),
      fanSvg(mc.percentiles, money, mc.start),
      dataTable(
        ['After ' + mc.years + (mc.years > 1 ? ' years' : ' year'), 'Worst 5%', 'Poor (25th)', 'Median', 'Good (75th)', 'Best 5%', 'Chance of a loss'],
        [[{ v: 'Portfolio value', cls: 'label' }, money(end('5')), money(end('25')), h('b', {}, money(end('50'))), money(end('75')), money(end('95')), pctU(mc.lossChance[mc.years], 0)]],
        undefined,
        false,
      ),
      h('p', { class: 'muted small' }, 'Block bootstrap: the history is cut into one-month stretches that are drawn at random and glued together, so calm and stormy spells stay intact. Seeded, so the same history gives the same fan.'),
    );
  }

  queueMicrotask(load);
  return el;
}

export function varPanel(t: TearSheet) {
  const v = t.value;
  const cell = (x: number) => h('span', {}, h('b', {}, money(-x * v)), h('span', { class: 'muted small' }, ` ${pctU(x, 2)}`));
  return panel(
    'Value at risk and expected shortfall',
    h('span', {}, 'On ', money(v), ' · ', infoTip('expectedShortfall')),
    dataTable(
      ['Confidence, horizon', 'Historical VaR', 'Historical CVaR', 'Normal VaR', 'Normal CVaR'],
      t.var.map((r) => [{ v: `${Math.round(r.level * 100)}%, ${r.days} day${r.days > 1 ? 's' : ''}`, cls: 'label' }, cell(r.historical), cell(r.historicalCvar), cell(r.parametric), cell(r.parametricCvar)]),
      undefined,
      false,
    ),
    h(
      'p',
      { class: 'muted small' },
      'VaR: the loss beaten on only 5% (or 1%) of days. CVaR (expected shortfall): the average loss on those bad days. Historical uses the actual worst days (10-day: every overlapping 10-day stretch); normal assumes a bell curve, which usually understates big falls.',
    ),
  );
}

export function drawdownPanel(t: TearSheet) {
  return panel(
    'Deepest drawdowns',
    t.drawdownNow < -0.0005 ? `Now ${pct(t.drawdownNow, 1)} below the high` : 'At a high now',
    t.drawdowns.length
      ? dataTable(
          ['Fall', 'Started', 'Bottom', 'Recovered', 'Length'],
          t.drawdowns.map((d) => [{ v: pct(d.depth, 1), cls: 'down' }, d.start, d.trough, d.recovered ?? h('span', { class: 'muted' }, 'not yet'), `${d.days.toLocaleString('en-US')} days`]),
          undefined,
          false,
        )
      : h('p', { class: 'muted' }, 'No drawdowns in this history.'),
    h('p', { class: 'muted small' }, 'Length: calendar days from the high to getting back to it (or to today).'),
  );
}

export function riskPanel(t: TearSheet, label: (s: string) => string = (s) => s) {
  const max = Math.max(0.01, ...t.risk.map((r) => Math.max(r.weight, r.share)));
  return panel(
    'Who drives the risk',
    h('span', {}, `Volatility ${pctU(t.volatility, 1)} a year `, infoTip('riskContribution')),
    h(
      'div',
      { class: 'qp-riskbars' },
      ...[...t.risk]
        .sort((a, b) => b.share - a.share)
        .map((r) =>
          h(
            'div',
            { class: 'qp-riskrow', title: `${label(r.symbol)}: ${pctU(r.weight, 1)} of the money, ${pctU(r.share, 1)} of the risk (${pctU(r.volatility, 2)} of the yearly volatility)` },
            h('span', { class: 'qp-risklabel' }, label(r.symbol)),
            h('span', { class: 'qp-riskbar' }, h('i', { class: 'w', style: `width:${(Math.max(0, r.weight) / max) * 100}%` }), h('i', { class: 's', style: `width:${(Math.max(0, r.share) / max) * 100}%` })),
            h('span', { class: 'qp-risknum' }, `${pctU(r.weight, 0)} → ${pctU(r.share, 0)}`),
          ),
        ),
    ),
    h('div', { class: 'line-legend static' }, h('span', {}, h('i', { class: 'qp-key weight' }), 'Share of the money'), h('span', {}, h('i', { class: 'qp-key share' }), 'Share of the risk')),
  );
}

export function correlationPanel(t: TearSheet, label: (s: string) => string = (s) => s) {
  const c = t.correlation;
  return panel(
    'Correlation heat map',
    'Daily returns · 1 = move together, 0 = unrelated, below 0 = opposite',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table qp-heat' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...c.symbols.map((s) => h('th', {}, label(s))))),
        h(
          'tbody',
          {},
          ...c.matrix.map((row, i) =>
            h('tr', {}, h('th', { class: 'label' }, label(c.symbols[i])), ...row.map((x, j) => h('td', { style: i === j ? '' : heatStyle(x, 1, true), title: `${label(c.symbols[i])} vs ${label(c.symbols[j])}: ${x.toFixed(2)}` }, x.toFixed(2)))),
          ),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, 'Red: holdings that tend to fall together (less diversification). Green: holdings that offset each other.'),
  );
}

export function monthlyPanel(t: TearSheet) {
  const scale = heatScale(t.monthly.flatMap((y) => y.months));
  return panel(
    'Monthly returns',
    'Today’s weights through history',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table qp-heat qp-monthly' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Year'), ...MONTHS.map((m) => h('th', {}, m)), h('th', {}, 'Year'))),
        h(
          'tbody',
          {},
          ...[...t.monthly].reverse().map((y) =>
            h(
              'tr',
              {},
              h('th', { class: 'label' }, String(y.year)),
              ...y.months.map((m, k) => h('td', { style: heatStyle(m, scale), title: m == null ? '' : `${MONTHS[k]} ${y.year}: ${pct(m, 2)}` }, m == null ? '' : (m * 100).toFixed(1))),
              h('td', { class: y.total >= 0 ? 'up' : 'down' }, h('b', {}, pct(y.total, 1))),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, 'Percent. Green up, red down; darker = bigger. A partial first or last year counts only its months shown.'),
  );
}

export function rollingPanel(t: TearSheet) {
  const betaBox = h('div', {});
  const sharpeBox = h('div', {});
  queueMicrotask(() => {
    const line = (xs: (number | null)[]) => t.rolling.dates.map((d, i) => ({ time: d, value: xs[i] ?? NaN })).filter((p) => Number.isFinite(p.value));
    createLineChart(betaBox, { height: 200, format: (v) => v.toFixed(2), title: 'Rolling 6-month beta vs SPY' }).set([{ name: 'Beta vs SPY', color: THEME.viz1, data: line(t.rolling.beta) }]);
    createLineChart(sharpeBox, { height: 200, format: (v) => v.toFixed(2), title: 'Rolling 6-month Sharpe ratio' }).set([{ name: 'Sharpe', color: THEME.viz2, data: line(t.rolling.sharpe) }]);
  });
  const lastOf = (xs: (number | null)[]) => [...xs].reverse().find((x) => x != null) ?? null;
  const b = lastOf(t.rolling.beta);
  const s = lastOf(t.rolling.sharpe);
  return h(
    'div',
    { class: 'two-col' },
    panel('Rolling beta vs SPY', `Last ${t.rolling.window} trading days · now ${b == null ? '—' : b.toFixed(2)}`, betaBox),
    panel('Rolling Sharpe ratio', `Last ${t.rolling.window} trading days, risk-free ${pctU(t.riskFree, 2)} · now ${s == null ? '—' : s.toFixed(2)}`, sharpeBox),
  );
}
