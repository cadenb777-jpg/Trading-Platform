/**
 * Macro → Net liquidity: Fed balance sheet minus the Treasury's cash account minus reverse repo (helper engine/rates.py,
 * FRED), weekly. Shown with how it changed and, honestly, how closely its weekly changes have moved with the S&P 500.
 */
import { h } from '../ui/dom';
import { createLineChart, money, pct, statCards } from '../ui/charts';
import { THEME } from '../ui/theme';
import { edgePanel, sourceLine } from './panel';

interface Corr {
  r: number;
  low: number;
  high: number;
  weeks: number;
}
export interface NetLiquidity {
  series: { date: string; value: number }[];
  spx: { date: string; value: number }[];
  latest: { date: string; value: number; week: number | null; month: number | null; year: number | null; assets: number; tga: number; rrp: number };
  correlation: Record<'1y' | '3y', Corr | null>;
}

/** Plain reading of a correlation and its interval (pure, tested). */
export function corrRead(c: Corr | null): string {
  if (!c) return 'Not enough weeks to compare.';
  const strength = Math.abs(c.r) < 0.1 ? 'almost no' : Math.abs(c.r) < 0.3 ? 'a weak' : Math.abs(c.r) < 0.5 ? 'a moderate' : 'a strong';
  const sure = c.low > 0 || c.high < 0 ? '' : ' — not clearly different from none';
  return `${strength} link (r ${c.r.toFixed(2)}, 95% range ${c.low.toFixed(2)} to ${c.high.toFixed(2)}, ${c.weeks} weeks)${sure}`;
}

const mil = (v: number | null) => (v == null ? null : v * 1e6);

export function netLiquidityPanel(): HTMLElement {
  return edgePanel<NetLiquidity>({
    title: 'Net liquidity',
    term: 'netLiquidity',
    sub: 'Fed balance sheet − Treasury cash − reverse repo',
    request: 'macro.netliquidity',
    render(d, body) {
      const l = d.latest;
      const chg = (then: number | null) => (then ? l.value / then - 1 : null);
      const tone = (v: number | null) => (v == null || Math.abs(v) < 0.0005 ? '' : v > 0 ? 'up' : 'down');
      const box = h('div', { class: 'xe-chart' });
      body.append(
        statCards([
          { label: 'Net liquidity', value: money(mil(l.value)), hint: `Week of ${l.date}` },
          { label: '1 week', value: pct(chg(l.week), 1), tone: tone(chg(l.week)) },
          { label: '1 month', value: pct(chg(l.month), 1), tone: tone(chg(l.month)) },
          { label: '1 year', value: pct(chg(l.year), 1), tone: tone(chg(l.year)) },
        ]),
        box,
        h('p', { class: 'small' }, `Parts: Fed assets ${money(mil(l.assets))} − Treasury cash ${money(mil(l.tga))} − reverse repo ${money(mil(l.rrp))}.`),
        h('p', { class: 'small' }, `Weekly changes vs the S&P 500 — last year: ${corrRead(d.correlation['1y'])}. Last 3 years: ${corrRead(d.correlation['3y'])}.`),
        sourceLine('FRED: WALCL, WDTGAL, RRPONTSYD, SP500 (Wednesdays). A gauge, not a signal by itself.'),
      );
      requestAnimationFrame(() => {
        const chart = createLineChart(box, { height: 200, title: 'Net liquidity ($ trillions)', format: (v) => `$${v.toFixed(2)}T` });
        chart.set([{ name: 'Net liquidity', color: THEME.viz1, data: d.series.map((p) => ({ time: p.date, value: p.value / 1e6 })) }]);
      });
    },
  });
}
