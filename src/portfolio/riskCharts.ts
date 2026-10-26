/**
 * The risk card's drill-downs: the daily P/L histogram (bad-day line marked), account vs SPY daily returns with the
 * fitted beta line, and the drawdown curve. Each opens in a window. Maths in ./risk.ts (histogram, fitLine,
 * drawdownCurve); colours come from CSS classes (theme variables), so light and dark both work.
 */
import { createLineChart } from '../ui/charts';
import { h, openModal } from '../ui/dom';
import { THEME } from '../ui/theme';
import { drawdownCurve, fitLine, histogram, type RiskReport } from './risk';

const NS = 'http://www.w3.org/2000/svg';
const pctS = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`;
const usd = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;

function svgFrame(W: number, H: number, label: string) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg rc-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string, parent: Element = svg) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  };
  return { svg, add };
}

/** Round tick steps for a % axis. */
function ticks(lo: number, hi: number, max = 6) {
  const step = [0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2].find((s) => (hi - lo) / s <= max) ?? 0.5;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
  return out;
}

function tipBox(wrap: HTMLElement) {
  type Part = Node | string;
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrap.append(tip);
  return {
    show(html: Part[], x: number, y: number) {
      tip.replaceChildren(...html);
      tip.hidden = false;
      const r = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(0, x - r.left + 12), r.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.max(0, y - r.top - tip.offsetHeight - 10)}px`;
    },
    hide: () => (tip.hidden = true),
  };
}

/** Daily P/L histogram: one bar per return band, bands at or beyond the 1-in-20 bad day in the loss colour. */
export function pnlHistogram(returns: number[], var95: number, measured: number) {
  const bins = histogram(returns);
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 12, t: 26, b: 34 };
  const x0 = bins[0].x0;
  const x1 = bins[bins.length - 1].x1;
  const ymax = Math.max(...bins.map((b) => b.count));
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / ymax) * (H - pad.t - pad.b);
  const { svg, add } = svgFrame(W, H, `Histogram of ${returns.length} daily returns; the 1-in-20 bad day is ${pctS(-var95)}`);
  for (const t of ticks(0, ymax / 100, 4).map((v) => Math.round(v * 100))) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'curve-label' }, String(t));
  }
  for (const t of ticks(x0, x1, 7)) add('text', { x: X(t), y: H - 16, 'text-anchor': 'middle', class: 'curve-label' }, pctS(t, Math.abs(t) < 0.01 && t !== 0 ? 1 : 0));
  add('text', { x: (W + pad.l) / 2, y: H - 2, 'text-anchor': 'middle', class: 'curve-label' }, 'Daily change of the account');
  const mid = (pad.t + H - pad.b) / 2;
  add('text', { x: 12, y: mid, 'text-anchor': 'middle', class: 'curve-label', transform: `rotate(-90 12 ${mid})` }, 'Days');
  const cut = -var95;
  const gap = 2;
  const bars = bins.map((b) => {
    const w = Math.max(1, X(b.x1) - X(b.x0) - gap);
    const top = Y(b.count);
    const bottom = Y(0);
    const r = Math.min(4, w / 2, bottom - top);
    // rounded data end at the top, square at the baseline
    const x = X(b.x0) + gap / 2;
    const d = b.count
      ? `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`
      : '';
    const el = add('path', { d, class: `rc-bar${b.x1 <= cut + 1e-12 ? ' tail' : ''}` });
    return { b, el };
  });
  add('line', { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0), class: 'rc-axis' });
  add('line', { x1: X(cut), x2: X(cut), y1: pad.t - 6, y2: Y(0), class: 'rc-cut' });
  const right = X(cut) < W / 2; // label on the roomier side of the line
  add('text', { x: X(cut) + (right ? 6 : -6), y: pad.t - 10, 'text-anchor': right ? 'start' : 'end', class: 'curve-label strong' }, `1 in 20 days: ${pctS(cut)}${measured ? ` (${usd(cut * measured)})` : ''}`);
  const wrap = h('div', { class: 'rc-wrap' }, svg);
  const tip = tipBox(wrap);
  // hit targets: the full column height of each band (bigger than the bar)
  bars.forEach(({ b, el }) => {
    const hit = add('rect', { x: X(b.x0), y: pad.t, width: X(b.x1) - X(b.x0), height: Y(0) - pad.t, class: 'rc-hit' });
    hit.addEventListener('pointermove', (e) => {
      bars.forEach((x) => x.el.classList.toggle('dim', x.el !== el));
      const ev = e as PointerEvent;
      tip.show(
        [
          h('div', { class: 'chart-tip-date' }, `${pctS(b.x0, 2)} to ${pctS(b.x1, 2)}`),
          h('div', {}, h('b', {}, `${b.count} day${b.count === 1 ? '' : 's'}`), ` of ${returns.length}`),
          measured ? h('div', { class: 'muted' }, `${usd(b.x0 * measured)} to ${usd(b.x1 * measured)} today`) : '',
        ],
        ev.clientX,
        ev.clientY,
      );
    });
  });
  svg.addEventListener('pointerleave', () => (bars.forEach((x) => x.el.classList.remove('dim')), tip.hide()));
  return { el: wrap, bins };
}

/** Account vs SPY daily returns, one dot per day, with the fitted line (its slope is the beta). */
export function betaScatter(dates: string[], account: number[], spy: number[]) {
  const fit = fitLine(spy, account);
  const W = 520;
  const H = 400;
  const pad = { l: 50, r: 14, t: 14, b: 38 };
  const lim = (v: number[]) => [Math.min(...v), Math.max(...v)];
  const [ax0, ax1] = lim(spy);
  const [ay0, ay1] = lim(account);
  const padX = (ax1 - ax0) * 0.06 || 0.01;
  const padY = (ay1 - ay0) * 0.06 || 0.01;
  const x0 = ax0 - padX;
  const x1 = ax1 + padX;
  const y0 = ay0 - padY;
  const y1 = ay1 + padY;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  const { svg, add } = svgFrame(W, H, `Daily returns of the account against SPY; fitted beta ${fit ? fit.slope.toFixed(2) : 'n/a'}`);
  for (const t of ticks(y0, y1)) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'rc-axis' : 'curve-grid' });
    add('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'curve-label' }, pctS(t, 0));
  }
  for (const t of ticks(x0, x1)) {
    if (t === 0) add('line', { x1: X(0), x2: X(0), y1: pad.t, y2: H - pad.b, class: 'rc-axis' });
    add('text', { x: X(t), y: H - 20, 'text-anchor': 'middle', class: 'curve-label' }, pctS(t, 0));
  }
  add('text', { x: (W + pad.l) / 2, y: H - 3, 'text-anchor': 'middle', class: 'curve-label' }, 'SPY that day');
  add('text', { x: 12, y: (H - pad.b) / 2, 'text-anchor': 'middle', class: 'curve-label', transform: `rotate(-90 12 ${(H - pad.b) / 2})` }, 'Your account that day');
  const dots = spy.map((s, i) => add('circle', { cx: X(s), cy: Y(account[i]), r: 3.5, class: 'rc-dot' }));
  if (fit) {
    add('line', { x1: X(x0), x2: X(x1), y1: Y(fit.intercept + fit.slope * x0), y2: Y(fit.intercept + fit.slope * x1), class: 'rc-fit' });
    const lx = x1 - (x1 - x0) * 0.02;
    add('text', { x: X(lx), y: Y(fit.intercept + fit.slope * lx) - 8, 'text-anchor': 'end', class: 'curve-label strong' }, `beta ${fit.slope.toFixed(2)}`);
  }
  const ring = add('circle', { r: 6, class: 'rc-ring', visibility: 'hidden' });
  const wrap = h('div', { class: 'rc-wrap' }, svg);
  const tip = tipBox(wrap);
  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    let best = -1;
    let dist = Infinity;
    spy.forEach((s, i) => {
      const d = (X(s) - px) ** 2 + (Y(account[i]) - py) ** 2;
      if (d < dist) (dist = d), (best = i);
    });
    if (best < 0 || dist > 30 ** 2) return (ring.setAttribute('visibility', 'hidden'), tip.hide());
    ring.setAttribute('cx', dots[best].getAttribute('cx')!);
    ring.setAttribute('cy', dots[best].getAttribute('cy')!);
    ring.setAttribute('visibility', 'visible');
    tip.show([h('div', { class: 'chart-tip-date' }, dates[best]), h('div', {}, `SPY ${pctS(spy[best], 2)}`), h('div', {}, h('b', {}, `Account ${pctS(account[best], 2)}`))], e.clientX, e.clientY);
  });
  svg.addEventListener('pointerleave', () => (ring.setAttribute('visibility', 'hidden'), tip.hide()));
  return { el: wrap, fit };
}

const needsUpdate = () => h('p', { class: 'ap-error' }, 'This chart needs the updated helper (version 32). Use the update banner at the top, then reload.');

function numbersTable(head: string[], rows: string[][]) {
  return h(
    'details',
    { class: 'rc-table' },
    h('summary', { class: 'muted small' }, 'Show the numbers'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h('td', { class: i ? 'num' : '' }, c))))))),
  );
}

/** Opens a drill-down window for one of the risk card's figures. */
export function openRiskDrill(kind: 'var' | 'beta' | 'drawdown', report: RiskReport) {
  const s = report.stats;
  const sr = report.series;
  if (!s) return;
  const period = `${s.start} to ${s.end}`;
  if (kind === 'var') {
    const body = h('div', { class: 'rc-body' });
    if (!sr?.account.length) body.append(needsUpdate());
    else {
      const chart = pnlHistogram(sr.account, s.var95, s.measured);
      const worse = sr.account.filter((r) => r <= -s.var95).length;
      body.append(
        h('p', {}, `Each bar counts the days the account moved by that much, ${period}, as if today’s holdings were held all year. Days at or past the line (${worse} of ${sr.account.length}) are the worst 1 in 20: on such a day you could lose about ${pctS(-s.var95)} (${usd(-s.var95 * s.measured)}).`),
        chart.el,
        numbersTable(['Daily change', 'Days', 'In dollars today'], chart.bins.filter((b) => b.count).map((b) => [`${pctS(b.x0, 2)} to ${pctS(b.x1, 2)}`, String(b.count), `${usd(b.x0 * s.measured)} to ${usd(b.x1 * s.measured)}`])),
      );
    }
    openModal('Bad days: daily profit and loss', body, { wide: true, noAutofocus: true });
  } else if (kind === 'beta') {
    const body = h('div', { class: 'rc-body' });
    if (!sr?.account.length) body.append(needsUpdate());
    else {
      const chart = betaScatter(sr.dates, sr.account, sr.spy);
      const f = chart.fit;
      body.append(
        h('p', {}, `One dot per trading day, ${period}: how SPY moved (across) and how your account moved (up). The line is the best fit; its slope is the beta${f ? ` (${f.slope.toFixed(2)}: when SPY moves 1%, the account moved about ${f.slope.toFixed(2)}%). SPY explains about ${Math.round(f.r2 * 100)}% of the account’s daily moves` : ''}.`),
        chart.el,
        f ? numbersTable(['Fit', 'Value'], [['Beta (slope)', f.slope.toFixed(3)], ['Daily extra return (intercept)', pctS(f.intercept, 3)], ['R² (share explained by SPY)', f.r2.toFixed(2)], ['Days', String(sr.account.length)]]) : '',
      );
    }
    openModal('Beta: your account vs SPY', body, { wide: true, noAutofocus: true });
  } else {
    const body = h('div', { class: 'rc-body' });
    if (!sr?.account.length) body.append(needsUpdate());
    else {
      const dd = drawdownCurve(sr.account);
      const holder = h('div', { class: 'rc-line' });
      body.append(h('p', {}, `How far the account was below its highest point so far, each day, ${period}. The deepest point was ${pctS(s.maxDrawdown)} (high ${s.peak}, low ${s.trough}).`), holder);
      requestAnimationFrame(() => {
        const c = createLineChart(holder, { height: 280, format: (v) => `${v.toFixed(1)}%`, title: 'Drawdown', expand: false });
        c.set([{ name: 'Below the high', color: THEME.down, data: sr.dates.map((d, i) => ({ time: d, value: dd[i] * 100 })) }]);
      });
    }
    openModal('Drawdown: distance below the high', body, { wide: true, noAutofocus: true });
  }
}
