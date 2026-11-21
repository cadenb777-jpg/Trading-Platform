/**
 * Macro → This quarter's growth (GDPNow) and Financial conditions (Chicago Fed NFCI), side by side under the recession
 * check. Four FRED series through the helper's existing raw request (macro.series {raw}); no helper change. Maths and
 * words in conditions.ts. Rebuilt on every Macro load (Refresh, the 30-minute timer), with Retry on a failure.
 */
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { rangeTrack } from '../ui/viz';
import { activityBlock } from './wagesActivityView';
import { conditions, conditionsWords, nowcast, nowcastWords, quarterLabel, rounded, signed } from './conditions';
import { failed, link, older, panel, raw } from './fred';

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function growthPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Atlanta Fed’s GDPNow from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Growth this quarter', 'A running estimate of this quarter’s growth, before the official figure', body, stamp.el);
  // the official figures only feed the comparison and the record: the nowcast shows even if they fail
  Promise.all([raw('GDPNOW'), raw('A191RL1Q225SBEA').catch(() => null)]).then(
    ([now, gdp]) => {
      // the reply's own fetch time (amber when it is a stale saved copy)
      stamp.el.replaceWith(asOfStamp('fred', { reply: gdp ? older(now.reply, gdp.reply) : now.reply, source: 'FRED' }).el);
      // an empty official series is as good as none: no comparison, and it is said
      const official = gdp?.data.length ? gdp.data : null;
      const n = nowcast(now.data, official);
      if (!n) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no GDPNow estimates right now.'));
        return;
      }
      body.replaceChildren(
        h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${signed(n.value, 1)}%`), h('span', { class: 'muted small' }, `${quarterLabel(n.quarter)}, a year’s pace${n.running ? ' (still being estimated)' : ''}`), infoTip('gdpNow')),
        h('p', { class: 'small' }, nowcastWords(n)),
        official ? '' : h('p', { class: 'muted small' }, gdp ? 'FRED sent no official growth figures, so there is no comparison or record right now.' : 'The official growth figures couldn’t be loaded, so there is no comparison or record right now.'),
        h('p', { class: 'muted small' }, 'Source: FRED ', link('GDPNOW', 'GDPNow (Atlanta Fed)', '%'), ' (latest estimate per quarter) and ', link('A191RL1Q225SBEA', 'Real GDP growth (BEA)', '%'), ' (official real GDP growth, annualised). Higgins (2014). A reading of the economy, not a market signal.'),
      );
    },
    () => body.replaceChildren(failed(() => section, 'GDPNow', growthPanel)),
  );
  // the activity block loads on its own: a failure there never hides the nowcast
  section.append(activityBlock());
  return section;
}

function conditionsPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Chicago Fed’s financial conditions index from FRED…'));
  const stamp = asOfStamp('fred', { source: 'FRED' });
  const section = panel('Financial conditions', 'How easy money and credit are, against their history', body, stamp.el);
  Promise.all([raw('NFCI'), raw('ANFCI').catch(() => null)]).then(
    ([nfci, anfci]) => {
      stamp.el.replaceWith(asOfStamp('fred', { reply: anfci ? older(nfci.reply, anfci.reply) : nfci.reply, source: 'FRED' }).el);
      const c = conditions(nfci.data, anfci?.data ?? []);
      if (!c) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no financial conditions readings right now.'));
        return;
      }
      const lo = Math.min(...nfci.data.map((p) => p.value));
      const hi = Math.max(...nfci.data.map((p) => p.value));
      const v = rounded(c.value, 2);
      body.replaceChildren(
        h(
          'div',
          { class: 'md-head' },
          h('b', { class: 'md-value num' }, signed(c.value, 2)),
          h('span', { class: `md-read${v > 0 ? ' tight' : ''}` }, v < 0 ? 'Looser than average' : v > 0 ? 'Tighter than average' : 'Average'),
          h('span', { class: 'muted small' }, day(c.date)),
          infoTip('nfci'),
        ),
        rangeTrack({
          low: lo,
          high: hi,
          value: c.value,
          format: (x) => signed(x, 2),
          title: `Loosest to tightest week since ${c.since.slice(0, 4)}`,
          marks: [{ value: 0, label: 'Average since 1971' }],
          caption: 'Mark: zero, the 1971 average. Left is looser, right is tighter.',
        }),
        h('p', { class: 'small' }, conditionsWords(c, day)),
        anfci == null
          ? h('p', { class: 'muted small' }, 'The adjusted index (ANFCI) couldn’t be loaded right now.')
          : c.adjusted == null
            ? h('p', { class: 'muted small' }, `The adjusted index (ANFCI) has no reading for ${day(c.date)} yet.`)
            : '',
        h('p', { class: 'muted small' }, 'Source: FRED ', link('NFCI', 'Chicago Fed financial conditions (NFCI)', 'pts'), ' and ', link('ANFCI', 'Adjusted financial conditions (ANFCI)', 'pts'), `, weekly; the history here starts in ${c.since.slice(0, 4)}. Brave and Butters (2011). A reading, not a signal.`),
      );
    },
    () => body.replaceChildren(failed(() => section, 'The financial conditions index', conditionsPanel)),
  );
  return section;
}

export function rightNowPanels(): HTMLElement {
  return h('div', { class: 'xe-grid cond-grid' }, growthPanel(), conditionsPanel());
}
