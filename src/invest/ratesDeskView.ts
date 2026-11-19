/**
 * Rates desk panels (helper 64): credit spreads by rating (Bonds → Bond market), the auction demand scorecard
 * (Bonds → Treasury auctions) and the term premium block (Bonds → What the curve says). Readings: ratesDesk.ts.
 */
import { ARRIVES_WITH_UPDATE, engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { sparkline } from '../ui/sparkline';
import { onThemeChange, THEME } from '../ui/theme';
import { errorBox } from './shared';
import { creditHeadline, LOOKBACK, READ_AT, READ_WORDS, scoreAuctions, scoreSentence, termPremiumSentence, type AuctionRow, type CreditReply, type CreditRow, type Score, type TermPremium } from './ratesDesk';

export const RATES_DESK_HELPER_VERSION = 64;
export const ratesDeskReady = () => !helper.tooOld && (helper.version ?? 0) >= RATES_DESK_HELPER_VERSION;

export const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const bpChange = (now: number | null | undefined, then: number | null | undefined, scale = 100) => {
  if (now == null || then == null) return '—';
  const v = Math.round((now - then) * scale);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} bp`;
};

const monthYear = (iso: string | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

/** Runs `go` once a new enough helper is connected (now, or when it says hello), else shows why it is waiting.
 *  Shared by the rates desk and money desk panels. */
export function whenReady(body: HTMLElement, el: HTMLElement, go: () => void, ready: () => boolean = ratesDeskReady) {
  if (ready()) return go();
  body.replaceChildren(h('p', { class: 'muted small' }, helper.isConnected ? ARRIVES_WITH_UPDATE : 'Start the helper to see this.'));
  const off = helper.onStatusChange(() => {
    if (!ready()) return;
    off();
    if (el.isConnected) go();
  });
}

/** Where today sits in its range since the data starts: a track from low to high with today's dot. */
function rangeBar(low: number, high: number, now: number, label: string, unusual: boolean) {
  const pos = high > low ? ((now - low) / (high - low)) * 100 : 50;
  return h('span', { class: 'rd-range', role: 'img', 'aria-label': label }, h('i', { class: 'rd-track' }), h('i', { class: `rd-dot${unusual ? ' unusual' : ''}`, style: `left:${Math.min(100, Math.max(0, pos))}%` }));
}

const unusual = (reading?: string) => !!reading && reading.startsWith('unusually');

function creditTable(rows: CreditRow[]) {
  return h(
    'div',
    { class: 'cf-table-wrap' },
    h(
      'table',
      { class: 'data-table rd-table' },
      h('caption', { class: 'sr-only' }, 'Corporate bond spreads over Treasuries by credit rating'),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Rating'),
          h('th', { scope: 'col', class: 'num' }, 'Spread'),
          h('th', { scope: 'col', class: 'num cf-wide' }, '1 month'),
          h('th', { scope: 'col', class: 'rd-range-head' }, `Range since ${monthYear(rows.find((r) => r.from)?.from)}`),
          h('th', { scope: 'col', class: 'num' }, 'Next notch pays'),
          h('th', { scope: 'col', class: 'cf-wide' }, 'That step'),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) => {
          if (r.spread == null) return h('tr', {}, h('th', { scope: 'row' }, r.rating), h('td', { class: 'muted small', colspan: '5' }, 'unavailable from FRED right now'));
          const s = r.step;
          return h(
            'tr',
            { class: unusual(s?.reading) ? 'cf-unusual' : '' },
            h('th', { scope: 'row' }, h('button', { type: 'button', class: 'link-btn', title: `${r.series}: full history`, onclick: () => openFredWindow(r.series, `${r.rating} corporate bond spread`) }, r.rating)),
            h('td', { class: 'num' }, `${r.spread.toFixed(2)}%`),
            h('td', { class: 'num muted cf-wide' }, bpChange(r.spread, r.monthAgo)),
            h('td', {}, h('div', { class: 'rd-range-cell' }, rangeBar(r.low!, r.high!, r.spread, `${r.spread.toFixed(2)}%, range since ${monthYear(r.from)} ${r.low!.toFixed(2)}% to ${r.high!.toFixed(2)}%, ${r.reading}`, unusual(r.reading)), h('span', { class: `rd-pct small${unusual(r.reading) ? ' strong' : ''}`, title: `Higher than on ${Math.round(r.percentile ?? 0)}% of days since ${monthYear(r.from)}` }, `${Math.round(r.percentile ?? 0)}th`))),
            s ? h('td', { class: 'num' }, `+${Math.round(s.bp)} bp`, h('span', { class: 'cf-wide' }, ` to ${s.to}`)) : h('td', { class: 'num' }, '—'),
            h('td', { class: `small cf-wide ${unusual(s?.reading) ? 'cf-read-strong' : 'muted'}` }, s ? `${s.reading} (${Math.round(s.percentile ?? 0)}th percentile)` : ''),
          );
        }),
      ),
    ),
  );
}

/** Bonds → Bond market: credit spreads by rating. */
export function creditPanel(): HTMLElement {
  const body = h('div', { class: 'xe-body' }, h('div', { class: 'skeleton', style: 'height:220px' }));
  const el = h(
    'section',
    { class: 'panel rd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Credit spreads by rating', infoTip('creditLadder')), h('span', { class: 'muted small' }, 'What companies pay over Treasuries, and what one more notch of risk pays')),
    body,
  );
  const load = () => {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:220px' }));
    engineRequest<CreditReply>('bonds.credit', {}, 60_000).then(
    (d) =>
      body.replaceChildren(
        h('p', { class: `small cf-headline${d.rows.some((r) => unusual(r.step?.reading)) ? ' strong' : ''}` }, creditHeadline(d.rows)),
        creditTable(d.rows),
        h(
          'p',
          { class: 'muted small' },
          `Option-adjusted spreads over Treasuries, in % a year. The range runs from ${monthYear(d.rows.find((r) => r.from)?.from)}, as far back as FRED keeps this ICE data (about 3 years); a step at its 10th percentile or below is called unusually tight, 90th or above unusually wide. Spreads pay for expected defaults and for risk, so a reading, not a forecast. Source: `,
          h('a', { href: d.source.url, target: '_blank', rel: 'noopener noreferrer' }, d.source.name),
          `, ${day(d.source.asOf)}.`,
          d.failed.length ? ` Unavailable: ${d.failed.join(', ')}.` : '',
        ),
      ),
    (err: Error) => body.replaceChildren(errorBox(err, load)),
  );
  };
  whenReady(body, el, load);
  return el;
}

/** Bonds → Treasury auctions: how the latest note and bond auctions went. */
export function auctionScorecard(coupons: AuctionRow[] | null | undefined): HTMLElement {
  const el = h(
    'section',
    { class: 'panel rd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Auction demand scorecard', infoTip('auctionDemand')), h('span', { class: 'muted small' }, 'Did investors want the Treasury’s new notes and bonds?')),
  );
  if (coupons === undefined) {
    el.append(h('p', { class: 'muted small' }, ARRIVES_WITH_UPDATE));
    return el;
  }
  if (coupons === null) {
    el.append(h('p', { class: 'muted small' }, 'Couldn’t load the note and bond auction results from the Treasury just now. Press Refresh in a few minutes.'));
    return el;
  }
  const scores = scoreAuctions(coupons).slice(0, 10);
  if (!scores.length) {
    el.append(h('p', { class: 'muted small' }, 'No note or bond auction results with the bidder split yet.'));
    return el;
  }
  const tone = (s: Score) => (s.read === 'strong' ? 'up' : s.read === 'weak' ? 'down' : '');
  el.append(
    h(
      'ul',
      { class: 'rd-auctions' },
      ...scores.map((s) =>
        h(
          'li',
          {},
          h('span', { class: 'rd-auction-name' }, h('b', {}, `${s.family}-year`), ` ${s.auction.reopening ? 'reopening ' : ''}· ${day(s.auction.auctionDate)}`),
          h('span', { class: `rd-read ${tone(s)}` }, READ_WORDS[s.read]),
          h('span', { class: 'num rd-yield' }, s.auction.yield != null ? `${s.auction.yield.toFixed(3)}%` : '—'),
          h('span', { class: 'muted small rd-sentence' }, scoreSentence(s)),
        ),
      ),
    ),
    h(
      'p',
      { class: 'muted small' },
      `Each auction against the last ${LOOKBACK} of the same maturity. Strong = more bids than usual and dealers left holding less (together at least ${READ_AT} standard deviations from usual: about 1 auction in 10 in 2024–26); weak = the reverse. Dealers must bid at every auction, so a big dealer share means outside buyers stayed away. Source: U.S. Treasury Fiscal Data, auction results.`,
    ),
  );
  return el;
}

/** Bonds → What the curve says: the Kim-Wright split of the 10-year yield (its own request, bonds.termpremium). */
export function termPremiumBlock(): HTMLElement {
  const body = h('div', { class: 'rd-tp-body' }, h('div', { class: 'skeleton', style: 'height:80px' }));
  const el = h('div', { class: 'rd-tp' }, h('div', { class: 'cf-caption' }, 'Pay for lending long (term premium)', infoTip('termPremium')), body);
  const load = () =>
    engineRequest<TermPremium & { source: { name: string; url: string } }>('bonds.termpremium', {}, 60_000).then(
      (t) => {
        const recent = t.history;
        const spark = h('span', { class: 'rd-tp-spark', title: 'Term premium, last 5 years (weekly)' }, sparkline(recent.map((x) => x.premium), null, THEME.viz2));
        // repaint in the other theme's colour; stops listening once the block leaves the page
        const off = onThemeChange(() => (spark.isConnected ? spark.replaceChildren(sparkline(recent.map((x) => x.premium), null, THEME.viz2)) : off()));
        body.replaceChildren(
          h(
            'div',
            { class: 'rd-tp-row' },
            h('b', { class: 'rd-tp-value num' }, `${t.premium.toFixed(2)}%`),
            h('span', { class: 'muted small' }, `${bpChange(t.premium, t.monthAgo)} in a month · ${bpChange(t.premium, t.yearAgo)} in a year`),
            spark,
          ),
          h('p', { class: 'small' }, termPremiumSentence(t)),
          h(
            'p',
            { class: 'muted small' },
            `Kim-Wright model, Federal Reserve Board, via FRED (THREEFY10, THREEFYTP10), ${day(t.date)}. A model estimate, not a market price. `,
            h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('THREEFYTP10', '10-year term premium (Kim-Wright)') }, 'Full history'),
          ),
        );
      },
      (err: Error) => body.replaceChildren(errorBox(err, load)),
    );
  whenReady(body, el, load);
  return el;
}
