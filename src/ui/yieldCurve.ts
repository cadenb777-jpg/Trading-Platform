/** The Treasury yield curve drawn as a small SVG chart (today, a month ago, a year ago). */
import { h } from './dom';

export interface CurvePoint {
  label: string;
  now: number;
  monthAgo: number | null;
  yearAgo: number | null;
  date: string;
}

/** The yield curve as a small SVG line chart: one line per date. */
export function yieldCurve(points: CurvePoint[]) {
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 30 };
  const lines: { key: 'now' | 'monthAgo' | 'yearAgo'; name: string; color: string; dash?: string }[] = [
    { key: 'now', name: 'Today', color: '#2962ff' },
    { key: 'monthAgo', name: '1 month ago', color: '#9598a1', dash: '4 4' },
    { key: 'yearAgo', name: '1 year ago', color: '#ff9800', dash: '2 4' },
  ];
  const values = points.flatMap((p) => lines.map((l) => p[l.key]).filter((v): v is number => v != null));
  const lo = Math.floor(Math.min(...values) * 2) / 2 - 0.25;
  const hi = Math.ceil(Math.max(...values) * 2) / 2 + 0.25;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  const step = [0.25, 0.5, 1, 2, 5].find((st) => (hi - lo) / st <= 8) ?? 10;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'curve-label' }, `${v.toFixed(1)}%`);
  }
  points.forEach((p, i) => add('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'curve-label' }, p.label));
  for (const l of [...lines].reverse()) {
    const pts = points.map((p, i) => (p[l.key] == null ? null : `${x(i)},${y(p[l.key]!)}`)).filter(Boolean);
    add('polyline', { points: pts.join(' '), fill: 'none', stroke: l.color, 'stroke-width': l.key === 'now' ? 2.5 : 1.5, 'stroke-dasharray': l.dash ?? '' });
    if (l.key === 'now') points.forEach((p, i) => add('circle', { cx: x(i), cy: y(p.now), r: 3.5, fill: l.color }));
  }
  const legend = h('div', { class: 'line-legend static' }, ...lines.map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
  return h('div', { class: 'curve-wrap' }, legend, svg);
}
