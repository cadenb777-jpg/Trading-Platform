/**
 * Macro → This quarter's growth (GDPNow) and Financial conditions (Chicago Fed NFCI), side by side under the recession
 * check. Four FRED series through the helper's existing raw request (macro.series {raw}); no helper change. Maths and
 * words in conditions.ts. Rebuilt on every Macro load (Refresh, the 30-minute timer), with Retry on a failure.
 */
import { engineRequest } from '../data/schwab';
import { asOfStamp } from '../ui/dataHealth';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { rangeTrack } from '../ui/viz';
import { conditions, conditionsWords, nowcast, nowcastWords, quarterLabel, rounded, signed, type Point } from './conditions';

type Raw = { data: Point[] };
/** One FRED series and its reply (the reply carries the fetch time for the as-of stamp). */
const raw = (series: string) =>
  engineRequest<Raw>('macro.series', { series, raw: true, limit: 5000 }, 45_000).then((reply) => ({ reply, data: reply.data.filter((p) => Number.isFinite(p.value)) }));
type Prov = { provenance?: { fetchedAt?: number; stale?: boolean } };
/** The older of two replies (or the stale saved one), so a panel's stamp never looks fresher than its oldest figure. */
const older = (a: unknown, b: unknown) => {
  const pa = (a as Prov)?.provenance;
  const pb = (b as Prov)?.provenance;
  if (!pb) return a;
  if (!pa) return b;
  if (pb.stale && !pa.stale) return b;
  if (pa.stale && !pb.stale) return a;
  return (pb.fetchedAt ?? Infinity) < (pa.fetchedAt ?? Infinity) ? b : a;
};
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const link = (id: string, name: string, unit: string) => h('button', { class: 'link-btn', type: 'button', onclick: () => openFredWindow(id, name, unit) }, id);

function panel(title: string, sub: string, body: HTMLElement, stamp: HTMLElement) {
  return h('section', { class: 'panel cond-panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), h('span', { class: 'muted small' }, sub), h('span', { class: 'spacer' }), stamp), body);
}

/** A failure line with Retry, which builds the panel again in place. */
function failed(section: () => HTMLElement, what: string, rebuild: () => HTMLElement): HTMLElement {
  return h(
    'p',
    { class: 'muted small' },
    `${what} couldn’t be loaded from FRED right now. `,
    h('button', { class: 'btn small', type: 'button', onclick: () => section().replaceWith(rebuild()) }, 'Retry'),
  );
}

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
          caption: 'Mark: zero, the index’s average since 1971. Left is looser (easy money and credit), right is tighter.',
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
