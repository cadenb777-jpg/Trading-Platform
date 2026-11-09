/**
 * "Sales and profit, year by year" on Research: one small bar chart per measure (revenue, net income, free cash flow),
 * each on its own scale, so profit isn't squashed flat under revenue. Each has its latest figure, a plain-English line
 * ("up 6.4% a year over 4 years · grew in 3 of 4 years") and a hover readout per bar. Bars are one calm colour; a loss
 * year is red (bad). The sentence maths is pure and tested.
 */
import { money } from '../ui/charts';
import { h } from '../ui/dom';

const SVG = 'http://www.w3.org/2000/svg';

export interface YearPoint {
  /** "FY2025" */
  label: string;
  value: number | null;
}

/** The plain-English read of a series of yearly values. */
export function yearSentence(points: YearPoint[]): string {
  const known = points.filter((p): p is YearPoint & { value: number } => p.value != null && Number.isFinite(p.value));
  if (!known.length) return 'No yearly figures in the filings.';
  const last = known[known.length - 1];
  if (known.length === 1) return `${last.label} is the only year reported so far.`;
  const first = known[0];
  const years = points.indexOf(last) - points.indexOf(first); // calendar span, also when a year in between is missing
  const steps = known.length - 1;
  const parts: string[] = [];
  if (last.value < 0) parts.push(`a loss in ${last.label}`);
  else if (first.value <= 0) parts.push(`${first.value < 0 ? 'a loss' : 'zero'} in ${first.label}, positive now`);
  else {
    const rate = (last.value / first.value) ** (1 / years) - 1;
    const word = rate >= 0 ? 'up' : 'down';
    parts.push(`${word} ${(Math.abs(rate) * 100).toFixed(1)}% a year over ${years} year${years === 1 ? '' : 's'}`);
  }
  let rises = 0;
  for (let i = 1; i < known.length; i++) if (known[i].value > known[i - 1].value) rises++;
  parts.push(`grew in ${rises} of ${steps} year${steps === 1 ? '' : 's'}`);
  return parts.join(' · ').replace(/^./, (c) => c.toUpperCase());
}

/** One measure's card: name, latest figure, sentence, bars with a hover readout. */
function measureCard(title: string, hint: string, points: YearPoint[]): HTMLElement {
  const known = points.filter((p) => p.value != null && Number.isFinite(p.value));
  const last = known[known.length - 1];
  const readout = h('div', { class: 'yb-readout muted small' }, last ? `${last.label}: ${money(last.value)}` : '');
  const W = 300;
  const H = 120;
  const top = 6;
  const base = 18; // room for the year labels
  const vals = known.map((p) => p.value as number);
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (H - top - base);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'yb-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title} by year: ${known.map((p) => `${p.label} ${money(p.value)}`).join(', ')}`);
  const n = points.length || 1;
  const slot = W / n;
  const barW = Math.min(36, slot * 0.6);
  const zero = y(0);
  const line = document.createElementNS(SVG, 'line');
  for (const [k, v] of Object.entries({ x1: 0, x2: W, y1: zero, y2: zero, class: 'yb-zero' })) line.setAttribute(k, String(v));
  svg.append(line);
  const every = n > 6 ? 2 : 1;
  points.forEach((p, i) => {
    const cx = slot * i + slot / 2;
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'yb-col');
    if (p.value != null && Number.isFinite(p.value)) {
      const v = p.value;
      const r = document.createElementNS(SVG, 'rect');
      const y0 = Math.min(y(v), zero);
      const hgt = Math.max(1, Math.abs(zero - y(v)));
      for (const [k, val] of Object.entries({ x: cx - barW / 2, y: y0, width: barW, height: hgt, rx: 3 })) r.setAttribute(k, String(val));
      r.setAttribute('class', `yb-bar${v < 0 ? ' loss' : ''}${p === last ? ' latest' : ''}`);
      g.append(r);
    }
    // a hit target the full height of the column, bigger than the bar
    const hit = document.createElementNS(SVG, 'rect');
    for (const [k, val] of Object.entries({ x: slot * i, y: 0, width: slot, height: H - base, class: 'yb-hit' })) hit.setAttribute(k, String(val));
    const show = () => (readout.textContent = `${p.label}: ${p.value == null ? 'not reported' : money(p.value)}`);
    hit.addEventListener('pointerenter', show);
    g.append(hit);
    if (i % every === (n - 1) % every) {
      const t = document.createElementNS(SVG, 'text');
      for (const [k, val] of Object.entries({ x: cx, y: H - 4, class: 'yb-year' })) t.setAttribute(k, String(val));
      t.textContent = p.label.replace(/^FY/, '');
      g.append(t);
    }
    svg.append(g);
  });
  svg.addEventListener('pointerleave', () => (readout.textContent = last ? `${last.label}: ${money(last.value)}` : ''));
  return h(
    'div',
    { class: 'yb-card' },
    h('div', { class: 'yb-head' }, h('span', { class: 'yb-title', title: hint }, title), h('b', { class: `yb-value${last && (last.value as number) < 0 ? ' down' : ''}` }, last ? money(last.value) : '—')),
    h('p', { class: 'yb-sentence small' }, yearSentence(points)),
    svg,
    readout,
  );
}

/** The three cards side by side (stacked on a phone). */
export function yearBars(labels: string[], values: Record<string, (number | null)[]>): HTMLElement {
  const pts = (key: string) => labels.map((label, i) => ({ label, value: values[key]?.[i] ?? null }));
  return h(
    'div',
    { class: 'yb-grid' },
    measureCard('Revenue', 'Total sales in the fiscal year', pts('revenue')),
    measureCard('Net income', 'Profit after all costs and taxes', pts('netIncome')),
    measureCard('Free cash flow', 'Cash from operations minus spending on equipment and buildings', pts('freeCashFlow')),
  );
}
