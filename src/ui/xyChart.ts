/** A small SVG line chart over a numeric x-axis (e.g. implied volatility by strike) with a hover tooltip. */
import { h } from './dom';

export interface XySeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
}

export function xySvg(series: XySeries[], opts: { x: (v: number) => string; y: (v: number) => string; marker?: { x: number; label: string }; xName?: string; height?: number }) {
  const W = 640;
  const H = opts.height ?? 240;
  const pad = { l: 52, r: 14, t: 14, b: 28 };
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const span = Math.max(...ys) - Math.min(...ys) || 1;
  const y0 = Math.min(...ys) - span * 0.08;
  const y1 = Math.max(...ys) + span * 0.08;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
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
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'curve-label' }, opts.y(v));
  }
  [x0, (x0 + x1) / 2, x1].forEach((v, i) => add('text', { x: X(v), y: H - 8, 'text-anchor': ['start', 'middle', 'end'][i], class: 'curve-label' }, opts.x(v)));
  if (opts.marker && opts.marker.x >= x0 && opts.marker.x <= x1) {
    add('line', { x1: X(opts.marker.x), x2: X(opts.marker.x), y1: pad.t, y2: H - pad.b, stroke: '#2962ff', 'stroke-dasharray': '4 3' });
    add('text', { x: X(opts.marker.x) + 4, y: pad.t + 10, class: 'curve-label strong' }, opts.marker.label);
  }
  for (const s of series) {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (pts.length > 1) add('polyline', { points: pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2 });
  }
  const guide = add('line', { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, stroke: '#787b86', 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const uniqueX = [...new Set(xs)].sort((a, b) => a - b);
  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const vx = x0 + (((e.clientX - rect.left) / rect.width) * W - pad.l) / ((W - pad.l - pad.r) / (x1 - x0 || 1));
    const nearest = uniqueX.reduce((a, b) => (Math.abs(b - vx) < Math.abs(a - vx) ? b : a), uniqueX[0]);
    guide.setAttribute('x1', String(X(nearest)));
    guide.setAttribute('x2', String(X(nearest)));
    guide.setAttribute('visibility', 'visible');
    const rows = series
      .map((s) => ({ s, p: s.points.find((p) => p.x === nearest) }))
      .filter((r) => r.p)
      .map((r) => h('div', { class: 'chart-tip-row' }, h('i', { style: `background:${r.s.color}` }), h('span', {}, r.s.name), h('b', {}, opts.y(r.p!.y))));
    tip.replaceChildren(h('div', { class: 'chart-tip-date' }, `${opts.xName ?? 'x'} ${opts.x(nearest)}`), ...rows);
    tip.hidden = false;
    const px = (X(nearest) / W) * rect.width;
    tip.style.left = `${px + 160 > rect.width ? px - 160 : px + 12}px`;
    tip.style.top = '10px';
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
  });
  const legend = h('div', { class: 'line-legend static' }, ...series.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), s.name)));
  return h('div', { class: 'curve-wrap curve-interactive' }, legend, svg, tip);
}
