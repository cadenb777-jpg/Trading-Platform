/** Portfolios: build a portfolio, see its long-run performance and risk, and optimise its weights. */
import { engineRequest } from '../data/schwab';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import { ASSET_CLASSES, PERIOD_LABELS, TEMPLATES, holdingsPayload, type Analysis, type AssetClass, type Optimisation, type Portfolio, type Rebalance } from '../portfolio/types';
import { createLineChart, dataTable, money, pageFrame, pct, pctU, scatterChart, statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';

const blank = (): Portfolio => ({ name: 'New portfolio', benchmark: 'SPY', rebalance: 'quarterly', holdings: [{ symbol: '', weight: 100, assetClass: 'US stocks' }] });
const ratio = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function createPortfolioPage() {
  let saved: (Portfolio & { id: string })[] = [];
  let current: Portfolio = structuredClone(TEMPLATES[0]);
  const list = h('div', { class: 'pf-list' });
  const editor = h('section', { class: 'panel' });
  const results = h('div', { class: 'ap-body' });
  const frame = pageFrame('Portfolios', 'Build a portfolio and see how it would have done: returns, risk, stress tests and optimal weights.', []);
  frame.body.replaceChildren(h('div', { class: 'pf-layout' }, h('aside', { class: 'panel' }, list), h('div', { class: 'ap-body' }, editor, results)));

  async function refreshList() {
    try {
      saved = await listDocs<Portfolio>('portfolios');
    } catch {
      saved = [];
    }
    renderList();
  }

  function renderList() {
    const item = (p: Portfolio, onclick: () => void, active: boolean) => h('button', { class: active ? 'active' : '', onclick }, p.name);
    list.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => select(blank()) }, '+ New portfolio'),
      h('div', { class: 'muted small' }, 'Saved'),
      ...(saved.length ? saved.map((p) => item(p, () => select(structuredClone(p)), p.id === current.id)) : [h('div', { class: 'muted small' }, 'None yet. Saved portfolios are stored by the helper on your computer.')]),
      h('div', { class: 'muted small' }, 'Templates'),
      ...TEMPLATES.map((t) => item(t, () => select(structuredClone(t)), false)),
    );
  }

  function select(p: Portfolio) {
    current = p;
    renderList();
    renderEditor();
    results.replaceChildren();
  }

  function renderEditor() {
    const p = current;
    const totalEl = h('span', { class: 'weight-total' });
    const updateTotal = () => {
      const total = p.holdings.reduce((a, x) => a + (x.weight || 0), 0);
      totalEl.textContent = `Total ${total.toFixed(1)}%${Math.abs(total - 100) > 0.05 ? ' (weights are scaled to 100% when analysed)' : ''}`;
      totalEl.classList.toggle('bad', Math.abs(total - 100) > 0.05);
    };
    const rows = h('tbody', {});
    const renderRows = () => {
      rows.replaceChildren(
        ...p.holdings.map((x, i) => {
          const sym = h('input', { class: 'input', value: x.symbol, placeholder: 'e.g. VTI', spellcheck: false, 'aria-label': 'Symbol' });
          sym.addEventListener('input', () => (x.symbol = sym.value.toUpperCase()));
          const w = h('input', { class: 'input', type: 'number', step: 0.5, value: x.weight, 'aria-label': 'Weight %' });
          w.addEventListener('input', () => ((x.weight = parseFloat(w.value) || 0), updateTotal()));
          const cls = h('select', { class: 'input', 'aria-label': 'Asset class' }, ...ASSET_CLASSES.map((c) => h('option', { value: c, selected: c === x.assetClass }, c)));
          cls.addEventListener('change', () => (x.assetClass = cls.value as AssetClass));
          return h(
            'tr',
            {},
            h('td', {}, sym),
            h('td', { class: 'w' }, w),
            h('td', {}, cls),
            h('td', { class: 'x' }, h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove holding', onclick: () => (p.holdings.splice(i, 1), renderRows(), updateTotal()) }, '✕')),
          );
        }),
      );
    };
    renderRows();
    updateTotal();
    const name = h('input', { class: 'input', value: p.name, 'aria-label': 'Portfolio name' });
    name.addEventListener('input', () => (p.name = name.value));
    const bench = h('input', { class: 'input symbol', value: p.benchmark, 'aria-label': 'Benchmark', spellcheck: false });
    bench.addEventListener('input', () => (p.benchmark = bench.value.toUpperCase()));
    const reb = h('select', { class: 'input', 'aria-label': 'Rebalancing' }, ...(['none', 'monthly', 'quarterly', 'yearly'] as Rebalance[]).map((r) => h('option', { value: r, selected: r === p.rebalance }, r === 'none' ? 'Never rebalance' : `Rebalance ${r}`)));
    reb.addEventListener('change', () => (p.rebalance = reb.value as Rebalance));
    const since = h('input', { class: 'input', type: 'date', value: p.inception ?? '', 'aria-label': 'Start date', title: 'Optional: only measure from this date' });
    since.addEventListener('change', () => (p.inception = since.value || undefined));
    editor.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Portfolio'), h('span', { class: 'spacer' }), totalEl),
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Name'), name),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Benchmark'), bench),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Rebalancing'), reb),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Measure from (optional)'), since),
      ),
      h('table', { class: 'holdings-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Symbol'), h('th', {}, 'Weight %'), h('th', {}, 'Asset class'), h('th', {}))), rows),
      h(
        'div',
        { class: 'ap-controls', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: () => (p.holdings.push({ symbol: '', weight: 0, assetClass: 'US stocks' }), renderRows()) }, '+ Add holding'),
        h('span', { class: 'spacer' }),
        p.id ? h('button', { class: 'btn danger', onclick: remove }, 'Delete') : null,
        h('button', { class: 'btn', onclick: save }, 'Save'),
        h('button', { class: 'btn primary', onclick: analyse }, 'Analyse'),
      ),
    );
  }

  async function save() {
    try {
      current = await saveDoc('portfolios', current);
      toast(`Saved "${current.name}"`);
      await refreshList();
      renderEditor();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!current.id || !confirm(`Delete "${current.name}"?`)) return;
    try {
      await deleteDoc('portfolios', current.id);
      await refreshList();
      select(blank());
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function analyse() {
    const holdings = holdingsPayload(current);
    results.replaceChildren(h('div', { class: 'muted pad' }, 'Crunching up to 20 years of daily prices…'));
    try {
      const a = await engineRequest<Analysis>('portfolio.analyze', { holdings, benchmark: current.benchmark, rebalance: current.rebalance, since: current.inception }, 120000);
      renderAnalysis(a);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  function renderAnalysis(a: Analysis) {
    const s = a.stats;
    const b = a.benchmarkStats;
    const growthBox = h('div', {});
    const ddBox = h('div', {});
    const mcBox = h('div', {});
    const optBox = h('div', { class: 'ap-body' });
    results.replaceChildren(
      h('p', { class: 'muted small' }, `History ${a.start} to ${a.end} (limited by the youngest holding). ${a.totalReturn ? 'Total returns with dividends reinvested.' : `No dividend data for ${a.priceOnly.join(', ')} (price-only).`} Risk-free rate ${pct(a.riskFree)}.`),
      statCards([
        { label: 'Annual return (CAGR)', value: pct(s.cagr), hint: `Benchmark ${pct(b.cagr)}`, tone: tone(s.cagr) },
        { label: 'Volatility', value: pctU(s.volatility, 1), hint: `Benchmark ${pctU(b.volatility, 1)}` },
        { label: 'Sharpe ratio', value: ratio(s.sharpe), hint: `Return per unit of risk. Benchmark ${ratio(b.sharpe)}` },
        { label: 'Max drawdown', value: pct(s.maxDrawdown, 1), hint: `${s.peak} → ${s.trough}${s.recovered ? `, recovered ${s.recovered}` : ', not yet recovered'}`, tone: 'down' },
        { label: 'Beta', value: ratio(s.beta), hint: `vs ${a.benchmark}` },
        { label: 'Growth of $10,000', value: money(a.growth[a.growth.length - 1]?.value), hint: `Benchmark ${money(a.benchmarkGrowth[a.benchmarkGrowth.length - 1]?.value)}` },
      ]),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Returns (periods over a year are yearly averages)')),
        dataTable(
          ['', ...PERIOD_LABELS.map(([, l]) => l)],
          [
            [{ v: current.name, cls: 'label' }, ...PERIOD_LABELS.map(([k]) => ({ v: pct(a.trailing[k].portfolio, 1), cls: tone(a.trailing[k].portfolio) }))],
            [{ v: a.benchmark, cls: 'label' }, ...PERIOD_LABELS.map(([k]) => ({ v: pct(a.trailing[k].benchmark, 1), cls: tone(a.trailing[k].benchmark) }))],
            [
              { v: 'Difference', cls: 'label' },
              ...PERIOD_LABELS.map(([k]) => {
                const p = a.trailing[k].portfolio;
                const q = a.trailing[k].benchmark;
                const d = p != null && q != null ? p - q : null;
                return { v: pct(d, 1), cls: tone(d) };
              }),
            ],
          ],
        ),
      ),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Growth of $10,000')), growthBox),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Drawdowns'), h('span', { class: 'muted small' }, 'How far below its previous high the portfolio was')), ddBox),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Calendar years')),
          dataTable(['Year', current.name, a.benchmark], [...a.calendar].reverse().map((c) => [String(c.year), { v: pct(c.portfolio, 1), cls: tone(c.portfolio) }, { v: pct(c.benchmark, 1), cls: tone(c.benchmark) }])),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Stress tests'), h('span', { class: 'muted small' }, 'What happened in past crises')),
          dataTable(
            ['Event', current.name, a.benchmark],
            a.stress.map((x) => [{ v: h('span', { title: `${x.start} to ${x.end}` }, x.name), cls: 'label' }, x.portfolio == null ? { v: 'before history', cls: 'muted' } : { v: pct(x.portfolio, 1), cls: tone(x.portfolio) }, { v: pct(x.benchmark, 1), cls: tone(x.benchmark) }]),
          ),
        ),
      ),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Risk statistics')),
          dataTable(
            ['', current.name, a.benchmark],
            (
              [
                ['Sortino ratio', ratio(s.sortino), ratio(b.sortino)],
                ['Calmar ratio', ratio(s.calmar), ratio(b.calmar)],
                ['Alpha (yearly)', pct(s.alpha), '—'],
                ['Correlation', ratio(s.correlation), '1.00'],
                ['Tracking error', pct(s.trackingError, 1), '—'],
                ['Information ratio', ratio(s.informationRatio), '—'],
                ['1-day VaR (95%)', pct(-s.var95), pct(-b.var95)],
                ['1-day CVaR (95%)', pct(-s.cvar95), pct(-b.cvar95)],
                ['Best month', pct(s.bestMonth, 1), pct(b.bestMonth, 1)],
                ['Worst month', pct(s.worstMonth, 1), pct(b.worstMonth, 1)],
                ['Positive months', pct(s.positiveMonths, 0).replace('+', ''), pct(b.positiveMonths, 0).replace('+', '')],
              ] as string[][]
            ).map(([l, x, y]) => [{ v: l, cls: 'label' }, x, y]),
          ),
          h('p', { class: 'ap-note' }, 'VaR: on 19 days out of 20 the daily loss was smaller than this. CVaR: the average loss on the other 1 day in 20.'),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Holdings')),
          dataTable(
            ['Symbol', 'Weight', 'Share of risk', 'CAGR', 'Volatility'],
            a.assets.map((x) => [h('b', {}, x.symbol), pct(x.weight, 1).replace('+', ''), { v: pct(x.riskContribution, 1).replace('+', ''), cls: x.riskContribution > x.weight * 1.3 ? 'down' : '' }, { v: pct(x.cagr, 1), cls: tone(x.cagr) }, pct(x.volatility, 1).replace('+', '')]),
          ),
          a.symbols.length > 1
            ? h(
                'div',
                {},
                h('h4', {}, 'Correlation'),
                dataTable(
                  ['', ...a.symbols],
                  a.correlation.map((row, i) => [h('b', {}, a.symbols[i]), ...row.map((c) => ({ v: h('span', { style: `color:${c > 0.7 ? 'var(--down)' : c < 0.3 ? 'var(--up)' : 'inherit'}` }, c.toFixed(2)), cls: 'corr-cell' }))]),
                ),
                h('p', { class: 'ap-note' }, 'Lower correlation (green) means better diversification.'),
              )
            : null,
        ),
      ),
      a.monteCarlo
        ? h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, `Monte Carlo: $10,000 over the next ${a.monteCarlo.years} years`), h('span', { class: 'muted small' }, `2,000 simulations from past monthly returns · ${pct(a.monteCarlo.lossChance, 0).replace('+', '')} chance of ending below $10,000`)),
            mcBox,
          )
        : '',
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Optimise weights')), optimiserForm(optBox), optBox),
    );
    const g = createLineChart(growthBox, { height: 320, format: money });
    g.set([
      { name: current.name, color: '#2962ff', data: a.growth },
      { name: a.benchmark, color: '#9598a1', width: 1, data: a.benchmarkGrowth },
    ]);
    const d = createLineChart(ddBox, { height: 200, format: (v) => `${(v * 100).toFixed(0)}%` });
    d.set([
      { name: current.name, color: '#ef5350', data: a.drawdown },
      { name: a.benchmark, color: '#9598a1', width: 1, data: a.benchmarkDrawdown },
    ]);
    if (a.monteCarlo) {
      const mc = a.monteCarlo;
      const year0 = new Date(`${a.end}T00:00:00Z`).getUTCFullYear();
      const line = (k: '5' | '25' | '50' | '75' | '95') => mc.percentiles[k].map((v, i) => ({ time: `${year0 + i}-12-31`, value: v }));
      const m = createLineChart(mcBox, { height: 300, format: money });
      m.set([
        { name: 'Best 5%', color: '#26a69a', width: 1, data: line('95') },
        { name: 'Good (75th)', color: '#80cbc4', width: 1, data: line('75') },
        { name: 'Median', color: '#2962ff', width: 3, data: line('50') },
        { name: 'Poor (25th)', color: '#ef9a9a', width: 1, data: line('25') },
        { name: 'Worst 5%', color: '#ef5350', width: 1, data: line('5') },
      ]);
    }
  }

  function optimiserForm(out: HTMLElement) {
    const method = h(
      'select',
      { class: 'input', 'aria-label': 'Method' },
      h('option', { value: 'max_sharpe' }, 'Best return for the risk (max Sharpe)'),
      h('option', { value: 'min_var' }, 'Lowest risk (minimum variance)'),
      h('option', { value: 'risk_parity' }, 'Equal risk from each holding (risk parity)'),
      h('option', { value: 'black_litterman' }, 'My views (Black-Litterman)'),
    );
    const minW = h('input', { class: 'input', type: 'number', value: 0, step: 1, 'aria-label': 'Minimum weight %' });
    const maxW = h('input', { class: 'input', type: 'number', value: 60, step: 1, 'aria-label': 'Maximum weight %' });
    const years = h('select', { class: 'input', 'aria-label': 'History' }, ...[5, 10, 20].map((y) => h('option', { value: y, selected: y === 10 }, `${y} years of history`)));
    const views = h('input', { class: 'input', placeholder: 'e.g. GLD 8% 60%, VTI 6% 50%', 'aria-label': 'Views', hidden: true, style: 'min-width:320px' });
    method.addEventListener('change', () => (views.hidden = method.value !== 'black_litterman'));
    async function run() {
      out.replaceChildren(h('div', { class: 'muted pad' }, 'Optimising…'));
      const parsedViews = views.value
        .split(',')
        .map((v) => v.trim().match(/^([A-Za-z.$^-]+)\s+(-?[\d.]+)%?(?:\s+([\d.]+)%?)?$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ symbol: m[1].toUpperCase(), return: parseFloat(m[2]) / 100, confidence: m[3] ? parseFloat(m[3]) / 100 : 0.5 }));
      try {
        const r = await engineRequest<Optimisation>(
          'portfolio.optimize',
          { holdings: holdingsPayload(current), method: method.value, minWeight: (parseFloat(minW.value) || 0) / 100, maxWeight: (parseFloat(maxW.value) || 100) / 100, years: Number(years.value), views: parsedViews },
          120000,
        );
        renderOptimisation(out, r);
      } catch (err) {
        out.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
      }
    }
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'ap-controls' },
        method,
        h('label', { class: 'field-input compact' }, h('span', { class: 'muted small' }, 'Min %'), minW),
        h('label', { class: 'field-input compact' }, h('span', { class: 'muted small' }, 'Max %'), maxW),
        years,
        views,
        h('button', { class: 'btn primary', onclick: run }, 'Optimise'),
      ),
      h('p', { class: 'ap-note' }, 'Views format: symbol, expected yearly return, confidence. Past returns don’t predict future ones, so optimised weights can be unstable. Treat them as a starting point.'),
    );
  }

  function renderOptimisation(out: HTMLElement, r: Optimisation) {
    out.replaceChildren(
      statCards([
        { label: 'Expected return', value: pct(r.result.return, 1), hint: `Current ${pct(r.currentResult.return, 1)}` },
        { label: 'Expected volatility', value: pctU(r.result.volatility, 1), hint: `Current ${pctU(r.currentResult.volatility, 1)}` },
        { label: 'Sharpe ratio', value: ratio(r.result.sharpe), hint: `Current ${ratio(r.currentResult.sharpe)}` },
      ]),
      h(
        'div',
        { class: 'two-col' },
        scatterChart(
          [
            { name: 'Efficient frontier', color: '#2962ff', line: true, points: r.frontier.map((f) => ({ x: f.volatility, y: f.return })) },
            { name: 'Holdings', color: '#9598a1', size: 4, points: r.symbols.map((s, i) => ({ x: r.volatilities[i], y: r.expectedReturns[i], label: s })) },
            { name: 'Current', color: '#ff9800', size: 6, points: [{ x: r.currentResult.volatility, y: r.currentResult.return, label: 'Current' }] },
            { name: 'Optimised', color: '#26a69a', size: 7, points: [{ x: r.result.volatility, y: r.result.return, label: 'Optimised' }] },
          ],
          { x: 'Risk (volatility)', y: 'Expected return' },
        ),
        h(
          'div',
          {},
          dataTable(
            ['Symbol', 'Current', 'Optimised', 'Change'],
            r.symbols.map((s, i) => [h('b', {}, s), pct(r.current[i], 1).replace('+', ''), pct(r.weights[i], 1).replace('+', ''), { v: pct(r.weights[i] - r.current[i], 1), cls: tone(r.weights[i] - r.current[i]) }]),
          ),
          h(
            'div',
            { class: 'ap-controls', style: 'margin-top:10px' },
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  const bySymbol = new Map(r.symbols.map((s, i) => [s, r.weights[i]]));
                  for (const x of current.holdings) x.weight = +(100 * (bySymbol.get(x.symbol.trim().toUpperCase()) ?? 0)).toFixed(1);
                  renderEditor();
                  toast('Weights applied. Press Analyse to see the history, and Save to keep them.');
                },
              },
              'Use these weights',
            ),
            r.converged ? null : h('span', { class: 'muted small' }, 'The optimiser didn’t fully converge; results are approximate.'),
          ),
        ),
      ),
    );
  }

  let started = false;
  return {
    el: frame.el,
    start() {
      if (started) return;
      started = true;
      renderEditor();
      renderList();
      refreshList();
    },
  };
}
