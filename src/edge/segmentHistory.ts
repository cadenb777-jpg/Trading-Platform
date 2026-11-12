/**
 * Research → Which businesses are growing (segment revenue over 5+ years from the last three 10-Ks) and Biggest
 * customers (concentration the company itself discloses). Helper engine/segments.py research.segmenthistory.
 */
import { h } from '../ui/dom';
import { money, pct, pctU } from '../ui/charts';
import { edgePanel, sourceLine } from './panel';

export interface HistAxis {
  axis: string;
  heading: string;
  years: string[];
  series: { name: string; values: (number | null)[] }[];
}
export interface SegHistory {
  symbol: string;
  company: string;
  history: HistAxis[];
  concentration: { name: string; of: string; kind: string; share: number; end: string }[];
  filings: { form: string; filed: string; url: string }[];
}

/** Yearly growth between the first and last known values (pure, tested). */
export function cagr(values: (number | null)[]): number | null {
  const known = values.map((v, i) => [i, v] as const).filter(([, v]) => v != null && v > 0) as [number, number][];
  if (known.length < 2) return null;
  const [i0, v0] = known[0], [i1, v1] = known[known.length - 1];
  return i1 > i0 ? (v1 / v0) ** (1 / (i1 - i0)) - 1 : null;
}

function axisTable(a: HistAxis) {
  return h(
    'div',
    { class: 'ar-scroll' },
    h(
      'table',
      { class: 'ar-table sh-table' },
      h('caption', { class: 'xe-sub' }, a.heading),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), ...a.years.map((y) => h('th', { scope: 'col', class: 'num' }, y.slice(0, 4))), h('th', { scope: 'col', class: 'num' }, 'Growth a year'))),
      h(
        'tbody',
        {},
        ...a.series.map((s) => {
          const g = cagr(s.values);
          return h(
            'tr',
            {},
            h('th', { scope: 'row' }, s.name),
            ...s.values.map((v) => h('td', { class: 'num' }, v == null ? '' : money(v))),
            h('td', { class: `num ${g == null ? 'muted' : g >= 0 ? 'up' : 'down'}` }, g == null ? '—' : pct(g, 1)),
          );
        }),
      ),
    ),
  );
}

export function segmentHistoryPanel(symbol: string): HTMLElement {
  return edgePanel<SegHistory>({
    title: 'Which businesses are growing',
    sub: 'Revenue by part over the last 10-Ks, and the biggest customers',
    request: 'research.segmenthistory',
    params: { symbol },
    timeout: 150000,
    render(d, body) {
      body.append(...(d.history.length ? d.history.map(axisTable) : [h('p', { class: 'muted small' }, 'The filings don’t break revenue into parts over several years.')]));
      body.append(h('h4', { class: 'xe-sub' }, 'Biggest customers and suppliers'));
      body.append(
        d.concentration.length
          ? h('ul', { class: 'conc-list' }, ...d.concentration.map((c) => h('li', {}, h('b', {}, c.name), ` — ${pctU(c.share, 0)} of ${c.of === 'revenue' ? 'sales' : c.of}${c.kind === 'supplier' ? ' (supplier)' : ''}`, h('span', { class: 'muted small' }, ` · ${c.end}`))))
          : h('p', { class: 'muted small' }, 'No single customer is named as 10% or more of sales or receivables (companies must disclose any that are).'),
      );
      body.append(sourceLine('SEC EDGAR XBRL, ', ...d.filings.flatMap((f, i) => [i ? ', ' : '', h('a', { href: f.url, target: '_blank', rel: 'noopener' }, `${f.form} ${f.filed}`)])));
    },
  });
}
