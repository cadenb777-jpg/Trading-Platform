import { toneVsPeers } from './tone';
/**
 * Research > Valuation, beside the DCF: comparable companies (with a football field), an LBO model and a merger
 * (accretion/dilution) model. Inputs start from the company's SEC figures and can all be changed. The maths is in
 * comps.ts, lbo.ts and merger.ts (tested); these views only draw it.
 */
import { engineRequest } from '../data/schwab';
import { dataTable, money, numberField, pct, pctU, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { footballFieldSvg, type RangeRow } from '../ui/quantCharts';
import { blendedRange, footballField, MULTIPLES, summarise, type CompRow, type CompsReply } from './comps';
import { DEFAULT_TRANCHES, lbo, lboSensitivity, type LboInputs, type Tranche } from './lbo';
import { merger, mergerSensitivity, type MergerInputs } from './merger';
import type { CompanyData } from '../pages/researchPage';

const ESTIMATE = 'An estimate from the assumptions shown, not a fact and not investment advice.';
const fmtX = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}×`);
const panel = (title: string, note: string | null, ...body: (Node | null)[]) =>
  h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), note ? h('span', { class: 'muted small' }, note) : null), ...body);
const asOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const mm = (v: number) => (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });
const last = (xs: (number | null)[] | undefined) => [...(xs ?? [])].reverse().find((x) => x != null) ?? null;

// ---------- Comparable companies ----------

/** Peer table, statistics, implied value range and football field. `dcfValue` is the DCF tab's value per share. */
export function compsView(d: CompanyData, dcfValue: number | null): Node[] {
  const box = h('div', { class: 'ap-body' }, h('div', { class: 'muted pad' }, `Finding ${d.symbol}'s peers in the SEC's industry list…`));
  const peersInput = h('input', { class: 'input qp-peers', placeholder: 'Your own peers, e.g. MSFT, GOOGL, META', 'aria-label': 'Peer symbols', spellcheck: false });
  const excluded = new Set<string>();
  let reply: CompsReply | null = null;

  async function load(typed: string[] = []) {
    box.replaceChildren(h('div', { class: 'muted pad' }, typed.length ? `Loading ${typed.join(', ')} from the SEC…` : `Finding ${d.symbol}'s peers in the SEC's industry list…`));
    try {
      reply = await engineRequest<CompsReply>('quant.comps', typed.length ? { symbol: d.symbol, peers: typed } : { symbol: d.symbol }, 180000);
      excluded.clear();
      draw();
    } catch (err) {
      box.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  function draw() {
    if (!reply) return;
    const r = reply;
    const t = r.target;
    const kept = r.peers.filter((p) => !excluded.has(p.symbol));
    const cols: [keyof CompRow, string, (v: number | null) => string][] = [
      ['marketCap', 'Market cap', money],
      ['evEbitda', 'EV/EBITDA', fmtX],
      ['pe', 'P/E', fmtX],
      ['ps', 'P/S', fmtX],
      ['pb', 'P/B', fmtX],
      ['evSales', 'EV/Sales', fmtX],
      ['revenueGrowth', 'Rev. growth', (v) => pct(v, 1)],
      ['grossMargin', 'Gross margin', (v) => pctU(v, 1)],
      ['operatingMargin', 'Op. margin', (v) => pctU(v, 1)],
      ['netMargin', 'Net margin', (v) => pctU(v, 1)],
    ];
    const medianOf = (k: string) => summarise(kept.map((p) => p[k as keyof CompRow] as number | null).filter((x): x is number => x != null && (!MULTIPLES.some((m) => m.key === k) || x > 0))).median;
    const line = (p: CompRow, own = false) => [
      own
        ? { v: h('b', {}, `${p.symbol} (this company)`), cls: 'label' }
        : {
            v: h(
              'label',
              { class: 'qp-include', title: 'Untick to leave this peer out of the statistics and the value range' },
              h('input', { type: 'checkbox', checked: !excluded.has(p.symbol), onchange: () => (excluded.has(p.symbol) ? excluded.delete(p.symbol) : excluded.add(p.symbol), draw()) }),
              h('span', {}, p.symbol),
            ),
            cls: 'label',
          },
      h('span', { class: 'muted small qp-name' }, p.name),
      // this company's figures against the peers' median: green = cheaper multiple or better margin/growth
      ...cols.map(([k, , f]) => (own ? { v: f(p[k] as number | null), cls: toneVsPeers(k, p[k] as number | null, medianOf(k)), title: 'Against the peers’ median' } : f(p[k] as number | null))),
    ];
    const stat = (label: string, pick: 'median' | 'mean') => [
      { v: h('b', {}, label), cls: 'label' },
      `${kept.length} peers`,
      ...cols.map(([k, , f]) => {
        const s = summarise(kept.map((p) => p[k] as number | null).filter((x) => x != null && (!MULTIPLES.some((m) => m.key === k) || x > 0)));
        return h('b', {}, f(s[pick]));
      }),
    ];
    const field = footballField(t, r.peers, excluded);
    const blend = blendedRange(field);
    const rows: RangeRow[] = field.map((f) => ({ label: f.label, low: f.low, mid: f.mid, high: f.high, note: `${f.peers} peers, 25th–75th percentile multiple` }));
    if (dcfValue != null && Number.isFinite(dcfValue) && dcfValue > 0) rows.push({ label: 'DCF (±15%)', low: dcfValue * 0.85, mid: dcfValue, high: dcfValue * 1.15, kind: 'own', note: 'your DCF inputs' });
    if (d.quote.low52 && d.quote.high52) rows.push({ label: '52-week range', low: d.quote.low52, high: d.quote.high52, kind: 'own' });
    box.replaceChildren(
      statCards([
        { label: 'Implied value (median of methods)', value: blend ? formatPrice(blend.mid) : '—', tone: blend && t.price ? (blend.mid >= t.price ? 'up' : 'down') : '' },
        { label: 'Implied range', value: blend ? `${formatPrice(blend.low)} – ${formatPrice(blend.high)}` : '—', hint: 'Lowest to highest of the peer ranges below' },
        { label: 'Current price', value: formatPrice(t.price) },
        { label: 'Peers used', value: `${kept.length} of ${r.peers.length}`, hint: r.peerSource },
      ]),
      panel(
        'Comparable companies',
        `${r.peerSource}${r.industry ? ` · ${r.industry}` : ''}${r.sic ? ` (SIC ${r.sic})` : ''}`,
        dataTable(['Company', 'Name', ...cols.map(([, l]) => l)], [line(t, true), ...r.peers.map((p) => line(p)), stat('Median', 'median'), stat('Mean', 'mean')], (i) => (i === 0 ? 'hl' : i > r.peers.length ? 'total' : excluded.has(r.peers[i - 1]?.symbol) ? 'qp-off' : ''), false),
        r.failed.length ? h('p', { class: 'muted small' }, `No SEC figures for ${r.failed.map((f) => f.symbol).join(', ')}.`) : null,
        h('p', { class: 'ap-note' }, `Trailing 12 months. EV = market cap + long-term debt − cash. Multiples of a loss are left blank. Sources: ${r.sources}; as of ${asOf(r.asOf)}.`),
      ),
      panel(
        'Football field: value per share by method',
        'Bars: the peers’ middle half of multiples applied to this company; tick: the median',
        footballFieldSvg(rows, t.price, formatPrice),
        dataTable(
          ['Method', 'Peers', 'This company', 'Low', 'Median', 'High'],
          field.map((f) => [{ v: f.label, cls: 'label' }, String(f.peers), fmtX(f.own), formatPrice(f.low), h('b', {}, formatPrice(f.mid)), formatPrice(f.high)]),
          undefined,
          false,
        ),
      ),
      h('p', { class: 'ap-note' }, `${ESTIMATE} Peers differ in growth, risk and accounting; a cheap multiple can be cheap for a reason.`),
    );
  }

  const run = () => load(peersInput.value.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean));
  peersInput.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  queueMicrotask(() => load());
  return [
    h(
      'div',
      { class: 'ap-controls qp-controls' },
      peersInput,
      h('button', { class: 'btn', onclick: run }, 'Use these peers'),
      h('button', { class: 'btn', onclick: () => ((peersInput.value = ''), load()) }, 'Find peers for me'),
    ),
    box,
  ];
}

// ---------- LBO ----------

export function lboView(d: CompanyData): Node[] {
  const a = d.annual.values;
  const ebitda0 = d.ttm.operatingIncome != null ? d.ttm.operatingIncome + (d.ttm.dna ?? 0) : null;
  if (!ebitda0 || ebitda0 <= 0) return [h('p', { class: 'muted' }, 'This company has no positive EBITDA in its filings, so a buyout model has nothing to borrow against.')];
  const ev = d.valuation.evEbitda;
  const growth = (d.ratios.revenueGrowth ?? []).filter((x): x is number => x != null).slice(-3);
  const capex = last(a.capex);
  const opInc = last(a.operatingIncome);
  const dna = last(a.dna);
  const lastEbitda = opInc != null ? opInc + (dna ?? 0) : null;
  const i: LboInputs = {
    ebitda: ebitda0,
    entryMultiple: ev && ev > 0 && ev < 40 ? Math.round(ev * 2) / 2 : 10,
    exitMultiple: ev && ev > 0 && ev < 40 ? Math.round(ev * 2) / 2 : 10,
    years: 5,
    growth: Math.min(0.15, Math.max(0, growth.length ? growth.reduce((x, y) => x + y, 0) / growth.length : 0.04)),
    daPct: lastEbitda && dna != null ? Math.min(0.6, dna / lastEbitda) : 0.15,
    capexPct: lastEbitda && capex != null ? Math.min(0.8, Math.abs(capex) / lastEbitda) : 0.2,
    nwcPct: 0.1,
    taxRate: Math.min(0.35, Math.max(0, d.valuation.taxRate ?? 0.21)),
    feesPct: 0.02,
    sweepPct: 1,
    tranches: DEFAULT_TRANCHES.map((t) => ({ ...t })),
  };
  const out = h('div', { class: 'ap-body' });
  const trancheBox = h('div', {});
  const M = 1e6;

  function drawTranches() {
    const row = (t: Tranche, k: number) =>
      h(
        'div',
        { class: 'qp-tranche' },
        h('input', { class: 'input', value: t.name, 'aria-label': 'Tranche name', oninput: (e: Event) => ((t.name = (e.target as HTMLInputElement).value), update()) }),
        numberField('× EBITDA', t.multiple, (v) => ((t.multiple = v), update()), { step: 0.25 }),
        numberField('Interest', t.rate, (v) => ((t.rate = v), update()), { percent: true, step: 0.25 }),
        numberField('Repay / year', t.amortization, (v) => ((t.amortization = v), update()), { percent: true, step: 1, hint: 'Mandatory repayment each year, % of the amount borrowed' }),
        h('label', { class: 'qp-include', title: 'Spare cash repays this early' }, h('input', { type: 'checkbox', checked: t.sweep, onchange: (e: Event) => ((t.sweep = (e.target as HTMLInputElement).checked), update()) }), h('span', {}, 'Cash sweep')),
        h('button', { class: 'btn small', 'aria-label': `Remove ${t.name}`, onclick: () => (i.tranches.splice(k, 1), drawTranches(), update()) }, 'Remove'),
      );
    trancheBox.replaceChildren(
      ...i.tranches.map(row),
      h('button', { class: 'btn small', onclick: () => (i.tranches.push({ name: 'Second lien', multiple: 1, rate: 0.11, amortization: 0, sweep: false }), drawTranches(), update()) }, 'Add debt tranche'),
    );
  }

  function update() {
    const r = lbo(i);
    const entries = [-2, -1, 0, 1, 2].map((x) => i.entryMultiple + x);
    const exits = [-2, -1, 0, 1, 2].map((x) => i.exitMultiple + x);
    const grid = lboSensitivity(i, entries, exits);
    const irrText = (v: number | null) => (v == null ? '—' : pct(v, 1));
    out.replaceChildren(
      statCards([
        { label: h('span', {}, 'IRR (yearly) ', infoTip('moic')), value: irrText(r.irr), tone: r.irr != null && r.irr >= 0.2 ? 'up' : r.irr != null && r.irr < 0.1 ? 'down' : '', hint: 'Buyout firms usually aim for 20%+' },
        { label: 'Money multiple (MoIC)', value: Number.isFinite(r.moic) ? `${r.moic.toFixed(2)}×` : '—', hint: 'Equity out ÷ equity in' },
        { label: 'Equity put in', value: money(r.equity), hint: `${pctU(r.equity / (r.entryEv + r.fees), 0)} of the price` },
        { label: 'Equity at exit', value: money(r.exitEquity) },
        { label: 'Debt / EBITDA', value: `${r.leverageIn.toFixed(1)}× → ${r.leverageOut.toFixed(1)}×`, hint: 'At entry → at exit' },
      ]),
      h(
        'div',
        { class: 'two-col' },
        panel(
          'Sources and uses',
          null,
          dataTable(
            ['Uses', '', 'Sources', ''],
            [
              ['Purchase (enterprise value)', money(r.entryEv), ...(i.tranches[0] ? [i.tranches[0].name, money(i.tranches[0].multiple * i.ebitda)] : ['', ''])],
              ['Fees', money(r.fees), ...(i.tranches[1] ? [i.tranches[1].name, money(i.tranches[1].multiple * i.ebitda)] : ['', ''])],
              ...i.tranches.slice(2).map((t) => ['', '', t.name, money(t.multiple * i.ebitda)]),
              ['', '', 'Equity', money(r.equity)],
              [h('b', {}, 'Total'), h('b', {}, money(r.entryEv + r.fees)), h('b', {}, 'Total'), h('b', {}, money(r.debt + r.equity))],
            ],
            undefined,
            false,
          ),
        ),
        panel(
          'IRR sensitivity',
          'Rows: price paid (× EBITDA). Columns: sale multiple.',
          dataTable(
            ['Entry ↓ / exit →', ...exits.map((x) => `${x.toFixed(1)}×`)],
            grid.map((row, k) => [{ v: `${entries[k].toFixed(1)}×`, cls: 'label' }, ...row.map((v, j) => ({ v: irrText(v), cls: `${k === 2 && j === 2 ? 'hl ' : ''}${v == null ? '' : v >= 0.2 ? 'up' : v < 0.1 ? 'down' : ''}` }))]),
            undefined,
            false,
          ),
        ),
      ),
      panel(
        'Year by year ($M)',
        'Interest on each year’s opening debt; spare cash repays the sweep tranches',
        dataTable(
          ['', ...r.years.map((y) => `Year ${y.year}`)],
          (
            [
              ['EBITDA', 'ebitda'],
              ['Interest', 'interest'],
              ['Taxes', 'taxes'],
              ['Net income', 'netIncome'],
              ['Capex', 'capex'],
              ['Working capital', 'nwc'],
              ['Free cash flow', 'freeCashFlow'],
              ['Scheduled repayment', 'mandatory'],
              ['Cash sweep', 'sweep'],
              ['Debt at year end', 'debt'],
              ['Cash at year end', 'cash'],
            ] as [string, keyof (typeof r.years)[number]][]
          ).map(([label, k]) => [{ v: label, cls: 'label' }, ...r.years.map((y) => (y[k] / M).toLocaleString('en-US', { maximumFractionDigits: 0 }))]),
          (k) => (k === 6 || k === 9 ? 'total' : ''),
        ),
      ),
    );
  }

  drawTranches();
  update();
  return [
    panel(
      'LBO assumptions',
      'Pre-filled from the filings; change any number',
      h(
        'div',
        { class: 'field-grid' },
        numberField('EBITDA, last 12 months ($M)', i.ebitda / M, (v) => ((i.ebitda = v * M), update())),
        numberField('Entry multiple (× EBITDA)', i.entryMultiple, (v) => ((i.entryMultiple = v), update()), { step: 0.5, hint: `Today the market values it at ${fmtX(ev)}` }),
        numberField('Exit multiple (× EBITDA)', i.exitMultiple, (v) => ((i.exitMultiple = v), update()), { step: 0.5, hint: 'Same as entry is the cautious default' }),
        numberField('Years held', i.years, (v) => ((i.years = Math.min(10, Math.max(1, Math.round(v)))), update()), { step: 1 }),
        numberField('EBITDA growth a year', i.growth, (v) => ((i.growth = v), update()), { percent: true }),
        numberField('D&A (% of EBITDA)', i.daPct, (v) => ((i.daPct = v), update()), { percent: true }),
        numberField('Capex (% of EBITDA)', i.capexPct, (v) => ((i.capexPct = v), update()), { percent: true }),
        numberField('Working capital (% of EBITDA growth)', i.nwcPct, (v) => ((i.nwcPct = v), update()), { percent: true }),
        numberField('Tax rate', i.taxRate, (v) => ((i.taxRate = v), update()), { percent: true }),
        numberField('Deal fees (% of price)', i.feesPct, (v) => ((i.feesPct = v), update()), { percent: true }),
        numberField('Cash sweep (% of spare cash)', i.sweepPct, (v) => ((i.sweepPct = Math.min(1, Math.max(0, v))), update()), { percent: true, step: 5 }),
      ),
      h('h4', {}, 'Debt'),
      trancheBox,
    ),
    out,
    h('p', { class: 'ap-note' }, `${ESTIMATE} A real buyout also has a revolver, a minimum cash balance, financing fees and management equity; this keeps the core mechanics only.`),
  ];
}

// ---------- Merger (accretion / dilution) ----------

export function mergerView(d: CompanyData): Node[] {
  const v = d.valuation;
  const ni = d.ttm.netIncome;
  if (!v.price || !v.shares || ni == null) return [h('p', { class: 'muted' }, 'This company needs a price, a share count and net income in its filings for a merger model.')];
  const i: MergerInputs = {
    acquirerPrice: v.price,
    acquirerShares: v.shares,
    acquirerNetIncome: ni,
    // an illustrative target a tenth the size at 15× earnings until a real one is loaded
    targetPrice: 50,
    targetShares: (v.price * v.shares * 0.1) / 50,
    targetNetIncome: (v.price * v.shares * 0.1) / 15,
    premium: 0.3,
    cashShare: 0.5,
    debtRate: Math.min(0.12, Math.max(0.03, v.costOfDebt ?? 0.06)),
    taxRate: Math.min(0.35, Math.max(0, v.taxRate ?? 0.21)),
    synergies: 0,
  };
  let targetName = 'Example target (load a real one)';
  const M = 1e6;
  const out = h('div', { class: 'ap-body' });
  const targetFields = h('div', { class: 'field-grid' });
  const targetInput = h('input', { class: 'input symbol', placeholder: 'Ticker', 'aria-label': 'Target symbol', spellcheck: false });
  const status = h('span', { class: 'muted small' }, targetName);

  async function loadTarget() {
    const sym = targetInput.value.trim().toUpperCase();
    if (!sym) return;
    status.textContent = `Loading ${sym} from the SEC…`;
    try {
      const t = await engineRequest<CompanyData>('research.company', { symbol: sym }, 90000);
      if (!t.valuation.price || !t.valuation.shares || t.ttm.netIncome == null) throw new Error(`${sym} has no price, share count or net income to use.`);
      i.targetPrice = t.valuation.price;
      i.targetShares = t.valuation.shares;
      i.targetNetIncome = t.ttm.netIncome;
      targetName = `${t.profile.name} (${t.symbol}), SEC filings and Schwab price`;
      status.textContent = targetName;
      drawTarget();
      update();
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  }
  targetInput.addEventListener('keydown', (e) => e.key === 'Enter' && loadTarget());

  function drawTarget() {
    targetFields.replaceChildren(
      numberField('Target share price ($)', i.targetPrice, (x) => ((i.targetPrice = x), update()), { step: 0.5 }),
      numberField('Target shares (M)', i.targetShares / M, (x) => ((i.targetShares = x * M), update())),
      numberField('Target net income ($M)', i.targetNetIncome / M, (x) => ((i.targetNetIncome = x * M), update())),
    );
  }

  function update() {
    const r = merger(i);
    const premiums = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const cashShares = [0, 0.25, 0.5, 0.75, 1];
    const grid = mergerSensitivity(i, premiums, cashShares);
    const tone = (x: number) => (x >= 0 ? 'up' : 'down');
    out.replaceChildren(
      statCards([
        { label: h('span', {}, r.accretion >= 0 ? 'EPS accretion ' : 'EPS dilution ', infoTip('accretion')), value: pct(r.accretion, 1), tone: tone(r.accretion), hint: 'Change in the buyer’s earnings per share in the first full year' },
        { label: 'Earnings per share', value: `$${r.standaloneEps.toFixed(2)} → $${r.proFormaEps.toFixed(2)}`, hint: 'Before → after the deal' },
        { label: 'Price paid', value: money(r.purchasePrice), hint: `${formatPrice(r.offerPerShare)} a share · ${fmtX(r.offerPe)} earnings vs the buyer’s ${fmtX(r.acquirerPe)}` },
        { label: 'Synergies to break even', value: r.breakevenSynergies <= 0 ? 'None needed' : money(r.breakevenSynergies), hint: 'Yearly pre-tax savings needed for no dilution' },
        { label: 'New shares issued', value: `${(r.newShares / M).toFixed(1)}M`, hint: `Target owners end up with ${pctU(r.targetOwnership, 1)} of the combined company` },
      ]),
      h(
        'div',
        { class: 'two-col' },
        panel(
          'Pro forma earnings ($M)',
          null,
          dataTable(
            ['', '$M'],
            [
              ['Buyer net income', mm(i.acquirerNetIncome)],
              ['Target net income', mm(i.targetNetIncome)],
              ['Synergies after tax', mm(i.synergies * (1 - i.taxRate))],
              ['Cost of the cash after tax', `−${mm(r.financingCost)}`],
              [h('b', {}, 'Combined net income'), h('b', {}, mm(r.proFormaNetIncome))],
              ['Shares after the deal (M)', (r.proFormaShares / M).toLocaleString('en-US', { maximumFractionDigits: 1 })],
            ],
            undefined,
            false,
          ),
        ),
        panel(
          'Accretion / dilution sensitivity',
          'Rows: premium paid. Columns: share paid in cash.',
          dataTable(
            ['Premium ↓ / cash →', ...cashShares.map((c) => pctU(c, 0))],
            grid.map((row, k) => [{ v: pctU(premiums[k], 0), cls: 'label' }, ...row.map((x) => ({ v: pct(x, 1), cls: tone(x) }))]),
            undefined,
            false,
          ),
        ),
      ),
    );
  }

  drawTarget();
  update();
  return [
    panel(
      `Merger model: ${d.profile.name} buys a target`,
      'Pre-filled from the filings; change any number',
      h('div', { class: 'ap-controls qp-controls' }, targetInput, h('button', { class: 'btn', onclick: loadTarget }, 'Load target'), status),
      targetFields,
      h('h4', {}, 'Deal terms'),
      h(
        'div',
        { class: 'field-grid' },
        numberField('Premium over the target’s price', i.premium, (x) => ((i.premium = x), update()), { percent: true, step: 5 }),
        numberField('Paid in cash', i.cashShare, (x) => ((i.cashShare = Math.min(1, Math.max(0, x))), update()), { percent: true, step: 5, hint: 'The rest is paid in new shares of the buyer' }),
        numberField('Cost of the cash (pre-tax)', i.debtRate, (x) => ((i.debtRate = x), update()), { percent: true, hint: 'Interest on new debt, or interest the cash was earning' }),
        numberField('Tax rate', i.taxRate, (x) => ((i.taxRate = x), update()), { percent: true }),
        numberField('Synergies a year, pre-tax ($M)', i.synergies / M, (x) => ((i.synergies = x * M), update())),
        numberField(`Buyer net income ($M)`, i.acquirerNetIncome / M, (x) => ((i.acquirerNetIncome = x * M), update())),
        numberField('Buyer share price ($)', i.acquirerPrice, (x) => ((i.acquirerPrice = x), update()), { step: 0.5 }),
      ),
    ),
    out,
    h('p', { class: 'ap-note' }, `${ESTIMATE} Accretion says nothing about whether the deal creates value: paying too much can still raise EPS.`),
  ];
}
