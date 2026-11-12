/**
 * "Where the money comes from" on Research: revenue by product or service, by business segment and by region, straight
 * from the company's latest 10-K XBRL (helper engine/segments.py). Each part: a bar of its share of sales, the amount,
 * growth on a year ago and, where the company reports it, segment operating margin. A breakdown whose parts don't add up
 * to the reported total says so. Source and filing date shown; nothing estimated.
 */
import { engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
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

function section(s: SegmentSection): HTMLElement {
  const anyMargin = s.items.some((i) => i.margin != null);
  return h(
    'div',
    { class: 'seg-block' },
    h('h4', { class: 'seg-head' }, s.heading),
    h(
      'div',
      { class: 'seg-rows', role: 'table', 'aria-label': s.heading },
      ...segmentRows(s).map((r) =>
        h(
          'div',
          { class: 'seg-row', role: 'row' },
          h('span', { class: 'seg-name', role: 'cell' }, r.name),
          h('span', { class: 'seg-bar', role: 'cell', 'aria-hidden': 'true' }, h('i', { style: `width:${(r.bar * 100).toFixed(1)}%` })),
          h('span', { class: 'seg-num num', role: 'cell' }, money(r.value)),
          h('span', { class: 'seg-num num muted', role: 'cell', title: 'Share of total sales' }, share(r.share)),
          h('span', { class: `seg-num num ${r.growth == null ? 'muted' : r.growth >= 0 ? 'up' : 'down'}`, role: 'cell', title: 'Change on a year earlier' }, r.growth == null ? '—' : pct(r.growth, 1)),
          anyMargin ? h('span', { class: 'seg-num num', role: 'cell', title: 'Segment operating margin' }, share(r.margin)) : '',
        ),
      ),
    ),
    h('p', { class: 'muted small seg-note' }, coverageNote(s), anyMargin ? ' Last column: segment operating margin.' : ''),
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
    body.replaceChildren(h('p', { class: 'muted small' }, 'Arrives with the next helper update (it installs by itself).'));
    return el;
  }
  engineRequest<Segments>('research.segments', { symbol }, 90000).then(
    (d) => {
      if (!d.sections.length) {
        body.replaceChildren(h('p', { class: 'muted small' }, `${d.company}’s ${d.form} doesn’t break revenue down by product, segment or region in its data.`));
        return;
      }
      body.replaceChildren(
        ...d.sections.map(section),
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
