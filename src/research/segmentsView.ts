/**
 * "Where the money comes from" on Research: revenue by product or service, by business segment and by region, straight
 * from the company's latest 10-K XBRL (helper engine/segments.py). Each part: a bar of its share of sales, the amount,
 * growth on a year ago and, where the company reports it, segment operating margin. A breakdown whose parts don't add up
 * to the reported total says so. Source and filing date shown; nothing estimated.
 */
import { ARRIVES_WITH_UPDATE, engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { treemap } from '../ui/viz';
import { tableTools } from '../ui/tableTools';
import { money, pct } from '../ui/charts';

export const SEGMENTS_HELPER_VERSION = 57;

export interface SegmentItem {
  member: string;
  name: string;
  value: number;
  prior: number | null;
  share: number | null;
  growth: number | null;
  operatingIncome: number | null;
  margin: number | null;
}
export interface SegmentSection {
  axis: string;
  heading: string;
  items: SegmentItem[];
  sum: number;
  total: number;
  complete: boolean;
  coverage: number | null;
}
export interface Segments {
  symbol: string;
  company: string;
  form: string;
  filed: string;
  source: string;
  periodEnd: string;
  period: 'annual' | 'quarter';
  total: number;
  priorTotal: number | null;
  sections: SegmentSection[];
}

/** One breakdown as rows (pure, tested): biggest first, bar width relative to the biggest part. */
export function segmentRows(s: SegmentSection) {
  const top = Math.max(...s.items.map((i) => i.value), 1);
  return s.items.map((i) => ({ ...i, bar: Math.max(0.02, i.value / top) }));
}

/** A share or margin without a sign: 0.5036 -> "50%" (pure, tested). */
export function share(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`;
}

/** The plain-language note under a breakdown (pure, tested). */
export function coverageNote(s: SegmentSection): string {
  if (s.complete) return 'Adds up to total sales.';
  if (s.coverage == null) return '';
  return `These parts add up to ${Math.round(s.coverage * 100)}% of total sales (the company reports only some parts, or parts that overlap).`;
}

/** One line under the flower: the biggest part and the fastest grower (pure, tested). */
export function segmentWords(s: SegmentSection): string {
  if (!s.items.length) return '';
  const big = [...s.items].sort((a, b) => b.value - a.value)[0];
  const grown = s.items.filter((i) => i.growth != null).sort((a, b) => b.growth! - a.growth!);
  const lead = `Biggest: ${big.name}${big.share != null ? `, ${share(big.share)} of sales` : ''}.`;
  if (!grown.length) return lead;
  const fast = grown[0];
  const slow = grown[grown.length - 1];
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`;
  return `${lead} Fastest growing: ${fast.name} ${sign(fast.growth!)}${grown.length > 1 && slow.growth! < 0 ? `; shrinking: ${slow.name} ${sign(slow.growth!)}` : ''}.`;
}


function section(s: SegmentSection, key: string): HTMLElement {
  const anyMargin = s.items.some((i) => i.margin != null);
  const items = s.items.filter((i) => i.value > 0);
  const byName = new Map(items.map((i) => [i.name, i]));
  // the picture: one block per part, area = sales, green when it grew and red when it shrank (deepest at +/-25%)
  const map = treemap({
    groups: [{ label: '', items: items.map((i) => i.name) }],
    title: s.heading,
    format: (v) => pct(v, 1),
    full: 0.25,
    height: 240,
    caption: segmentWords(s),
    describe: (name) => {
      const i = byName.get(name)!;
      return `${name}: ${money(i.value)}${i.share != null ? `, ${share(i.share)} of sales` : ''}${i.growth != null ? `, ${pct(i.growth, 1)} on a year earlier` : ''}`;
    },
  });
  map.setWeights((n) => byName.get(n)?.value);
  map.update((n) => byName.get(n)?.growth);
  const table = h(
    'table',
    { class: 'data-table seg-table', 'aria-label': s.heading },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Part'),
        h('th', { 'aria-hidden': 'true' }, ''),
        h('th', { class: 'num' }, 'Sales'),
        h('th', { class: 'num', title: 'Share of total sales' }, 'Share'),
        h('th', { class: 'num', title: 'Change on a year earlier' }, 'Growth'),
        anyMargin ? h('th', { class: 'num', title: 'Segment operating margin' }, 'Margin') : '',
      ),
    ),
    h(
      'tbody',
      {},
      ...segmentRows(s).map((r) =>
        h(
          'tr',
          {},
          h('td', { class: 'seg-name' }, r.name),
          h('td', { class: 'seg-bar-cell' }, h('span', { class: 'seg-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${(r.bar * 100).toFixed(1)}%` }))),
          h('td', { class: 'num', 'data-value': String(r.value) }, money(r.value)),
          h('td', { class: 'num muted', 'data-value': r.share == null ? '' : String(r.share) }, share(r.share)),
          h('td', { class: `num ${r.growth == null ? 'muted' : r.growth >= 0 ? 'up' : 'down'}`, 'data-value': r.growth == null ? '' : String(r.growth) }, r.growth == null ? '—' : pct(r.growth, 1)),
          anyMargin ? h('td', { class: 'num', 'data-value': r.margin == null ? '' : String(r.margin) }, share(r.margin)) : '',
        ),
      ),
    ),
  ) as HTMLTableElement;
  tableTools(table, { id: `segments:${key}`, columns: { '': 'none' }, minRowsForFilters: 1 });
  return h(
    'div',
    { class: 'seg-block' },
    h('h4', { class: 'seg-head' }, s.heading),
    h('div', { class: 'seg-split' }, map.el, h('div', { class: 'seg-rows table-scroll' }, table)),
    h('p', { class: 'muted small seg-note' }, coverageNote(s)),
  );
}

/** The panel: loads on its own, so the rest of the page never waits for it. */
export function segmentsPanel(symbol: string): HTMLElement {
  const body = h('div', { class: 'seg-body' }, h('p', { class: 'muted small' }, 'Reading the latest annual report…'));
  const el = h(
    'section',
    { class: 'panel seg-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Where the money comes from'), h('span', { class: 'muted small' }, 'Products, segments and regions from the company’s own filing')),
    body,
  );
  if ((helper.version ?? 0) < SEGMENTS_HELPER_VERSION) {
    body.replaceChildren(h('p', { class: 'muted small' }, ARRIVES_WITH_UPDATE));
    return el;
  }
  engineRequest<Segments>('research.segments', { symbol }, 90000).then(
    (d) => {
      if (!d.sections.length) {
        body.replaceChildren(h('p', { class: 'muted small' }, `${d.company}’s ${d.form} doesn’t break revenue down by product, segment or region in its data.`));
        return;
      }
      body.replaceChildren(
        ...d.sections.map((sec) => section(sec, sec.axis)),
        h(
          'p',
          { class: 'muted small seg-source' },
          `Fiscal year ended ${new Date(`${d.periodEnd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · total sales ${money(d.total)}`,
          d.priorTotal ? ` (${pct(d.total / d.priorTotal - 1, 1)} on the year before)` : '',
          ' · ',
          h('a', { href: d.source, target: '_blank', rel: 'noopener' }, `${d.form} filed ${d.filed}`),
        ),
      );
    },
    (err: Error) => body.replaceChildren(h('p', { class: 'muted small' }, `Couldn’t read the breakdown: ${err.message}`)),
  );
  return el;
}
