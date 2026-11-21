/**
 * Macro → Inflation expected and Jobs market, side by side under Growth / Financial conditions. FRED series through
 * the helper's existing raw request (macro.series {raw}); no helper change. Maths and words in expectations.ts.
 */
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { rangeTrack } from '../ui/viz';
import { signed } from './conditions';
import { failed, link, older, panel, raw } from './fred';
import { HISTORY_SINCE } from './sahm';
import { wageBlock } from './wagesActivityView';
import { curveWords, expectations, expinfId, gapWords, HORIZONS, jobs, jobsWords, monthLabel, stateWords } from './expectations';

const short = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const horizon = (y: number) => (y === 1 ? '1 year' : `${y} years`);
/** A change in points with its sign (+0.34, −0.12, 0.00). */
const change = (d: number) => {
  const s = signed(d, 2);
  return `${s.startsWith('−') || s === '0.00' ? '' : '+'}${s}`;
};
const pct = (v: number) => `${v.toFixed(2)}%`;

function inflationPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Cleveland Fed’s expected inflation and the market’s breakevens from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Inflation expected', 'Average inflation the Cleveland Fed’s model expects, 1 to 30 years ahead', body, stamp.el);
  section.classList.add('exp-panel');
  // the breakevens only feed the model-vs-market comparison: the curve shows even if they fail
  Promise.all([Promise.all(HORIZONS.map((y) => raw(expinfId(y)))), raw('T5YIE').catch(() => null), raw('T10YIE').catch(() => null)])
    .then(([curves, be5, be10]) => {
      const replies = [...curves.map((c) => c.reply), be5?.reply, be10?.reply].filter(Boolean);
      stamp.el.replaceWith(
        asOfStamp('fred', {
          reply: replies.slice(1).reduce<unknown>((a, b) => older(a, b), replies[0]),
          source: 'FRED',
        }).el,
      );
      const e = expectations(new Map(HORIZONS.map((y, i) => [y as number, curves[i].data])), be5?.data ?? [], be10?.data ?? []);
      if (!e) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no month with every horizon of the Cleveland Fed’s estimates right now.'));
        return;
      }
      const first = e.curve[0];
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, pct(first.value)),
          h('span', { class: 'muted small' }, `over the next year, ${monthLabel(e.month)}`),
          infoTip('expectedInflation'),
        ),
        h(
          'table',
          { class: 'exp-table small' },
          h('caption', { class: 'sr-only' }, 'Expected average inflation by horizon'),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Average over'),
              h('th', { scope: 'col', class: 'num' }, short(e.month)),
              h('th', { scope: 'col', class: 'num' }, short(`${Number(e.month.slice(0, 4)) - 1}${e.month.slice(4)}`)),
              h('th', { scope: 'col', class: 'num' }, 'Change (pts)'),
            ),
          ),
          h(
            'tbody',
            {},
            ...e.curve.map((c, i) => {
              const before = e.yearAgo?.[i];
              return h(
                'tr',
                {},
                h('th', { scope: 'row' }, horizon(c.years)),
                h('td', { class: 'num' }, pct(c.value)),
                h('td', { class: 'num' }, before ? pct(before.value) : '—'),
                h('td', { class: 'num' }, before ? change(c.value - before.value) : '—'),
              );
            }),
          ),
        ),
        h('p', { class: 'small' }, curveWords(e)),
        h('h4', { class: 'exp-sub' }, 'Against the bond market', infoTip('breakevenGap')),
        ...e.gaps.map((g) => h('p', { class: 'small' }, gapWords(g))),
        ...(
          [
            [5, be5],
            [10, be10],
          ] as const
        ).map(([y, be]) =>
          e.gaps.some((g) => g.years === y)
            ? ''
            : h(
                'p',
                { class: 'muted small' },
                be
                  ? `${y}-year: no whole month of breakevens lines up with a model estimate yet.`
                  : `${y}-year: the market’s breakeven (${y === 5 ? 'T5YIE' : 'T10YIE'}) couldn’t be loaded right now, so there is no comparison.`,
              ),
        ),
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          ...HORIZONS.flatMap((y, i) => [i ? ', ' : '', link(expinfId(y), `Expected inflation, ${y} year${y === 1 ? '' : 's'} (Cleveland Fed)`, '%')]),
          ' (monthly) and ',
          link('T5YIE', '5-year breakeven inflation', '%'),
          ', ',
          link('T10YIE', '10-year breakeven inflation', '%'),
          ' (daily, averaged over whole months; history from 2006). Each month’s estimate is published early in that month, so it is set against the month before’s breakevens. Haubrich, Pennacchi and Ritchken (2012). The gap is risk and liquidity premia, not a mispricing; a reading, not a signal.',
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => section, 'Expected inflation', inflationPanel)));
  return section;
}

function jobsPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Kansas City Fed’s labour market indicators from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Jobs market', 'How strong hiring and work are, and which way they are moving', body, stamp.el);
  section.classList.add('exp-panel');
  Promise.all([raw('FRBKCLMCILA', HISTORY_SINCE), raw('FRBKCLMCIM', HISTORY_SINCE).catch(() => null)])
    .then(([level, mom]) => {
      stamp.el.replaceWith(
        asOfStamp('fred', {
          reply: mom ? older(level.reply, mom.reply) : level.reply,
          source: 'FRED',
        }).el,
      );
      const j = jobs(level.data, mom?.data ?? []);
      if (!j) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no labour market readings right now.'));
        return;
      }
      const range = (xs: { value: number }[]) => [Math.min(...xs.map((p) => p.value)), Math.max(...xs.map((p) => p.value))] as const;
      const [lo, hi] = range(level.data);
      const momData = mom?.data.filter((p) => p.time >= j.since) ?? [];
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, signed(j.level, 2)),
          j.state && j.momentum != null
            ? h(
                'span',
                {
                  class: `md-read${j.state === 'weak-slowing' ? ' tight' : ''}`,
                },
                stateWords(j.level, j.momentum),
              )
            : '',
          h('span', { class: 'muted small' }, monthLabel(j.month)),
          infoTip('lmci'),
        ),
        rangeTrack({
          low: lo,
          high: hi,
          value: j.level,
          format: (x) => signed(x, 2),
          title: `Level: weakest to strongest month since ${j.since.slice(0, 4)}`,
          marks: [{ value: 0, label: 'Long-run average' }],
          caption: 'Mark: zero, the long-run average. Right is stronger.',
        }),
        j.momentum != null && momData.length
          ? rangeTrack({
              low: range(momData)[0],
              high: range(momData)[1],
              value: j.momentum,
              format: (x) => signed(x, 2),
              title: `Momentum: worst to best month since ${j.since.slice(0, 4)}`,
              marks: [{ value: 0, label: 'Usual pace' }],
              caption: 'Mark: zero, the usual pace of change. Right is improving faster.',
            })
          : '',
        h('p', { class: 'small' }, jobsWords(j)),
        mom == null
          ? h('p', { class: 'muted small' }, 'The momentum reading (FRBKCLMCIM) couldn’t be loaded right now.')
          : j.momentum == null
            ? h('p', { class: 'muted small' }, `The momentum reading has no figure for ${monthLabel(j.month)} yet.`)
            : '',
        h(
          'p',
          { class: 'muted small' },
          'Source: FRED ',
          link('FRBKCLMCILA', 'Labor market conditions, level (Kansas City Fed)', 'pts'),
          ' and ',
          link('FRBKCLMCIM', 'Labor market conditions, momentum (Kansas City Fed)', 'pts'),
          `, monthly; the history here starts in ${j.since.slice(0, 4)}. Hakkio and Willis (2013). A reading of the economy, not a market signal.`,
        ),
      );
    })
    .catch(() => body.replaceChildren(failed(() => section, 'The labour market indicators', jobsPanel)));
  // pay loads on its own: a failure there never hides the labour market reading
  section.append(wageBlock());
  return section;
}

export function expectationPanels(): HTMLElement {
  return h('div', { class: 'xe-grid cond-grid' }, inflationPanel(), jobsPanel());
}
