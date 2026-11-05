/**
 * Small SVG line charts for the Investments page's popover, expanded rows and compare panel. Colours come from CSS
 * classes (`mc-up`, `mc-down`, `mc-s1`..`mc-s4` use tokens), so both themes follow without repainting.
 */
import type { Point } from './miniMath';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ChartLine {
  points: Point[];
  /** Colour class: mc-up, mc-down, mc-s1..mc-s4. */
  cls: string;
}

function el(tag: string, attrs: Record<string, string>) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * One or more lines over time in a fixed-size box (it scales to its container's width). `area` fills under a single
 * line; `zero` draws a dashed line at 0 (for % change charts). `onHover` gets the nearest time as the pointer moves.
 */
export function lineChart(lines: ChartLine[], opts: { width: number; height: number; area?: boolean; zero?: boolean; label: string; onHover?: (t: number | null, x: number) => void }): SVGSVGElement {
  const { width: W, height: H } = opts;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'mc-svg', role: 'img', 'aria-label': opts.label }) as SVGSVGElement;
  const all = lines.flatMap((l) => l.points);
  if (all.length < 2) return svg;
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const [t, v] of all) {
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (opts.zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const pad = (hi - lo || Math.abs(hi) * 0.01 || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W / 2);
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  if (opts.zero) svg.append(el('line', { x1: '0', x2: String(W), y1: y(0).toFixed(1), y2: y(0).toFixed(1), class: 'mc-zero', 'vector-effect': 'non-scaling-stroke' }));
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const d = line.points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const g = el('g', { class: line.cls });
    if (opts.area && lines.length === 1) g.append(el('path', { d: `${d}L${x(line.points[line.points.length - 1][0]).toFixed(1)},${H}L${x(line.points[0][0]).toFixed(1)},${H}Z`, class: 'mc-area' }));
    g.append(el('path', { d, class: 'mc-line', 'vector-effect': 'non-scaling-stroke' }));
    svg.append(g);
  }
  if (opts.onHover) {
    const cursor = el('line', { y1: '0', y2: String(H), class: 'mc-cursor', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
    svg.append(cursor);
    const hover = opts.onHover;
    svg.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const t = t0 + frac * (t1 - t0);
      cursor.setAttribute('x1', String(frac * W));
      cursor.setAttribute('x2', String(frac * W));
      cursor.setAttribute('visibility', 'visible');
      hover(t, e.clientX - box.left);
    });
    svg.addEventListener('pointerleave', () => {
      cursor.setAttribute('visibility', 'hidden');
      hover(null, 0);
    });
  }
  return svg;
}

/** The value of a line at (or just before) time t. */
export function valueAt(points: readonly Point[], t: number): Point | null {
  if (!points.length || t < points[0][0]) return points[0] ?? null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo];
}
