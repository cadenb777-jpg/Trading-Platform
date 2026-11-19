/**
 * Macro → This quarter's growth (GDPNow) and Financial conditions (Chicago Fed NFCI), side by side under the recession
 * check. Four FRED series through the helper's existing raw request (macro.series {raw}); no helper change. Maths and
 * words in conditions.ts.
 */
import { engineRequest } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { rangeTrack } from '../ui/viz';
import { conditions, conditionsWords, nowcast, nowcastWords, quarterLabel, type Point } from './conditions';

type Raw = { data: Point[] };
const raw = (series: string) => engineRequest<Raw>('macro.series', { series, raw: true, limit: 5000 }, 45_000).then((r) => r.data.filter((p) => Number.isFinite(p.value)));
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const link = (id: string, name: string, unit: string) => h('button', { class: 'link-btn', type: 'button', onclick: () => openFredWindow(id, name, unit) }, id);
const failed = (what: string) => h('p', { class: 'muted small' }, `${what} couldn’t be loaded from FRED right now.`);

function panel(title: string, sub: string, body: HTMLElement) {
  return h('section', { class: 'panel cond-panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), h('span', { class: 'muted small' }, sub)), body);
}

function growthPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Atlanta Fed’s GDPNow from FRED…'));
  // the official figures only feed the comparison and the record: the nowcast shows even if they fail
  Promise.all([raw('GDPNOW'), raw('A191RL1Q225SBEA').catch(() => null)]).then(
    ([now, gdp]) => {
      const n = nowcast(now, gdp ?? []);
      if (!n) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no GDPNow estimates right now.'));
        return;
      }
      body.replaceChildren(
        h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${n.value < 0 ? '−' : ''}${Math.abs(n.value).toFixed(1)}%`), h('span', { class: 'muted small' }, `${quarterLabel(n.quarter)}, a year’s pace${n.running ? ' (still being estimated)' : ''}`), infoTip('gdpNow')),
        h('p', { class: 'small' }, nowcastWords(n)),
        gdp ? '' : h('p', { class: 'muted small' }, 'The official growth figures couldn’t be loaded, so there is no comparison or record right now.'),
        h('p', { class: 'muted small' }, 'Source: FRED ', link('GDPNOW', 'GDPNow (Atlanta Fed)', '%'), ' (latest estimate per quarter) and ', link('A191RL1Q225SBEA', 'Real GDP growth (BEA)', '%'), ' (official real GDP growth, annualised). Higgins (2014). A reading of the economy, not a market signal.'),
      );
    },
    () => body.replaceChildren(failed('GDPNow')),
  );
  return panel('Growth this quarter', 'A running estimate of this quarter’s growth, before the official figure', body);
}

function conditionsPanel(): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading the Chicago Fed’s financial conditions index from FRED…'));
  Promise.all([raw('NFCI'), raw('ANFCI').catch(() => [] as Point[])]).then(
    ([nfci, anfci]) => {
      const c = conditions(nfci, anfci);
      if (!c) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'FRED sent no financial conditions readings right now.'));
        return;
      }
      const lo = Math.min(...nfci.map((p) => p.value));
      const hi = Math.max(...nfci.map((p) => p.value));
      body.replaceChildren(
        h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${c.value < 0 ? '−' : ''}${Math.abs(c.value).toFixed(2)}`), h('span', { class: 'md-read' }, c.value < 0 ? 'Looser than average' : c.value > 0 ? 'Tighter than average' : 'Average'), h('span', { class: 'muted small' }, day(c.date)), infoTip('nfci')),
        rangeTrack({
          low: lo,
          high: hi,
          value: c.value,
          format: (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`,
          title: `Loosest to tightest week since ${c.since.slice(0, 4)}`,
          marks: [{ value: 0, label: 'Average since 1971' }],
          caption: 'Mark: zero, the average. Left is looser (easy money and credit), right is tighter.',
        }),
        h('p', { class: 'small' }, conditionsWords(c, day)),
        h('p', { class: 'muted small' }, 'Source: FRED ', link('NFCI', 'Chicago Fed financial conditions (NFCI)', 'pts'), ' and ', link('ANFCI', 'Adjusted financial conditions (ANFCI)', 'pts'), ', weekly. Brave and Butters (2011). A reading, not a signal.'),
      );
    },
    () => body.replaceChildren(failed('The financial conditions index')),
  );
  return panel('Financial conditions', 'How easy money and credit are, against their history', body);
}

export function rightNowPanels(): HTMLElement {
  return h('div', { class: 'xe-grid cond-grid' }, growthPanel(), conditionsPanel());
}
