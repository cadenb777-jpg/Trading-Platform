/**
 * Research overview: Cash health = dividend cover by free cash flow + cash conversion cycle. Reads only the annual
 * statements research.company returned (helper 74 adds inventory and payables); maths and sentences in cashHealth.ts.
 */
import { cashCycleReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { dataTable, money } from '../ui/charts';
import { fy, type Statements } from './debtDilution';
import { cashCycle, coverWord, coverWords, cycleWords, dividendCover } from './cashHealth';

function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}
const x = (v: number | null) => (v == null ? '—' : v <= 0 ? 'none' : `${v.toFixed(v >= 10 ? 0 : 1)}×`);
const d = (v: number) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v))}`;

export function cashHealthPanel(a: Statements): HTMLElement {
  const c = dividendCover(a);
  const cover = block(
    'Dividend cover',
    'divCover',
    ...(c
      ? [
          h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, x(c.cover)), h('span', { class: `md-read${coverWord(c) === 'not covered' ? ' tight' : ''}` }, coverWord(c) === 'covered' ? 'Covered' : coverWord(c) === 'thin' ? 'Thin' : 'Not covered'), h('span', { class: 'muted small' }, `${fy(c.end)}${c.cover5 != null ? `; ${x(c.cover5)} over ${c.years} years` : ''}`)),
          h(
            'div',
            { class: 'qe-table' },
            dataTable(
              ['Year', 'Free cash flow', 'Dividends', 'Cover'],
              c.window
                .map((r) => [
                  { v: fy(r.end), cls: 'label' },
                  { v: money(r.fcf), cls: 'num' },
                  { v: money(r.dividends), cls: 'num' },
                  { v: x(r.fcf / r.dividends), cls: `num${r.fcf < r.dividends ? ' down' : ''}` },
                ]),
              undefined,
              false,
            ),
          ),
          h('p', { class: 'small' }, coverWords(c)),
          h('p', { class: 'muted small' }, 'Free cash flow = cash from operations − capital spending (only years whose filings report capital spending); dividends and buybacks as paid in the cash flow statement. Under 1× the dividend wasn’t paid from that year’s cash. A reading, not a signal.'),
        ]
      : [h('p', { class: 'muted small' }, 'No dividend in the filings’ recent years, or no free cash flow to compare it with.')]),
  );

  const y = 'payables' in a.values ? cashCycle(a) : undefined;
  const cycle = block(
    'Cash conversion cycle',
    'ccc',
    ...(y === undefined
      ? [h('p', { class: 'muted small' }, cashCycleReady() ? 'This page is showing data saved before your helper update. It fills in when the company’s data next refreshes (Refresh, or within 5 minutes).' : 'Arrives with the next helper update (it installs by itself).')]
      : y === null
        ? [h('p', { class: 'muted small' }, 'The filings don’t give sales, cost of sales, receivables and payables for the same year.')]
        : 'missing' in y
          ? [h('p', { class: 'muted small' }, y.missing === 'payables' ? 'Not worked out: the filings don’t give accounts payable on a line of their own (some companies report them only together with accrued expenses), so days to pay suppliers can’t be measured.' : 'Not worked out: the filings don’t give sales and cost of sales.')]
          : [
              h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${d(y.latest.ccc)} days`), h('span', { class: 'muted small' }, fy(y.latest.end))),
              h(
                'div',
                { class: 'qe-table' },
                dataTable(
                  ['Days', fy(y.latest.end), ...(y.previous ? [fy(y.previous.end)] : [])],
                  (
                    [
                      ['Customers take to pay', 'dso'],
                      ...(y.noInventory ? [] : [['Stock sits before it sells', 'dio']]),
                      ['It takes to pay suppliers', 'dpo'],
                      ['Cash tied up (cycle)', 'ccc'],
                    ] as [string, 'dso' | 'dio' | 'dpo' | 'ccc'][]
                  ).map(([label, k]) => [{ v: label, cls: 'label' }, { v: d(y.latest[k]), cls: 'num' }, ...(y.previous ? [{ v: d(y.previous[k]), cls: 'num' }] : [])]),
                  undefined,
                  false,
                ),
              ),
              h('p', { class: 'small' }, cycleWords(y)),
              h('p', { class: 'muted small' }, 'Richards and Laughlin (1980): receivables ÷ sales, inventory ÷ cost of sales and payables ÷ cost of sales, each × 365, on year-end balances. Below zero, suppliers wait longer than customers. A reading, not a signal.'),
            ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel ch-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Cash health'), h('span', { class: 'muted small' }, 'Does the cash the business makes pay its dividend, and how long is cash tied up? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, cover, cycle),
  );
}
