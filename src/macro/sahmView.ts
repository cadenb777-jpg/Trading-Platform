/**
 * Macro → Recession check: the Sahm rule, real time, with its own record against NBER recession dates. Two FRED series
 * through the helper's existing raw request (macro.series {raw}); no helper change. Maths and words in sahm.ts.
 */
import { engineRequest } from '../data/schwab';
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { rangeTrack } from '../ui/viz';
import { missedRecessions, month, nowWords, recordWords, sahmSignals, sahmState, TRIGGER, WATCH, type MonthPoint } from './sahm';

type Raw = { data: MonthPoint[]; date?: string };

const STATE_LABEL = { triggered: 'Triggered', watch: 'Watch', calm: 'Calm' } as const;

export function sahmPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Sahm rule and recession dates from FRED…'));
  const stampSlot = h('span', {});
  const section = h(
    'section',
    { class: 'panel sahm-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Recession check'), h('span', { class: 'muted small' }, 'The Sahm rule: has unemployment risen enough to say a recession has begun?'), h('span', { class: 'spacer' }), stampSlot),
    body,
  );
  // the recession dates only feed the record: if they fail, the reading still shows
  const dates = engineRequest<Raw>('macro.series', { series: 'USREC', raw: true, limit: 2000 }, 45_000).catch(() => null);
  Promise.all([engineRequest<Raw>('macro.series', { series: 'SAHMREALTIME', raw: true, limit: 2000 }, 45_000), dates]).then(
    ([s, u]) => {
      stampSlot.replaceChildren(asOfStamp('fred', { reply: s, source: 'FRED' }).el);
      const sahm = s.data.filter((p) => Number.isFinite(p.value));
      const usrec = (u?.data ?? []).filter((p) => Number.isFinite(p.value));
      if (!sahm.length) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no Sahm rule readings right now.'));
        return;
      }
      const latest = sahm[sahm.length - 1];
      const state = sahmState(latest.value);
      const signals = sahmSignals(sahm, usrec);
      const record = missedRecessions(sahm, usrec, signals);
      const top = Math.max(1, Math.ceil(latest.value * 2) / 2);
      const low = Math.min(0, Math.floor(latest.value * 2) / 2);
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, `${latest.value.toFixed(2)} pts`),
          h('span', { class: `md-read${state === 'calm' ? '' : ' tight'}` }, STATE_LABEL[state]),
          h('span', { class: 'muted small' }, `${month(latest.time)}; fires at ${TRIGGER.toFixed(2)}`),
          infoTip('sahmRule'),
        ),
        rangeTrack({
          low,
          high: top,
          value: latest.value,
          format: (v) => v.toFixed(2),
          title: 'Unemployment rise above its 12-month low (points)',
          marks: [
            { value: WATCH, label: 'Watch' },
            { value: TRIGGER, label: 'Sahm rule fires' },
          ],
          caption: `Marks: ${WATCH.toFixed(2)} watch · ${TRIGGER.toFixed(2)} the rule fires. Lower is better.`,
        }),
        h('p', { class: 'small' }, nowWords(latest)),
        h('p', { class: 'small' }, u ? recordWords(signals, sahm[0].time, usrec.length ? usrec[usrec.length - 1].time : null, record) : 'Its record against past recessions needs the NBER recession dates (FRED USREC), which couldn’t be loaded right now.'),
        u && signals.length
          ? h(
              'details',
              { class: 'sahm-record' },
              h('summary', { class: 'small muted' }, `Every time it fired (${signals.length})`),
              h(
                'table',
                { class: 'sahm-table small' },
                h('thead', {}, h('tr', {}, ...['Fired', 'Reading', 'Recession began', 'Fired after its start'].map((c, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, c)))),
                h(
                  'tbody',
                  {},
                  ...signals.map((g) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, month(g.date)),
                      h('td', { class: 'num' }, g.value.toFixed(2)),
                      h('td', { class: 'num' }, g.recessionStart ? month(g.recessionStart) : 'none declared'),
                      h('td', { class: 'num' }, g.monthsFromStart == null ? '—' : g.monthsFromStart === 0 ? 'same month' : `${Math.abs(g.monthsFromStart)} mo ${g.monthsFromStart > 0 ? 'after' : 'before'}`),
                    ),
                  ),
                ),
              ),
            )
          : '',
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          h('button', { class: 'link-btn', type: 'button', onclick: () => openFredWindow('SAHMREALTIME', 'Sahm rule (real time)', 'pts') }, 'SAHMREALTIME'),
          ` (the published real-time reading, monthly) and `,
          h('button', { class: 'link-btn', type: 'button', onclick: () => openFredWindow('USREC', 'NBER recession months', 'pts') }, 'USREC'),
          ' (NBER recession months, announced months after they begin). Sahm (2019), Brookings Hamilton Project. A reading of the economy, not a market signal.',
        ),
      );
    },
    (e: unknown) =>
      body.replaceChildren(
        h(
          'p',
          { class: 'muted small' },
          `The Sahm rule couldn’t be loaded from FRED right now${e instanceof Error && e.message ? ` (${e.message})` : ''}. `,
          h('button', { class: 'btn small', type: 'button', onclick: () => section.replaceWith(sahmPanel()) }, 'Retry'),
        ),
      ),
  );
  return section;
}
