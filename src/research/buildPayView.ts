/**
 * Research overview: Building and stock pay = capital spending against depreciation (paired bars per year) and free
 * cash flow after stock pay. Reads only the annual statements research.company returned (helper 81 adds the
 * depreciation line) and today's market value; maths in buildPay.ts.
 */
import { capexReady } from '../data/schwab';
import { h } from '../ui/dom';
import { block, savedBeforeUpdate } from './panelBlock';
import { fact } from '../invest/moneyDeskView';
import { dataTable, money } from '../ui/charts';
import { fy, pc, usd, type Statements } from './debtDilution';
import { buildRate, buildStaleWords, buildWords, payStaleWords, payWords, stockPay, type Build } from './buildPay';

/** One row per year: spending over depreciation on one scale, the multiple at the end. */
function pairedBars(b: Build): HTMLElement {
  const max = Math.max(...b.history.map((y) => Math.max(y.capex, y.dep)));
  const w = (v: number) => `width:${Math.max(1, (v / max) * 100).toFixed(1)}%`;
  const what = b.basis === 'depreciation' ? 'depreciation' : 'depreciation and amortization';
  return h(
    'div',
    { class: 'bp-pairs' },
    h('div', { class: 'bp-key small muted', 'aria-hidden': 'true' }, h('span', {}, h('i', { class: 'bp-swatch spend' }), 'Spending'), h('span', {}, h('i', { class: 'bp-swatch dep' }), b.basis === 'depreciation' ? 'Depreciation' : 'Depreciation and amortization')),
    h(
      'div',
      { role: 'list', 'aria-label': `Capital spending against ${what}, by year` },
      ...b.history.map((y) =>
        h(
          'div',
          { class: 'bp-row', role: 'listitem', 'aria-label': `${fy(y.end)}: spent ${usd(y.capex)}, ${what} ${usd(y.dep)}, ${y.ratio.toFixed(1)} times`, title: `${fy(y.end)}: spent ${money(y.capex)}, ${what} ${money(y.dep)}` },
          h('span', { class: 'bp-year small muted' }, fy(y.end)),
          h('span', { class: 'bp-bars' }, h('span', { class: 'bp-bar spend', style: w(y.capex) }), h('span', { class: 'bp-bar dep', style: w(y.dep) })),
          h('span', { class: 'bp-ratio num small' }, `${y.ratio.toFixed(1)}×`),
        ),
      ),
    ),
  );
}

export function buildPayPanel(a: Statements, marketCap: number | null): HTMLElement {
  const fresh = 'depreciation' in a.values;
  const b = fresh ? buildRate(a) : null;
  const building = block(
    'Spending vs depreciation',
    'capexDep',
    ...(!fresh
      ? [savedBeforeUpdate(capexReady())]
      : !b
        ? [h('p', { class: 'muted small' }, 'The filings don’t show capital spending and depreciation for the same year.')]
        : 'lastShown' in b
          ? [h('p', { class: 'muted small' }, buildStaleWords(b))]
          : [
              h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${b.latest.ratio.toFixed(1)}×`), h('span', { class: 'muted small' }, `spending against ${b.basis === 'depreciation' ? 'depreciation' : 'depreciation and amortization'}, ${fy(b.latest.end)}`)),
              pairedBars(b),
              h('p', { class: 'small' }, buildWords(b)),
              h(
                'p',
                { class: 'muted small' },
                'Spending = cash paid for property and equipment; depreciation = the year’s write-off of property and equipment',
                b.basis === 'dna' ? ' (these filings have no depreciation line of its own, so depreciation and amortization stands in)' : '',
                ', both from the 10-K cash-flow statement. A reading, not a signal.',
              ),
            ]),
  );

  const s = stockPay(a, marketCap);
  const pay = block(
    'Free cash flow after stock pay',
    'stockPayFcf',
    ...(!s
      ? [h('p', { class: 'muted small' }, 'The filings don’t show free cash flow and stock-based pay for the same year.')]
      : 'lastShown' in s
        ? [h('p', { class: 'muted small' }, payStaleWords(s))]
        : [
            s.share != null
              ? h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, pc(s.share, 0)), h('span', { class: 'muted small' }, `stock pay as a share of free cash flow, ${fy(s.latest.end)}`))
              : h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(s.after)), h('span', { class: 'muted small' }, `free cash flow after stock pay, ${fy(s.latest.end)}`)),
            h(
              'div',
              { class: 'qe-table' },
              dataTable(
                ['Year', 'Free cash', 'Stock pay', 'After'],
                s.window.map((y) => [
                  { v: fy(y.end), cls: 'label' },
                  { v: money(y.fcf), cls: `num${y.fcf < 0 ? ' down' : ''}` },
                  { v: money(y.sbc), cls: 'num' },
                  { v: money(y.fcf - y.sbc), cls: `num${y.fcf - y.sbc < 0 ? ' down' : ''}` },
                ]),
                undefined,
                false,
              ),
            ),
            ...(s.fcfYield != null ? [h('div', { class: 'md-facts' }, fact('Free-cash-flow yield', pc(s.fcfYield, 1), fy(s.latest.end)), fact('After stock pay', pc(s.afterYield, 1), 'on today’s value'))] : []),
            h('p', { class: 'small' }, payWords(s)),
            h(
              'p',
              { class: 'muted small' },
              'Free cash = free cash flow, operating cash flow - capital spending; stock pay = stock-based compensation, both from the 10-K cash-flow statement (red = below zero). ',
              marketCap != null && marketCap > 0 ? 'Yields use today’s market value (price × shares).' : 'Yields need a live price, which isn’t available right now.',
              ' A reading, not a signal.',
            ),
          ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel bp-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Building and stock pay'), h('span', { class: 'muted small' }, 'Is the company building ahead of what wears out, and what is its cash flow once staff paid in stock are counted? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, building, pay),
  );
}
