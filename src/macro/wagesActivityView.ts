/**
 * Macro → the Pay block (in Jobs market) and the Activity block (in Growth this quarter). Each loads on its own, so a
 * failure leaves one line in its block and never hides the panel's main reading, and each has its own as-of stamp
 * (the panel's stamp covers only its main replies). FRED through macro.series raw with the full history
 * (HISTORY_SINCE; older helpers send 2006 onwards, which the words then say). Maths in wagesActivity.ts.
 */
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { rangeTrack } from '../ui/viz';
import { signed } from './conditions';
import { failed, link, older, raw } from './fred';
import { HISTORY_SINCE, month } from './sahm';
import { activity, activityWords, wages, wageWords } from './wagesActivity';

function block(title: string, term: string, body: HTMLElement, stamp: HTMLElement): HTMLElement {
  return h('div', { class: 'wa-block' }, h('h4', { class: 'exp-sub' }, title, infoTip(term), h('span', { class: 'spacer' }), stamp), body);
}

export function wageBlock(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Atlanta Fed’s wage growth tracker…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const el = block('Pay', 'wageTracker', body, stamp.el);
  Promise.all([raw('FRBATLWGT3MMAUMHWGO', HISTORY_SINCE), raw('MEDCPIM159SFRBCLE', HISTORY_SINCE).catch(() => null)])
    .then(([w, cpi]) => {
      stamp.el.replaceWith(asOfStamp('fred', { reply: cpi ? older(w.reply, cpi.reply) : w.reply, source: 'FRED' }).el);
      const x = wages(w.data, cpi?.data ?? []);
      if (!x) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no wage growth readings right now.'));
        return;
      }
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, `${signed(x.value, 1)}%`),
          h('span', { class: 'muted small' }, `typical pay rise over a year, ${month(x.month)}`),
          x.real != null ? h('span', { class: 'muted small' }, x.real === 0 ? '· keeping pace with median prices' : `· about ${Math.abs(x.real).toFixed(1)} pts ${x.real > 0 ? 'ahead of' : 'behind'} median prices`) : '',
        ),
        h('p', { class: 'small' }, wageWords(x, cpi == null ? 'failed' : cpi.data.length ? 'loaded' : 'empty')),
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          link('FRBATLWGT3MMAUMHWGO', 'Wage growth tracker (Atlanta Fed)', '%'),
          ' (3-month average of the median, monthly; people in work in both years) and ',
          link('MEDCPIM159SFRBCLE', 'Median CPI, 12-month (Cleveland Fed)', '%'),
          ' (averaged over the same three months). The gap to prices is rough: one median minus another. Daly, Hobijn and Wiles (2011).',
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => el, 'Wage growth', wageBlock)));
  return el;
}

export function activityBlock(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Chicago Fed’s national activity index…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const el = block('Activity across the economy', 'cfnai', body, stamp.el);
  Promise.all([raw('CFNAIMA3', HISTORY_SINCE), raw('CFNAI', HISTORY_SINCE).catch(() => null)])
    .then(([ma3, monthly]) => {
      stamp.el.replaceWith(asOfStamp('fred', { reply: monthly ? older(ma3.reply, monthly.reply) : ma3.reply, source: 'FRED' }).el);
      const x = activity(ma3.data, monthly?.data ?? []);
      if (!x) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no national activity readings right now.'));
        return;
      }
      const values = ma3.data.map((p) => p.value);
      body.replaceChildren(
        h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, signed(x.ma3, 2)), h('span', { class: 'muted small' }, `3-month average to ${month(x.month)}`)),
        rangeTrack({
          low: Math.min(...values),
          high: Math.max(...values),
          value: x.ma3,
          format: (v) => signed(v, 2),
          title: `Weakest to strongest 3 months since ${x.since.slice(0, 4)}`,
          marks: [{ value: 0, label: 'Trend growth' }],
          caption: 'Mark: zero, growth at the trend pace. Right is stronger.',
        }),
        h('p', { class: 'small' }, activityWords(x)),
        monthly == null ? h('p', { class: 'muted small' }, 'The single-month reading (CFNAI) couldn’t be loaded right now.') : '',
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          link('CFNAIMA3', 'Chicago Fed National Activity Index, 3-month average', 'pts'),
          ' and ',
          link('CFNAI', 'Chicago Fed National Activity Index', 'pts'),
          `, monthly from ${x.since.slice(0, 4)}. Stock and Watson (1999). A reading of the economy, not a market signal.`,
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => el, 'The national activity index', activityBlock)));
  return el;
}
