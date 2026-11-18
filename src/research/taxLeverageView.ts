/**
 * Research overview: Taxes and operating leverage = the cash tax rate against the book rate and the federal rate (three
 * bars on one scale) and how operating profit has moved with sales. Reads only the annual statements research.company
 * returned (helper 85 adds income taxes paid); maths in taxLeverage.ts.
 */
import { taxReady } from '../data/schwab';
import { h } from '../ui/dom';
import { block, rateBars, savedBeforeUpdate } from './panelBlock';
import { dataTable, money } from '../ui/charts';
import { fy, pc, type Statements } from './debtDilution';
import { cashTax, FEDERAL_RATE, leverageWords, operatingLeverage, taxWords } from './taxLeverage';

export function taxLeveragePanel(a: Statements): HTMLElement {
  const fresh = 'taxesPaid' in a.values;
  const t = fresh ? cashTax(a) : null;
  const tax = block(
    'Tax paid in cash',
    'cashTaxRate',
    ...(!fresh
      ? [savedBeforeUpdate(taxReady())]
      : !t
        ? [h('p', { class: 'muted small' }, 'The filings don’t show income taxes paid and pre-tax profit for the same year.')]
        : 'lastShown' in t
          ? [h('p', { class: 'muted small' }, `The newest filings don’t show ${t.missing}; the cash tax rate was last worked out for ${fy(t.lastShown)}.`)]
          : [
              t.longCash != null
                ? h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, pc(t.longCash, 1)), h('span', { class: 'muted small' }, `of pre-tax profit paid in cash, ${fy(t.window[0].end)}–${fy(t.latest.end)}`))
                : t.cashRate != null
                  ? h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, pc(t.cashRate, 1)), h('span', { class: 'muted small' }, `of pre-tax profit paid in cash, ${fy(t.latest.end)}`))
                  : h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(Math.abs(t.latest.paid))), h('span', { class: 'muted small' }, `${t.latest.paid < 0 ? 'net tax refund' : 'income tax paid in cash'}, ${fy(t.latest.end)}`)),
              ...(t.longCash != null && t.longCash >= 0
                ? [
                    rateBars([
                      { label: 'Paid in cash', rate: t.longCash, kind: 'one' as const },
                      ...(t.longBook != null && t.longBook >= 0 ? [{ label: 'In the accounts', rate: t.longBook, kind: 'two' as const }] : []),
                      { label: 'Federal rate', rate: FEDERAL_RATE, kind: 'base' as const },
                    ], 'Tax rates compared'),
                  ]
                : []),
              h('p', { class: 'small' }, taxWords(t)),
              h('p', { class: 'muted small' }, 'Income taxes paid (the 10-K’s supplemental cash-flow line) and income tax expense, each over pre-tax profit; the long run sums both over the years shown (Dyreng, Hanlon and Maydew 2008). A reading, not a signal.'),
            ]),
  );

  const l = operatingLeverage(a);
  const lev = block(
    'Operating leverage',
    'operatingLeverage',
    ...(!l
      ? [h('p', { class: 'muted small' }, 'The filings don’t show sales and an operating profit for two years in a row.')]
      : 'lastShown' in l
        ? [h('p', { class: 'muted small' }, `The newest filings don’t show ${l.missing} (or it was a loss); operating leverage was last worked out for ${fy(l.lastShown)}.`)]
        : [
            ...(l.slope != null ? [h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${l.slope.toFixed(1)}×`), h('span', { class: 'muted small' }, `profit move per 1% sales move, ${fy(l.from)}–${fy(l.to)}`))] : []),
            ...(l.history.length
              ? [
                  h(
                    'div',
                    { class: 'qe-table' },
                    dataTable(
                      ['Year', 'Op. profit', 'Sales', 'Ratio'],
                      l.history.map((y) => [
                        { v: fy(y.end), cls: 'label' },
                        { v: pc(y.opGrowth, 1, true), cls: 'num' },
                        { v: pc(y.salesGrowth, 1, true), cls: 'num' },
                        { v: y.dol == null ? '—' : `${y.dol.toFixed(2)}×`, cls: 'num', ...(y.dol == null ? { title: 'Sales moved less than 2%, so the ratio would mislead' } : {}) },
                      ]),
                      undefined,
                      false,
                    ),
                  ),
                ]
              : []),
            h('p', { class: 'small' }, leverageWords(l)),
            h('p', { class: 'muted small' }, 'Operating income and sales from the 10-K; the multiple is the slope of log operating profit on log sales over the years with an operating profit (Mandelker and Rhee 1984). A reading, not a signal.'),
          ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel tl-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Taxes and operating leverage'), h('span', { class: 'muted small' }, 'How much tax does the company really pay, and how hard does its profit swing when sales move? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, tax, lev),
  );
}
