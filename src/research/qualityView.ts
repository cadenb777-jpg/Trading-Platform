/**
 * Research overview: Earnings quality = Piotroski F-score checklist + accruals by year. Reads only the annual
 * statements research.company already returned; maths and sentences in quality.ts (tested).
 */
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { dataTable } from '../ui/charts';
import { fy, pc, shareCount, type Statements } from './debtDilution';
import { accruals, accrualWords, fScore, fScoreWord, fScoreWords, type Check } from './quality';

const show = (v: number | null, unit: Check['unit']) =>
  v == null ? '—' : unit === '%' ? pc(v) : unit === 'x' ? v.toFixed(2) : shareCount(v).replace(' billion', 'B').replace(' million', 'M');
/** ✓ / ✗ / – in front of the check, with words for screen readers */
const mark = (p: boolean | null) =>
  h('span', { class: `qe-mark ${p === null ? 'muted' : p ? 'up' : 'down'}`, 'aria-label': p === null ? 'No data: ' : p ? 'Pass: ' : 'Miss: ', role: 'img' }, p === null ? '–' : p ? '✓' : '✗');

function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}

export function qualityPanel(a: Statements): HTMLElement {
  const f = fScore(a);
  const x = accruals(a);
  const word = f ? fScoreWord(f) : null;

  const score = block(
    'Piotroski F-score',
    'fscore',
    ...(f
      ? [
          h(
            'div',
            { class: 'md-head' },
            h('b', { class: 'md-value num' }, `${f.score} of ${f.checked}`),
            h('span', { class: `md-read${word === 'weak' ? ' tight' : ''}` }, word === 'strong' ? 'Strong' : word === 'weak' ? 'Weak' : word === 'middle' ? 'In between' : 'Some figures missing'),
          ),
          h(
            'div',
            { class: 'qe-table' },
            dataTable(
              ['Check', fy(f.end), fy(f.previousEnd)],
              f.checks.map((c) => [
                { v: h('span', {}, mark(c.pass), c.label), cls: 'label' },
                // "cash beat profit" compares two figures of the same year: both go in this year's column
                { v: c.key === 'accrual' ? `${show(c.now, c.unit)} vs ${show(c.before, c.unit)}` : show(c.now, c.unit), cls: 'num' },
                // the profit/cash/accrual checks are about this year only
                { v: c.key === 'roa' || c.key === 'cfo' || c.key === 'accrual' ? '' : show(c.before, c.unit), cls: 'num' },
              ]),
              undefined,
              false,
            ),
          ),
          h('p', { class: 'small' }, fScoreWords(f)),
          h('p', { class: 'muted small' }, 'Piotroski (2000): return on assets and cash flow over the year’s starting assets, long-term debt over average assets (the debt line the filing reports; a company that changes which line it tags can move this check). “Cash beat profit” compares cash from operations with profit, both over starting assets. “No new shares” stands in for the paper’s “issued no stock” check. A reading, not a buy signal: it hasn’t been tested on your stocks.'),
        ]
      : [h('p', { class: 'muted small' }, 'The filings don’t have two years of profit and assets to score.')]),
  );

  const max = x ? Math.max(...x.history.map((y) => Math.abs(y.accruals)), 1e-9) : 1;
  const acc = block(
    'Accruals: profit vs cash',
    'accruals',
    ...(x
      ? [
          h(
            'div',
            { class: 'md-head' },
            h('b', { class: 'md-value num' }, pc(x.latest.accruals, 1, true)),
            h('span', { class: 'muted small' }, `of assets, ${fy(x.latest.end)}`),
          ),
          h(
            'div',
            { class: 'qe-bars', role: 'list', 'aria-label': 'Accruals by year, as a share of assets' },
            ...x.history.map((y) =>
              h(
                'div',
                { class: 'qe-row', role: 'listitem' },
                h('span', { class: 'dd-label small' }, fy(y.end)),
                h(
                  'span',
                  { class: 'qe-track' },
                  h('span', { class: `qe-bar ${y.accruals > 0 ? 'pos' : 'neg'}`, style: `width:${((Math.abs(y.accruals) / max) * 50).toFixed(1)}%;${y.accruals > 0 ? 'left:50%' : `right:50%`}` }),
                ),
                h('span', { class: 'dd-amt num small' }, pc(y.accruals, 1, true)),
              ),
            ),
          ),
          h('p', { class: 'small' }, accrualWords(x)),
          ...(f && x.latest.end !== f.end ? [h('p', { class: 'muted small' }, `Its newest year with every figure is ${fy(x.latest.end)}; the F-score is for ${fy(f.end)}.`)] : []),
          h('p', { class: 'muted small' }, '(Net income − cash from operations) ÷ average total assets (Hribar and Collins 2002; Sloan 1996). A reading, not a buy signal.'),
        ]
      : [h('p', { class: 'muted small' }, 'The filings don’t have net income, operating cash flow and assets for the same years.')]),
  );

  return h(
    'section',
    { class: 'panel qe-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Earnings quality'), h('span', { class: 'muted small' }, 'Is the profit real cash, and is the business getting stronger? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, score, acc),
  );
}
