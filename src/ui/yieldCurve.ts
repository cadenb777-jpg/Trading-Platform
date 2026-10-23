/** The Treasury yield curve drawn as a small SVG chart (today, a month ago, a year ago). */
import { h } from './dom';
import { CURVE_SERIES, openFredWindow } from './fredWindow';

export interface CurvePoint {
  label: string;
  now: number;
  monthAgo: number | null;
  yearAgo: number | null;
  date: string;
}

/**
 * The yield curve as a small SVG line chart: one line per date. Hovering a maturity shows its yields (today, a month
 * ago, a year ago, and the changes); clicking it opens that Treasury's full yield history in a chart window.
 */
export function yieldCurve(points: CurvePoint[], onPick: (label: string) => void = (label) => CURVE_SERIES[label] && openFredWindow(CURVE_SERIES[label])) {
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
    return el;
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
  // Hover / click targets: one invisible column per maturity, with a guide line and a tooltip.
  const guide = add('line', { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, stroke: '#787b86', 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const wrap = h('div', { class: 'curve-wrap curve-interactive' });
  const bps = (a: number, b: number | null) => (b == null ? '' : ` (${a - b >= 0 ? '+' : '−'}${Math.round(Math.abs(a - b) * 100)} bp)`);
  const colW = (W - pad.l - pad.r) / Math.max(1, points.length - 1);
  points.forEach((p, i) => {
    const col = add('rect', { x: x(i) - colW / 2, y: pad.t, width: colW, height: H - pad.t - pad.b, fill: 'transparent', class: 'svg-tip-target' });
    col.addEventListener('mouseenter', () => {
      guide.setAttribute('x1', String(x(i)));
      guide.setAttribute('x2', String(x(i)));
      guide.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        h('div', { class: 'chart-tip-date' }, `${p.label} Treasury · ${p.date}`),
        ...lines.filter((l) => p[l.key] != null).map((l) => h('div', { class: 'chart-tip-row' }, h('i', { style: `background:${l.color}` }), h('span', {}, l.name), h('b', {}, `${p[l.key]!.toFixed(2)}%${l.key === 'now' ? '' : bps(p.now, p[l.key])}`))),
        h('div', { class: 'muted small' }, 'Click for the full history'),
      );
      tip.hidden = false;
      const rect = svg.getBoundingClientRect();
      const px = (x(i) / W) * rect.width;
      tip.style.left = `${px + 14 + 200 > rect.width ? px - 214 : px + 14}px`;
      tip.style.top = `${(y(p.now) / H) * rect.height - 10}px`;
    });
    col.addEventListener('click', () => onPick(p.label));
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
  });
  const legend = h('div', { class: 'line-legend static' }, ...lines.map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
  wrap.append(legend, svg, tip);
  return wrap;
}
