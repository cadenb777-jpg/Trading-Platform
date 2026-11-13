/**
 * Research overview: Debt and dilution. Reads only what research.company already returned (annual statements,
 * valuation, and from helper 68 the 10-K maturity ladder); maths and sentences in debtDilution.ts (tested).
 */
import { debtLadderReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { fact } from '../invest/moneyDeskView';
import { money } from '../ui/charts';
import { BUCKETS, coverWords, fy, interestCover, ladder, ladderWords, pc, payouts, payoutWords, shareChange, shareCount, sharesWords, type Maturities, type Statements } from './debtDilution';

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}

/** Horizontal bars, one per year bucket, on one scale; a bucket the filing leaves out says so. */
function ladderBars(m: Maturities): HTMLElement {
  const amounts = BUCKETS.map(([k]) => m.buckets[k]);
  const max = Math.max(...amounts.map((v) => v ?? 0), 1);
  return h(
    'div',
    { class: 'dd-ladder', role: 'list', 'aria-label': 'Debt principal due by year' },
    ...BUCKETS.map(([k, label]) => {
      const v = m.buckets[k];
      return h(
        'div',
        { class: 'dd-row', role: 'listitem' },
        h('span', { class: 'dd-label small' }, label),
        h('span', { class: 'dd-track' }, v == null || v <= 0 ? '' : h('span', { class: `dd-bar${k === 'next12' || k === 'year2' ? ' soon' : ''}`, style: `width:${Math.max(1, (v / max) * 100).toFixed(1)}%` })),
        h('span', { class: 'dd-amt num small' }, v == null ? 'not listed' : money(v)),
      );
    }),
  );
}

export interface DebtDilutionInput {
  annual: Statements;
  marketCap: number | null;
  cash: number | null;
  maturities?: Maturities | null;
}

export function debtDilutionPanel(d: DebtDilutionInput): HTMLElement {
  const lad = ladder(d.maturities);
  const cover = interestCover(d.annual);
  const shares = shareChange(d.annual);
  const pay = payouts(d.annual, d.marketCap);

  const debt = block(
    'Debt coming due',
    'debtLadder',
    ...(d.maturities && lad
      ? [
          lad.dueIn2 != null || d.maturities.buckets.next12 == null
            ? h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(lad.dueIn2)), h('span', { class: 'muted small' }, 'due within 2 years'))
            : h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(d.maturities.buckets.next12)), h('span', { class: 'muted small' }, 'due within 12 months')),
          ladderBars(d.maturities),
          h('p', { class: 'small' }, ladderWords(lad, d.maturities, d.cash)),
          h(
            'p',
            { class: 'muted small' },
            `Principal by year after the balance sheet of ${day(d.maturities.asOf)}; cash and short-term investments from the latest quarter. `,
            d.maturities.url ? h('a', { href: d.maturities.url, target: '_blank', rel: 'noopener' }, `${d.maturities.form} filed ${day(d.maturities.filed)}`) : `${d.maturities.form} filed ${day(d.maturities.filed)}`,
          ),
        ]
      : [
          h(
            'p',
            { class: 'muted small' },
            !debtLadderReady() && d.maturities === undefined
              ? 'When the debt comes due arrives with the next helper update (it installs by itself).'
              : 'The latest 10-K doesn’t tag a debt maturity table in its data (common when a company has little or no long-term debt).',
          ),
        ]),
    h('p', { class: 'small' }, cover ? coverWords(cover) : 'Interest cover: the filings don’t show both operating profit and interest expense for the same year.'),
  );

  const dil = block(
    'Shares and buybacks',
    'netBuyback',
    ...(shares
      ? [
          h(
            'div',
            { class: 'md-facts' },
            ...shares.changes.map((c) => fact(`${c.years} year${c.years > 1 ? 's' : ''}`, `${pc(c.rate, 1, true)} a year`, `since ${fy(c.from)}`)),
            fact('Diluted shares', shareCount(shares.latest), `${fy(shares.latestEnd)} average`),
          ),
          h('p', { class: 'small' }, sharesWords(shares)),
        ]
      : [h('p', { class: 'muted small' }, 'The filings don’t report a diluted share count.')]),
    ...(pay
      ? [
          h('p', { class: 'small' }, payoutWords(pay)),
          h(
            'div',
            { class: 'md-facts' },
            ...(pay.shareholderYield != null
              ? [fact('Shareholder yield', pc(pay.shareholderYield), 'buybacks + dividends'), fact('After stock pay', pc(pay.netBuybackYield, 1, true), 'net buyback yield')]
              : [fact('Buybacks after stock pay', money(pay.stockComp != null && pay.buybacks != null ? pay.buybacks - pay.stockComp : null), fy(pay.end))]),
            fact('Stock pay', pc(pay.sbcOfRevenue), 'of sales'),
          ),
        ]
      : []),
    h(
      'p',
      { class: 'muted small' },
      shares?.breakAfter ? `${fy(shares.breakAfter)} and earlier aren’t compared: that year’s filing counts shares before a later stock split. ` : '',
      'Fiscal-year figures from the company’s SEC filings (XBRL); ',
      d.marketCap != null ? 'yields use today’s market value (price × shares).' : 'yields need a live price, which isn’t available right now.',
    ),
  );

  return h(
    'section',
    { class: 'panel dd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Debt and dilution'), h('span', { class: 'muted small' }, 'When the debt comes due, and whether buybacks really shrink the share count')),
    h('div', { class: 'md-grid' }, debt, dil),
  );
}
