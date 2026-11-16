/**
 * Visual building blocks for the revamp (Fincept-style, the platform's colours): a speed gauge, a progress ring,
 * a range track, a "flower" of flows from one centre and a heat grid. Plain SVG/DOM (no library, nothing on scroll),
 * coloured only through the theme's CSS variables, so both themes work. Each one takes a caption: the words that
 * make the picture readable (finance-ui: a picture plus the text around it).
 *
 * The geometry is pure and tested (viz.test.ts); the builders only draw.
 */
import { h } from './dom';

export type Tone = 'up' | 'down' | 'warn' | 'accent' | 'copper' | 'muted';
const TONE_VAR: Record<Tone, string> = {
  up: 'var(--up)',
  down: 'var(--down)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  copper: 'var(--accent-2)',
  muted: 'var(--line-strong)',
};
export const toneColor = (t: Tone) => TONE_VAR[t];

// ---------- geometry (pure) ----------

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Point on a circle; 0° is straight up, angles grow clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** SVG path of a circular arc from a0 to a1 degrees (clockwise). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Gauge needle angle for a value: min sits at -90° (left), max at +90° (right). */
export function gaugeAngle(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return -90;
  return -90 + (clamp(value, min, max) - min) / (max - min) * 180;
}

/** Where a value sits on a track, 0..1 (clamped). */
export function trackPos(value: number, low: number, high: number): number {
  if (!(high > low) || !Number.isFinite(value)) return 0.5;
  return clamp((value - low) / (high - low), 0, 1);
}

/** Petal (flower) layout: n outer points evenly round the circle, starting at the top. */
export function petalPoints(n: number, cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => polar(cx, cy, r, (360 / Math.max(1, n)) * i));
}

/** Stroke width for a flow: the biggest gets `max`, the smallest still visible. */
export function flowWidth(value: number, biggest: number, max = 10, min = 1.2): number {
  if (!(biggest > 0) || !(value > 0)) return min;
  return min + (max - min) * Math.sqrt(value / biggest);
}

/** Heat-grid shade: share of the tone mixed into the cell, 8..70 %, by size versus the biggest move. */
export function heatShare(value: number, maxAbs: number): number {
  if (!(maxAbs > 0) || !Number.isFinite(value)) return 0;
  return Math.round(8 + 62 * Math.min(1, Math.abs(value) / maxAbs));
}

// ---------- drawing ----------

const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

function figure(cls: string, art: Node, caption?: Node | string, label?: string) {
  return h('figure', { class: `viz ${cls}`, ...(label ? { 'aria-label': label } : {}) }, art, caption ? h('figcaption', { class: 'viz-cap' }, caption) : '');
}

export interface GaugeZone {
  to: number;
  tone: Tone;
  label?: string;
}

/** A speed gauge: coloured zones on a half circle, a needle at the value, the reading in the middle. */
export function gauge(o: { value: number | null; min: number; max: number; zones: GaugeZone[]; valueText: string; title: string; caption?: Node | string; size?: number }) {
  const w = o.size ?? 200;
  const cx = w / 2;
  const cy = w * 0.55;
  const r = w * 0.4;
  const art = svg('svg', { viewBox: `0 0 ${w} ${w * 0.68}`, role: 'img', 'aria-label': `${o.title}: ${o.valueText}`, class: 'viz-art' });
  let from = o.min;
  for (const z of o.zones) {
    const a0 = gaugeAngle(from, o.min, o.max);
    const a1 = gaugeAngle(z.to, o.min, o.max);
    if (a1 > a0) art.append(svg('path', { d: arcPath(cx, cy, r, a0, a1 - 0.6), class: 'viz-zone', stroke: toneColor(z.tone), 'stroke-width': w * 0.07, fill: 'none' }));
    from = z.to;
  }
  // tick labels at both ends
  const [lx, ly] = polar(cx, cy, r + w * 0.07, -90);
  const [rx, ry] = polar(cx, cy, r + w * 0.07, 90);
  art.append(svg('text', { x: lx, y: ly + 14, class: 'viz-tick', 'text-anchor': 'middle' }, String(o.min)), svg('text', { x: rx, y: ry + 14, class: 'viz-tick', 'text-anchor': 'middle' }, String(o.max)));
  if (o.value != null && Number.isFinite(o.value)) {
    const [nx, ny] = polar(cx, cy, r * 0.86, gaugeAngle(o.value, o.min, o.max));
    art.append(svg('line', { x1: cx, y1: cy, x2: nx, y2: ny, class: 'viz-needle' }), svg('circle', { cx, cy, r: w * 0.03, class: 'viz-hub' }));
  }
  art.append(svg('text', { x: cx, y: cy - r * 0.32, class: 'viz-reading', 'text-anchor': 'middle' }, o.valueText));
  return figure('viz-gauge', h('div', {}, h('div', { class: 'viz-title' }, o.title), art), o.caption, o.title);
}

/** A progress ring for a share (0..1): margins, ownership, odds. */
export function ring(o: { share: number | null; valueText: string; title: string; tone?: Tone; caption?: Node | string; size?: number }) {
  const w = o.size ?? 96;
  const r = w * 0.38;
  const c = 2 * Math.PI * r;
  const share = o.share == null || !Number.isFinite(o.share) ? 0 : clamp(o.share, 0, 1);
  const art = svg(
    'svg',
    { viewBox: `0 0 ${w} ${w}`, role: 'img', 'aria-label': `${o.title}: ${o.valueText}`, class: 'viz-art' },
    svg('circle', { cx: w / 2, cy: w / 2, r, class: 'viz-ring-bg', 'stroke-width': w * 0.1, fill: 'none' }),
    svg('circle', {
      cx: w / 2, cy: w / 2, r, fill: 'none', stroke: toneColor(o.tone ?? 'accent'), 'stroke-width': w * 0.1, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * share).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${w / 2} ${w / 2})`, class: 'viz-ring-fg',
    }),
    svg('text', { x: w / 2, y: w / 2 + 5, class: 'viz-ring-text', 'text-anchor': 'middle' }, o.valueText),
  );
  return figure('viz-ring', h('div', {}, art, h('div', { class: 'viz-title' }, o.title)), o.caption, o.title);
}

/** A range track (52-week range, analyst targets, fair-value band) with the value marked and labelled ends. */
export function rangeTrack(o: { low: number; high: number; value: number | null; format: (v: number) => string; title: string; marks?: { value: number; label: string }[]; caption?: Node | string }) {
  const pos = o.value == null ? null : trackPos(o.value, o.low, o.high);
  const track = h(
    'div',
    { class: 'viz-track', role: 'img', 'aria-label': `${o.title}: ${o.value == null ? 'no value' : o.format(o.value)} between ${o.format(o.low)} and ${o.format(o.high)}` },
    h('div', { class: 'viz-track-bar' }),
    ...(o.marks ?? []).map((m) => h('span', { class: 'viz-track-mark', style: `left:${(trackPos(m.value, o.low, o.high) * 100).toFixed(1)}%`, title: `${m.label}: ${o.format(m.value)}` })),
    pos == null ? '' : h('span', { class: 'viz-track-dot', style: `left:${(pos * 100).toFixed(1)}%` }, h('b', {}, o.format(o.value!))),
  );
  return figure('viz-range', h('div', {}, h('div', { class: 'viz-title' }, o.title), track, h('div', { class: 'viz-track-ends' }, h('span', {}, o.format(o.low)), h('span', {}, o.format(o.high)))), o.caption, o.title);
}

/** The "flower": one centre with curved flows to each item, thicker for bigger values (regions, segments, holders). */
export function flower(o: { centre: string; items: { label: string; value: number; tone?: Tone; title?: string }[]; title: string; format: (v: number) => string; caption?: Node | string; size?: number }) {
  const w = o.size ?? 300;
  const c = w / 2;
  const items = o.items.filter((i) => i.value > 0).slice(0, 12);
  const biggest = Math.max(0, ...items.map((i) => i.value));
  const pts = petalPoints(items.length, c, c, w * 0.36);
  const art = svg('svg', { viewBox: `0 0 ${w} ${w}`, role: 'img', 'aria-label': o.title, class: 'viz-art' });
  art.append(svg('circle', { cx: c, cy: c, r: w * 0.36, class: 'viz-orbit', fill: 'none' }), svg('circle', { cx: c, cy: c, r: w * 0.2, class: 'viz-orbit', fill: 'none' }));
  items.forEach((it, i) => {
    const [x, y] = pts[i];
    // a gentle curve: the control point is pulled sideways from the straight line
    const mx = (c + x) / 2 + (y - c) * 0.18;
    const my = (c + y) / 2 - (x - c) * 0.18;
    const path = svg('path', { d: `M ${c} ${c} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`, fill: 'none', stroke: toneColor(it.tone ?? (i % 2 ? 'accent' : 'copper')), 'stroke-width': flowWidth(it.value, biggest).toFixed(2), class: 'viz-flow' });
    path.append(svg('title', {}, `${it.title ?? it.label}: ${o.format(it.value)}`));
    art.append(path);
  });
  items.forEach((it, i) => {
    const [x, y] = pts[i];
    const right = x >= c - 1;
    art.append(
      svg('rect', { x: x - 5, y: y - 5, width: 10, height: 10, class: 'viz-node' }),
      svg('text', { x: x + (right ? 9 : -9), y: y - 7, class: 'viz-node-label', 'text-anchor': Math.abs(x - c) < 4 ? 'middle' : right ? 'start' : 'end' }, it.label),
      svg('text', { x: x + (right ? 9 : -9), y: y + 9, class: 'viz-node-value', 'text-anchor': Math.abs(x - c) < 4 ? 'middle' : right ? 'start' : 'end' }, o.format(it.value)),
    );
  });
  art.append(svg('rect', { x: c - 26, y: c - 13, width: 52, height: 26, class: 'viz-centre' }), svg('text', { x: c, y: c + 5, class: 'viz-centre-text', 'text-anchor': 'middle' }, o.centre));
  return figure('viz-flower', h('div', {}, h('div', { class: 'viz-title' }, o.title), art), o.caption, o.title);
}

/** A heat grid: one tile per item, green or red by sign, stronger for bigger moves (sectors, watchlist, factors). */
export function heatGrid(o: { items: { label: string; value: number | null; sub?: string; title?: string; onClick?: () => void }[]; format: (v: number) => string; title: string; caption?: Node | string }) {
  const maxAbs = Math.max(0, ...o.items.map((i) => Math.abs(i.value ?? 0)));
  const grid = h(
    'div',
    { class: 'viz-heat', role: 'list' },
    ...o.items.map((i) => {
      const share = i.value == null ? 0 : heatShare(i.value, maxAbs);
      const tone = i.value == null ? 'var(--raised)' : `color-mix(in srgb, ${i.value >= 0 ? 'var(--up-fill)' : 'var(--down-fill)'} ${share}%, var(--surface))`;
      return h(
        i.onClick ? 'button' : 'div',
        { class: 'viz-heat-tile', role: 'listitem', style: `background:${tone}`, title: i.title ?? '', ...(i.onClick ? { onclick: i.onClick, type: 'button' } : {}) },
        h('b', {}, i.label),
        h('span', {}, i.value == null ? '—' : o.format(i.value)),
        i.sub ? h('small', {}, i.sub) : '',
      );
    }),
  );
  return figure('viz-heatgrid', h('div', {}, h('div', { class: 'viz-title' }, o.title), grid), o.caption, o.title);
}
