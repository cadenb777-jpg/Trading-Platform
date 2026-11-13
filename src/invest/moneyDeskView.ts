/**
 * Money and supply panels (helper 66, `bonds.money`): "Money and housing" on Bonds → Bond market (funding stress and
 * the mortgage spread) and "How fast the government is borrowing" on Bonds → What the curve says. Readings: moneyDesk.ts.
 */
import { engineRequest, moneyReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { sparkline } from '../ui/sparkline';
import { onThemeChange, THEME } from '../ui/theme';
import { errorBox } from './shared';
import { billShareFlag, bn, bp, fundingWords, mortgageWords, ord, pct0, supplyWords, yearOf, type MoneyReply } from './moneyDesk';
import { day, whenReady as whenReadyFor } from './ratesDeskView';

export { moneyReady };

const whenReady = (body: HTMLElement, el: HTMLElement, go: () => void) => whenReadyFor(body, el, go, moneyReady);

/** A small line that repaints in the other theme's colour (stops listening once it leaves the page). */
function themedSpark(values: number[], baseline: number | null, title: string) {
  const box = h('span', { class: 'md-spark', title }, sparkline(values, baseline, THEME.viz1));
  const off = onThemeChange(() => (box.isConnected ? box.replaceChildren(sparkline(values, baseline, THEME.viz1)) : off()));
  return box;
}

const load = () => engineRequest<MoneyReply>('bonds.money', {}, 60_000);

function fact(label: string, value: string, note = '') {
  return h('div', { class: 'md-fact' }, h('span', { class: 'muted small' }, label), h('b', { class: 'num' }, value), note ? h('span', { class: 'muted small' }, note) : '');
}

/** Bonds → Bond market: overnight funding stress and the mortgage spread. */
export function moneyPanel(): HTMLElement {
  const body = h('div', { class: 'md-grid' }, h('div', { class: 'skeleton', style: 'height:200px' }));
  const el = h(
    'section',
    { class: 'panel rd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Money and housing'), h('span', { class: 'muted small' }, 'Is overnight cash getting scarce, and what do homebuyers pay over Treasuries?')),
    body,
  );
  const go = () => {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
    load().then(
      (d) => {
        const f = d.funding;
        const m = d.mortgage;
        body.replaceChildren(
          h(
            'div',
            { class: 'md-block' },
            h('div', { class: 'cf-caption' }, 'Overnight funding', infoTip('fundingStress')),
            f
              ? h(
                  'div',
                  { class: 'md-body' },
                  h(
                    'div',
                    { class: 'md-head' },
                    h('b', { class: 'md-value num' }, bp(f.spreadBp)),
                    h('span', { class: `md-read${f.reading === 'tight' ? ' tight' : ''}` }, f.reading === 'tight' ? 'Tight' : f.reading === 'month-end' ? 'Month-end bump' : 'Calm'),
                    themedSpark(f.series.map((x) => x.spreadBp), 0, 'SOFR minus IORB, last year (bp); the line is zero'),
                  ),
                  h('p', { class: 'small' }, fundingWords(f)),
                  h(
                    'div',
                    { class: 'md-facts' },
                    fact('Highest in 30 days', bp(f.high30Bp), 'month-ends lift it'),
                    fact('Spread of the day’s rates', `${Math.round(f.dispersionBp)} bp`, `${ord(f.dispersionPct ?? 0)} percentile`),
                  ),
                  h(
                    'p',
                    { class: 'muted small' },
                    `${d.sources.funding.name}, ${day(f.date)}; history since ${day(f.from)}. `,
                    h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('SOFR', 'SOFR (overnight repo rate)') }, 'SOFR history'),
                  ),
                )
              : h('p', { class: 'muted small' }, d.notes.find((n) => n.startsWith('Funding')) ?? 'Unavailable.'),
          ),
          h(
            'div',
            { class: 'md-block' },
            h('div', { class: 'cf-caption' }, 'Mortgage spread', infoTip('mortgageSpread')),
            m
              ? h(
                  'div',
                  { class: 'md-body' },
                  h(
                    'div',
                    { class: 'md-head' },
                    h('b', { class: 'md-value num' }, `${(m.spreadBp / 100).toFixed(2)} pts`),
                    h('span', { class: 'muted small' }, `${ord(m.percentile ?? 0)} percentile since ${yearOf(m.from)}`),
                    themedSpark(m.series.map((x) => x.spreadBp), m.medianBp, 'Mortgage rate minus 10-year Treasury, last 10 years (weekly); the line is the usual gap'),
                  ),
                  h('p', { class: 'small' }, mortgageWords(m)),
                  h('div', { class: 'md-facts' }, fact('A year ago', m.yearAgoBp != null ? `${(m.yearAgoBp / 100).toFixed(2)} pts` : '—'), fact('Usual since ' + yearOf(m.from), `${(m.medianBp / 100).toFixed(2)} pts`, 'the median week')),
                  h(
                    'p',
                    { class: 'muted small' },
                    `${d.sources.mortgage.name}, week of ${day(m.date)}. The gap pays mortgage investors for prepayment risk and lenders for their costs. `,
                    h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('MORTGAGE30US', '30-year mortgage rate (Freddie Mac)') }, 'Mortgage rate history'),
                  ),
                )
              : h('p', { class: 'muted small' }, d.notes.find((n) => n.startsWith('Mortgage')) ?? 'Unavailable.'),
          ),
        );
      },
      (err: Error) => body.replaceChildren(errorBox(err, go)),
    );
  };
  whenReady(body, el, go);
  return el;
}

/** Bonds → What the curve says: how fast the government is borrowing, and how much of it is in bills. */
export function supplyBlock(): HTMLElement {
  const body = h('div', { class: 'md-body' }, h('div', { class: 'skeleton', style: 'height:90px' }));
  const el = h('div', { class: 'rd-tp' }, h('div', { class: 'cf-caption' }, 'How fast the government is borrowing', infoTip('treasurySupply')), body);
  const go = () =>
    load().then(
      (d) => {
        const s = d.supply;
        if (!s) return body.replaceChildren(h('p', { class: 'muted small' }, d.notes.find((n) => n.startsWith('Treasury')) ?? 'Unavailable.'));
        const flag = billShareFlag(s);
        body.replaceChildren(
          h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, bn(s.pacePerYear)), h('span', { class: 'muted small' }, 'a year, at the last 3 months’ pace')),
          h('p', { class: 'small' }, supplyWords(s)),
          flag ? h('p', { class: 'small cf-headline strong' }, flag) : '',
          h(
            'div',
            { class: 'md-facts' },
            fact('30 days', bn(s.change30)),
            fact('3 months', bn(s.change91)),
            fact('12 months', bn(s.change365)),
            fact('Bills, of new debt (12 months)', pct0(s.billShareNew12m)),
          ),
          h(
            'p',
            { class: 'muted small' },
            `${d.sources.supply.name}: debt held by the public ${day(s.date)}, debt by type at month-end ${day(s.mspdDate)}. More long-term supply has gone with a higher term premium (Greenwood and Vayanos 2014): a reading, not a forecast.`,
          ),
        );
      },
      (err: Error) => body.replaceChildren(errorBox(err, go)),
    );
  whenReady(body, el, go);
  return el;
}
