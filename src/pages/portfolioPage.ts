/** Portfolios: build a portfolio, see its long-run performance and risk, and optimise its weights. */
import { engineRequest } from '../data/schwab';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import { PRIVATE_FUNDS, STRATEGIES, type Strategy } from '../invest/catalog';
import { openStatementImport, renderDividends } from '../portfolio/dividendsView';
import { renderWebull } from '../portfolio/webullView';
import { fetchPrices, priceMap, type PriceInfo } from '../portfolio/prices';
import {
  ALT_CLASSES,
  ASSET_CLASSES,
  PERIOD_LABELS,
  TEMPLATES,
  analysisSymbol,
  holdingsPayload,
  isCashOrAlt,
  isMine,
  positions,
  pricedSymbols,
  proxyNotes,
  type Analysis,
  type AssetClass,
  type EntryMode,
  type Holding,
  type Optimisation,
  type Portfolio,
  type Rebalance,
} from '../portfolio/types';
import { createLineChart, dataTable, money, pageFrame, pct, pctU, scatterChart, statCards } from '../ui/charts';
import { h, openModal, toast } from '../ui/dom';

const STRATEGY_CLASS: Record<Strategy, AssetClass> = {
  'Private credit': 'Private credit',
  'Real estate': 'Private real estate',
  'Private equity': 'Private equity',
  Infrastructure: 'Infrastructure',
  'Venture & growth': 'Private equity',
};

const blank = (): Portfolio => ({ name: 'New portfolio', benchmark: 'SPY', rebalance: 'quarterly', mode: 'weight', holdings: [{ symbol: '', weight: 100, assetClass: 'US stocks', kind: 'security' }] });
const ratio = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function createPortfolioPage() {
  let saved: (Portfolio & { id: string })[] = [];
  let current: Portfolio = structuredClone(TEMPLATES[0]);
  const list = h('div', { class: 'pf-list' });
  const editor = h('section', { class: 'panel' });
  const results = h('div', { class: 'ap-body' });
  const frame = pageFrame('Portfolios', 'Build a portfolio and see how it would have done: returns, risk, stress tests, optimal weights and dividend income.', []);
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
    const item = (p: Portfolio, onclick: () => void, active: boolean) =>
      h('button', { class: active ? 'active' : '', onclick }, p.name, p.id && isMine(p) ? h('span', { class: 'badge accent pf-mine-badge', title: 'Your own account (shown on the Account page)' }, 'Mine') : null);
    list.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => select(blank()) }, '+ New portfolio'),
      h('button', { class: 'btn', title: 'Upload a positions export (CSV or Excel) from your broker', onclick: () => openStatementImport(imported) }, 'Import statement'),
      h('button', { class: 'btn', title: 'Your Webull account: balances, positions, orders, sync and the order ticket', onclick: () => renderWebull(results, synced) }, 'Webull'),
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

  let prices: Record<string, PriceInfo> = {};

  async function loadPrices(p: Portfolio) {
    const syms = pricedSymbols(p);
    if (!syms.length) return;
    try {
      prices = { ...prices, ...(await fetchPrices(syms)) };
    } catch (err) {
      toast(`Live prices unavailable: ${(err as Error).message}`);
    }
  }

  function renderEditor() {
    const p = current;
    const mode: EntryMode = p.mode ?? 'weight';
    const totalEl = h('span', { class: 'weight-total' });
    const updateTotal = () => {
      if (mode === 'weight') {
        const total = p.holdings.reduce((a, x) => a + (x.weight || 0), 0);
        totalEl.textContent = `Total ${total.toFixed(1)}%${Math.abs(total - 100) > 0.05 ? ' (weights are scaled to 100% when analysed)' : ''}`;
        totalEl.classList.toggle('bad', Math.abs(total - 100) > 0.05);
      } else {
        const { total } = positions(p, priceMap(prices));
        const cost = p.holdings.reduce((s, x) => s + (x.cost ?? 0), 0);
        totalEl.textContent = `Market value ${money(total)}${cost && total ? ` · unrealized ${total - cost >= 0 ? '+' : ''}${money(total - cost)}` : ''}`;
        totalEl.classList.remove('bad');
      }
    };
    const rows = h('tbody', {});
    const num = (value: number | undefined, onInput: (v: number | undefined) => void, opts: { step?: number; label: string; placeholder?: string }) => {
      const el = h('input', { class: 'input', type: 'number', step: opts.step ?? 1, value: value ?? '', placeholder: opts.placeholder ?? '', 'aria-label': opts.label });
      el.addEventListener('input', () => {
        onInput(el.value === '' ? undefined : parseFloat(el.value));
        updateTotal();
        refreshDerived();
      });
      return el;
    };
    const derived: { row: Holding; value: HTMLElement; weight: HTMLElement; price: HTMLElement }[] = [];
    const refreshDerived = () => {
      const pos = positions(p, priceMap(prices));
      for (const d of derived) {
        const r = pos.rows.find((x) => x.holding === d.row);
        d.value.textContent = r?.value != null ? money(r.value) : '—';
        d.weight.textContent = r ? pctU(r.weight, 1) : '—';
        const pr = prices[d.row.symbol.trim().toUpperCase()]?.price;
        d.price.textContent = isCashOrAlt(d.row) ? '' : pr != null ? pr.toFixed(2) : '—';
      }
    };
    const renderRows = () => {
      derived.length = 0;
      rows.replaceChildren(
        ...p.holdings.map((x, i) => {
          const special = isCashOrAlt(x);
          const sym = h('input', { class: 'input', value: x.symbol, placeholder: special ? (x.kind === 'cash' ? 'CASH' : 'e.g. BCRED') : 'e.g. VTI', spellcheck: false, 'aria-label': 'Symbol' });
          sym.addEventListener('input', () => (x.symbol = sym.value.toUpperCase()));
          sym.addEventListener('change', () => mode === 'shares' && loadPrices(p).then(refreshDerived).then(updateTotal));
          const cls = h('select', { class: 'input', 'aria-label': 'Asset class' }, ...ASSET_CLASSES.map((c) => h('option', { value: c, selected: c === x.assetClass }, c)));
          cls.addEventListener('change', () => (x.assetClass = cls.value as AssetClass));
          const value = h('span', { class: 'muted' });
          const weight = h('span', { class: 'muted' });
          const price = h('span', { class: 'muted' });
          derived.push({ row: x, value, weight, price });
          const label = h(
            'td',
            {},
            h('div', { class: 'holding-cell' }, sym, special ? h('span', { class: `holding-tag ${x.kind}` }, x.kind === 'cash' ? 'Cash' : 'Alt') : null),
            x.name ? h('div', { class: 'muted small' }, x.name) : null,
          );
          const cells: (HTMLElement | null)[] =
            mode === 'weight'
              ? [h('td', { class: 'w' }, num(x.weight, (v) => (x.weight = v ?? 0), { step: 0.5, label: 'Weight %' }))]
              : mode === 'shares' && !special
                ? [
                    h('td', { class: 'w' }, num(x.shares, (v) => (x.shares = v), { step: 1, label: 'Shares' })),
                    h('td', { class: 'num' }, price),
                    h('td', { class: 'num' }, value),
                    h('td', { class: 'w' }, num(x.cost, (v) => (x.cost = v), { step: 100, label: 'Cost basis $', placeholder: 'optional' })),
                    h('td', { class: 'num' }, weight),
                  ]
                : [
                    h('td', { class: 'w' }, num(x.amount, (v) => (x.amount = v), { step: 100, label: 'Amount $' })),
                    ...(mode === 'shares' ? [h('td', { class: 'num' }, price), h('td', { class: 'num' }, value)] : []),
                    h('td', { class: 'w' }, num(x.cost, (v) => (x.cost = v), { step: 100, label: 'Cost basis $', placeholder: 'optional' })),
                    h('td', { class: 'num' }, weight),
                  ];
          return h(
            'tr',
            {},
            label,
            ...cells,
            h('td', { class: 'cls' }, cls),
            h(
              'td',
              { class: 'x' },
              special ? h('button', { class: 'icon-btn', title: 'Details', 'aria-label': 'Details', onclick: () => holdingDetails(x, () => (renderRows(), updateTotal())) }, '⋯') : null,
              h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove holding', onclick: () => (p.holdings.splice(i, 1), renderRows(), updateTotal()) }, '✕'),
            ),
          );
        }),
      );
      refreshDerived();
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
    const mineBox = h('input', { type: 'checkbox', checked: isMine(p) }) as HTMLInputElement;
    mineBox.addEventListener('change', () => setMine(mineBox.checked));
    const modes: [EntryMode, string][] = [
      ['weight', 'Percent'],
      ['shares', 'Shares'],
      ['dollars', 'Dollars'],
    ];
    const modeSeg = h('div', { class: 'segmented' }, ...modes.map(([m, l]) => h('button', { class: m === mode ? 'active' : '', onclick: () => switchMode(m) }, l)));
    const head =
      mode === 'weight'
        ? ['Holding', 'Weight %', 'Asset class', '']
        : mode === 'shares'
          ? ['Holding', 'Shares / $', 'Price', 'Value', 'Cost basis $', 'Weight', 'Asset class', '']
          : ['Holding', 'Amount $', 'Cost basis $', 'Weight', 'Asset class', ''];
    const notes = proxyNotes(p);
    editor.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Portfolio'), h('span', { class: 'muted small' }, 'Enter holdings as'), modeSeg, h('span', { class: 'spacer' }), totalEl),
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Name'), name),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Benchmark'), bench),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Rebalancing'), reb),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Measure from (optional)'), since),
      ),
      h(
        'div',
        { class: 'pf-mine' },
        h('label', { class: 'pf-mine-toggle', title: 'Your own accounts are added together on the Account page; client portfolios stay out' }, mineBox, h('span', {}, 'This is my account')),
        isMine(p) ? h('a', { href: '#account', class: 'small' }, 'See it in Account →') : null,
        mode === 'weight' && isMine(p) ? h('span', { class: 'muted small' }, 'Percent-only portfolios have no amounts, so Account leaves them out. Use Shares or Dollars.') : null,
      ),
      h('div', { class: 'holdings-wrap' }, h('table', { class: `holdings-table mode-${mode}` }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), rows)),
      notes.length ? h('p', { class: 'muted small' }, `For the performance maths, cash and alternatives use listed stand-ins (they have no daily prices): ${notes.join('; ')}. Change one with ⋯.`) : '',
      h(
        'div',
        { class: 'ap-controls', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: () => (p.holdings.push({ symbol: '', weight: 0, assetClass: 'US stocks', kind: 'security' }), renderRows()) }, '+ Add holding'),
        h('button', { class: 'btn', onclick: () => (p.holdings.push({ symbol: 'CASH', name: 'Cash / money market', weight: 0, assetClass: 'Cash', kind: 'cash', yield: 0.04 }), renderRows(), updateTotal()) }, '+ Add cash'),
        h('button', { class: 'btn', onclick: () => addAlternative(() => (renderRows(), updateTotal(), renderEditor())) }, '+ Add alternative'),
        mode === 'shares' ? h('button', { class: 'btn', onclick: () => loadPrices(p).then(() => (refreshDerived(), updateTotal())) }, 'Refresh prices') : null,
        h('span', { class: 'spacer' }),
        p.id ? h('button', { class: 'btn danger', onclick: remove }, 'Delete') : null,
        h('button', { class: 'btn', onclick: save }, 'Save'),
        h('button', { class: 'btn', title: 'Dividend income, yields and a 12-month calendar', onclick: () => renderDividends(results, current) }, 'Dividends'),
        h('button', { class: 'btn primary', onclick: analyse }, 'Analyse'),
      ),
    );
    if (mode === 'shares' && pricedSymbols(p).some((s) => !prices[s])) loadPrices(p).then(() => (refreshDerived(), updateTotal()));
  }

  /** Switches between percent, shares and dollars, converting the numbers already entered. */
  async function switchMode(next: EntryMode) {
    const p = current;
    const from = p.mode ?? 'weight';
    if (from === next) return;
    if (next === 'shares' || from === 'shares') await loadPrices(p);
    const pm = priceMap(prices);
    const pos = positions(p, pm);
    const total = pos.total ?? 100000;
    for (const r of pos.rows) {
      const x = r.holding;
      const value = r.value ?? r.weight * total;
      if (next === 'weight') x.weight = +(r.weight * 100).toFixed(2);
      else if (isCashOrAlt(x) || next === 'dollars') x.amount = Math.round(value);
      else {
        const price = pm[x.symbol.trim().toUpperCase()];
        x.shares = price ? +(value / price).toFixed(3) : x.shares;
      }
    }
    if (from === 'weight' && next !== 'weight') toast(`Converted using a ${money(total)} account. Type in the real amounts.`);
    p.mode = next;
    renderEditor();
  }

  /** Name, fund, stand-in, income and private-fund numbers for a cash or alternative holding. */
  function holdingDetails(x: Holding, done: () => void) {
    const text = (label: string, value: string | undefined, set: (v: string) => void, type = 'text', placeholder = '') => {
      const el = h('input', { class: 'input', type, value: value ?? '', placeholder });
      el.addEventListener('input', () => set(el.value));
      return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), el);
    };
    const numF = (label: string, value: number | undefined, set: (v: number | undefined) => void, percent = false) =>
      text(label, value == null ? '' : String(percent ? +(value * 100).toFixed(3) : value), (v) => set(v === '' ? undefined : percent ? parseFloat(v) / 100 : parseFloat(v)), 'number');
    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'field-grid' },
        text('Label', x.symbol, (v) => (x.symbol = v.toUpperCase())),
        text('Full name', x.name, (v) => (x.name = v)),
        text('Stand-in ticker for analysis', x.proxy, (v) => (x.proxy = v.toUpperCase() || undefined), 'text', analysisSymbol({ ...x, proxy: undefined })),
        numF(x.kind === 'cash' ? 'Interest rate (%)' : 'Distribution rate (%)', x.yield, (v) => (x.yield = v), true),
        ...(x.kind === 'alt'
          ? [
              numF('Commitment ($)', x.commitment, (v) => (x.commitment = v)),
              numF('Paid in / called ($)', x.contributed, (v) => (x.contributed = v)),
              numF('Distributions received ($)', x.distributed, (v) => (x.distributed = v)),
              text('Latest valuation date', x.valueDate, (v) => (x.valueDate = v || undefined), 'date'),
            ]
          : []),
      ),
      h('p', { class: 'muted small' }, 'The stand-in is a listed fund with daily prices that behaves similarly (e.g. BIZD for private credit, VNQ for real estate, BIL for cash). Reports show the real holding and note the stand-in.'),
      h('div', { class: 'ap-controls' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => (close(), done()) }, 'Done')),
    );
    const close = openModal(x.name || x.symbol || 'Holding details', body, { wide: true, onClose: done });
  }

  /** Adds a private/alternative fund: pick one from the directory or type your own. */
  function addAlternative(done: () => void) {
    const p = current;
    const pick = h(
      'select',
      { class: 'input' },
      h('option', { value: '' }, 'Other (type it below)'),
      ...STRATEGIES.map((s) => h('optgroup', { label: s }, ...PRIVATE_FUNDS.filter((f) => f.strategy === s).map((f) => h('option', { value: f.id }, `${f.short} · ${f.name}`)))),
    );
    const own = h('input', { class: 'input', placeholder: 'Fund name, e.g. Acme Growth Fund III' });
    const cls = h('select', { class: 'input' }, ...ALT_CLASSES.map((c) => h('option', { value: c }, c)));
    const amount = h('input', { class: 'input', type: 'number', step: 1000, placeholder: 'Current value / NAV ($)' });
    pick.addEventListener('change', () => {
      const f = PRIVATE_FUNDS.find((x) => x.id === pick.value);
      if (f) cls.value = STRATEGY_CLASS[f.strategy];
    });
    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Fund'), pick),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Or your own'), own),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Asset class'), cls),
        (p.mode ?? 'weight') === 'weight' ? null : h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Value ($)'), amount),
      ),
      h(
        'div',
        { class: 'ap-controls' },
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              const f = PRIVATE_FUNDS.find((x) => x.id === pick.value);
              const label = f?.short ?? own.value.trim();
              if (!label) return toast('Pick a fund or type a name');
              p.holdings.push({
                symbol: label.toUpperCase().slice(0, 16),
                name: f?.name ?? own.value.trim(),
                fundId: f?.id,
                kind: 'alt',
                assetClass: cls.value as AssetClass,
                weight: 0,
                amount: amount.value ? parseFloat(amount.value) : undefined,
              });
              close();
              done();
            },
          },
          'Add',
        ),
      ),
    );
    const close = openModal('Add an alternative investment', body, { wide: true });
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

  /** "This is my account": saved straight away for a saved portfolio (only the flag, not unsaved edits). */
  async function setMine(on: boolean) {
    current.mine = on;
    const stored = saved.find((x) => x.id === current.id);
    if (stored) {
      try {
        await saveDoc('portfolios', { ...stored, mine: on });
        await refreshList();
        toast(on ? `"${stored.name}" now shows on the Account page` : `"${stored.name}" is no longer on the Account page`);
      } catch (err) {
        toast((err as Error).message);
      }
    }
    renderEditor();
  }

  /** A statement was imported and saved: open it and show its dividends. */
  async function imported(p: Portfolio & { id: string }) {
    await refreshList();
    select(structuredClone(p));
    renderDividends(results, current);
  }

  /** Webull holdings were synced to a portfolio: refresh the list and select it, keeping the Webull view open. */
  async function synced(p: Portfolio & { id: string }) {
    await refreshList();
    current = structuredClone(p);
    renderList();
    renderEditor();
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
    if ((current.mode ?? 'weight') === 'shares') await loadPrices(current);
    results.replaceChildren(h('div', { class: 'muted pad' }, 'Crunching up to 20 years of daily prices…'));
    try {
      const holdings = holdingsPayload(current, priceMap(prices));
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
                ['Positive months', pctU(s.positiveMonths, 0), pctU(b.positiveMonths, 0)],
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
            a.assets.map((x) => [h('b', {}, x.symbol), pctU(x.weight, 1), { v: pctU(x.riskContribution, 1), cls: x.riskContribution > x.weight * 1.3 ? 'down' : '' }, { v: pct(x.cagr, 1), cls: tone(x.cagr) }, pctU(x.volatility, 1)]),
          ),
          a.symbols.length > 1
            ? h(
                'div',
                {},
                h('h4', {}, 'Correlation'),
                dataTable(
                  ['', ...a.symbols],
                  a.correlation.map((row, i) => [h('b', {}, a.symbols[i]), ...row.map((c) => ({ v: h('span', { style: `color:${c > 0.7 ? 'var(--down)' : c < 0.3 ? 'var(--up)' : 'inherit'}` }, c.toFixed(2)), cls: 'corr-cell' }))]),
                  undefined,
                  false,
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
            h('div', { class: 'panel-head' }, h('h3', {}, `Monte Carlo: $10,000 over the next ${a.monteCarlo.years} years`), h('span', { class: 'muted small' }, `2,000 simulations from past monthly returns · ${pctU(a.monteCarlo.lossChance, 0)} chance of ending below $10,000`)),
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
          { holdings: holdingsPayload(current, priceMap(prices)), method: method.value, minWeight: (parseFloat(minW.value) || 0) / 100, maxWeight: (parseFloat(maxW.value) || 100) / 100, years: Number(years.value), views: parsedViews },
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
            r.symbols.map((s, i) => [h('b', {}, s), pctU(r.current[i], 1), pctU(r.weights[i], 1), { v: pct(r.weights[i] - r.current[i], 1), cls: tone(r.weights[i] - r.current[i]) }]),
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
                  // Holdings sharing a stand-in (e.g. two private credit funds) split its weight.
                  const counts = new Map<string, number>();
                  for (const x of current.holdings) counts.set(analysisSymbol(x), (counts.get(analysisSymbol(x)) ?? 0) + 1);
                  for (const x of current.holdings) x.weight = +((100 * (bySymbol.get(analysisSymbol(x)) ?? 0)) / (counts.get(analysisSymbol(x)) ?? 1)).toFixed(1);
                  current.mode = 'weight';
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

  window.addEventListener('tp:data-changed', () => started && refreshList());

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
    /** Opens a saved portfolio, or the Webull view for 'webull' (from the Account page). */
    async open(id: string) {
      if (id === 'webull') return renderWebull(results, synced);
      await refreshList();
      const p = saved.find((x) => x.id === id);
      if (p) select(structuredClone(p));
    },
  };
}
