/** Print-quality SVG charts for client reports (light background, thin lines, no clutter). */

const NS = 'http://www.w3.org/2000/svg';

function svg(w: number, hgt: number) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  el.setAttribute('class', 'rpt-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text != null) node.textContent = text;
    el.append(node);
    return node;
  };
  return { el, add };
}

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

const shortMoney = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

/** Line chart over dates: `series` share the x-axis (ISO date strings). */
export function lineSvg(series: { name: string; color: string; width?: number; dash?: string; points: { time: string; value: number }[] }[], opts: { money?: boolean; percent?: boolean; height?: number; fill?: boolean; width?: number } = {}) {
  const W = opts.width ?? 700;
  const H = opts.height ?? 260;
  const pad = { l: 58, r: 12, t: 10, b: 26 };
  const all = series.flatMap((s) => s.points);
  const t = (p: { time: string }) => Date.parse(`${p.time}T00:00:00Z`);
  const t0 = Math.min(...all.map(t));
  const t1 = Math.max(...all.map(t));
  let lo = Math.min(...all.map((p) => p.value));
  let hi = Math.max(...all.map((p) => p.value));
  if (opts.percent) hi = Math.max(hi, 0);
  const step = niceStep(hi - lo || Math.abs(hi) || 1, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (v: number) => pad.l + ((v - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const { el, add } = svg(W, H);
  for (let v = lo; v <= hi + step / 2; v += step) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: Math.abs(v) < 1e-9 && opts.percent ? 'rpt-axis' : 'rpt-grid' });
    add('text', { x: pad.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'rpt-tick' }, opts.money ? shortMoney(v) : opts.percent ? `${Math.round(v * 100)}%` : v.toFixed(0));
  }
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const every = Math.max(1, Math.ceil((y1 - y0 + 1) / 10));
  for (let y = y0 + 1; y <= y1; y += every) {
    const x = X(Date.UTC(y, 0, 1));
    if (x > pad.l + 10 && x < W - pad.r - 10) add('text', { x, y: H - 8, 'text-anchor': 'middle', class: 'rpt-tick' }, String(y));
  }
  series.forEach((s, i) => {
    const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${X(t(p)).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
    if (opts.fill && i === 0) add('path', { d: `${d}L${X(t(s.points[s.points.length - 1])).toFixed(1)},${Y(opts.percent ? 0 : lo)}L${X(t(s.points[0])).toFixed(1)},${Y(opts.percent ? 0 : lo)}Z`, fill: s.color, opacity: 0.08 });
    add('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 1.6, 'stroke-dasharray': s.dash ?? '', 'stroke-linejoin': 'round' });
  });
  return el;
}

/** Donut chart for allocations. */
export function donutSvg(slices: { label: string; value: number; color: string }[], centre: { top: string; bottom: string }) {
  const S = 220;
  const r = 96;
  const inner = 68;
  const { el, add } = svg(S, S);
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  let angle = -Math.PI / 2;
  for (const s of slices) {
    const sweep = (s.value / total) * Math.PI * 2;
    if (sweep >= Math.PI * 2 - 1e-6) {
      add('circle', { cx: S / 2, cy: S / 2, r: (r + inner) / 2, fill: 'none', stroke: s.color, 'stroke-width': r - inner });
      break;
    }
    const a2 = angle + sweep;
    const p = (a: number, rad: number) => `${S / 2 + rad * Math.cos(a)},${S / 2 + rad * Math.sin(a)}`;
    const large = sweep > Math.PI ? 1 : 0;
    add('path', { d: `M${p(angle, r)}A${r},${r} 0 ${large} 1 ${p(a2, r)}L${p(a2, inner)}A${inner},${inner} 0 ${large} 0 ${p(angle, inner)}Z`, fill: s.color, stroke: '#fff', 'stroke-width': 1.5 });
    angle = a2;
  }
  add('text', { x: S / 2, y: S / 2 - 2, 'text-anchor': 'middle', class: 'rpt-donut-top' }, centre.top);
  add('text', { x: S / 2, y: S / 2 + 16, 'text-anchor': 'middle', class: 'rpt-tick' }, centre.bottom);
  return el;
}

/** Paired vertical bars per category (e.g. calendar-year returns, portfolio vs benchmark). */
export function barsSvg(categories: string[], series: { name: string; color: string; values: (number | null)[] }[], opts: { height?: number } = {}) {
  const W = 700;
  const H = opts.height ?? 220;
  const pad = { l: 46, r: 8, t: 14, b: 24 };
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  const step = niceStep(hi - lo || 0.1, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const Y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const { el, add } = svg(W, H);
  for (let v = lo; v <= hi + step / 2; v += step) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: Math.abs(v) < 1e-9 ? 'rpt-axis' : 'rpt-grid' });
    add('text', { x: pad.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'rpt-tick' }, `${Math.round(v * 100)}%`);
  }
  const band = (W - pad.l - pad.r) / Math.max(1, categories.length);
  const bw = Math.min(16, (band * 0.7) / series.length);
  categories.forEach((c, i) => {
    const cx = pad.l + band * (i + 0.5);
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v == null) return;
      const x = cx - (bw * series.length) / 2 + k * bw;
      add('rect', { x: x + 0.5, y: Math.min(Y(v), Y(0)), width: bw - 1, height: Math.max(0.5, Math.abs(Y(v) - Y(0))), fill: s.color });
    });
    add('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'rpt-tick' }, c);
  });
  return el;
}

/** Mixes two hex colours: t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number) {
  const p = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
