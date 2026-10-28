/**
 * Portfolios: models and what-ifs. Build a portfolio, see its long-run performance and risk, and optimise its weights.
 * The owner's real accounts (marked "mine": imported statements, synced Webull accounts) have their home on the
 * Account page; "Analyse in Portfolios" there opens one here, with a note and "Save as a what-if copy".
 */
import { engineRequest } from '../data/schwab';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import { PRIVATE_FUNDS, STRATEGIES, type Strategy } from '../invest/catalog';
import { renderDividends } from '../portfolio/dividendsView';
import { DEFAULT_GOAL, GOALS, cleanViews, compareName, compareNote, compareRows, compareVerdict, defaultMaxWeight, figureRows, goalInfo, randomWalkLine, rowName, vsText } from '../portfolio/goals';
import { frontierChart, riskBars, type FrontierPoint } from '../portfolio/optimiserCharts';
import { leftOutLine, shortHistoryAdvice, standInLine, yearsBetween } from '../portfolio/optimiserText';
import { fetchPrices, priceMap, type PriceInfo } from '../portfolio/prices';
import {
  ALT_CLASSES,
  ASSET_CLASSES,
  PERIOD_LABELS,
  TEMPLATES,
  analysisSymbol,
  holdingLabel,
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
import { createLineChart, dataTable, money, pageFrame, pct, pctU, statCards } from '../ui/charts';
import { infoTip } from '../ui/glossary';
import { h, openModal, toast } from '../ui/dom';
import { tickerAttr } from '../ui/tickerCard';

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
  const frame = pageFrame('Portfolios', 'Models and what-ifs: build a portfolio and see how it would have done (returns, risk, stress tests, optimal weights, dividend income). Your real accounts are on Account.', []);
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
    // models and client portfolios only: the owner's real accounts live on the Account page
    const models = saved.filter((p) => !isMine(p));
    const accounts = saved.length - models.length;
    list.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => select(blank()) }, '+ New portfolio'),
      h('div', { class: 'muted small' }, 'Saved models'),
      ...(models.length ? models.map((p) => item(p, () => select(structuredClone(p)), p.id === current.id)) : [h('div', { class: 'muted small' }, 'None yet. Saved portfolios are stored by the helper on your computer.')]),
      h('div', { class: 'muted small' }, 'Templates'),
      ...TEMPLATES.map((t) => item(t, () => select(structuredClone(t)), false)),
      h(
        'p',
        { class: 'muted small pf-accounts-link' },
        accounts ? `Your ${accounts} real account${accounts === 1 ? '' : 's'} (statements, Webull) are on ` : 'Your real accounts (import a statement, sync Webull) are on ',
        h('a', { href: '#account' }, 'Account →'),
        accounts ? ' Use “Analyse in Portfolios” there to test one here.' : '',
      ),
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
      p.id && isMine(p)
        ? h(
            'div',
            { class: 'callout pf-real' },
            h('b', {}, `${p.name} is one of your real accounts. `),
            'Its home is the Account page. Saving here changes that account’s record; to try changes without touching it, make a copy. ',
            h('button', { class: 'btn small', onclick: saveCopy }, 'Save as a what-if copy'),
            ' ',
            h('a', { href: '#account', class: 'small' }, 'Back to Account →'),
          )
        : '',
      h(
        'div',
        { class: 'pf-mine' },
        h('label', { class: 'pf-mine-toggle', title: 'Your own accounts are added together on the Account page (and leave this list); client portfolios stay out' }, mineBox, h('span', {}, 'This is my account (real money)')),
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

  /** A copy of the open portfolio that is a model (not one of the owner's accounts): safe for what-ifs. */
  async function saveCopy() {
    const copy: Portfolio = { ...structuredClone(current), name: `${current.name} (what-if)`, mine: false };
    delete copy.id;
    delete copy.webullAccount;
    delete copy.webullEnv;
    delete copy.webullClass;
    delete copy.syncedAt;
    current = copy;
    await save();
  }

  /** "This is my account": saved straight away for a saved portfolio (only the flag, not unsaved edits). */
  async function setMine(on: boolean) {
    current.mine = on;
    const stored = saved.find((x) => x.id === current.id);
    if (stored) {
      try {
        await saveDoc('portfolios', { ...stored, mine: on });
        await refreshList();
        toast(on ? `"${stored.name}" is now one of your accounts: it moves to the Account page` : `"${stored.name}" is now a model: it left the Account page`);
      } catch (err) {
        toast((err as Error).message);
      }
    }
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
            a.assets.map((x) => [holdingCell(x.symbol), pctU(x.weight, 1), { v: pctU(x.riskContribution, 1), cls: x.riskContribution > x.weight * 1.3 ? 'down' : '' }, { v: pct(x.cagr, 1), cls: tone(x.cagr) }, pctU(x.volatility, 1)]),
          ),
          a.symbols.length > 1
            ? h(
                'div',
                {},
                h('h4', {}, 'Correlation'),
                dataTable(
                  ['', ...a.symbols.map((x) => holdingLabel(current, x).label)],
                  a.correlation.map((row, i) => [h('b', {}, holdingLabel(current, a.symbols[i]).label), ...row.map((c) => ({ v: h('span', { style: `color:${c > 0.7 ? 'var(--down)' : c < 0.3 ? 'var(--up)' : 'inherit'}` }, c.toFixed(2)), cls: 'corr-cell' }))]),
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

  /** A holding's name for result tables: cash shows as "Cash" with a note about its stand-in, never as BIL. */
  function holdingCell(symbol: string) {
    const l = holdingLabel(current, symbol);
    return h('span', {}, h('b', l.label === symbol ? tickerAttr(symbol) : {}, l.label), l.note ? h('span', { class: 'muted small' }, ` ${l.note}`) : null);
  }

  function optimiserForm(out: HTMLElement) {
    const goal = h('select', { class: 'input', 'aria-label': 'Goal' }, ...GOALS.map((g) => h('option', { value: g.key, selected: g.key === DEFAULT_GOAL }, g.name))) as HTMLSelectElement;
    const tip = h('span', {});
    const goalLine = h('p', { class: 'opt-goal-line' });
    const slider = (label: string, value: number, min: number, max: number, step = 0.5) => {
      const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
      const shown = h('b', {}, `${value}%`);
      input.addEventListener('input', () => (shown.textContent = `${input.value}%`));
      return { input, el: h('label', { class: 'opt-slider' }, h('span', { class: 'muted small' }, label), input, shown) };
    };
    const targetVol = slider('Target volatility', 10, 6, 20);
    const volCap = slider('Volatility limit', 12, 6, 20);
    const teBudget = slider('Tracking-error budget', 2, 0, 10, 0.5);
    const others = saved.filter((p) => p.id && p.id !== current.id);
    const bench = h(
      'select',
      { class: 'input', 'aria-label': 'Benchmark' },
      h('option', { value: 'SPY' }, 'SPY (US stocks)'),
      h('option', { value: '6040' }, '60/40 (SPY + AGG)'),
      ...others.map((p) => h('option', { value: `p:${p.id}` }, p.name)),
    ) as HTMLSelectElement;
    const benchBox = h('span', { class: 'opt-method' }, bench, teBudget.el, infoTip('trackingError'));
    const extra = h('span', { class: 'opt-method' });
    const syncGoal = () => {
      const g = goalInfo(goal.value) ?? GOALS[0];
      tip.replaceChildren(infoTip(g.term));
      goalLine.textContent = g.line;
      extra.replaceChildren(g.needs === 'targetVol' ? targetVol.el : g.needs === 'volCap' ? volCap.el : g.needs === 'benchmark' ? benchBox : '');
    };
    goal.addEventListener('change', syncGoal);
    syncGoal();

    // Advanced settings (folded): sensible defaults, so most people never open it.
    const numIn = (label: string, value: number | '', opts: { min?: number; max?: number; step?: number; placeholder?: string } = {}) =>
      h('input', { class: 'input', type: 'number', value, min: opts.min ?? 0, max: opts.max ?? 100, step: opts.step ?? 1, placeholder: opts.placeholder ?? '', 'aria-label': label }) as HTMLInputElement;
    const field = (label: string, input: HTMLElement, term?: string) => h('label', { class: 'field-input compact' }, h('span', { class: 'muted small' }, label, term ? ' ' : '', term ? infoTip(term) : ''), input);
    // Default max per holding: 2 / holdings, between 25% and 50% (the helper uses the same rule when it's blank).
    const holdingCount = new Set(current.holdings.map(analysisSymbol).filter(Boolean)).size || 1;
    const maxW = numIn('Max per holding %', Math.round(100 * defaultMaxWeight(holdingCount)), { min: 1 });
    const maxChange = numIn('Max change per holding %', '', { min: 1, placeholder: 'no limit' });
    const maxTurnover = numIn('Max total change %', '', { min: 0, placeholder: 'no limit' });
    const hasCash = current.holdings.some((x) => x.kind === 'cash');
    const minCash = numIn('Minimum cash %', '', { min: 0, max: 95, placeholder: hasCash ? 'none' : 'add Cash first' });
    minCash.disabled = !hasCash;
    const maxHoldings = numIn('Max number of holdings', '', { min: 1, max: 300, placeholder: 'no limit' });
    const sectorCap = numIn('Max per sector %', '', { min: 5, placeholder: 'no limit' });
    const select = (label: string, options: [string, string][], value: string) =>
      h('select', { class: 'input', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))) as HTMLSelectElement;
    const lookback = select('Lookback', [['1', '1 year'], ['3', '3 years'], ['5', '5 years'], ['10', '10 years']], '3');
    const estimate = select('Return estimate', [['shrunk', 'History, pulled toward equilibrium'], ['views', 'My views (Black-Litterman)']], 'shrunk');
    const testRebalance = select('Test rebalance', [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']], 'quarterly');
    const cost = numIn('Cost per trade %', 0.1, { min: 0, max: 5, step: 0.05 });
    const keepCash = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    const keepAll = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const standIns = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;

    let symbols: string[] = [];
    try {
      symbols = holdingsPayload(current, priceMap(prices)).map((x) => x.symbol);
    } catch {
      symbols = [...new Set(current.holdings.map(analysisSymbol).filter(Boolean))];
    }
    const limitInputs = new Map<string, { min: HTMLInputElement; max: HTMLInputElement }>();
    const limitsTable = h(
      'div',
      { class: 'opt-limits' },
      dataTable(
        ['Holding', 'Min %', 'Max %'],
        symbols.map((s) => {
          const lim = { min: numIn(`${s} minimum %`, '', { placeholder: '—' }), max: numIn(`${s} maximum %`, '', { placeholder: '—' }) };
          limitInputs.set(s, lim);
          return [holdingCell(s), lim.min, lim.max];
        }),
        undefined,
        false,
      ),
    );
    const viewRows = h('div', {});
    const addView = () => {
      const sym = h('select', { class: 'input', 'aria-label': 'View holding' }, ...symbols.map((s) => h('option', { value: s }, holdingLabel(current, s).label))) as HTMLSelectElement;
      const ret = numIn('Expected return per year %', '', { min: -50, max: 100, step: 0.5, placeholder: 'e.g. 8' });
      const conf = h('input', { type: 'range', min: 10, max: 90, step: 5, value: 50, 'aria-label': 'Confidence' }) as HTMLInputElement;
      const confShown = h('span', { class: 'muted small' }, 'confidence 50%');
      conf.addEventListener('input', () => (confShown.textContent = `confidence ${conf.value}%`));
      const row = h('div', { class: 'opt-view-row', 'data-view': '' }, sym, ret, h('span', { class: 'muted small' }, '% a year'), conf, confShown, h('button', { class: 'btn', type: 'button', onclick: () => row.remove(), 'aria-label': 'Remove view' }, '×'));
      (row as HTMLElement & { read?: () => { symbol: string; ret: string; confidence: number } }).read = () => ({ symbol: sym.value, ret: ret.value, confidence: Number(conf.value) / 100 });
      viewRows.append(row);
    };
    const viewsBox = h(
      'div',
      { hidden: true },
      h('h4', { class: 'opt-adv-h' }, 'My views ', infoTip('optViews')),
      h('p', { class: 'ap-note' }, 'Your expected yearly return for a few holdings, and how sure you are. Low confidence barely moves the neutral market view. Views can’t be tested on the past, so the test below runs without them.'),
      viewRows,
      h('button', { class: 'btn', type: 'button', onclick: addView }, '+ Add view'),
    );
    estimate.addEventListener('change', () => {
      viewsBox.hidden = estimate.value !== 'views';
      if (!viewsBox.hidden && !viewRows.children.length) addView();
    });
    const advanced = h(
      'details',
      { class: 'opt-advanced' },
      h('summary', {}, 'Advanced settings'),
      h(
        'div',
        { class: 'opt-adv-grid' },
        field('Max per holding %', maxW),
        field('Max change per holding %', maxChange),
        field('Max total change %', maxTurnover, 'turnover'),
        field('Minimum cash %', minCash),
        field('Max number of holdings', maxHoldings),
        field('Max per sector %', sectorCap, 'sectorCap'),
        field('Lookback', lookback, 'lookback'),
        field('Return estimate', estimate, 'returnEstimate'),
        field('Test: rebalance', testRebalance, 'walkForward'),
        field('Test: cost per trade %', cost, 'tradingCosts'),
      ),
      h(
        'div',
        { class: 'ap-controls' },
        hasCash ? h('label', { class: 'opt-check', title: 'Only the invested part is reallocated' }, keepCash, ' Keep cash as is') : null,
        h('label', { class: 'opt-check' }, keepAll, ' Keep every holding (at least 1%)'),
        h('label', { class: 'opt-check', title: 'For the test only: before a young holding existed, its returns are estimated from the long-running fund it moves most like' }, standIns, ' Use stand-in history for young holdings ', infoTip('standIn')),
      ),
      h('h4', { class: 'opt-adv-h' }, 'Limits per holding'),
      h('p', { class: 'ap-note' }, 'Leave blank to use Max per holding. Sectors come from the SEC’s industry codes; funds count as “Fund” and cash has no sector.'),
      limitsTable,
      viewsBox,
    );

    const pctVal = (el: HTMLInputElement) => (el.value === '' || !Number.isFinite(parseFloat(el.value)) ? null : parseFloat(el.value) / 100);
    async function run() {
      const progress = h('div', { class: 'muted pad' }, 'Optimising and testing every goal on data it hadn’t seen (one to a few minutes, depending on your computer)…');
      out.replaceChildren(progress);
      try {
        const limits: Record<string, { min?: number; max?: number }> = {};
        for (const [s, lim] of limitInputs) {
          const lo = pctVal(lim.min);
          const hi = pctVal(lim.max);
          if (lo != null || hi != null) limits[s] = { ...(lo != null ? { min: lo } : {}), ...(hi != null ? { max: hi } : {}) };
        }
        let trackBenchmark: Record<string, unknown> = { kind: bench.value === '6040' ? '6040' : 'SPY' };
        if (bench.value.startsWith('p:') && goal.value === 'track') {
          const p = others.find((x) => `p:${x.id}` === bench.value);
          if (p) {
            await loadPrices(p);
            trackBenchmark = { kind: 'portfolio', name: p.name, holdings: holdingsPayload(p, priceMap(prices)) };
          }
        }
        const views = cleanViews([...viewRows.querySelectorAll<HTMLElement & { read?: () => { symbol: string; ret: string; confidence: number } }>('[data-view]')].map((x) => x.read!()));
        const r = await engineRequest<Optimisation>(
          'portfolio.optimize',
          {
            holdings: holdingsPayload(current, priceMap(prices)),
            method: goal.value,
            maxWeight: parseFloat(maxW.value) > 0 ? parseFloat(maxW.value) / 100 : null,
            maxChange: parseFloat(maxChange.value) > 0 ? parseFloat(maxChange.value) / 100 : null,
            maxTurnover: pctVal(maxTurnover),
            minCash: pctVal(minCash),
            maxHoldings: parseInt(maxHoldings.value, 10) > 0 ? parseInt(maxHoldings.value, 10) : null,
            sectorCap: pctVal(sectorCap),
            limits,
            keepCash: keepCash.checked,
            keepAll: keepAll.checked,
            lookback: Number(lookback.value),
            estimate: estimate.value,
            views: estimate.value === 'views' ? views : [],
            testRebalance: testRebalance.value,
            cost: pctVal(cost) ?? 0,
            targetVol: Number(targetVol.input.value) / 100,
            volCap: Number(volCap.input.value) / 100,
            teBudget: Number(teBudget.input.value) / 100,
            trackBenchmark,
            standIns: standIns.checked,
          },
          300000,
          (e) => {
            if (e.type === 'status') progress.textContent = `${e.text}…`;
          },
        );
        renderOptimisation(out, r);
      } catch (err) {
        out.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
      }
    }
    return h(
      'div',
      {},
      h('div', { class: 'ap-controls' }, h('span', { class: 'opt-method' }, h('span', { class: 'muted small' }, 'Goal'), goal, tip), extra, h('button', { class: 'btn primary', onclick: run }, 'Optimise')),
      goalLine,
      advanced,
      h('p', { class: 'ap-note' }, 'Only your own holdings are used. Every goal is worked out and tested each time, so you can compare them below.'),
    );
  }

  /** The 10th-90th percentile of a weight across bootstrap refits as a small bar, with a tick at the suggestion. */
  function rangeCell(lo: number, hi: number, w: number, scale: number, pinned = false) {
    const at = (x: number) => `${Math.min(100, (100 * x) / scale).toFixed(1)}%`;
    return h(
      'span',
      { class: 'opt-range-cell', title: pinned ? 'Every refit landed on one of your limits (max per holding, max change, keep cash or 1% minimum): your limit, not the data, sets this weight' : `80% of refits put this weight between ${pctU(lo, 1)} and ${pctU(hi, 1)}` },
      h('span', { class: 'opt-range', 'aria-hidden': 'true' }, h('span', { class: 'opt-range-fill', style: `left:${at(lo)};width:max(2px, ${at(hi - lo)})` }), h('span', { class: 'opt-range-mark', style: `left:${at(w)}` })),
      h('span', { class: 'muted small' }, pinned ? 'held by your limit' : `${pctU(lo, 0)}–${pctU(hi, 0)}`),
    );
  }

  /** One line comparing a goal with the current mix in a walk-forward table. */
  function compareLine(t: NonNullable<Optimisation['realOnly']>, key: string): string {
    const m = t.rows.find((x) => x.key === key);
    const c = t.rows.find((x) => x.key === 'current');
    if (!m || !c) return 'not available';
    return `${rowName(key)} Sharpe ${ratio(m.sharpe)} vs ${ratio(c.sharpe)} for your mix, ${pct(m.return, 1)} vs ${pct(c.return, 1)} a year`;
  }

  function verdict(r: Optimisation, key: string, rw: Optimisation['randomWalk']): string {
    const wf = r.walkForward;
    const name = rowName(key);
    if (!wf) return shortHistoryAdvice(yearsBetween(r.testStart ?? r.start, r.end), 'none');
    const m = wf.rows.find((x) => x.key === key);
    const c = wf.rows.find((x) => x.key === 'current');
    if (!m || !c) return '';
    const edge = (m.sharpe ?? 0) - (c.sharpe ?? 0);
    const chance = wf.short ? ' With this little history, differences between goals are likely chance.' : '';
    if (Math.abs(edge) < 0.01) return `On data it hadn’t seen, ${name} did about the same as your current mix (Sharpe ${ratio(m.sharpe)} vs ${ratio(c.sharpe)}). Keeping what you have is a reasonable choice.${chance}`;
    if (edge <= 0) return `On data it hadn’t seen, ${name} did not beat your current mix (Sharpe ${ratio(m.sharpe)} vs ${ratio(c.sharpe)}). Keeping what you have is a reasonable choice.${chance}`;
    const base = `On data it hadn’t seen, ${name} beat your current mix: Sharpe ${ratio(m.sharpe)} vs ${ratio(c.sharpe)}, ${pct(m.return, 1)} vs ${pct(c.return, 1)} a year, worst drop ${pct(m.maxDrawdown, 0)} vs ${pct(c.maxDrawdown, 0)}.${chance}`;
    if (!rw || !rw.runs) return base;
    return rw.p <= 0.1
      ? `${base} Shuffled histories rarely gave an edge this big (p = ${rw.p.toFixed(2)}), so the goal found something real in the order of events.`
      : `${base} Shuffled histories gave an edge this big ${Math.round(rw.p * 100)} times in 100, so it doesn’t come from reading the past: it comes from how these holdings move together (spreading risk). Past results still don’t guarantee future ones.`;
  }

  function renderOptimisation(out: HTMLElement, r: Optimisation, shown: string = r.goal ?? (r.method === 'black_litterman' ? 'growth' : r.method)) {
    const wf = r.walkForward;
    const goals = r.goals ?? [];
    const g = goals.find((x) => x.key === shown);
    const weights = g?.weights ?? r.weights;
    const st = g?.stability ?? r.stability;
    const rw = g ? g.randomWalk : r.randomWalk;
    const name = rowName(shown);
    const label = (s: string) => holdingLabel(current, s).label;
    const scale = st ? Math.max(0.05, ...st.high, ...weights) : 1;
    const history = [...(r.standIns ?? []).map((s) => standInLine(s, label(s.symbol))), ...(r.leftOut ?? []).map((s) => leftOutLine(s, label(s.symbol)))];
    const switcher = goals.length
      ? (h('select', { class: 'input', 'aria-label': 'Show goal' }, ...goals.map((x) => h('option', { value: x.key, selected: x.key === shown }, rowName(x.key) + (x.key === r.goal ? ' (picked)' : '')))) as HTMLSelectElement)
      : null;
    switcher?.addEventListener('change', () => renderOptimisation(out, r, switcher.value));
    const show = (key: string) => {
      renderOptimisation(out, r, key);
      out.querySelector<HTMLElement>('.opt-verdict')?.scrollIntoView({ block: 'nearest' });
    };
    const figures = figureRows(r.currentFigures, g);
    const points: FrontierPoint[] = [
      ...goals.filter((x) => x.key !== shown).map((x) => ({ key: x.key, label: rowName(x.key), volatility: x.volatility, return: x.expectedReturn, kind: 'goal' as const })),
      ...(r.currentFigures ? [{ key: 'current', label: 'Your mix', volatility: r.currentFigures.volatility, return: r.currentFigures.expectedReturn, kind: 'current' as const }] : []),
      ...(g ? [{ key: g.key, label: name, volatility: g.volatility, return: g.expectedReturn, kind: 'chosen' as const }] : []),
    ];
    const compare = compareRows(r);
    const goalNotes = g?.notes ?? [];
    const changeCapped = r.settings?.maxTurnover != null || r.settings?.maxChange != null;
    const lead = wf ? wf.rows.filter((x) => x.key === 'current' || x.key === 'equal') : [];
    const tableRows = [
      ...lead.map((row) => ({ row, name: rowName(row.key), p: null as number | null, goal: false, vs: '', twins: [] as string[] })),
      ...compare.map((c) => ({ row: c.row, name: compareName(c) + (c.key === 'income' || c.twins.includes('income') ? ' †' : ''), p: c.p, goal: true, vs: vsText(c.vs), twins: c.twins })),
    ];
    const wfLine = wf
      ? `Test used: each goal refit on the previous ${wf.windowYears.toFixed(0)} year${wf.windowYears >= 2 ? 's' : ''} and rebalanced every ${wf.short ? 'month' : (wf.stepDays ?? 63) >= 252 ? 'year' : (wf.stepDays ?? 63) <= 21 ? 'month' : 'quarter'}; results cover ${wf.oosStart ? `${wf.oosStart} to ${wf.oosEnd}` : 'the last'} (${(wf.days / 252).toFixed(1)} years), paying ${pctU(r.settings?.cost ?? 0, 2)} of every trade. Dividends included.`
      : '';
    out.replaceChildren(
      ...(switcher ? [h('div', { class: 'opt-showing' }, h('span', { class: 'muted small' }, 'Showing'), switcher, infoTip(goalInfo(shown)?.term ?? ''))] : []),
      h('p', { class: 'opt-verdict' }, verdict(r, shown, rw)),
      ...([...(r.notes ?? []), ...goalNotes].length ? [h('div', { class: 'opt-notes' }, ...[...(r.notes ?? []), ...goalNotes].map((n) => h('p', {}, n)))] : []),
      ...(wf?.short ? [h('p', { class: 'opt-guide' }, shortHistoryAdvice(yearsBetween(r.testStart ?? r.start, r.end), 'short'))] : []),
      ...(history.length ? [h('div', { class: 'opt-standins' }, ...history.map((x) => h('p', { class: 'ap-note' }, x)))] : []),
      h(
        'div',
        { class: 'opt-results' },
        h(
          'div',
          {},
          h('h4', {}, `Suggested weights: ${name}`),
          h('div', { class: 'opt-weights' }, dataTable(
            ['Holding', 'Current', 'Suggested', 'Change', ...(st ? ['Likely range'] : [])],
            r.symbols.map((s, i) => [
              holdingCell(s),
              pctU(r.current[i], 1),
              pctU(weights[i], 1),
              { v: pct(weights[i] - r.current[i], 1), cls: tone(weights[i] - r.current[i]) },
              ...(st ? [rangeCell(st.low[i], st.high[i], weights[i], scale, st.pinned?.[i])] : []),
            ]),
            undefined,
            false,
          )),
          st
            ? h(
                'p',
                { class: 'ap-note' },
                h('b', {}, 'How firm are these weights? '),
                infoTip('weightRange'),
                ` The goal was refit on ${st.runs} reshuffled versions of your real history (1-month blocks); each bar shows where that weight landed 80% of the time. Narrow = the data or your limits pin it down; wide = the data can’t, so don’t read much into the exact number.${shown === 'growth' ? ' Growth’s bars also include a little noise from its own resampling.' : ''} This checks robustness, not whether returns will be better.`,
              )
            : null,
          figures.length
            ? h(
                'div',
                {},
                h('h4', {}, 'Before and after, on the history it was fitted to'),
                dataTable(['', 'Now', name], figures.map((f) => [h('span', {}, f.label, f.term ? ' ' : '', f.term ? infoTip(f.term) : ''), f.now, h('b', {}, f.next)]), undefined, false),
                h('p', { class: 'ap-note' }, `In-sample: these weights were chosen on this same history, so the figures flatter them; the comparison below uses data each goal hadn’t seen. Expected return comes from the return estimate (${r.settings?.estimate === 'views' ? 'your views' : 'history pulled toward equilibrium'}), not a promise. Worst drop and bad-month loss replay the last ${r.settings?.lookbackYears ?? ''} years with these weights.${r.keepCash ? ' Cash is kept as is; only the invested part moves.' : ''} History ${r.start} to ${r.end}.`),
              )
            : h('p', { class: 'ap-note' }, `Expected volatility ${pctU(r.volatility.suggested, 1)} (now ${pctU(r.volatility.current, 1)}).${r.keepCash ? ' Cash is kept as is; only the invested part moves.' : ''} History ${r.start} to ${r.end}.`),
          h(
            'div',
            { class: 'ap-controls' },
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  const bySymbol = new Map(r.symbols.map((s, i) => [s, weights[i]]));
                  // Holdings sharing a stand-in (e.g. two private credit funds) split its weight.
                  const counts = new Map<string, number>();
                  for (const x of current.holdings) counts.set(analysisSymbol(x), (counts.get(analysisSymbol(x)) ?? 0) + 1);
                  for (const x of current.holdings) x.weight = +((100 * (bySymbol.get(analysisSymbol(x)) ?? 0)) / (counts.get(analysisSymbol(x)) ?? 1)).toFixed(1);
                  current.mode = 'weight';
                  renderEditor();
                  toast('Weights applied. Press Analyse to see the history, and Save to keep them.');
                },
              },
              `Use these weights (${name})`,
            ),
          ),
        ),
        r.frontier?.length && points.length
          ? h(
              'div',
              {},
              h('h4', {}, 'Efficient frontier ', infoTip('efficientFrontier')),
              frontierChart(r.frontier, points, show),
              h('p', { class: 'ap-note' }, 'The line is the best expected return for each level of risk under your limits. Points below it give up expected return for something else (even risk, diversification, income, small bad months). Expected returns are estimates; click a point to show that goal.'),
            )
          : null,
        g && r.currentFigures
          ? h(
              'div',
              {},
              h('h4', {}, 'Who drives the risk ', infoTip('riskContribution')),
              riskBars(r.symbols.map((s, i) => ({ label: label(s), now: r.currentFigures!.riskContributions[i] ?? 0, next: g.riskContributions[i] ?? 0 }))),
              h('p', { class: 'ap-note' }, 'Each holding’s share of the swings, now and with the suggested weights. A holding can carry far more risk than its weight.'),
            )
          : null,
        h(
          'div',
          { class: 'opt-compare' },
          h('h4', {}, 'Compare goals on data they hadn’t seen ', infoTip('walkForward')),
          wf && r.estimatedShare
            ? h('p', { class: 'opt-estimated' }, `${Math.round(r.estimatedShare * 100)}% of the test period uses estimated (stand-in) history `, infoTip('standIn'), '. The estimate uses relationships measured later, which can flatter results.')
            : null,
          wf && compare.length ? h('p', { class: 'opt-verdict' }, compareVerdict(r)) : null,
          wf
            ? h(
                'div',
                { class: 'opt-table-scroll' },
                dataTable(
                  ['Goal', 'Return/yr', 'Volatility', 'Worst drop', 'Sharpe', 'Vs Even risk', 'Traded/yr', 'Needs real timing? (p)', ''],
                  tableRows.map((t) => {
                    const x = t.row;
                    const isShown = x.key === shown || t.twins.includes(shown);
                    return [
                      isShown ? h('b', {}, t.name) : t.name,
                      { v: pct(x.return, 1), cls: tone(x.return) },
                      pctU(x.volatility, 1),
                      { v: pct(x.maxDrawdown, 0), cls: 'down' },
                      ratio(x.sharpe),
                      t.vs || '—',
                      pctU(x.turnover, 0),
                      t.p == null ? (t.goal ? 'no edge' : '—') : t.p.toFixed(2),
                      t.goal && goals.length && !isShown ? h('button', { class: 'btn', onclick: () => show(x.key), 'aria-label': `Show ${rowName(x.key)}` }, 'Show') : '',
                    ];
                  }),
                  (i) => (tableRows[i].row.key === shown ? 'opt-chosen' : ''),
                  false,
                ),
              )
            : h('p', { class: 'muted small' }, 'Not enough history for this test.'),
          wf && compare.length ? h('p', { class: 'ap-note' }, compareNote(r)) : null,
          wf && compare.some((c) => c.key === 'income' || c.twins.includes('income'))
            ? h('p', { class: 'ap-note' }, '† Income’s test uses today’s dividend yields for every past year (look-ahead), which flatters it.')
            : null,
          wf
            ? h(
                'p',
                { class: 'ap-note' },
                wf.short ? h('b', {}, 'Short test: low confidence. ') : null,
                wfLine,
                changeCapped ? ' The test doesn’t apply your max-change limits (each refit starts fresh), so it may trade more than you would.' : '',
                r.testStart && r.testStart < r.start ? ` Tested from ${r.testStart}, before the ${r.start} start of your real shared history: see the notes on young holdings above.` : '',
                r.settings?.estimate === 'views' ? ' Your views aren’t used in the test.' : '',
              )
            : null,
          wf && r.estimatedShare
            ? h(
                'p',
                { class: 'ap-note' },
                h('b', {}, 'Real prices only: '),
                r.realOnly ? `${compareLine(r.realOnly, shown)}${r.realOnly.short ? ' (short test, low confidence)' : ''}.` : 'not enough real shared history (2.5 years) for this test without stand-ins.',
              )
            : null,
          rw ? h('p', { class: 'ap-note' }, h('b', {}, `Random-walk check (${name}) `), infoTip('randomWalk'), randomWalkLine(rw, name)) : null,
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
    /** Opens a saved portfolio (a model, or one of your accounts from Account's "Analyse in Portfolios"). */
    async open(id: string) {
      if (id === 'webull') return void (location.hash = '#trade'); // the old Webull view: ordering is on Trade
      await refreshList();
      const p = saved.find((x) => x.id === id);
      if (p) select(structuredClone(p));
    },
  };
}
