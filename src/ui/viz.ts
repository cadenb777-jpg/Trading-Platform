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
export function flower(o: { centre: string; items: { label: string; value: number; tone?: Tone; title?: string }[]; title: string; format: (v: number) => string; caption?: Node | string; size?: number; hideTitle?: boolean }) {
  const w = o.size ?? 300;
  const c = w / 2;
  const items = o.items.filter((i) => i.value > 0).slice(0, 12);
  const biggest = Math.max(0, ...items.map((i) => i.value));
  const pts = petalPoints(items.length, c, c, w * 0.34);
  // room either side for the labels, so none is cut off at the edge
  const pad = w * 0.22;
  const art = svg('svg', { viewBox: `${-pad} -4 ${w + 2 * pad} ${w + 8}`, role: 'img', 'aria-label': o.title, class: 'viz-art' });
  art.append(svg('circle', { cx: c, cy: c, r: w * 0.34, class: 'viz-orbit', fill: 'none' }), svg('circle', { cx: c, cy: c, r: w * 0.19, class: 'viz-orbit', fill: 'none' }));
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
  return figure('viz-flower', h('div', {}, o.hideTitle ? '' : h('div', { class: 'viz-title' }, o.title), art), o.caption, o.title);
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

// ---------- mix bar ----------

/** The biggest parts as they are, the rest folded into "Other" (pure, tested). Weights are shares of the total. */
export function mixSegments(items: { label: string; value: number }[], max = 5): { label: string; value: number; weight: number }[] {
  const pos = items.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const total = pos.reduce((s, x) => s + x.value, 0);
  if (!total) return [];
  const top = pos.length > max ? pos.slice(0, max - 1) : pos;
  const rest = pos.slice(top.length);
  const out = top.map((x) => ({ ...x }));
  if (rest.length) out.push({ label: 'Other', value: rest.reduce((s, x) => s + x.value, 0) });
  return out.map((x) => ({ ...x, weight: x.value / total }));
}

/** Calm categorical colours (the destination hues; green/red stay for good/bad). */
const MIX_COLORS = ['var(--hue-money)', 'var(--accent-2)', 'var(--hue-security)', 'var(--hue-markets)', 'var(--hue-ideas)', 'var(--line-strong)'];

/** One bar split into what the money is in, with a legend underneath (share and amount on hover). */
export function mixBar(o: { items: { label: string; value: number }[]; title: string; format: (v: number) => string; caption?: Node | string }) {
  const segs = mixSegments(o.items);
  const color = (i: number, label: string) => (label === 'Other' ? MIX_COLORS[5] : MIX_COLORS[i % 5]);
  const tip = (x: { label: string; value: number; weight: number }) => `${x.label}: ${(x.weight * 100).toFixed(1)}% (${o.format(x.value)})`;
  return h(
    'figure',
    { class: 'viz viz-mix' },
    h('figcaption', { class: 'viz-title' }, o.title),
    h('div', { class: 'mix-bar', role: 'img', 'aria-label': segs.map(tip).join('; ') }, ...segs.map((x, i) => h('span', { class: 'mix-seg', title: tip(x), style: `flex:${x.weight} 1 0;background:${color(i, x.label)}` }))),
    h(
      'ul',
      { class: 'mix-legend' },
      ...segs.map((x, i) => h('li', { title: tip(x) }, h('i', { style: `background:${color(i, x.label)}` }), h('span', {}, x.label), h('b', { class: 'num' }, `${Math.round(x.weight * 100)}%`))),
    ),
    o.caption ? h('p', { class: 'viz-caption' }, o.caption) : '',
  );
}

// ---------- sunburst ----------

/** SVG path of a ring slice between radii r0 < r1 from a0 to a1 degrees (pure, tested). */
export function ringSlice(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = Math.min(359.99, a1 - a0);
  const b = a0 + span;
  const [ox0, oy0] = polar(cx, cy, r1, a0);
  const [ox1, oy1] = polar(cx, cy, r1, b);
  const [ix1, iy1] = polar(cx, cy, r0, b);
  const [ix0, iy0] = polar(cx, cy, r0, a0);
  const large = span > 180 ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M ${f(ox0)} ${f(oy0)} A ${r1} ${r1} 0 ${large} 1 ${f(ox1)} ${f(oy1)} L ${f(ix1)} ${f(iy1)} A ${r0} ${r0} 0 ${large} 0 ${f(ix0)} ${f(iy0)} Z`;
}

/** Short ring labels for long group names (the full name is in the slice's hover). */
const SHORT: Record<string, string> = { Semiconductors: 'Chips', 'Hardware & IT services': 'Hardware', Communication: 'Comms', 'Health care': 'Health', 'Utilities, energy & materials': 'Utilities', 'Financials & real estate': 'Financials' };

export interface SunGroup {
  label: string;
  items: string[];
}

/** Equal-weight sunburst layout: every member gets the same angle, a group spans its members (pure, tested). */
export function sunburstLayout(groups: SunGroup[], gap = 0.6): { groups: { label: string; a0: number; a1: number }[]; items: { label: string; group: string; a0: number; a1: number }[] } {
  const n = groups.reduce((s, g) => s + g.items.length, 0);
  if (!n) return { groups: [], items: [] };
  const step = 360 / n;
  let a = 0;
  const outG: { label: string; a0: number; a1: number }[] = [];
  const outI: { label: string; group: string; a0: number; a1: number }[] = [];
  for (const g of groups) {
    if (!g.items.length) continue;
    const g0 = a;
    for (const it of g.items) {
      outI.push({ label: it, group: g.label, a0: a + gap / 2, a1: a + step - gap / 2 });
      a += step;
    }
    outG.push({ label: g.label, a0: g0 + gap / 2, a1: a - gap / 2 });
  }
  return { groups: outG, items: outI };
}

const heatFill = (v: number | null | undefined, maxAbs: number) =>
  v == null || !Number.isFinite(v) ? 'var(--raised)' : `color-mix(in srgb, ${v >= 0 ? 'var(--up-fill)' : 'var(--down-fill)'} ${heatShare(v, maxAbs)}%, var(--surface))`;

/**
 * A sunburst: groups on the inner ring, their members on the outer ring, each slice coloured green/red by its value
 * (deeper = bigger move, scaled to the biggest move shown). Equal weight per member. `update` recolours in place
 * (live quotes), so nothing is rebuilt while the page is open.
 */
export function sunburst(o: {
  groups: SunGroup[];
  title: string;
  centre: string;
  format: (v: number) => string;
  onItem?: (label: string) => void;
  onGroup?: (label: string) => void;
  caption?: Node | string;
  size?: number;
  hideTitle?: boolean;
}) {
  const S = o.size ?? 340;
  const c = S / 2;
  const R = c - 4;
  const r1 = R * 0.6;
  const r0 = R * 0.3;
  const lay = sunburstLayout(o.groups);
  const groupPaths = new Map<string, SVGElement>();
  const itemPaths = new Map<string, SVGElement>();
  const itemTitles = new Map<string, SVGElement>();
  const groupTitles = new Map<string, SVGElement>();
  const centreValue = svg('text', { x: c, y: c + 16, 'text-anchor': 'middle', class: 'sb-centre-value' }, '—');
  const art = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'sb-svg', role: 'img', 'aria-label': o.title });
  for (const g of lay.groups) {
    const t = svg('title', {}, g.label);
    const p = svg('path', { d: ringSlice(c, c, r0, r1 - 2, g.a0, g.a1), class: 'sb-group', fill: 'var(--raised)' }, t);
    if (o.onGroup) p.addEventListener('click', () => o.onGroup!(g.label));
    groupPaths.set(g.label, p);
    groupTitles.set(g.label, t);
    art.append(p);
    // label the bigger groups along the ring's middle
    if (g.a1 - g.a0 > 34) {
      const [x, y] = polar(c, c, (r0 + r1) / 2, (g.a0 + g.a1) / 2);
      art.append(svg('text', { x: x.toFixed(1), y: (y + 4).toFixed(1), 'text-anchor': 'middle', class: 'sb-group-label' }, SHORT[g.label] ?? g.label.split(/[ ,&]/)[0]));
    }
  }
  for (const it of lay.items) {
    const t = svg('title', {}, it.label);
    const p = svg('path', { d: ringSlice(c, c, r1, R, it.a0, it.a1), class: 'sb-item', fill: 'var(--raised)' }, t);
    if (o.onItem) p.addEventListener('click', () => o.onItem!(it.label));
    itemPaths.set(it.label, p);
    itemTitles.set(it.label, t);
    art.append(p);
    if (it.a1 - it.a0 > 6) {
      const mid = (it.a0 + it.a1) / 2;
      const [x, y] = polar(c, c, (r1 + R) / 2, mid);
      const rot = mid > 180 ? mid + 90 : mid - 90;
      art.append(svg('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'sb-item-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }, it.label));
    }
  }
  art.append(svg('text', { x: c, y: c - 6, 'text-anchor': 'middle', class: 'sb-centre-label' }, o.centre), centreValue);
  const el = figure('viz-sunburst', h('div', {}, o.hideTitle ? '' : h('div', { class: 'viz-title' }, o.title), art), o.caption, o.title);
  return {
    el,
    /** Recolours every slice from the members' values; groups and the centre show equal-weight averages. */
    update(value: (label: string) => number | null | undefined) {
      const vals = lay.items.map((it) => value(it.label));
      const maxAbs = Math.max(0.005, ...vals.map((v) => Math.abs(v ?? 0)));
      const sums = new Map<string, number[]>();
      lay.items.forEach((it, i) => {
        const v = vals[i];
        itemPaths.get(it.label)!.setAttribute('fill', heatFill(v, maxAbs));
        itemTitles.get(it.label)!.textContent = `${it.label} (${it.group}): ${v == null ? 'no price yet' : o.format(v)}`;
        if (v != null && Number.isFinite(v)) sums.set(it.group, [...(sums.get(it.group) ?? []), v]);
      });
      const all: number[] = [];
      for (const g of lay.groups) {
        const xs = sums.get(g.label) ?? [];
        all.push(...xs);
        const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        groupPaths.get(g.label)!.setAttribute('fill', heatFill(avg, maxAbs));
        groupTitles.get(g.label)!.textContent = `${g.label}: ${avg == null ? 'no prices yet' : `${o.format(avg)} on average`}`;
      }
      centreValue.textContent = all.length ? o.format(all.reduce((a, b) => a + b, 0) / all.length) : '—';
      centreValue.setAttribute('class', `sb-centre-value ${all.length ? (all.reduce((a, b) => a + b, 0) >= 0 ? 'up' : 'down') : ''}`);
    },
  };
}

// ---------- treemap (market map) ----------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk 2000): areas proportional to weight, rows chosen so blocks stay as
 * close to square as possible. Biggest first; zero or missing weights are left out (pure, tested).
 */
export function squarify<T extends { weight: number }>(items: T[], r: Rect): (T & Rect)[] {
  const list = items.filter((i) => Number.isFinite(i.weight) && i.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = list.reduce((s, i) => s + i.weight, 0);
  if (!total || r.w <= 0 || r.h <= 0) return [];
  const scale = (r.w * r.h) / total;
  const out: (T & Rect)[] = [];
  const free = { ...r };
  const worst = (areas: number[], side: number) => {
    const s = areas.reduce((a, b) => a + b, 0);
    const mx = Math.max(...areas);
    const mn = Math.min(...areas);
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = (row: T[]) => {
    const areas = row.map((i) => i.weight * scale);
    const s = areas.reduce((a, b) => a + b, 0);
    if (free.w >= free.h) {
      const w = free.h ? s / free.h : 0;
      let y = free.y;
      row.forEach((it, k) => {
        const hh = w ? areas[k] / w : 0;
        out.push({ ...it, x: free.x, y, w, h: hh });
        y += hh;
      });
      free.x += w;
      free.w -= w;
    } else {
      const hh = free.w ? s / free.w : 0;
      let x = free.x;
      row.forEach((it, k) => {
        const w = hh ? areas[k] / hh : 0;
        out.push({ ...it, x, y: free.y, w, h: hh });
        x += w;
      });
      free.y += hh;
      free.h -= hh;
    }
  };
  let row: T[] = [];
  for (const it of list) {
    const side = Math.min(free.w, free.h);
    const areas = row.map((i) => i.weight * scale);
    if (!row.length || worst([...areas, it.weight * scale], side) <= worst(areas, side)) row.push(it);
    else {
      place(row);
      row = [it];
    }
  }
  if (row.length) place(row);
  return out;
}

/** Tone scale of the market map: a 3% move (or more) is the deepest shade, so colours stay calm and comparable. */
const MAP_FULL = 0.03;

/**
 * A market map: one square-ish block per stock, area = market cap (equal when caps aren't known), grouped by sector,
 * coloured green/red by today's move. `update` recolours in place (live quotes); `setWeights` re-lays the blocks.
 */
export function treemap(o: {
  groups: SunGroup[];
  title: string;
  format: (v: number) => string;
  onItem?: (label: string) => void;
  caption?: Node | string;
  height?: number;
}) {
  const H = o.height ?? 360;
  const art = h('div', { class: 'tm-art', role: 'img', 'aria-label': o.title, style: `height:${H}px` });
  const el = figure('viz-treemap', art, o.caption, o.title);
  let weights: (label: string) => number | null | undefined = () => 1;
  let values: (label: string) => number | null | undefined = () => null;
  const cells = new Map<string, { el: HTMLElement; chg: HTMLElement; group: string }>();
  const heads = new Map<string, { el: HTMLElement; chg: HTMLElement }>();
  let lastW = 0;

  const groupWeight = (g: SunGroup) => g.items.reduce((s, it) => s + (weights(it) ?? 0), 0);

  function layout() {
    const W = art.clientWidth;
    if (!W) return;
    lastW = W;
    art.replaceChildren();
    cells.clear();
    heads.clear();
    const total = o.groups.reduce((s, g) => s + groupWeight(g), 0);
    const gl = squarify(o.groups.map((g) => ({ g, weight: groupWeight(g) })), { x: 0, y: 0, w: W, h: H });
    for (const { g, x, y, w, h: gh } of gl) {
      const head = gh > 44 && w > 56;
      const top = head ? 18 : 0;
      const box = h('div', { class: 'tm-group', style: `left:${x}px;top:${y}px;width:${w}px;height:${gh}px` });
      if (head) {
        const chg = h('span', { class: 'tm-head-chg' });
        const hd = h('div', { class: 'tm-head', title: g.label }, h('span', { class: 'tm-head-name' }, g.label), chg);
        heads.set(g.label, { el: hd, chg });
        box.append(hd);
      }
      const inner = squarify(g.items.map((label) => ({ label, weight: weights(label) ?? 0 })), { x: 1, y: top + 1, w: Math.max(0, w - 2), h: Math.max(0, gh - top - 2) });
      for (const it of inner) {
        const side = Math.min(it.w, it.h);
        const size = side < 22 || it.w < 30 ? 'tm-xs' : side < 34 || it.w < 46 ? 'tm-sm' : '';
        const font = Math.max(11, Math.min(20, Math.round(side / 4)));
        const chg = h('span', { class: 'tm-chg' });
        const share = total ? (100 * (weights(it.label) ?? 0)) / total : 0;
        const cell = h(
          'button',
          {
            type: 'button',
            class: `tm-cell ${size}`,
            style: `left:${it.x}px;top:${it.y}px;width:${Math.max(0, it.w - 1)}px;height:${Math.max(0, it.h - 1)}px;font-size:${font}px`,
            'data-share': share.toFixed(2),
            onclick: () => o.onItem?.(it.label),
          },
          h('span', { class: 'tm-sym' }, it.label),
          chg,
        );
        cells.set(it.label, { el: cell, chg, group: g.label });
        box.append(cell);
      }
      art.append(box);
    }
    paint();
  }

  function paint() {
    const sums = new Map<string, { wv: number; w: number }>();
    for (const [label, c] of cells) {
      const v = values(label);
      const ok = v != null && Number.isFinite(v);
      c.el.style.background = ok ? `color-mix(in srgb, ${v! >= 0 ? 'var(--up-fill)' : 'var(--down-fill)'} ${heatShare(v!, MAP_FULL)}%, var(--surface))` : 'var(--raised)';
      c.chg.textContent = ok ? o.format(v!) : '';
      c.el.title = `${label} (${c.group}): ${ok ? o.format(v!) : 'no price yet'} · ${c.el.dataset.share}% of the map by size`;
      if (ok) {
        const wt = weights(label) ?? 0;
        const s = sums.get(c.group) ?? { wv: 0, w: 0 };
        s.wv += wt * v!;
        s.w += wt;
        sums.set(c.group, s);
      }
    }
    for (const [label, hd] of heads) {
      const s = sums.get(label);
      const avg = s && s.w ? s.wv / s.w : null;
      hd.chg.textContent = avg == null ? '' : o.format(avg);
      hd.chg.className = `tm-head-chg ${avg == null ? '' : avg >= 0 ? 'up' : 'down'}`;
    }
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => art.clientWidth !== lastW && layout()).observe(art);
  queueMicrotask(layout);
  return {
    el,
    /** Recolours every block from the members' values; sector headers show the size-weighted average. */
    update(value: (label: string) => number | null | undefined) {
      values = value;
      paint();
    },
    /** Sets block sizes (market caps) and re-lays the map. */
    setWeights(weight: (label: string) => number | null | undefined) {
      weights = (l) => weight(l) ?? 0;
      layout();
    },
  };
}
