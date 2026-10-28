/**
 * Small charts for the Prospecting page, drawn with theme variables so they follow light/dark:
 * columns for AUM over time (few dated points) and single-hue share bars (client mix, sector mix, compare cells).
 * Every mark has a hover/focus tooltip and the numbers are also in a table or label next to it.
 */
import { h } from '../ui/dom';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

/** Round numbers for a y axis from 0 to max (3-5 ticks). */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/**
 * Vertical columns, one per dated point (e.g. regulatory AUM per monthly adviser list). Missing values leave a gap
 * marked "n/r" (not reported) instead of a zero bar.
 */
export function columnChart(points: { label: string; value: number | null; tip: string }[], format: (v: number) => string, opts: { height?: number; name: string }) {
  const W = 520;
  const H = opts.height ?? 180;
  const pad = { l: 56, r: 8, t: 14, b: 26 };
  const values = points.map((p) => p.value ?? 0);
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks[ticks.length - 1] || 1;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(6, Math.min(56, slot * 0.6));
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pr-col-svg', role: 'img', 'aria-label': opts.name });
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'pr-grid' }));
    svg.append(svgEl('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'pr-axis' }, format(t)));
  }
  const tip = h('div', { class: 'pr-tip', role: 'status', hidden: true });
  const wrap = h('div', { class: 'pr-col-wrap' }, svg as unknown as Node, tip);
  points.forEach((p, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const g = svgEl('g', { class: 'pr-col', tabindex: 0, 'aria-label': p.tip });
    // the hit area is the whole slot, bigger than the bar
    g.append(svgEl('rect', { x: cx - slot / 2, y: pad.t, width: slot, height: innerH, class: 'pr-hit' }));
    if (p.value != null && p.value > 0) {
      const top = y(p.value);
      const height = pad.t + innerH - top;
      const r = Math.min(4, barW / 2, height);
      // rounded data end (top), square at the baseline
      g.append(svgEl('path', { d: `M${cx - barW / 2},${pad.t + innerH}V${top + r}q0,-${r} ${r},-${r}H${cx + barW / 2 - r}q${r},0 ${r},${r}V${pad.t + innerH}Z`, class: 'pr-bar' }));
    } else {
      g.append(svgEl('text', { x: cx, y: pad.t + innerH - 4, 'text-anchor': 'middle', class: 'pr-axis' }, p.value == null ? 'n/r' : '0'));
    }
    if (i === points.length - 1 && p.value != null) g.append(svgEl('text', { x: cx, y: y(p.value) - 4, 'text-anchor': 'middle', class: 'pr-axis strong' }, format(p.value)));
    g.append(svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'pr-axis' }, p.label));
    const show = () => {
      tip.textContent = p.tip;
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const left = (cx / W) * box.width;
      tip.style.left = `${Math.max(4, Math.min(box.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2))}px`;
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('mouseleave', () => (tip.hidden = true));
    g.addEventListener('blur', () => (tip.hidden = true));
    svg.append(g);
  });
  svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + innerH, y2: pad.t + innerH, class: 'pr-baseline' }));
  return wrap;
}

/** One horizontal share bar (0..1) with its value; used in lists and table cells. */
export function shareBar(value: number | null, text: string, tip: string) {
  const w = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return h('span', { class: 'pr-share', title: tip }, h('span', { class: 'pr-share-track' }, h('span', { class: 'pr-share-fill', style: `width:${w.toFixed(1)}%` })), h('span', { class: 'pr-share-val' }, text));
}

/** A labelled list of share bars (biggest first as given). */
export function shareList(rows: { label: string | Node; value: number | null; text: string; tip: string }[], name: string) {
  return h('div', { class: 'pr-share-list', role: 'list', 'aria-label': name }, ...rows.map((r) => h('div', { class: 'pr-share-row', role: 'listitem' }, h('span', { class: 'pr-share-label' }, r.label), shareBar(r.value, r.text, r.tip))));
}
