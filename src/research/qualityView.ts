/**
 * Research overview: Earnings quality = Piotroski F-score checklist, accruals by year, Beneish M-score and Altman
 * Z-score. Reads only what research.company already returned; maths and sentences in quality.ts and health.ts (tested).
 */
import { healthReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { dataTable } from '../ui/charts';
import { fy, pc, shareCount, type Statements } from './debtDilution';
import { accruals, accrualWords, fScore, fScoreWord, fScoreWords, type Check } from './quality';
import { altman, altmanWords, BENEISH, BENEISH_CUTOFF, beneish, beneishWords, isFinancial, signed } from './health';

/** Lines the helper reads from helper 71 on; a helper copy saved before then lacks them for up to 6 hours. */
const NEW_LINES = ['receivables', 'ppe', 'retainedEarnings'];


const show = (v: number | null, unit: Check['unit']) =>
  v == null ? '—' : unit === '%' ? pc(v) : unit === 'x' ? v.toFixed(2) : shareCount(v).replace(' billion', 'B').replace(' million', 'M');
/** ✓ / ✗ / – in front of the check, with words for screen readers */
const mark = (p: boolean | null) =>
  h('span', { class: `qe-mark ${p === null ? 'muted' : p ? 'up' : 'down'}`, 'aria-label': p === null ? 'No data: ' : p ? 'Pass: ' : 'Miss: ', role: 'img' }, p === null ? '–' : p ? '✓' : '✗');

function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}

export interface QualityContext {
  /** SEC industry code (helper 71+) */
  sic?: string | number | null;
  marketCap: number | null;
  /** statement line names as research.company sends them (`labels`) */
  labels?: Record<string, string>;
}

export function qualityPanel(a: Statements, c: QualityContext = { marketCap: null }): HTMLElement {
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
    h('div', { class: 'panel-head' }, h('h3', {}, 'Earnings quality'), h('span', { class: 'muted small' }, 'Is the profit real cash, is the business getting stronger, and how safe is it? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, score, acc, mScore(a, c.labels ?? {}), zScore(a, c)),
  );
}

/** The helper hasn't sent the new lines yet: an older helper (helper 71 re-reads an older saved copy by itself). */
const notYet = (a: Statements) => NEW_LINES.some((k) => !(k in a.values));
const waitNote = () =>
  h('p', { class: 'muted small' }, healthReady() ? 'This company’s saved filings are being read again for the extra lines this needs. Open the stock again in a minute.' : 'Arrives with the next helper update (it installs by itself).');

function mScore(a: Statements, labels: Record<string, string>): HTMLElement {
  if (notYet(a)) return block('Beneish M-score', 'mscore', waitNote());
  const b = beneish(a);
  if ('missing' in b)
    return block(
      'Beneish M-score',
      'mscore',
      h(
        'p',
        { class: 'muted small' },
        b.undefinedRatio
          ? `Not scored: the ${b.undefinedRatio.toLowerCase()} can’t be worked out from these filings (it would divide by zero), and all eight ratios are needed.`
          : `Not scored: the filings don’t give ${b.missing.map((k) => (labels[k] ?? k).toLowerCase()).join(', ')} for two years in a row, and all eight ratios are needed.`,
      ),
    );
  return block(
    'Beneish M-score',
    'mscore',
    h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, signed(b.m)), h('span', { class: `md-read${b.flagged ? ' tight' : ''}` }, `${b.flagged ? 'Above' : 'Below'} the ${signed(BENEISH_CUTOFF)} line`)),
    h(
      'div',
      { class: 'qe-table' },
      dataTable(
        ['Ratio', `${fy(b.end)} vs ${fy(b.previousEnd)}`],
        BENEISH.map((r) => [{ v: r.label, cls: 'label' }, { v: r.key === 'TATA' ? pc(b.ratios.TATA, 1, true) : b.ratios[r.key].toFixed(2), cls: `num${b.drivers.includes(r.key) && b.flagged ? ' down' : ''}` }]),
        undefined,
        false,
      ),
    ),
    h('p', { class: 'small' }, beneishWords(b)),
    h('p', { class: 'muted small' }, `Beneish (1999): eight ratios of this year to last year (1.00 = no change; accruals as a share of assets), weighted and added. Above ${signed(BENEISH_CUTOFF)} looked like companies later caught inflating profits. Depreciation is the filing’s depreciation and amortization line. A reading, not proof and not a signal.`),
  );
}

function zScore(a: Statements, c: QualityContext): HTMLElement {
  if (isFinancial(c.sic)) return block('Altman Z-score', 'altmanZ', h('p', { class: 'muted small' }, 'Not scored: the Z-score wasn’t built for banks, insurers and other financial firms.'));
  if (notYet(a)) return block('Altman Z-score', 'altmanZ', waitNote());
  const z = altman(a, c.sic, c.marketCap);
  if (!z) return block('Altman Z-score', 'altmanZ', h('p', { class: 'muted small' }, 'Not scored: the filings don’t give working capital, retained earnings, operating profit and liabilities for the same year.'));
  const parts: [string, number | null][] = [
    ['Working capital ÷ assets', z.x.workingCapital],
    ['Retained earnings ÷ assets', z.x.retained],
    ['Operating profit ÷ assets', z.x.ebit],
    [z.model === 'Z' ? 'Market value ÷ liabilities' : 'Book equity ÷ liabilities', z.x.equity],
    ...(z.x.sales != null ? ([['Sales ÷ assets', z.x.sales]] as [string, number][]) : []),
  ];
  return block(
    'Altman Z-score',
    'altmanZ',
    h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, signed(z.z)), h('span', { class: `md-read${z.zone === 'distress' ? ' tight' : ''}` }, z.zone === 'safe' ? 'Safe zone' : z.zone === 'distress' ? 'Distress zone' : 'Grey zone')),
    h('div', { class: 'qe-table' }, dataTable(['Part', fy(z.end)], parts.map(([k, v]) => [{ v: k, cls: 'label' }, { v: v == null ? '—' : v.toFixed(2), cls: 'num' }]), undefined, false)),
    h('p', { class: 'small' }, altmanWords(z)),
    h(
      'p',
      { class: 'muted small' },
      z.model === 'Z'
        ? 'Altman (1968), for manufacturers: 1.2, 1.4, 3.3, 0.6 and 1.0 times these parts. Market value = today’s price × shares. A reading, not a signal.'
        : z.model === "Z'"
          ? 'Altman’s Z′ (1983), for manufacturers on book values: 0.717, 0.847, 3.107, 0.420 and 0.998 times these parts. A reading, not a signal.'
          : 'Altman’s Z′′ (1983): 6.56, 3.26, 6.72 and 1.05 times these parts, for companies that aren’t manufacturers. A reading, not a signal.',
    ),
  );
}
