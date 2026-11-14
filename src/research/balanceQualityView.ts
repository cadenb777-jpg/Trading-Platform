/**
 * Research overview: Balance-sheet quality = money billed in advance against sales, and goodwill with its write-downs.
 * Reads only the annual statements research.company returned (helper 75 adds the lines); maths in balanceQuality.ts.
 */
import { balanceReady } from '../data/schwab';
import { h } from '../ui/dom';
import { block, savedBeforeUpdate } from './panelBlock';
import { dataTable, money } from '../ui/charts';
import { fy, pc, type Statements } from './debtDilution';
import { deferredRevenue, deferredStaleWords, deferredWords, goodwill, goodwillWords, slower, staleWords, type WriteDown } from './balanceQuality';


function writeDownTable(ws: WriteDown[]): HTMLElement {
  return h(
    'div',
    { class: 'qe-table' },
    dataTable(
      ['Year', 'Goodwill written down', 'Other intangibles'],
      ws.map((w) => [{ v: fy(w.end), cls: 'label' }, { v: w.goodwill == null ? '—' : money(w.goodwill), cls: 'num' }, { v: w.intangibles == null ? '—' : money(w.intangibles), cls: 'num' }]),
      undefined,
      false,
    ),
  );
}

export function balanceQualityPanel(a: Statements): HTMLElement {
  const fresh = 'deferredRevenue' in a.values && 'goodwill' in a.values;
  const d = fresh ? deferredRevenue(a) : null;
  const advance = block(
    'Billed in advance',
    'deferredRevenue',
    ...(!fresh
      ? [savedBeforeUpdate(balanceReady())]
      : !d
        ? [h('p', { class: 'muted small' }, 'The filings don’t report deferred revenue (money billed before the work is delivered) on a line of its own. Common for companies that are paid on delivery.')]
        : 'lastShown' in d
          ? [h('p', { class: 'muted small' }, deferredStaleWords(d))]
          : [
            h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${d.months.toFixed(1)} months`), h('span', { class: 'muted small' }, `of sales already billed, ${fy(d.latest.end)}`)),
            h(
              'div',
              { class: 'qe-table' },
              dataTable(
                ['Year', 'Billed', 'Growth', 'Sales growth'],
                d.history.slice(-5).map((y) => [
                  { v: fy(y.end), cls: 'label' },
                  { v: money(y.deferred), cls: 'num' },
                  { v: pc(y.deferredGrowth, 1, true), cls: `num${slower(y) ? ' down' : ''}`, ...(slower(y) ? { title: 'Grew more than a point slower than sales' } : {}) },
                  { v: pc(y.revenueGrowth, 1, true), cls: 'num' },
                ]),
                undefined,
                false,
              ),
            ),
            h('p', { class: 'small' }, deferredWords(d)),
            h('p', { class: 'muted small' }, 'Billed = current contract liabilities (deferred revenue) from the 10-K balance sheet; growth against the year’s sales growth (red = more than a point slower than sales). A reading, not a signal.'),
          ]),
  );

  const g = fresh ? goodwill(a) : null;
  const gw = block(
    'Goodwill and write-downs',
    'goodwill',
    ...(!fresh
      ? [savedBeforeUpdate(balanceReady())]
      : !g
        ? [h('p', { class: 'muted small' }, 'No goodwill line in the filings’ recent years (the company reports none, or none on a line of its own).')]
        : 'lastShown' in g
          ? [...(g.writeDowns.length ? [writeDownTable(g.writeDowns)] : []), h('p', { class: 'muted small' }, staleWords(g))]
          : [
              h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, g.ofEquity != null && g.ofEquity > 0 ? pc(g.ofEquity, 0) : money(g.goodwill)), h('span', { class: 'muted small' }, g.ofEquity != null && g.ofEquity > 0 ? `of shareholders’ equity, ${fy(g.end)}` : fy(g.end))),
              ...(g.writeDowns.length ? [writeDownTable(g.writeDowns)] : []),
              h('p', { class: 'small' }, goodwillWords(g)),
              h('p', { class: 'muted small' }, 'Goodwill and shareholders’ equity from the 10-K balance sheet; write-downs as the income statement reports them (a year without one reported shows nothing, not zero). A reading, not a signal.'),
            ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel bq-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Balance-sheet quality'), h('span', { class: 'muted small' }, 'How much future business is already billed, and how much of the balance sheet is the price of past deals? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, advance, gw),
  );
}
