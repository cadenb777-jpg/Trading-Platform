/**
 * Small SVG charts for the quant pack: a football field (value ranges side by side with a price line) and a
 * percentile fan (Monte Carlo). Colours come from theme tokens through CSS classes (style.css, quant pack block).
 */
import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

/** The drawing width in SVG units: close to the real width, so 11-12px labels stay that size on a phone and a desktop. */
function chartWidth() {
  const w = typeof window === 'undefined' ? 900 : window.innerWidth || 900;
  return Math.max(340, Math.min(1000, w - (w < 720 ? 40 : 320)));
}

/** An axis label: whole numbers with thousands separators, small values with up to 2 decimals. */
const tick = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface RangeRow {
  label: string;
  low: number | null;
  mid?: number | null;
  high: number | null;
  /** 'own' for a range that isn't from peers (DCF, 52-week range): drawn in the second accent. */
  kind?: 'peer' | 'own';
  note?: string;
}

/** Horizontal value ranges with their mid marked and a vertical line at today's price. */
export function footballFieldSvg(rows: RangeRow[], price: number | null, fmt: (v: number) => string) {
  const usable = rows.filter((r) => r.low != null && r.high != null && Number.isFinite(r.low) && Number.isFinite(r.high));
  if (!usable.length) return h('p', { class: 'muted' }, 'Not enough figures to draw the value ranges.');
  const vals = usable.flatMap((r) => [r.low!, r.high!]).concat(price != null && Number.isFinite(price) ? [price] : []);
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const padV = (hi0 - lo0 || hi0 || 1) * 0.08;
  const lo = Math.max(0, lo0 - padV);
  const hi = hi0 + padV;
  const W = chartWidth();
  const rowH = 30;
  const pad = { l: W < 500 ? 96 : 128, r: 16, t: 10, b: 26 };
  const H = pad.t + pad.b + rowH * usable.length;
  const X = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'qp-svg', role: 'img', 'aria-label': 'Value ranges by method (football field)' });
  for (const t of niceTicks(lo, hi, W < 500 ? 3 : 5)) {
    svg.append(svgEl('line', { x1: X(t), x2: X(t), y1: pad.t, y2: H - pad.b, class: 'qp-grid' }));
    svg.append(svgEl('text', { x: X(t), y: H - 8, 'text-anchor': 'middle', class: 'qp-axis' }, tick(t)));
  }
  usable.forEach((r, i) => {
    const y = pad.t + i * rowH + 6;
    const g = svgEl('g', {});
    const title = svgEl('title', {}, `${r.label}: ${fmt(r.low!)} – ${fmt(r.high!)}${r.mid != null ? ` (middle ${fmt(r.mid)})` : ''}${r.note ? ` · ${r.note}` : ''}`);
    g.append(title);
    g.append(svgEl('text', { x: pad.l - 8, y: y + 13, 'text-anchor': 'end', class: 'qp-label' }, r.label));
    const x0 = X(r.low!);
    g.append(svgEl('rect', { x: x0, y, width: Math.max(2, X(r.high!) - x0), height: rowH - 12, rx: 3, class: r.kind === 'own' ? 'qp-bar own' : 'qp-bar' }));
    if (r.mid != null && Number.isFinite(r.mid)) g.append(svgEl('line', { x1: X(r.mid), x2: X(r.mid), y1: y - 2, y2: y + rowH - 10, class: 'qp-mid' }));
    svg.append(g);
  });
  if (price != null && Number.isFinite(price)) {
    svg.append(svgEl('line', { x1: X(price), x2: X(price), y1: pad.t - 4, y2: H - pad.b, class: 'qp-price' }));
    const right = X(price) > W * 0.7; // near the right edge the label goes on the left of the line
    svg.append(svgEl('text', { x: X(price) + (right ? -4 : 4), y: pad.t + 6, 'text-anchor': right ? 'end' : 'start', class: 'qp-axis strong' }, `Price ${fmt(price)}`));
  }
  return h('div', { class: 'qp-chart' }, svg);
}

/** Monte Carlo fan: 5-95% and 25-75% bands with the median line, by year. */
export function fanSvg(pct: Record<string, number[]>, fmt: (v: number) => string, start: number) {
  const p5 = pct['5'];
  const p25 = pct['25'];
  const p50 = pct['50'];
  const p75 = pct['75'];
  const p95 = pct['95'];
  const n = p50.length;
  const W = chartWidth();
  const H = 260;
  const pad = { l: 64, r: 16, t: 12, b: 28 };
  const lo = Math.min(...p5, start) * 0.95;
  const hi = Math.max(...p95) * 1.03;
  const X = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'qp-svg', role: 'img', 'aria-label': 'Monte Carlo fan chart of portfolio value' });
  for (const t of niceTicks(lo, hi)) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'qp-grid' }));
    svg.append(svgEl('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'qp-axis' }, fmt(t)));
  }
  for (let i = 0; i < n; i++) svg.append(svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: 'qp-axis' }, i === 0 ? 'Now' : `${i}y`));
  const band = (a: number[], b: number[], cls: string) =>
    svg.append(svgEl('polygon', { points: [...a.map((v, i) => `${X(i)},${Y(v)}`), ...b.map((v, i) => `${X(i)},${Y(v)}`).reverse()].join(' '), class: cls }));
  band(p5, p95, 'qp-band outer');
  band(p25, p75, 'qp-band inner');
  svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: Y(start), y2: Y(start), class: 'qp-start' }));
  svg.append(svgEl('polyline', { points: p50.map((v, i) => `${X(i)},${Y(v)}`).join(' '), class: 'qp-median' }));
  for (let i = 1; i < n; i++) {
    const hit = svgEl('rect', { x: X(i) - 12, y: pad.t, width: 24, height: H - pad.t - pad.b, class: 'qp-hit' });
    hit.append(svgEl('title', {}, `Year ${i}: median ${fmt(p50[i])} · middle half ${fmt(p25[i])} – ${fmt(p75[i])} · 90% of paths ${fmt(p5[i])} – ${fmt(p95[i])}`));
    svg.append(hit);
  }
  return h(
    'div',
    { class: 'qp-chart' },
    h('div', { class: 'line-legend static' }, h('span', {}, h('i', { class: 'qp-key median' }), 'Median'), h('span', {}, h('i', { class: 'qp-key inner' }), 'Middle half of outcomes'), h('span', {}, h('i', { class: 'qp-key outer' }), '90% of outcomes')),
    svg,
  );
}
