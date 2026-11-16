/**
 * Prospects → firm detail: estimated revenue (helper engine/prospect_revenue.py: Form ADV assets by client type x
 * typical fee rates, performance fees, a headcount check), how its 13F investments have done (engine/prospect_perf.py)
 * and what the firm could be worth to you (your fee x the share of its assets you could win x your close rate).
 * Estimates are always shown as a range with the method; reported revenue only when the firm is a public company.
 */
import { engineRequest, helper } from '../data/schwab';
import { dataTable, statCards } from '../ui/charts';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { moneyText } from './logic';

export const REVENUE_HELPER_VERSION = 76;

export interface RevenuePart { type: string; label: string; aum: number; rate: number; rateLow: number; rateHigh: number; low: number; likely: number; high: number; basis: string }
export interface RevenueEstimate {
  low: number;
  likely: number;
  high: number;
  parts: RevenuePart[];
  performance: { assets: number; share: number; returns: [number, number, number]; source: string; low: number; likely: number; high: number } | null;
  perEmployee: { employees: number; low: number; likely: number; high: number } | null;
  effectiveRate: number | null;
  notes: string[];
  method: string;
}
export interface Quarter { start: string; end: string; partial: boolean; return: number | null; spy: number | null; priced: number; top: { ticker: string; weight: number; change: number; contribution: number }[] }
export interface Performance {
  quarters: Quarter[];
  oneYear: number | null;
  spyOneYear: number | null;
  quartersCounted: number;
  revenue: RevenueEstimate | null;
  reportedRevenue: { value: number; fiscalYearEnd: string; source: string } | null;
  note: string;
}
export interface YourTerms { fee: number; share: number; close: number }

const LS = 'tp.prospect.terms';
export const DEFAULT_TERMS: YourTerms = { fee: 0.01, share: 0.05, close: 0.1 };

/** What a prospect could be worth to you a year (pure, tested): their assets x share you win x your fee x close rate. */
export function yourRevenue(aum: number | null | undefined, t: YourTerms): { ifWon: number; expected: number } | null {
  if (!aum || aum <= 0) return null;
  const ifWon = aum * t.share * t.fee;
  return { ifWon, expected: ifWon * t.close };
}

export function loadTerms(): YourTerms {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (v && [v.fee, v.share, v.close].every((x: unknown) => typeof x === 'number' && x >= 0 && x <= 1)) return v;
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_TERMS };
}

const pctText = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const signed = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`);
export const rangeText = (r: { low: number; likely: number; high: number }) => `${moneyText(r.likely)} (${moneyText(r.low)} – ${moneyText(r.high)})`;

function estimateBlock(est: RevenueEstimate) {
  return h(
    'div',
    { class: 'pr-rev' },
    statCards([
      { label: 'Estimated revenue a year', value: moneyText(est.likely), hint: `Range ${moneyText(est.low)} – ${moneyText(est.high)}` },
      { label: 'Effective fee rate', value: pctText(est.effectiveRate, 2), hint: 'Likely revenue ÷ regulatory AUM' },
      ...(est.performance ? [{ label: 'Of which performance fees', value: moneyText(est.performance.likely), hint: `20% of gains on ${moneyText(est.performance.assets)} in private funds, from ${est.performance.source}` }] : []),
      ...(est.perEmployee ? [{ label: 'Headcount check', value: moneyText(est.perEmployee.likely), hint: `${est.perEmployee.employees} employees × a typical revenue per employee (${moneyText(est.perEmployee.low)} – ${moneyText(est.perEmployee.high)})` }] : []),
    ]),
    dataTable(
      ['Client type', 'Assets', 'Assumed fee', 'Revenue (likely)', 'Range'],
      est.parts.map((p) => [{ v: p.label, cls: 'label', title: p.basis }, moneyText(p.aum), { v: pctText(p.rate, 2), title: `${pctText(p.rateLow, 2)} – ${pctText(p.rateHigh, 2)}: ${p.basis}` }, moneyText(p.likely), `${moneyText(p.low)} – ${moneyText(p.high)}`]),
      undefined,
      false,
    ),
    ...est.notes.map((n) => h('p', { class: 'small warn-text' }, n)),
    h('p', { class: 'muted small' }, est.method, ' Fee rates are typical-industry assumptions, not this firm’s own schedule.'),
  );
}

function perfBlock(p: Performance) {
  const rows = p.quarters.map((q) => [
    `${q.start} → ${q.partial ? 'today' : q.end}`,
    { v: signed(q.return), cls: q.return == null ? 'muted' : q.return >= 0 ? 'up' : 'down' },
    { v: signed(q.spy), cls: 'muted' },
    { v: pctText(q.priced, 0), title: 'Share of the portfolio priced (top 40 stock positions with a known ticker)' },
    q.top.slice(0, 3).map((t) => `${t.ticker} ${signed(t.change)}`).join(' · '),
  ]);
  return h(
    'div',
    {},
    statCards([
      { label: 'Last 4 quarters', value: signed(p.oneYear), hint: `${p.quartersCounted} full quarters`, tone: p.oneYear == null ? '' : p.oneYear >= 0 ? 'up' : 'down' },
      { label: 'S&P 500 (SPY), same quarters', value: signed(p.spyOneYear) },
      { label: 'Ahead / behind', value: p.oneYear != null && p.spyOneYear != null ? signed(p.oneYear - p.spyOneYear) : '—', tone: p.oneYear != null && p.spyOneYear != null ? (p.oneYear >= p.spyOneYear ? 'up' : 'down') : '' },
    ]),
    rows.length ? dataTable(['Quarter', 'Their 13F stocks', 'SPY', 'Priced', 'Biggest movers'], rows, undefined, false) : h('p', { class: 'muted small' }, 'No 13F holdings to price.'),
    h('p', { class: 'muted small' }, p.note),
  );
}

function termsBlock(aum: number | null, onChange: () => void, out: HTMLElement) {
  const t = loadTerms();
  const input = (key: keyof YourTerms, label: string, step: string) => {
    const el = h('input', { class: 'input', type: 'number', min: '0', max: '100', step, value: String(+(t[key] * 100).toFixed(2)), 'aria-label': label });
    el.addEventListener('input', () => {
      const v = Number(el.value) / 100;
      if (Number.isFinite(v) && v >= 0 && v <= 1) {
        t[key] = v;
        try {
          localStorage.setItem(LS, JSON.stringify(t));
        } catch {
          /* not saved */
        }
        onChange();
      }
    });
    return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), el);
  };
  const draw = () => {
    const r = yourRevenue(aum, loadTerms());
    out.replaceChildren(
      r
        ? statCards([
            { label: 'Your revenue if won', value: moneyText(r.ifWon), hint: 'Their AUM × share you win × your fee, a year' },
            { label: 'Expected (× close rate)', value: moneyText(r.expected), hint: 'What this prospect is worth on average' },
          ])
        : h('p', { class: 'muted small' }, 'No AUM on file to work from.'),
    );
  };
  draw();
  return { el: h('div', { class: 'pr-terms' }, input('fee', 'Your fee (% a year)', '0.05'), input('share', 'Share of their assets you could win (%)', '1'), input('close', 'Your close rate (%)', '1')), draw };
}

/** The Revenue section of a firm profile. Draws the Form ADV estimate at once and fills in performance (and the
 * performance-fee update, and any reported revenue) when the helper answers. */
export function revenueSection(firmId: string, aum: number | null, est: RevenueEstimate | null | undefined): HTMLElement {
  const estBox = h('div', {}, est ? estimateBlock(est) : h('p', { class: 'muted small' }, aum ? 'Revenue estimate arrives with the next helper update (it installs by itself).' : 'No Form ADV assets on file, so no revenue estimate.'));
  const perfBox = h('div', {}, h('div', { class: 'skeleton', style: 'height:80px' }));
  const reported = h('div', {});
  const yours = h('div', {});
  const terms = termsBlock(aum, () => terms.draw(), yours);
  if ((helper.version ?? 0) >= REVENUE_HELPER_VERSION) {
    engineRequest<Performance>('prospect.performance', { firmId }, 90000).then(
      (p) => {
        // the same estimate, with the performance fee worked out from the firm's own 13F return
        if (p.revenue?.performance) estBox.replaceChildren(estimateBlock(p.revenue));
        perfBox.replaceChildren(p.quarters.length ? perfBlock(p) : h('p', { class: 'muted small' }, 'This firm files no 13F (stock holdings over $100M), so there is no portfolio to price.'));
        if (p.reportedRevenue) {
          reported.replaceChildren(h('p', { class: 'pr-reported' }, h('b', {}, `Reported revenue: ${moneyText(p.reportedRevenue.value)}`), ` (fiscal year to ${p.reportedRevenue.fiscalYearEnd}, ${p.reportedRevenue.source}: this firm or its filer is a public company).`));
        }
      },
      (err: Error) => perfBox.replaceChildren(h('p', { class: 'muted small' }, `Couldn’t price the holdings: ${err.message}`)),
    );
  } else perfBox.replaceChildren(h('p', { class: 'muted small' }, 'Investment performance arrives with the next helper update (it installs by itself).'));
  return h(
    'section',
    { class: 'pr-sec' },
    h('h3', {}, 'Revenue and performance ', infoTip('prRevenue')),
    reported,
    estBox,
    h('h4', { class: 'xe-sub' }, 'How its investments have done (13F stocks)'),
    perfBox,
    h('h4', { class: 'xe-sub' }, 'What it could be worth to you'),
    terms.el,
    yours,
  );
}
