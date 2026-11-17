/**
 * Research overview: Profitability and asset growth = gross profit per dollar of assets on the company's own range
 * (range track) and total-asset growth against sales growth. Reads only the annual statements research.company
 * returned; maths in assetQuality.ts.
 */
import { h } from '../ui/dom';
import { rangeTrack } from '../ui/viz';
import { block } from './panelBlock';
import { dataTable, money } from '../ui/charts';
import { fy, pc, type Statements } from './debtDilution';
import { ahead, assetGrowth, dollars, gpWords, grossProfitability, growthWords, staleWords } from './assetQuality';


export function assetQualityPanel(a: Statements): HTMLElement {
  const g = grossProfitability(a);
  const gp = block(
    'Gross profit per dollar of assets',
    'grossProfitability',
    ...(!g
      ? [h('p', { class: 'muted small' }, 'The filings don’t show gross profit (banks, insurers and many service companies don’t report it).')]
      : 'lastShown' in g
        ? [h('p', { class: 'muted small' }, staleWords(g))]
        : [
            h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, dollars(g.latest.ratio)), h('span', { class: 'muted small' }, `gross profit per dollar of assets, ${fy(g.latest.end)}`)),
            ...(g.place ? [rangeTrack({ low: g.low, high: g.high, value: g.latest.ratio, format: dollars, title: `Its own range, ${fy(g.history[0].end)}–${fy(g.latest.end)}` })] : []),
            h('p', { class: 'small' }, gpWords(g)),
            h('p', { class: 'muted small' }, 'Gross profit (sales less the cost of sales) and total assets from the 10-K. A reading, not a signal: it hasn’t been tested on your own stocks.'),
          ]),
  );

  const ag = assetGrowth(a);
  const growth = block(
    'Asset growth',
    'assetGrowth',
    ...(!ag
      ? [h('p', { class: 'muted small' }, 'The filings don’t show total assets for two year-ends a year apart.')]
      : 'lastShown' in ag
        ? [h('p', { class: 'muted small' }, staleWords(ag))]
        : [
            h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, pc(ag.latest.assetGrowth, 1, true)), h('span', { class: 'muted small' }, `total assets, ${fy(ag.latest.end)}`)),
            h(
              'div',
              { class: 'qe-table' },
              dataTable(
                ['Year', 'Assets', 'Growth', 'Sales growth'],
                ag.history.map((y) => [
                  { v: fy(y.end), cls: 'label' },
                  { v: money(y.assets), cls: 'num' },
                  { v: pc(y.assetGrowth, 1, true), cls: `num${ahead(y) ? ' warn' : ''}`, ...(ahead(y) ? { title: 'Assets grew more than a point faster than sales' } : {}) },
                  { v: pc(y.salesGrowth, 1, true), cls: 'num' },
                ]),
                undefined,
                false,
              ),
            ),
            h('p', { class: 'small' }, growthWords(ag)),
            h('p', { class: 'muted small' }, 'Total assets at each fiscal year-end and sales from the 10-K (amber = assets grew more than a point faster than sales). A reading, not a signal.'),
          ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel aq-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Profitability and asset growth'), h('span', { class: 'muted small' }, 'How much gross profit each dollar of assets makes, and is the asset base growing faster than the business? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, gp, growth),
  );
}
