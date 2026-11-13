/**
 * Research overview: Debt and dilution. Reads only what research.company already returned (annual statements,
 * valuation, from helper 68 the 10-K maturity ladder, from helper 69 leases, commitments, uncertain tax and today's
 * corporate yields); maths and sentences in debtDilution.ts and obligations.ts (tested).
 */
import { debtLadderReady, engineRequest, obligationsReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { fact } from '../invest/moneyDeskView';
import { money } from '../ui/charts';
import { leases, leaseWords, purchaseWords, refinancing, refinancingWords, taxWords, type CorpYields, type Obligations } from './obligations';
import { BUCKETS, coverWords, day, fy, interestCover, ladder, ladderWords, pc, payouts, payoutWords, shareChange, shareCount, sharesWords, type Maturities, type Statements } from './debtDilution';


function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}

/** Horizontal bars, one per year bucket, on one scale; a bucket the filing leaves out says so. */
function ladderBars(buckets: Partial<Record<string, number | null>>, label: string): HTMLElement {
  const amounts = BUCKETS.map(([k]) => buckets[k] ?? null);
  const max = Math.max(...amounts.map((v) => v ?? 0), 1);
  return h(
    'div',
    { class: 'dd-ladder', role: 'list', 'aria-label': label },
    ...BUCKETS.map(([k, label]) => {
      const v = buckets[k] ?? null;
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
  obligations?: Obligations | null;
}

const link = (f: { url?: string; form: string; filed: string }) =>
  f.url ? h('a', { href: f.url, target: '_blank', rel: 'noopener' }, `${f.form} filed ${day(f.filed)}`) : `${f.form} filed ${day(f.filed)}`;
const fred = (sid: string, name: string) => h('a', { href: `https://fred.stlouisfed.org/series/${sid}`, target: '_blank', rel: 'noopener' }, name);

/** "Leases, commitments and tax positions at Sep 26, 2026." (dates grouped, first name capitalised) */
function asOfWords(items: [string, string][]): string {
  const byDate = new Map<string, string[]>();
  for (const [name, asOf] of items) byDate.set(day(asOf), [...(byDate.get(day(asOf)) ?? []), name.toLowerCase()]);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const t = [...byDate].map(([d, names]) => `${list(names)} at ${d}`).join('; ');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

export function debtDilutionPanel(d: DebtDilutionInput): HTMLElement {
  const lad = ladder(d.maturities);
  const cover = interestCover(d.annual);
  const shares = shareChange(d.annual);
  const pay = payouts(d.annual, d.marketCap);
  const lease = leases(d.obligations, lad, d.maturities);
  const o = d.obligations;
  // today's corporate yields: their own request (FRED), painted when they arrive; never holds up the page
  const refiText = h('p', { class: 'small', hidden: true });
  const refiSource = h('span', {});
  if (lad?.dueIn2 && obligationsReady()) {
    engineRequest<CorpYields>('research.corpyields', {}, 30_000).then(
      (y) => {
        const refi = refinancing(lad, d.annual, y);
        if (!refi) return;
        refiText.textContent = refinancingWords(refi);
        refiText.hidden = false;
        const links = [refi.ig ? fred(refi.ig.series, 'ICE BofA US corporate (investment grade)') : null, refi.hy ? fred(refi.hy.series, 'ICE BofA US high yield') : null].filter(
          (x): x is HTMLAnchorElement => x != null,
        );
        refiSource.replaceChildren(' Yields: ', ...links.flatMap((x, i) => (i ? [' and ', x] : [x])), ', effective yield via FRED.');
      },
      () => {
        refiText.textContent = 'Today’s corporate bond yields couldn’t be loaded from FRED, so the cost of borrowing this again isn’t shown.';
        refiText.hidden = false;
      },
    );
  }

  const debt = block(
    'Debt coming due',
    'debtLadder',
    ...(d.maturities && lad
      ? [
          lad.dueIn2 != null || d.maturities.buckets.next12 == null
            ? h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(lad.dueIn2)), h('span', { class: 'muted small' }, 'due within 2 years'))
            : h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, money(d.maturities.buckets.next12)), h('span', { class: 'muted small' }, 'due within 12 months')),
          ladderBars(d.maturities.buckets, 'Debt principal due by year'),
          h('p', { class: 'small' }, ladderWords(lad, d.maturities, d.cash)),
          refiText,
          h(
            'p',
            { class: 'muted small' },
            `Principal by year after the balance sheet of ${day(d.maturities.asOf)}; cash and short-term investments from the latest quarter. `,
            link(d.maturities),
            '.',
            refiSource,
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

  // footnote: what each part is as of, then each filing once
  const parts = o ? ([['Leases', o.leases], ['finance leases', o.financeLease], ['commitments', o.purchase], ['tax positions', o.uncertainTax]] as const).filter(([, f]) => f) : [];
  const filings = [...new Map(parts.map(([, f]) => [f!.accession, f!])).values()];
  const beyond = block(
    'Beyond the debt line',
    'offBalance',
    ...(o && parts.length
      ? [
          h(
            'div',
            { class: 'md-facts' },
            ...(lease?.presentValue != null ? [fact('Lease liability', money(lease.presentValue), lease.addsToDebt != null ? `+${pc(lease.addsToDebt, 0)} on debt` : 'operating leases')] : []),
            ...(o.purchase ? [fact('Purchase commitments', money(o.purchase.value), 'not on the balance sheet')] : []),
            ...(o.uncertainTax ? [fact('Uncertain tax', money(o.uncertainTax.value), 'reserved for')] : []),
          ),
          ...(o.leases
            ? [h('div', { class: 'cf-caption dd-sub' }, 'Operating lease payments by year'), ladderBars(o.leases.buckets, 'Operating lease payments due by year')]
            : []),
          ...(lease ? [h('p', { class: 'small' }, leaseWords(lease))] : []),
          ...(o.purchase ? [h('p', { class: 'small' }, purchaseWords(o.purchase, d.cash))] : []),
          ...(o.uncertainTax ? [h('p', { class: 'small' }, taxWords(o.uncertainTax, d.cash))] : []),
          h(
            'p',
            { class: 'muted small' },
            asOfWords(parts.map(([name, f]) => [name, f!.asOf])),
            ' From the ',
            ...filings.flatMap((f, i) => (i ? [i === filings.length - 1 ? ' and ' : ', ', link(f)] : [link(f)])),
            '.',
          ),
        ]
      : [
          h(
            'p',
            { class: 'muted small' },
            !obligationsReady() && d.obligations === undefined
              ? 'Leases, purchase commitments and tax positions arrive with the next helper update (it installs by itself).'
              : 'The latest 10-K doesn’t tag leases, purchase commitments or uncertain tax positions in its data.',
          ),
        ]),
  );

  return h(
    'section',
    { class: 'panel dd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Debt and dilution'), h('span', { class: 'muted small' }, 'When the debt comes due, what else the company owes, and whether buybacks really shrink the share count')),
    h('div', { class: 'md-grid' }, debt, beyond, dil),
  );
}
