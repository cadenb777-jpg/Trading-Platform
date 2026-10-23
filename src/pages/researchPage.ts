/** Research: a company's financial statements, ratios, valuation (DCF) and SEC filings. */
import { insightButton } from '../ai/insight';
import { subscribeQuote } from '../data/quotes';
import { engineRequest } from '../data/schwab';
import { dcf, impliedGrowth, sensitivity, wacc, type DcfInputs } from '../research/dcf';
import { compact, createLineChart, dataTable, money, numberField, pageFrame, pct, rangeBar, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';

type Values = Record<string, (number | null)[]>;

interface Statements {
  periods: string[];
  values: Values;
}

export interface CompanyData {
  symbol: string;
  profile: { name: string; cik: number; industry: string; exchange: string; fiscalYearEnd: string };
  quote: { price?: number; change?: number; high52?: number; low52?: number; peRatio?: number; divYield?: number; lastEarnings?: string };
  valuation: {
    price: number | null;
    shares: number | null;
    marketCap: number | null;
    enterpriseValue: number | null;
    debt: number;
    cash: number;
    pe: number | null;
    ps: number | null;
    pfcf: number | null;
    evEbitda: number | null;
    fcfYield: number | null;
    taxRate: number | null;
    beta: number | null;
    costOfDebt: number | null;
  };
  ttm: Record<string, number | null>;
  annual: Statements;
  quarterly: Statements;
  ratios: Values;
  labels: Record<string, string>;
  sections: { income: string[]; balance: string[]; cashflow: string[] };
  filings: { form: string; filed: string; reportDate: string; description: string; url: string }[];
}

type Tab = 'overview' | 'financials' | 'valuation' | 'filings';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['financials', 'Financials'],
  ['valuation', 'Valuation (DCF)'],
  ['filings', 'SEC filings'],
];

const RATIO_ROWS: [string, string][] = [
  ['revenueGrowth', 'Revenue growth'],
  ['epsGrowth', 'EPS growth'],
  ['grossMargin', 'Gross margin'],
  ['operatingMargin', 'Operating margin'],
  ['netMargin', 'Net margin'],
  ['fcfMargin', 'Free cash flow margin'],
  ['roe', 'Return on equity'],
  ['roa', 'Return on assets'],
  ['currentRatio', 'Current ratio'],
  ['debtToEquity', 'Debt / equity'],
];
const RATIO_PLAIN = new Set(['currentRatio', 'debtToEquity']);

const fmtX = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}×`);
const periodLabel = (end: string, quarterly: boolean) => {
  const d = new Date(`${end}T00:00:00Z`);
  return quarterly ? `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}` : `FY${d.getUTCFullYear()}`;
};

export function createResearchPage() {
  let tab: Tab = 'overview';
  let data: CompanyData | null = null;
  let period: 'annual' | 'quarterly' = 'annual';
  let riskFree = 0.042;
  const symbolInput = h('input', { class: 'input symbol', value: 'AAPL', 'aria-label': 'Symbol', spellcheck: false });
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...TABS.map(([t, label]) => h('button', { class: `tab${t === tab ? ' active' : ''}`, 'data-tab': t, onclick: () => setTab(t) }, label)));
  const ai = insightButton(() => {
    if (!data) return null;
    const d = data;
    const a = d.annual;
    return {
      topic: 'research',
      symbol: d.symbol,
      title: `Investment summary: ${d.profile.name}`,
      data: { profile: d.profile, quote: d.quote, valuation: d.valuation, ttm: d.ttm, fiscalYears: a.periods, annual: Object.fromEntries(['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted', 'freeCashFlow', 'cash', 'longTermDebt', 'equity'].map((k) => [k, a.values[k]])), ratios: d.ratios },
    };
  });
  const frame = pageFrame('Research', 'Company financials from SEC filings, key ratios and a valuation calculator.', [tabs, symbolInput, h('button', { class: 'btn primary', onclick: () => load() }, 'Load'), ai.button]);
  const livePrice = h('b', { class: 'big-value' });
  const liveChange = h('b', {});
  let stopQuote = () => {};
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());

  function setTab(t: Tab) {
    tab = t;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  async function load() {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;
    frame.loading(`Loading ${symbol} from the SEC…`);
    ai.panel.hidden = true;
    try {
      data = await engineRequest<CompanyData>('research.company', { symbol }, 90000);
      livePrice.textContent = formatPrice(data.valuation.price);
      setChange(data.quote.change ?? null);
      // Keep the price live while the page is open.
      stopQuote();
      stopQuote = subscribeQuote({ provider: 'schwab', symbol: data.symbol }, (q) => {
        if (q.last == null) return;
        livePrice.textContent = formatPrice(q.last);
        if (q.prevClose) setChange(((q.last - q.prevClose) / q.prevClose) * 100);
      });
      render();
    } catch (err) {
      data = null;
      frame.error(err);
    }
  }

  function setChange(change: number | null) {
    liveChange.textContent = change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    liveChange.className = change == null ? '' : change >= 0 ? 'up' : 'down';
  }

  function render() {
    if (!data) return;
    const d = data;
    const header = h(
      'section',
      { class: 'panel company-head' },
      h('div', { class: 'panel-head' }, h('h3', {}, `${d.profile.name} (${d.symbol})`), h('span', { class: 'spacer' }), livePrice, liveChange),
      h('div', { class: 'profile-line muted small' }, h('span', {}, d.profile.industry || 'Industry n/a'), h('span', {}, d.profile.exchange), d.profile.fiscalYearEnd ? h('span', {}, `Fiscal year ends ${d.profile.fiscalYearEnd.slice(0, 2)}/${d.profile.fiscalYearEnd.slice(2)}`) : null, h('span', {}, `SEC CIK ${d.profile.cik}`)),
    );
    const body = tab === 'overview' ? overview(d) : tab === 'financials' ? financials(d) : tab === 'valuation' ? valuation(d) : filings(d);
    frame.body.replaceChildren(header, ...body, ai.panel);
  }

  function overview(d: CompanyData): Node[] {
    const v = d.valuation;
    const range = d.quote.low52 && d.quote.high52 ? rangeBar(d.quote.low52, d.quote.high52, v.price, formatPrice) : undefined;
    const chartBox = h('div', {});
    const a = d.annual;
    const lastRatio = (k: string) => [...(d.ratios[k] ?? [])].reverse().find((x) => x != null) ?? null;
    const nodes: Node[] = [
      statCards([
        { label: 'Market cap', value: money(v.marketCap) },
        { label: 'Enterprise value', value: money(v.enterpriseValue), hint: 'Market cap plus debt minus cash' },
        { label: 'P/E (trailing)', value: fmtX(v.pe ?? d.quote.peRatio), hint: 'Price divided by the last 12 months of earnings per share' },
        { label: 'Price / sales', value: fmtX(v.ps) },
        { label: 'EV / EBITDA', value: fmtX(v.evEbitda), hint: 'A debt-neutral valuation multiple' },
        { label: 'Free cash flow yield', value: pct(v.fcfYield), hint: 'Yearly free cash flow as a % of market cap' },
        { label: 'Beta (5y vs S&P 500)', value: v.beta != null ? v.beta.toFixed(2) : '—', hint: '1 = moves with the market; 2 = twice as much' },
        { label: '52-week range', value: '—', node: range },
        { label: 'Dividend yield', value: d.quote.divYield ? `${d.quote.divYield.toFixed(2)}%` : '—' },
        { label: 'Revenue (TTM)', value: money(d.ttm.revenue) },
        { label: 'Net income (TTM)', value: money(d.ttm.netIncome), tone: (d.ttm.netIncome ?? 0) >= 0 ? '' : 'down' },
        { label: 'Net margin', value: pct(lastRatio('netMargin'), 1) },
      ]),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Revenue, net income and free cash flow (yearly)')), chartBox),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Key ratios by year')),
        dataTable(
          ['', ...a.periods.map((p) => periodLabel(p, false))],
          RATIO_ROWS.map(([k, label]) => [{ v: label, cls: 'label' }, ...(d.ratios[k] ?? []).map((x) => (RATIO_PLAIN.has(k) ? (x == null ? '—' : x.toFixed(2)) : { v: pct(x, 1), cls: x == null ? '' : k.endsWith('Growth') ? (x >= 0 ? 'up' : 'down') : '' }))]),
        ),
      ),
    ];
    queueMicrotask(() => {
      const chart = createLineChart(chartBox, { height: 300, format: (x) => money(x) });
      const line = (key: string) => a.periods.map((p, i) => ({ time: p, value: a.values[key][i] ?? NaN }));
      chart.set([
        { name: 'Revenue', color: '#2962ff', data: line('revenue') },
        { name: 'Net income', color: '#26a69a', data: line('netIncome') },
        { name: 'Free cash flow', color: '#ff9800', data: line('freeCashFlow') },
      ]);
    });
    return nodes;
  }

  function financials(d: CompanyData): Node[] {
    const s = d[period];
    const quarterly = period === 'quarterly';
    const toggle = h(
      'div',
      { class: 'segmented' },
      ...(['annual', 'quarterly'] as const).map((p) =>
        h('button', { class: p === period ? 'active' : '', onclick: () => ((period = p), render()) }, p === 'annual' ? 'Yearly' : 'Quarterly'),
      ),
    );
    const fmt = (key: string, v: number | null) => (v == null ? '—' : key === 'epsDiluted' ? `$${v.toFixed(2)}` : key === 'dilutedShares' ? compact(v) : money(v));
    const table = (title: string, keys: string[]) =>
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, title)),
        dataTable(
          ['', ...s.periods.map((p) => periodLabel(p, quarterly))],
          keys
            .filter((k) => s.values[k]?.some((v) => v != null))
            .map((k) => [{ v: d.labels[k] ?? k, cls: 'label' }, ...s.values[k].map((v) => ({ v: fmt(k, v), cls: v != null && v < 0 ? 'down' : '' }))]),
          (i) => (['netIncome', 'freeCashFlow', 'equity'].includes(keys.filter((k) => s.values[k]?.some((v) => v != null))[i]) ? 'total' : ''),
        ),
      );
    return [
      h('div', { class: 'ap-controls' }, toggle, h('span', { class: 'muted small' }, quarterly ? 'Fourth quarters are worked out as the full year minus the first three.' : 'From each 10-K annual report.')),
      table('Income statement', d.sections.income),
      table('Balance sheet', d.sections.balance),
      table('Cash flow', d.sections.cashflow),
      h('p', { class: 'ap-note' }, 'Source: SEC EDGAR XBRL data as filed by the company. Some lines are blank when a company uses its own labels.'),
    ];
  }

  function valuation(d: CompanyData): Node[] {
    const v = d.valuation;
    if (!v.shares || d.ttm.freeCashFlow == null) return [h('p', { class: 'muted' }, 'Not enough data (free cash flow or share count) for a DCF on this company.')];
    const revGrowth = (d.ratios.revenueGrowth ?? []).filter((x): x is number => x != null).slice(-3);
    const avgGrowth = revGrowth.length ? revGrowth.reduce((a, b) => a + b, 0) / revGrowth.length : 0.05;
    const w = {
      riskFree,
      beta: v.beta ?? 1,
      equityPremium: 0.05,
      costOfDebt: Math.min(0.12, Math.max(0.02, v.costOfDebt ?? 0.05)),
      taxRate: Math.min(0.35, Math.max(0, v.taxRate ?? 0.21)),
      marketCap: v.marketCap ?? 0,
      debt: v.debt,
    };
    const inputs: DcfInputs = {
      baseFcf: d.ttm.freeCashFlow,
      growth: Math.min(0.25, Math.max(-0.05, avgGrowth)),
      terminalGrowth: 0.025,
      discountRate: wacc(w).wacc,
      netDebt: v.debt - v.cash,
      shares: v.shares,
    };
    const results = h('div', { class: 'ap-body' });
    const waccOut = h('span', { class: 'muted small' });
    const discountField = h('div', {});

    function setDiscount() {
      discountField.replaceChildren(numberField('Discount rate (WACC)', inputs.discountRate, (x) => ((inputs.discountRate = x), update()), { percent: true, hint: 'The yearly return you require' }));
    }

    function useWacc() {
      const r = wacc(w);
      inputs.discountRate = r.wacc;
      setDiscount();
      update();
    }

    function update() {
      const r = wacc(w);
      waccOut.textContent = `Cost of equity ${pct(r.costOfEquity)} · after-tax debt ${pct(r.afterTaxDebt)} · ${(r.equityWeight * 100).toFixed(0)}% equity → WACC ${pct(r.wacc)}`;
      const out = dcf(inputs);
      const price = v.price ?? NaN;
      const upside = out.perShare / price - 1;
      const implied = Number.isFinite(price) ? impliedGrowth(inputs, price) : null;
      const rates = [-0.02, -0.01, 0, 0.01, 0.02].map((x) => inputs.discountRate + x);
      const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((x) => inputs.terminalGrowth + x);
      const grid = sensitivity(inputs, rates, growths);
      results.replaceChildren(
        statCards([
          { label: 'Value per share', value: formatPrice(out.perShare), tone: upside >= 0 ? 'up' : 'down' },
          { label: 'Current price', value: formatPrice(price) },
          { label: Number.isFinite(upside) ? (upside >= 0 ? 'Upside' : 'Downside') : 'Upside', value: pct(upside, 1), tone: upside >= 0 ? 'up' : 'down' },
          { label: 'Growth the price implies', value: implied == null ? '—' : pct(implied, 1), hint: 'The 5-year free cash flow growth needed to justify today’s price with these other inputs' },
          { label: 'Enterprise value', value: money(out.enterpriseValue) },
          { label: 'Terminal value share', value: pct(out.pvTerminal / out.enterpriseValue, 0), hint: 'How much of the value comes from after year 10. Over ~75% means the result depends heavily on long-run guesses.' },
        ]),
        h(
          'div',
          { class: 'two-col' },
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'Projected free cash flow')),
            dataTable(
              ['Year', 'Growth', 'Free cash flow', 'Today’s value'],
              [
                ...out.years.map((y) => [String(y.year), pct(y.growth, 1), money(y.fcf), money(y.pv)]),
                [{ v: 'After year 10', cls: 'label' }, pct(inputs.terminalGrowth, 1), money(out.terminalValue), money(out.pvTerminal)],
              ],
            ),
          ),
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'Sensitivity: value per share')),
            h('p', { class: 'muted small' }, 'Rows: discount rate. Columns: long-run growth. Small changes move the answer a lot, so treat it as a range.'),
            dataTable(
              ['Discount ↓ / growth →', ...growths.map((g) => pct(g, 1))],
              grid.map((row, i) => [{ v: pct(rates[i], 1), cls: 'label' }, ...row.map((x, j) => ({ v: formatPrice(x), cls: `${i === 2 && j === 2 ? 'hl ' : ''}${x >= price ? 'up' : 'down'}` }))]),
            ),
          ),
        ),
      );
    }

    setDiscount();
    update();
    return [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Assumptions'), h('span', { class: 'muted small' }, 'Pre-filled from the filings; change any number.')),
        h(
          'div',
          { class: 'field-grid' },
          numberField('Free cash flow, last 12 months ($M)', inputs.baseFcf / 1e6, (x) => ((inputs.baseFcf = x * 1e6), update())),
          numberField('Growth, years 1–5', inputs.growth, (x) => ((inputs.growth = x), update()), { percent: true, hint: `Revenue grew ${pct(avgGrowth, 1)} a year recently` }),
          numberField('Long-run growth (after year 10)', inputs.terminalGrowth, (x) => ((inputs.terminalGrowth = x), update()), { percent: true, hint: 'Usually 2–3%, close to the economy' }),
          discountField,
          numberField('Net debt ($M)', inputs.netDebt / 1e6, (x) => ((inputs.netDebt = x * 1e6), update()), { hint: 'Debt minus cash; negative means net cash' }),
          numberField('Shares (M)', inputs.shares / 1e6, (x) => ((inputs.shares = x * 1e6), update())),
        ),
        h('h4', {}, 'Discount rate helper (WACC)'),
        h(
          'div',
          { class: 'field-grid' },
          numberField('Risk-free rate (10y Treasury)', w.riskFree, (x) => ((w.riskFree = x), update()), { percent: true }),
          numberField('Beta', w.beta, (x) => ((w.beta = x), update()), { step: 0.05 }),
          numberField('Equity risk premium', w.equityPremium, (x) => ((w.equityPremium = x), update()), { percent: true, hint: 'Extra return stocks are expected to earn over bonds; 4–6% is typical' }),
          numberField('Cost of debt', w.costOfDebt, (x) => ((w.costOfDebt = x), update()), { percent: true }),
          numberField('Tax rate', w.taxRate, (x) => ((w.taxRate = x), update()), { percent: true }),
        ),
        h('div', { class: 'ap-controls', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: useWacc }, 'Use this WACC'), waccOut),
      ),
      results,
      h('p', { class: 'ap-note' }, 'A DCF is an estimate, not a fact. It is only as good as its assumptions. Not investment advice.'),
    ];
  }

  function filings(d: CompanyData): Node[] {
    return [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Recent SEC filings'), h('span', { class: 'muted small' }, '10-K annual, 10-Q quarterly, 8-K news, DEF 14A proxy (pay and votes)')),
        dataTable(
          ['Filed', 'Form', 'Period', 'Description', ''],
          d.filings.map((f) => [f.filed, h('b', {}, f.form), f.reportDate || '—', { v: f.description || '', cls: 'label' }, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, 'Open')]),
        ),
      ),
    ];
  }

  let started = false;
  return {
    el: frame.el,
    open(symbol: string) {
      symbolInput.value = symbol;
      started = true;
      load();
    },
    stop() {
      stopQuote();
      stopQuote = () => {};
    },
    async start() {
      if (started) {
        // Coming back to the page: resume the live price.
        if (data) {
          const sym = data.symbol;
          stopQuote();
          stopQuote = subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
            if (q.last == null) return;
            livePrice.textContent = formatPrice(q.last);
            if (q.prevClose) setChange(((q.last - q.prevClose) / q.prevClose) * 100);
          });
        }
        return;
      }
      started = true;
      engineRequest<{ value: number }>('macro.series', { series: 'DGS10' })
        .then((r) => (riskFree = r.value / 100))
        .catch(() => {});
      load();
    },
  };
}
