/**
 * Portfolios → What it's really betting on (helper engine/factors.py): Fama-French five factors + momentum exposures
 * with 95% ranges, and the hidden bets (principal components of the holdings) with the effective number of bets.
 */
import { h } from '../ui/dom';
import { pct, pctU, statCards } from '../ui/charts';
import { edgePanel, sourceLine } from './panel';

export interface FactorRow {
  code: string;
  label: string;
  beta: number;
  se: number;
  t: number | null;
  low: number;
  high: number;
}
export interface Factors {
  symbols: string[];
  start: string;
  end: string;
  days: number;
  factors: FactorRow[];
  rSquared: number;
  alpha: { yearly: number; t: number | null };
  bets: { components: { share: number; varianceShare: number; drivers: { symbol: string; loading: number }[] }[]; effectiveBets: number; holdings: number };
  source: string;
}

/** A plain reading of one exposure (pure, tested): only ranges that exclude zero count as a real tilt. */
export function factorRead(f: FactorRow): string {
  if (f.code === 'Mkt-RF') return `Moves ${f.beta.toFixed(2)}× the stock market`;
  if (f.low <= 0 && f.high >= 0) return 'No clear tilt';
  const side: Record<string, [string, string]> = {
    SMB: ['small companies', 'large companies'],
    HML: ['cheap (value) stocks', 'expensive (growth) stocks'],
    RMW: ['highly profitable companies', 'weakly profitable companies'],
    CMA: ['companies investing cautiously', 'companies investing aggressively'],
    Mom: ['recent winners', 'recent losers'],
  };
  const [pos, neg] = side[f.code] ?? ['this factor', 'the opposite'];
  return `Leans toward ${f.beta > 0 ? pos : neg}`;
}

export function betsRead(b: Factors['bets']): string {
  const top = b.components[0];
  const lead = top ? `${pctU(top.share, 0)} of the risk comes from one common driver (led by ${top.drivers.slice(0, 3).map((d) => d.symbol).join(', ')}).` : '';
  return `${b.holdings} holdings behave like about ${b.effectiveBets.toFixed(1)} independent bets. ${lead}`;
}

function factorBars(rows: FactorRow[]) {
  const span = Math.max(1.5, ...rows.map((r) => Math.max(Math.abs(r.low), Math.abs(r.high))));
  const X = (v: number) => `${(50 + (v / span) * 50).toFixed(2)}%`;
  return h(
    'div',
    { class: 'fx-rows', role: 'table', 'aria-label': 'Factor exposures' },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'fx-row', role: 'row' },
        h('span', { role: 'cell', class: 'fx-name' }, r.label),
        h(
          'span',
          { role: 'cell', class: 'fx-track', title: `${r.beta.toFixed(2)} (95% range ${r.low.toFixed(2)} to ${r.high.toFixed(2)}${r.t != null ? `, t ${r.t.toFixed(1)}` : ''})` },
          h('i', { class: 'fx-zero' }),
          h('i', { class: 'fx-range', style: `left:${X(Math.min(r.low, r.high))};width:calc(${X(Math.max(r.low, r.high))} - ${X(Math.min(r.low, r.high))})` }),
          h('i', { class: 'fx-dot', style: `left:${X(r.beta)}` }),
        ),
        h('span', { role: 'cell', class: 'num fx-beta' }, r.beta.toFixed(2)),
        h('span', { role: 'cell', class: 'muted small fx-read' }, factorRead(r)),
      ),
    ),
  );
}

export function factorsPanel(holdings: { symbol: string; weight: number }[], rebalance?: string): HTMLElement {
  return edgePanel<Factors>({
    title: 'What it’s really betting on',
    term: 'factorExposure',
    sub: 'Factor exposures and hidden bets, last 3 years',
    request: 'portfolio.factors',
    params: { holdings, rebalance, years: 3 },
    timeout: 120000,
    render(d, body) {
      body.append(
        statCards([
          { label: 'Explained by the factors', value: pctU(d.rSquared, 0), hint: 'R²: how much of the daily ups and downs these six factors account for' },
          { label: 'Alpha left over', value: pct(d.alpha.yearly, 1), hint: d.alpha.t != null ? `A year · t ${d.alpha.t.toFixed(1)} ${Math.abs(d.alpha.t) < 2 ? '(could be luck)' : ''}` : '', tone: Math.abs(d.alpha.t ?? 0) >= 2 ? (d.alpha.yearly >= 0 ? 'up' : 'down') : '' },
          { label: 'Independent bets', value: d.bets.effectiveBets.toFixed(1), hint: `Out of ${d.bets.holdings} holdings` },
        ]),
        h('h4', { class: 'xe-sub' }, 'Factor exposures (dot = estimate, bar = 95% range)'),
        factorBars(d.factors),
        h('h4', { class: 'xe-sub' }, 'Hidden bets'),
        h('p', { class: 'small' }, betsRead(d.bets)),
        h(
          'div',
          { class: 'fx-comps' },
          ...d.bets.components.filter((c) => c.share >= 0.01).map((c, i) =>
            h('div', { class: 'fx-comp' }, h('b', {}, `Driver ${i + 1}: ${pctU(c.share, 0)} of your risk`), h('span', { class: 'muted small' }, c.drivers.map((x) => `${x.symbol} ${x.loading >= 0 ? '+' : '−'}${Math.abs(x.loading).toFixed(2)}`).join(' · '))),
          ),
        ),
        sourceLine(`${d.source} ${d.start} to ${d.end} (${d.days} days; the factor library updates monthly). Ranges use Newey-West errors.`),
      );
    },
  });
}
