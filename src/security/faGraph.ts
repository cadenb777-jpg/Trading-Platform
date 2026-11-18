/**
 * Financials → graph mode (Bloomberg FA bar-chart view, owner's spec 7.4): the line items you tick, as bars per period,
 * side by side, with a zero line when something went negative. Click a line's name in the statements to add or remove
 * it (up to 3). Pure scaling tested in faGraph.test.ts.
 */
import { h } from '../ui/dom';

export interface GraphSeries {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The top and bottom of the scale and where zero sits (0 = top, 1 = bottom), from every value shown. */
export function barScale(series: GraphSeries[]): { top: number; bottom: number; zero: number } {
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v));
  const top = Math.max(0, ...vals);
  const bottom = Math.min(0, ...vals);
  const span = top - bottom || 1;
  return { top, bottom, zero: top / span };
}

/** Toggles a line in the picked list, keeping at most `max` (the oldest pick drops out). */
export function togglePick(picked: string[], key: string, max = 3): string[] {
  if (picked.includes(key)) return picked.filter((k) => k !== key);
  return [...picked, key].slice(-max);
}

const COLORS = ['var(--hue-money)', 'var(--accent-2)', 'var(--hue-security)'];

export function faGraph(series: GraphSeries[], periods: string[], fmt: (v: number) => string): HTMLElement {
  if (!series.length) return h('p', { class: 'muted small' }, 'Click a line’s name in the statements below to chart it.');
  const sc = barScale(series);
  const span = sc.top - sc.bottom || 1;
  return h(
    'div',
    { class: 'fa-graph' },
    h('ul', { class: 'fa-legend' }, ...series.map((s, i) => h('li', {}, h('i', { style: `background:${COLORS[i % 3]}` }), s.label)), h('li', { class: 'fa-hint' }, 'Click a line’s name below to add or remove it')),
    h(
      'div',
      { class: 'fa-bars', role: 'img', 'aria-label': series.map((s) => `${s.label}: ${s.values.map((v, i) => `${periods[i]} ${v == null ? 'not reported' : fmt(v)}`).join(', ')}`).join('. ') },
      sc.bottom < 0 ? h('div', { class: 'fa-zero', style: `top:calc((100% - 20px) * ${sc.zero.toFixed(4)})` }) : '',
      ...periods.map((p, i) =>
        h(
          'div',
          { class: `fa-period ${i === periods.length - 1 ? 'latest' : ''}` },
          h(
            'div',
            { class: 'fa-plot' },
            ...series.map((s, j) => {
              const v = s.values[i];
              if (v == null || !Number.isFinite(v)) return h('span', { class: 'fa-bar empty', title: `${s.label}, ${p}: not reported` });
              const hgt = (Math.abs(v) / span) * 100;
              const style = v >= 0 ? `bottom:${((1 - sc.zero) * 100).toFixed(2)}%;height:${hgt.toFixed(2)}%` : `top:${(sc.zero * 100).toFixed(2)}%;height:${hgt.toFixed(2)}%`;
              return h('span', { class: `fa-bar ${v < 0 ? 'neg' : ''}`, title: `${s.label}, ${p}: ${fmt(v)}`, style: `${style};background:${COLORS[j % 3]}` });
            }),
          ),
          h('small', {}, p),
        ),
      ),
    ),
  );
}
