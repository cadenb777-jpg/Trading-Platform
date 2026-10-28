/**
 * Optimiser charts: the efficient frontier (volatility vs expected return, with the current mix, every goal and the
 * chosen one) and risk-contribution bars (who drives the risk, now vs suggested). Colours: --viz-1 (chosen /
 * suggested) and --viz-2 (current), validated as a pair in light and dark; other goals are neutral.
 */
import { h } from '../ui/dom';

const NS = 'http://www.w3.org/2000/svg';
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export interface FrontierPoint {
  key: string;
  label: string;
  volatility: number;
  return: number;
  kind: 'current' | 'chosen' | 'goal';
}

/** Decimals for a tick label: one for half-percent steps, else none. */
export function tickDecimals(ticks: number[]): number {
  return ticks.some((v) => Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) ? 1 : 0;
}

/** Clean percent ticks covering lo..hi (at most about 5; half-percent steps when the range is narrow). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = Math.max(hi - lo, 1e-4);
  const step = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5].find((s) => span / s <= count) ?? 1;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+(Math.round(v / step) * step).toFixed(4));
  return out;
}

export function frontierChart(frontier: { volatility: number; return: number }[], points: FrontierPoint[], onPick?: (key: string) => void) {
  const W = 560;
  const H = 300;
  const pad = { l: 48, r: 16, t: 12, b: 40 };
  const xs = [...frontier.map((p) => p.volatility), ...points.map((p) => p.volatility)];
  const ys = [...frontier.map((p) => p.return), ...points.map((p) => p.return)];
  const padBy = (a: number[]) => Math.max((Math.max(...a) - Math.min(...a)) * 0.1, 0.004);
  const x0 = Math.max(0, Math.min(...xs) - padBy(xs));
  const x1 = Math.max(...xs) + padBy(xs);
  const y0 = Math.min(...ys) - padBy(ys);
  const y1 = Math.max(...ys) + padBy(ys);
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'opt-frontier-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Efficient frontier: expected return against volatility. ${points.map((p) => `${p.label} ${pct(p.volatility)} volatility, ${pct(p.return)} return`).join('; ')}.`);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string, parent: Element = svg) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text != null) el.textContent = text;
    parent.append(el);
    return el;
  };
  const yt = niceTicks(y0, y1);
  const xt = niceTicks(x0, x1);
  for (const v of yt) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'opt-grid' });
    add('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'opt-axis' }, pct(v, tickDecimals(yt)));
  }
  for (const v of xt) add('text', { x: X(v), y: H - 22, 'text-anchor': 'middle', class: 'opt-axis' }, pct(v, tickDecimals(xt)));
  add('text', { x: (W + pad.l) / 2, y: H - 4, 'text-anchor': 'middle', class: 'opt-axis' }, 'Volatility per year (risk)');
  add('text', { x: 12, y: (H - pad.b) / 2, 'text-anchor': 'middle', class: 'opt-axis', transform: `rotate(-90 12 ${(H - pad.b) / 2})` }, 'Expected return per year');
  if (frontier.length > 1) add('polyline', { points: frontier.map((p) => `${X(p.volatility)},${Y(p.return)}`).join(' '), class: 'opt-frontier-line' });

  const tip = h('div', { class: 'opt-chart-tip', role: 'status', hidden: true });
  const wrap = h('div', { class: 'opt-frontier' });
  const show = (p: FrontierPoint, cx: number, cy: number) => {
    tip.replaceChildren(h('b', {}, p.label), h('span', {}, `Volatility ${pct(p.volatility)}`), h('span', {}, `Expected return ${pct(p.return)}`), onPick && p.kind === 'goal' ? h('span', { class: 'muted' }, 'Click to show this goal') : '');
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const sx = box.width / W;
    tip.style.left = `${Math.min(cx * sx + 10, box.width - 170)}px`;
    tip.style.top = `${Math.max(cy * (box.height / H) - 60, 0)}px`;
  };
  const hide = () => (tip.hidden = true);
  // Neutral goals first, then current and chosen on top.
  const order = { goal: 0, current: 1, chosen: 2 } as const;
  for (const p of [...points].sort((a, b) => order[a.kind] - order[b.kind])) {
    const cx = X(p.volatility);
    const cy = Y(p.return);
    const g = add('g', { class: `opt-dot ${p.kind}`, tabindex: 0, role: 'button', 'aria-label': `${p.label}: volatility ${pct(p.volatility)}, expected return ${pct(p.return)}` });
    add('circle', { cx, cy, r: 12, class: 'opt-hit' }, undefined, g);
    add('circle', { cx, cy, r: p.kind === 'goal' ? 4.5 : p.kind === 'chosen' ? 6 : 5.5, class: 'opt-mark' }, undefined, g);
    if (p.kind !== 'goal') {
      const right = cx < W - 150;
      add('text', { x: right ? cx + 10 : cx - 10, y: cy + (p.kind === 'current' ? 16 : -9), 'text-anchor': right ? 'start' : 'end', class: 'opt-axis strong' }, p.label, g);
    }
    g.addEventListener('mouseenter', () => show(p, cx, cy));
    g.addEventListener('focus', () => show(p, cx, cy));
    g.addEventListener('mouseleave', hide);
    g.addEventListener('blur', hide);
    if (onPick && p.kind === 'goal') {
      g.addEventListener('click', () => onPick(p.key));
      g.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          onPick(p.key);
        }
      });
    }
  }
  const key = (cls: string, text: string) => h('span', {}, h('i', { class: `opt-key ${cls}`, 'aria-hidden': 'true' }), text);
  wrap.append(
    h('div', { class: 'opt-legend' }, key('line', 'Efficient frontier'), key('chosen', 'Shown goal'), key('current', 'Your current mix'), key('goal', 'Other goals')),
    h('div', { class: 'opt-frontier-plot' }, svg, tip),
  );
  return wrap;
}

/** Each holding's share of the risk now and after: two thin bars per holding, values at the tips. */
export function riskBars(rows: { label: string; now: number; next: number }[]) {
  const top = Math.max(0.01, ...rows.flatMap((r) => [r.now, r.next]));
  const bar = (v: number, cls: string, who: string) =>
    h('div', { class: 'opt-rbar-line' }, h('span', { class: `opt-rbar ${cls}`, style: `width:${Math.max(0, (100 * v) / top).toFixed(1)}%` }), h('span', { class: 'opt-rbar-val' }, `${who} ${pct(v, 0)}`));
  return h(
    'div',
    { class: 'opt-rbars' },
    h('div', { class: 'opt-legend' }, h('span', {}, h('i', { class: 'opt-key current', 'aria-hidden': 'true' }), 'Now'), h('span', {}, h('i', { class: 'opt-key chosen', 'aria-hidden': 'true' }), 'Suggested')),
    ...rows.map((r) => h('div', { class: 'opt-rbar-row' }, h('div', { class: 'opt-rbar-label' }, r.label), h('div', { class: 'opt-rbar-pair' }, bar(r.now, 'current', 'now'), bar(r.next, 'chosen', 'after')))),
  );
}
