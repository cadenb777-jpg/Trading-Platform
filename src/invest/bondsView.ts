/**
 * Bonds: the bond market (yields, credit spreads, the yield curve, bond ETFs), Treasury auctions, a CUSIP
 * lookup (Schwab), a bond calculator (price, yield, duration, tax-equivalent yield) and a Treasury ladder.
 */
import { engineRequest } from '../data/schwab';
import { dataTable, money, numberField, pct, statCards, pctU } from '../ui/charts';
import { h } from '../ui/dom';
import { sparkline } from '../ui/sparkline';
import { yieldCurve, type CurvePoint } from '../ui/yieldCurve';
import { analyze, buildLadder, labelYears, priceChangeEstimate, priceFromYield, taxEquivalentYield, yearsUntil, yieldFromPrice, type BondInputs } from './bonds';
import { BOARDS } from './catalog';
import { boardTable, errorBox, loadBoard, openSymbolDetail, skeletonBoard, type InvestContext } from './shared';

type Tab = 'market' | 'auctions' | 'lookup' | 'calculator' | 'ladder';
const TABS: [Tab, string][] = [
  ['market', 'Bond market'],
  ['auctions', 'Treasury auctions'],
  ['lookup', 'Look up a bond (CUSIP)'],
  ['calculator', 'Bond calculator'],
  ['ladder', 'Ladder builder'],
];

interface RateSeries {
  id: string;
  name: string;
  group: string;
  date: string;
  value: number;
  monthAgo: number | null;
  yearAgo: number | null;
  spark: number[];
}

interface Auction {
  cusip: string;
  type: string;
  term: string;
  auctionDate: string;
  issueDate: string;
  maturityDate: string;
  rate: number | null;
  yield: number | null;
  discountRate: number | null;
  price: number | null;
  bidToCover: number | null;
  offering: number | null;
  reopening: boolean;
}

interface CusipResult {
  cusip: string;
  description: string;
  assetType: string;
  price: number | null;
  coupon: number | null;
  maturity: string | null;
  auctions: Auction[];
}

const bps = (now: number, then: number | null) => (then == null ? '' : `${now - then >= 0 ? '+' : '−'}${Math.round(Math.abs(now - then) * 100)} bp`);
const pctPoints = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`);

export function createBondsView(ctx: InvestContext) {
  let tab: Tab = 'market';
  const body = h('div', { class: 'inv-sub' });
  const tabs = h('div', { class: 'tabs inv-tabs', role: 'tablist' }, ...TABS.map(([t, label]) => h('button', { class: `tab${t === tab ? ' active' : ''}`, 'data-tab': t, onclick: () => setTab(t) }, label)));
  const el = h('div', { class: 'inv-section' }, tabs, body);
  const calc = { coupon: 0.045, years: 10, frequency: 2, mode: 'price' as 'price' | 'yield', price: 98, yield: 0.047, muni: 0.035, federal: 0.32, state: 0.05 };
  let lookupCusip = '';
  let curveCache: CurvePoint[] | null = null;

  function setTab(t: Tab) {
    tab = t;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  function render() {
    if (tab === 'market') return renderMarket();
    if (tab === 'auctions') return renderAuctions();
    if (tab === 'lookup') return renderLookup();
    if (tab === 'calculator') return renderCalculator();
    return renderLadder();
  }

  async function curve(): Promise<CurvePoint[]> {
    curveCache ??= (await engineRequest<{ curve: CurvePoint[] }>('macro.curve', {}, 45000)).curve;
    return curveCache;
  }

  // ----- Market -----

  function renderMarket() {
    const rates = h('div', { class: 'inv-rates' }, h('div', { class: 'skeleton', style: 'height:120px' }));
    const curvePanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Treasury yield curve'), h('span', { class: 'muted small' }, 'What the government pays to borrow for each length of time')), h('div', { class: 'skeleton', style: 'height:240px' }));
    const boards = h('div', { class: 'inv-boards' }, ...BOARDS.bonds.map(skeletonBoard));
    body.replaceChildren(rates, curvePanel, h('h2', { class: 'group-title' }, 'Bond funds (ETFs)'), boards);
    engineRequest<{ series: RateSeries[]; failed: string[] }>('bonds.market', {}, 60000)
      .then(({ series, failed }) => {
        const groups = [...new Set(series.map((s) => s.group))];
        rates.replaceChildren(
          ...groups.map((g) =>
            h(
              'section',
              {},
              h('h2', { class: 'group-title' }, g),
              h(
                'div',
                { class: 'inv-rate-grid' },
                ...series
                  .filter((s) => s.group === g)
                  .map((s) =>
                    h(
                      'div',
                      { class: 'panel inv-rate' },
                      h('span', { class: 'muted small' }, s.name),
                      h('b', { class: 'inv-rate-value' }, pctPoints(s.value)),
                      h('span', { class: 'small inv-rate-change' }, h('span', {}, `${bps(s.value, s.monthAgo)} 1m`), h('span', {}, `${bps(s.value, s.yearAgo)} 1y`)),
                      h('div', { class: 'inv-rate-spark' }, sparkline(s.spark, null, '#2962ff')),
                      h('span', { class: 'muted tiny' }, s.date),
                    ),
                  ),
              ),
            ),
          ),
          failed.length ? h('p', { class: 'muted small' }, `Not available right now: ${failed.join(', ')}.`) : '',
        );
      })
      .catch((err) => rates.replaceChildren(errorBox(err, renderMarket)));
    curve()
      .then((points) => curvePanel.replaceChildren(curvePanel.firstChild!, yieldCurve(points)))
      .catch((err) => curvePanel.replaceChildren(curvePanel.firstChild!, errorBox(err)));
    loadBoard(BOARDS.bonds)
      .then((rows) => boards.replaceChildren(...BOARDS.bonds.map((g) => boardTable(g, rows, (s, l) => openSymbolDetail(s, l, rows.get(s), ctx)))))
      .catch((err) => boards.replaceChildren(errorBox(err, renderMarket)));
  }

  // ----- Treasury auctions -----

  function renderAuctions() {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:300px' }));
    engineRequest<{ results: Auction[]; upcoming: Auction[] }>('bonds.auctions', {}, 45000)
      .then(({ results, upcoming }) => {
        let filter = 'All';
        const types = ['All', ...new Set(results.map((r) => r.type).filter(Boolean))];
        const resultsBox = h('div');
        const security = (a: Auction) => `${a.term} ${a.type}${a.reopening ? ' (reopening)' : ''}`;
        const cusipLink = (a: Auction) => h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), (lookupCusip = a.cusip), setTab('lookup')) }, a.cusip);
        const drawResults = () =>
          resultsBox.replaceChildren(
            dataTable(
              ['Auction', 'Security', 'CUSIP', 'Yield / rate', 'Coupon', 'Price per $100', 'Bid-to-cover', 'Matures'],
              results
                .filter((r) => filter === 'All' || r.type === filter)
                .slice(0, 80)
                .map((a) => [a.auctionDate, { v: security(a), cls: 'label' }, cusipLink(a), pctPoints(a.yield ?? a.discountRate, 3), a.rate ? pctPoints(a.rate, 3) : '—', a.price ? a.price.toFixed(4) : '—', a.bidToCover ? `${a.bidToCover.toFixed(2)}×` : '—', a.maturityDate.slice(0, 10)]),
            ),
          );
        const seg = h(
          'div',
          { class: 'segmented small' },
          ...types.map((t) =>
            h('button', { class: t === filter ? 'active' : '', onclick: (e: Event) => ((filter = t), seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)), drawResults()) }, t),
          ),
        );
        drawResults();
        body.replaceChildren(
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'Coming up'), h('span', { class: 'muted small' }, 'Treasury auctions already announced. You can bid through Schwab or TreasuryDirect.')),
            upcoming.length
              ? dataTable(['Auction', 'Security', 'CUSIP', 'Issue date', 'Offering'], upcoming.map((a) => [a.auctionDate, { v: security(a), cls: 'label' }, a.cusip ? cusipLink(a) : '—', a.issueDate || '—', a.offering ? money(a.offering) : '—']))
              : h('p', { class: 'muted' }, 'No auctions announced yet.'),
          ),
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Recent results'), seg), resultsBox),
          h('p', { class: 'muted small' }, 'From the US Treasury (Fiscal Data). "Bid-to-cover" is how many dollars were bid for each dollar sold: higher means stronger demand.'),
        );
      })
      .catch((err) => body.replaceChildren(errorBox(err, renderAuctions)));
  }

  // ----- CUSIP lookup -----

  function renderLookup() {
    const input = h('input', { class: 'input', placeholder: 'CUSIP, e.g. 91282CLW9', value: lookupCusip, spellcheck: false, maxlength: 12, style: 'width:220px;text-transform:uppercase' });
    const result = h('div');
    const go = () => {
      lookupCusip = input.value.trim().toUpperCase();
      if (!lookupCusip) return;
      result.replaceChildren(h('div', { class: 'skeleton', style: 'height:160px' }));
      engineRequest<CusipResult>('bonds.cusip', { cusip: lookupCusip }, 30000)
        .then((r) => result.replaceChildren(cusipCard(r)))
        .catch((err) => result.replaceChildren(errorBox(err, go)));
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    body.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Look up a bond')),
        h('p', { class: 'muted small' }, 'Every bond has a 9-character CUSIP (on statements, trade confirmations and Schwab\'s bond pages). Schwab\'s data service looks bonds up one CUSIP at a time; to browse and buy bonds use Schwab BondSource on schwab.com.'),
        h('div', { class: 'ap-controls' }, input, h('button', { class: 'btn primary', onclick: go }, 'Look up')),
      ),
      result,
    );
    if (lookupCusip) go();
  }

  function cusipCard(r: CusipResult) {
    const years = r.maturity ? yearsUntil(r.maturity) : null;
    const bond: BondInputs | null = r.coupon != null && years != null && years > 0 ? { coupon: r.coupon / 100, years, frequency: 2 } : null;
    const ytm = bond && r.price ? yieldFromPrice(bond, r.price) : null;
    const a = bond && ytm != null ? analyze(bond, ytm) : null;
    return h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, r.description || r.cusip), h('span', { class: 'muted small' }, `CUSIP ${r.cusip}${r.assetType ? ` · ${r.assetType}` : ''}`)),
      statCards([
        { label: 'Price (per $100)', value: r.price ? r.price.toFixed(3) : '—', hint: 'From Schwab' },
        { label: 'Coupon', value: r.coupon != null ? `${r.coupon.toFixed(3)}%` : '—' },
        { label: 'Matures', value: r.maturity ?? '—', hint: years != null ? `${years.toFixed(1)} years` : '' },
        { label: 'Yield to maturity', value: ytm != null ? pctU(ytm, 3) : '—', hint: 'Calculated from the price' },
        { label: 'Modified duration', value: a ? a.modifiedDuration.toFixed(2) : '—', hint: a ? `Price moves about ${a.modifiedDuration.toFixed(1)}% for each 1% change in rates` : '' },
      ]),
      r.auctions.length
        ? h('div', {}, h('h4', {}, 'Treasury auction history'), dataTable(['Auction', 'Security', 'Yield', 'Coupon', 'Price', 'Bid-to-cover'], r.auctions.map((x) => [x.auctionDate, { v: `${x.term} ${x.type}`, cls: 'label' }, pctPoints(x.yield ?? x.discountRate, 3), x.rate ? pctPoints(x.rate, 3) : '—', x.price ? x.price.toFixed(4) : '—', x.bidToCover ? `${x.bidToCover.toFixed(2)}×` : '—'])))
        : null,
      bond
        ? h(
            'div',
            { class: 'inv-actions' },
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  Object.assign(calc, { coupon: bond.coupon, years: +bond.years.toFixed(2), frequency: 2, mode: r.price ? 'price' : 'yield', price: r.price ?? calc.price });
                  setTab('calculator');
                },
              },
              'Open in bond calculator',
            ),
          )
        : null,
    );
  }

  // ----- Calculator -----

  function renderCalculator() {
    const out = h('div', { class: 'inv-out' });
    const whatIf = h('div');
    const tey = h('div');
    const update = () => {
      const bond: BondInputs = { coupon: calc.coupon, years: Math.max(0.01, calc.years), frequency: calc.frequency };
      const y = calc.mode === 'price' ? yieldFromPrice(bond, calc.price) : calc.yield;
      const a = analyze(bond, y);
      out.replaceChildren(
        statCards([
          { label: calc.mode === 'price' ? 'Yield to maturity' : 'Price (per $100)', value: calc.mode === 'price' ? pctU(a.yieldToMaturity, 3) : a.cleanPrice.toFixed(3), hint: calc.mode === 'price' ? 'Your yearly return if held to maturity' : 'Clean price (without accrued interest)' },
          { label: 'Current yield', value: a.currentYield != null ? pctU(a.currentYield, 3) : '—', hint: 'Coupon ÷ price' },
          { label: 'Accrued interest', value: a.accrued.toFixed(3), hint: 'Added to the price when you buy between coupon dates' },
          { label: 'Macaulay duration', value: `${a.macaulayDuration.toFixed(2)} yrs`, hint: 'Average time until you get your money back' },
          { label: 'Modified duration', value: a.modifiedDuration.toFixed(2), hint: '% price change for a 1% change in rates' },
          { label: 'Convexity', value: a.convexity.toFixed(1) },
          { label: 'DV01 (per $100)', value: a.dv01.toFixed(4), hint: 'Price change for a 0.01% move in yield' },
        ]),
      );
      const moves = [-0.02, -0.01, -0.005, 0.005, 0.01, 0.02];
      whatIf.replaceChildren(
        dataTable(
          ['If rates move', 'New yield', 'New price', 'Price change', 'Duration estimate'],
          moves.map((dy) => {
            const p = priceFromYield(bond, a.yieldToMaturity + dy);
            const change = p / a.cleanPrice - 1;
            return [{ v: `${dy > 0 ? '+' : ''}${(dy * 100).toFixed(1)}%`, cls: 'label' }, pctU(a.yieldToMaturity + dy, 2), p.toFixed(2), { v: pct(change), cls: change >= 0 ? 'up' : 'down' }, pct(priceChangeEstimate(a, dy))];
          }),
        ),
      );
      const t = taxEquivalentYield(calc.muni, calc.federal, calc.state);
      tey.replaceChildren(statCards([{ label: 'Tax-equivalent yield', value: pctU(t, 2), hint: `A taxable bond would need to pay this to match a ${pctU(calc.muni, 2)} tax-free muni` }]));
    };
    const field = (label: string, value: number, set: (v: number) => void, opts: { percent?: boolean; step?: number; hint?: string } = {}) => numberField(label, value, (v) => (set(v), update()), opts);
    const freq = h('select', { class: 'input' }, ...[['2', 'Twice a year (most US bonds)'], ['1', 'Once a year'], ['4', 'Quarterly'], ['12', 'Monthly'], ['0', 'Zero-coupon']].map(([v, l]) => h('option', { value: v, selected: +v === calc.frequency }, l)));
    freq.addEventListener('change', () => ((calc.frequency = +freq.value), update()));
    const modeSel = h('select', { class: 'input' }, h('option', { value: 'price', selected: calc.mode === 'price' }, 'I know the price → find the yield'), h('option', { value: 'yield', selected: calc.mode === 'yield' }, 'I know the yield → find the price'));
    const known = h('div');
    const drawKnown = () => known.replaceChildren(calc.mode === 'price' ? field('Price (per $100 face)', calc.price, (v) => (calc.price = v), { step: 0.125 }) : field('Yield to maturity', calc.yield, (v) => (calc.yield = v), { percent: true, step: 0.05 }));
    modeSel.addEventListener('change', () => ((calc.mode = modeSel.value as 'price' | 'yield'), drawKnown(), update()));
    const fed = h('select', { class: 'input' }, ...[0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37].map((r) => h('option', { value: r, selected: r === calc.federal }, `${Math.round(r * 100)}%`)));
    fed.addEventListener('change', () => ((calc.federal = +fed.value), update()));
    drawKnown();
    body.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Bond calculator')),
        h(
          'div',
          { class: 'field-grid' },
          field('Coupon (yearly)', calc.coupon, (v) => (calc.coupon = v), { percent: true, step: 0.125 }),
          field('Years to maturity', calc.years, (v) => (calc.years = v), { step: 0.25 }),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Coupon payments'), freq),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'What do you know?'), modeSel),
          known,
        ),
        out,
      ),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'What if interest rates change?'), h('span', { class: 'muted small' }, 'Bond prices move opposite to rates')), whatIf),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Municipal bonds: tax-equivalent yield')),
        h(
          'div',
          { class: 'field-grid' },
          field('Tax-free (muni) yield', calc.muni, (v) => (calc.muni = v), { percent: true, step: 0.05 }),
          h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Federal tax bracket'), fed),
          field('State tax rate (in-state munis)', calc.state, (v) => (calc.state = v), { percent: true, step: 0.25 }),
        ),
        tey,
      ),
      h('p', { class: 'muted small' }, 'Standard bond maths (semi-annual compounding for zero-coupon bonds); real quotes can differ slightly because of settlement dates and day counts.'),
    );
    update();
  }

  // ----- Ladder -----

  function renderLadder() {
    const plan = { amount: 100000, first: 1, last: 5 };
    const out = h('div', { class: 'skeleton', style: 'height:200px' });
    let points: { years: number; yield: number }[] = [];
    const draw = () => {
      if (!points.length) return;
      const rungs = buildLadder(plan.amount, Math.round(plan.first), Math.round(plan.last), points);
      const income = rungs.reduce((s, r) => s + r.income, 0);
      const year = new Date().getFullYear();
      out.classList.remove('skeleton');
      out.replaceChildren(
        statCards([
          { label: 'Yearly interest', value: money(income), hint: 'Before tax, at today\'s Treasury yields' },
          { label: 'Average yield', value: pctU(plan.amount ? income / plan.amount : null, 2) },
          { label: 'Rungs', value: String(rungs.length), hint: 'One bond maturing each year' },
        ]),
        dataTable(['Matures', 'Amount', 'Treasury yield', 'Yearly interest'], rungs.map((r) => [{ v: `${year + r.year} (in ${r.year} yr${r.year > 1 ? 's' : ''})`, cls: 'label' }, money(r.amount), pctU(r.yield, 2), money(r.income)])),
        h('p', { class: 'muted small' }, 'As each bond matures, reinvest it at the long end to keep the ladder going. Yields are interpolated from today\'s Treasury curve; buy the actual Treasuries (or CDs and munis) at Schwab or TreasuryDirect.'),
      );
    };
    const field = (label: string, value: number, set: (v: number) => void, opts: { step?: number } = {}) => numberField(label, value, (v) => (set(v), draw()), opts);
    body.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Treasury ladder builder'), h('span', { class: 'muted small' }, 'Spread money across bonds that mature one after another')),
        h('div', { class: 'field-grid' }, field('Amount to invest ($)', plan.amount, (v) => (plan.amount = v), { step: 1000 }), field('First maturity (years)', plan.first, (v) => (plan.first = v)), field('Last maturity (years)', plan.last, (v) => (plan.last = Math.min(30, v)))),
        out,
      ),
    );
    curve()
      .then((curvePoints) => {
        points = curvePoints.map((p) => ({ years: labelYears(p.label) ?? 0, yield: p.now / 100 })).filter((p) => p.years > 0);
        draw();
      })
      .catch((err) => out.replaceWith(errorBox(err, renderLadder)));
  }

  return {
    el,
    show() {
      render();
    },
    refresh() {
      if (tab === 'market') renderMarket();
    },
  };
}

