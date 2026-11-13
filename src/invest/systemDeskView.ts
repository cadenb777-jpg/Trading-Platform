/**
 * Bonds → Bond market: "Credit and reserves" (helper 67, `bonds.system`): bank reserves vs GDP, the commercial paper
 * spread over T-bills and banks' lending standards. Readings: systemDesk.ts.
 */
import { engineRequest, systemReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { errorBox } from './shared';
import { fact, themedSpark } from './moneyDeskView';
import { day, whenReady } from './ratesDeskView';
import { bp, ord } from './moneyDesk';
import { lendingWords, paperWords, reservesWords, trendWords, type SystemReply } from './systemDesk';

const pts = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const bpSigned = (v: number | null | undefined) => (v == null ? '—' : bp(v));
const ordOr = (n: number | null | undefined) => (n == null ? '—' : ord(n));

function block(title: string, term: string, body: Node) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), body);
}

export function systemPanel(): HTMLElement {
  const body = h('div', { class: 'md-grid sd-grid' }, h('div', { class: 'skeleton', style: 'height:200px' }));
  const el = h(
    'section',
    { class: 'panel rd-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Credit and reserves'), h('span', { class: 'muted small' }, 'Is there enough cash in the banking system, and is credit getting harder to get?')),
    body,
  );
  const go = () => {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
    engineRequest<SystemReply>('bonds.system', {}, 60_000).then(
      (d) => {
        const r = d.reserves;
        const p = d.paper;
        const l = d.lending;
        const note = (prefix: string) => h('p', { class: 'muted small' }, d.notes.find((n) => n.startsWith(prefix)) ?? 'Unavailable.');
        body.replaceChildren(
          block(
            'Bank reserves',
            'reservesAmple',
            r
              ? h(
                  'div',
                  { class: 'md-body' },
                  h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${r.ratio.toFixed(1)}%`), h('span', { class: 'muted small' }, 'of GDP'), themedSpark(r.series.map((x) => x.ratio), r.stressRatio, 'Reserves as % of GDP, last 10 years (weekly); the line is the September 2019 level')),
                  h('p', { class: 'small' }, reservesWords(r)),
                  h('div', { class: 'md-facts' }, fact('3 months ago', pts(r.ratio3m)), fact('A year ago', pts(r.ratio12m)), fact('September 2019', pts(r.stressRatio), 'money markets broke')),
                  h('p', { class: 'muted small' }, trendWords(r), ' ', `${d.sources.reserves.name}, week of ${day(r.date)}${r.gdpEstimated ? '; this quarter’s GDP is not out yet, so it is estimated from the last quarter’s growth' : ''}. `, h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('WRESBAL', 'Reserve balances at the Fed') }, 'Reserves history')),
                )
              : note('Reserves'),
          ),
          block(
            'Company IOUs vs T-bills',
            'paperSpread',
            p
              ? h(
                  'div',
                  { class: 'md-body' },
                  h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, bpSigned(p.spreadBp)), h('span', { class: `md-read${p.stressed ? ' tight' : ''}` }, p.stressed ? 'Stressed' : `${ordOr(p.percentile)} percentile since ${p.from.slice(0, 4)}`), themedSpark(p.series.map((x) => x.spreadBp), 0, 'Commercial paper minus 3-month T-bill, last year (bp); the line is zero')),
                  h('p', { class: 'small' }, paperWords(p)),
                  h('div', { class: 'md-facts' }, fact('A month ago', bpSigned(p.monthAgoBp)), fact('Highest in a year', bpSigned(p.high1yBp))),
                  h('p', { class: 'muted small' }, `${d.sources.paper.name}, ${day(p.date)}. Both on the discount basis. `, h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('RIFSPPFAAD90NB', '90-day AA financial commercial paper') }, 'Paper rate history')),
                )
              : note('Commercial paper'),
          ),
          block(
            'Banks’ lending standards',
            'lendingStandards',
            l
              ? h(
                  'div',
                  { class: 'md-body' },
                  h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${l.netTightening > 0 ? '+' : l.netTightening < 0 ? '−' : ''}${Math.abs(l.netTightening).toFixed(1)}%`), h('span', { class: `md-read${l.reading === 'tightening' ? ' tight' : ''}` }, l.reading === 'tightening' ? 'Tightening' : l.reading === 'easing' ? 'Easing' : 'About steady'), themedSpark(l.series.map((x) => x.net), 0, 'Net % of banks tightening, last 10 years (quarterly); the line is zero')),
                  h('p', { class: 'small' }, lendingWords(l)),
                  h('p', { class: 'muted small' }, `${d.sources.lending.name}, ${ordOr(l.percentile)} percentile since ${l.from.slice(0, 4)}. `, h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('DRTSCILM', 'Banks tightening loan standards (net %)') }, 'Survey history')),
                )
              : note('Lending'),
          ),
        );
      },
      (err: Error) => body.replaceChildren(errorBox(err, go)),
    );
  };
  whenReady(body, el, go, systemReady);
  return el;
}
