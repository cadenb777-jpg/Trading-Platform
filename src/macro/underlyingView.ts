/**
 * Macro → Recession probability (Chauvet-Piger) and Underlying inflation (median, sticky, trimmed), side by side under
 * Inflation expected / Jobs market. FRED through macro.series raw; the probability and NBER dates ask for their full
 * history (`since`, helper 104; older helpers send 2006 onwards and the words say the years they cover). Maths in
 * underlying.ts.
 */
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { rangeTrack } from '../ui/viz';
import { failed, link, older, panel, raw } from './conditionsView';
import { HISTORY_SINCE, month } from './sahm';
import { MEASURES, PROB_TRIGGER, probRecord, probWords, row, underlyingWords, type Row } from './underlying';

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

function probabilityPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the recession probability and NBER recession dates from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Recession probability', 'A model’s chance the economy is in recession, from jobs, output, income and sales', body, stamp.el);
  section.classList.add('und-panel');
  Promise.all([raw('RECPROUSM156N', HISTORY_SINCE), raw('USREC', HISTORY_SINCE).catch(() => null)])
    .then(([prob, usrec]) => {
      stamp.el.replaceWith(asOfStamp('fred', { reply: usrec ? older(prob.reply, usrec.reply) : prob.reply, source: 'FRED' }).el);
      const r = probRecord(prob.data, usrec?.data ?? []);
      if (!r) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no recession probabilities right now.'));
        return;
      }
      const v = r.latest.value;
      const rows = [
        ...r.onTime.map((s) => ({ date: s.date, value: s.value, start: s.recessionStart, verdict: s.monthsFromStart === 0 ? 'On time (same month)' : `On time (${Math.abs(s.monthsFromStart ?? 0)} mo ${(s.monthsFromStart ?? 0) > 0 ? 'after' : 'before'})` })),
        ...r.late.map((l) => ({ date: l.date, value: l.value, start: l.recessionStart, verdict: `Late (${l.monthsIn} mo in)` })),
        ...r.alarms.map((s) => ({ date: s.date, value: s.value, start: null as string | null, verdict: 'False alarm' })),
      ].sort((a, b) => (a.date < b.date ? -1 : 1));
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, `${v.toFixed(1)}%`),
          h('span', { class: `md-read${v >= PROB_TRIGGER ? ' tight' : ''}` }, v >= PROB_TRIGGER ? 'More likely than not' : v >= 20 ? 'Elevated' : 'Low'),
          h('span', { class: 'muted small' }, month(r.latest.time)),
          infoTip('recessionProb'),
        ),
        rangeTrack({
          low: 0,
          high: 100,
          value: v,
          format: (x) => `${x.toFixed(0)}%`,
          title: 'Chance of recession (%)',
          marks: [{ value: PROB_TRIGGER, label: 'More likely than not' }],
          caption: `Mark: ${PROB_TRIGGER}%, more likely than not. Lower is better.`,
        }),
        h('p', { class: 'small' }, probWords(r, usrec != null, usrec?.data.length ? usrec.data[usrec.data.length - 1].time : null)),
        usrec && rows.length
          ? h(
              'details',
              { class: 'sahm-record' },
              h('summary', { class: 'small muted' }, `Every time it crossed ${PROB_TRIGGER}% (${rows.length})`),
              h(
                'table',
                { class: 'sahm-table small' },
                h('thead', {}, h('tr', {}, ...['Crossed', 'Reading', 'Recession began', 'Verdict'].map((c, i) => h('th', { scope: 'col', class: i === 1 ? 'num' : '' }, c)))),
                h('tbody', {}, ...rows.map((x) => h('tr', {}, h('td', {}, month(x.date)), h('td', { class: 'num' }, `${x.value.toFixed(1)}%`), h('td', {}, x.start ? month(x.start) : 'none declared'), h('td', {}, x.verdict)))),
              ),
            )
          : '',
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          link('RECPROUSM156N', 'Smoothed recession probabilities (Chauvet-Piger)', '%'),
          ` (monthly, about two months behind; from ${prob.data[0]?.time.slice(0, 4) ?? '—'}) and `,
          link('USREC', 'NBER recession months', 'pts'),
          '. Chauvet and Piger (2008). A reading of the economy, not a market signal.',
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => section, 'The recession probability', probabilityPanel)));
  return section;
}

function inflationPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading underlying inflation from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Underlying inflation', 'Inflation with the month’s outliers taken out, against headline and core', body, stamp.el);
  section.classList.add('und-panel');
  // each measure loads on its own: one failing leaves a note in its row, never an empty panel
  const loads = MEASURES.map((m) =>
    Promise.all([raw(m.yearId), m.monthId ? raw(m.monthId).catch(() => null) : Promise.resolve(null)]).then(
      ([year, monthly]) => ({ m, year, monthly }),
      () => ({ m, year: null, monthly: null }),
    ),
  );
  Promise.all(loads)
    .then((got) => {
      const replies = got.flatMap((g) => [g.year?.reply, g.monthly?.reply]).filter(Boolean);
      if (!replies.length) throw new Error('none');
      stamp.el.replaceWith(asOfStamp('fred', { reply: replies.slice(1).reduce<unknown>((a, b) => older(a, b), replies[0]), source: 'FRED' }).el);
      const rows = got.map((g) => ({ m: g.m, r: g.year ? row(g.m, g.year.data, g.monthly?.data ?? []) : null }));
      const ok = rows.map((x) => x.r).filter((r): r is Row => r != null);
      const line = (x: (typeof rows)[number]) =>
        h(
          'tr',
          { class: x.m.underlying ? '' : 'und-compare' },
          h('th', { scope: 'row' }, h('span', { class: 'und-name' }, x.m.label), h('span', { class: 'und-by muted' }, x.r ? `${x.m.by} · ${month(x.r.month)}` : x.m.by)),
          ...(x.r
            ? [h('td', { class: 'num' }, pct(x.r.year)), h('td', { class: 'num' }, pct(x.r.pace3)), h('td', { class: 'num und-opt' }, pct(x.r.yearAgo))]
            : [h('td', { class: 'muted', colspan: '3' }, 'couldn’t be loaded right now')]),
        );
      // one note per missing month (headline and core CPI share the same gap)
      const gaps = new Map<string, Row[]>();
      const yearAgoGaps = new Map<string, Row[]>();
      for (const r of ok) {
        if (r.year == null && r.missing) gaps.set(r.missing, [...(gaps.get(r.missing) ?? []), r]);
        else if (r.yearAgo == null && r.yearAgoMissing) yearAgoGaps.set(r.yearAgoMissing, [...(yearAgoGaps.get(r.yearAgoMissing) ?? []), r]);
      }
      body.replaceChildren(
        h(
          'table',
          { class: 'exp-table und-table small' },
          h('caption', { class: 'sr-only' }, 'Underlying inflation measures against headline and core CPI'),
          h('thead', {}, h('tr', {}, ...['Measure', '12 months', '3-month pace', 'A year earlier'].map((c, i) => h('th', { scope: 'col', class: i === 3 ? 'num und-opt' : i ? 'num' : '' }, c)))),
          h('tbody', {}, ...rows.map(line)),
        ),
        ...[...gaps].map(([gap, rs]) =>
          h('p', { class: 'muted small' }, `${rs.map((r) => r.measure.label).join(' and ')}: FRED has no index for ${month(gap)}, so the 12-month rate for ${month(rs[0].month)} can’t be worked out (it isn’t estimated).`),
        ),
        ...[...yearAgoGaps].map(([gap, rs]) =>
          h('p', { class: 'muted small' }, `${rs.map((r) => r.measure.label).join(' and ')}: FRED has no index for ${month(gap)}, so the rate a year earlier can’t be worked out (it isn’t estimated).`),
        ),
        h('p', { class: 'small' }, underlyingWords(ok), infoTip('underlyingInflation')),
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          ...MEASURES.flatMap((m, i) => [i ? ', ' : '', link(m.yearId, `${m.label} (${m.by})`, m.monthId ? '%' : 'index'), ...(m.monthId ? [' / ', link(m.monthId, `${m.label}, 1 month at an annual rate (${m.by})`, '%')] : [])]),
          '. The 3-month pace compounds the last three months to a yearly rate. Bryan and Cecchetti (1994), Bryan and Meyer (2010), Dolmas (2005).',
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => section, 'Underlying inflation', inflationPanel)));
  return section;
}

export function underlyingPanels(): HTMLElement {
  return h('div', { class: 'xe-grid cond-grid' }, probabilityPanel(), inflationPanel());
}
