/**
 * Interactive chart tools shared by every page: a hover tooltip (date and value of each line), and chart windows
 * that float above the page. A window can be dragged by its title bar and resized from its corner, and the chart
 * inside zooms (scroll / pinch) and pans (drag), with range buttons, log and %-change scales, a stats bar for the
 * visible period, line toggles and a CSV download. Several windows can be open at once.
 */
import { ColorType, LineSeries, PriceScaleMode, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time } from 'lightweight-charts';
import { THEME, followTheme } from './theme';
import { h } from './dom';
import { indicatorMenu } from './windowIndicators';

export interface WindowLine {
  name: string;
  color: string;
  /** Points with dates as 'YYYY-MM-DD' or unix seconds. */
  data: { time: string | number; value: number }[];
  width?: 1 | 2 | 3;
}

export interface ChartWindowOptions {
  title: string;
  subtitle?: string;
  lines: WindowLine[];
  /** Formats a value for the axis, tooltip and stats (default: 2 decimals). */
  format?: (v: number) => string;
  /** Extra buttons in the title bar (e.g. "Open in chart"). */
  actions?: Node[];
  /** 'points' for rates and other values already in % (a change is "+0.25 pts", not a % of a %). */
  changeAs?: 'percent' | 'points';
  /** Open with the indicator menu showing (the ƒx button on page charts). */
  openIndicators?: boolean;
}

const DAY = 86400;

/** 'YYYY-MM-DD' or unix seconds → unix seconds. */
export function toUnix(t: string | number | Time): number {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') return Date.parse(`${t}T00:00:00Z`) / 1000;
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
}

/** A readable date (and time for intraday points). */
/** True when points are a day or more apart (daily, weekly, monthly data): show dates without a clock time.
 * Daily bars are stamped at midnight in some US time zone (04:00-07:00 UTC), so their UTC date is the right day. */
export function isDailySeries(times: number[]): boolean {
  if (times.length < 2) return times.length === 1 && times[0] % DAY === 0;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(times.length, 60); i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= 20 * 3600;
}

export function formatTime(t: string | number | Time, daily = typeof t !== 'number'): string {
  const d = new Date(toUnix(t) * 1000);
  if (!daily) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const csvDate = (t: number, daily: boolean) => new Date(t * 1000).toISOString().slice(0, daily ? 10 : 16);

const lineTimes = (data: { time: string | number | Time }[]) => data.map((p) => toUnix(p.time));

/** Shows the date and each line's value under the crosshair in a small box that follows the mouse. */
export function attachTooltip(chart: IChartApi, container: HTMLElement, getSeries: () => { series: ISeriesApi<'Line'>; name: string; color: string }[], format: (v: number) => string, isDaily: () => boolean = () => false) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  container.append(tip);
  chart.subscribeCrosshairMove((param: MouseEventParams) => {
    if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      tip.hidden = true;
      return;
    }
    const rows = getSeries()
      .map((s) => {
        const d = param.seriesData.get(s.series) as { value?: number } | undefined;
        return d?.value != null && Number.isFinite(d.value) ? h('div', { class: 'chart-tip-row' }, h('i', { style: `background:${s.color}` }), h('span', {}, s.name || 'Value'), h('b', {}, format(d.value))) : null;
      })
      .filter((r): r is HTMLDivElement => !!r);
    if (!rows.length) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren(h('div', { class: 'chart-tip-date' }, formatTime(param.time, typeof param.time !== 'number' || isDaily())), ...rows);
    tip.hidden = false;
    const w = container.clientWidth;
    const left = param.point.x + 16 + tip.offsetWidth > w ? param.point.x - tip.offsetWidth - 16 : param.point.x + 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, Math.min(param.point.y - 10, container.clientHeight - tip.offsetHeight - 4))}px`;
  });
}

let zTop = 1000;
let openCount = 0;

/** Opens a floating, draggable, resizable chart window. Returns a function that closes it. */
export function openChartWindow(o: ChartWindowOptions): () => void {
  const format = o.format ?? ((v: number) => v.toFixed(2));
  const lines = o.lines.filter((l) => l.data.length);
  const offset = (openCount++ % 6) * 28;
  const win = h('div', { class: 'chart-window', role: 'dialog', 'aria-label': o.title, style: `left:${Math.max(16, (innerWidth - 920) / 2 + offset)}px;top:${Math.max(16, (innerHeight - 600) / 2 + offset)}px;z-index:${++zTop}` });
  const close = () => {
    chart.remove();
    win.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && win.style.zIndex === String(zTop) && close();
  document.addEventListener('keydown', onKey);
  win.addEventListener('pointerdown', () => (win.style.zIndex = String(++zTop)));

  // ----- Title bar (drag to move) -----
  const bar = h(
    'div',
    { class: 'chart-window-bar' },
    h('div', { class: 'chart-window-title' }, h('b', {}, o.title), o.subtitle ? h('span', { class: 'muted small' }, o.subtitle) : null),
    h('span', { class: 'spacer' }),
    ...(o.actions ?? []),
    h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, '✕'),
  );
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button, a, select, input')) return;
    const startX = e.clientX - win.offsetLeft;
    const startY = e.clientY - win.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      win.style.left = `${Math.min(innerWidth - 80, Math.max(-win.offsetWidth + 120, ev.clientX - startX))}px`;
      win.style.top = `${Math.min(innerHeight - 40, Math.max(0, ev.clientY - startY))}px`;
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  // Corner handle for resizing with a finger (CSS resize only works with a mouse).
  const grip = h('div', { class: 'chart-window-grip', title: 'Drag to resize', 'aria-hidden': 'true' });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = win.offsetWidth;
    const startH = win.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      win.style.width = `${Math.max(280, Math.min(innerWidth - win.offsetLeft - 4, startW + ev.clientX - startX))}px`;
      win.style.height = `${Math.max(260, Math.min(innerHeight - win.offsetTop - 4, startH + ev.clientY - startY))}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // ----- Chart -----
  const box = h('div', { class: 'chart-window-chart' });
  const chart = createChart(box, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: THEME.background }, textColor: THEME.text, fontFamily: "'Inter', sans-serif", fontSize: 12, attributionLogo: false },
    grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border, rightOffset: 4 },
    crosshair: { mode: 0 },
  });
  followTheme(chart);
  const series = lines.map((l) => {
    // The format goes on each series (not the whole chart) so indicator panes keep their own units.
    const s = chart.addSeries(LineSeries, { color: l.color, lineWidth: l.width ?? 2, priceLineVisible: false, lastValueVisible: true, title: lines.length > 1 ? l.name : '', priceFormat: { type: 'custom', formatter: format, minMove: 0.0001 } });
    s.setData(dedupe(l.data) as never);
    return { series: s, name: l.name, color: l.color, line: l, visible: true };
  });
  const daily = isDailySeries(lineTimes(lines[0]?.data ?? []));
  const when = (t: string | number | Time) => formatTime(t, daily);
  attachTooltip(chart, box, () => series.filter((s) => s.visible), format, () => daily);

  // ----- Controls -----
  const last = Math.max(...lines.map((l) => toUnix(l.data[l.data.length - 1].time)));
  const first = Math.min(...lines.map((l) => toUnix(l.data[0].time)));
  const ranges: [string, number | 'ytd' | 'max'][] = [
    ['1M', 31],
    ['3M', 92],
    ['6M', 183],
    ['YTD', 'ytd'],
    ['1Y', 366],
    ['5Y', 5 * 366],
    ['10Y', 10 * 366],
    ['Max', 'max'],
  ];
  const rangeBtns = h(
    'div',
    { class: 'segmented small' },
    ...ranges
      .filter(([, d]) => typeof d !== 'number' || last - d * DAY > first - 40 * DAY)
      .map(([label, d]) =>
        h(
          'button',
          {
            onclick: (e: Event) => {
              rangeBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
              if (d === 'max') return chart.timeScale().fitContent();
              const from = d === 'ytd' ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000 : last - d * DAY;
              chart.timeScale().setVisibleRange({ from: Math.max(first, from) as Time, to: last as Time });
            },
          },
          label,
        ),
      ),
  );
  const scale = h('select', { class: 'input small-select', 'aria-label': 'Scale' }, h('option', { value: String(PriceScaleMode.Normal) }, 'Price'), h('option', { value: String(PriceScaleMode.Percentage) }, '% change'), h('option', { value: String(PriceScaleMode.Logarithmic) }, 'Log scale'));
  scale.addEventListener('change', () => chart.priceScale('right').applyOptions({ mode: Number(scale.value) as PriceScaleMode }));
  const legend = h(
    'div',
    { class: 'chart-window-legend' },
    ...series.map((s) => {
      const chip = h('button', { class: 'legend-chip on', title: 'Show / hide' }, h('i', { style: `background:${s.color}` }), s.name || 'Value');
      chip.addEventListener('click', () => {
        s.visible = !s.visible;
        s.series.applyOptions({ visible: s.visible });
        chip.classList.toggle('on', s.visible);
        updateStats();
      });
      return chip;
    }),
  );
  const csv = h('button', { class: 'btn small', title: 'Download the data as a spreadsheet (CSV)', onclick: () => downloadCsv(o.title, lines) }, 'CSV');
  const fit = h('button', { class: 'btn small', title: 'Fit everything', onclick: () => chart.timeScale().fitContent() }, 'Fit');
  const stats = h('div', { class: 'chart-window-stats' });
  const studies = indicatorMenu(chart, () => dedupe(lines[0]?.data ?? []), { open: o.openIndicators, format });
  const tools = h('div', { class: 'chart-window-tools' }, rangeBtns, scale, fit, csv, studies.button, legend);

  /** Change, high and low over the visible period for the first visible line. */
  function updateStats() {
    const range = chart.timeScale().getVisibleRange();
    const s = series.find((x) => x.visible);
    if (!range || !s) return stats.replaceChildren();
    const from = toUnix(range.from);
    const to = toUnix(range.to);
    const pts = s.line.data.filter((p) => {
      const t = toUnix(p.time);
      return t >= from && t <= to && Number.isFinite(p.value);
    });
    if (pts.length < 2) return stats.replaceChildren();
    const a = pts[0];
    const b = pts[pts.length - 1];
    const hi = pts.reduce((m, p) => (p.value > m.value ? p : m));
    const lo = pts.reduce((m, p) => (p.value < m.value ? p : m));
    const diff = b.value - a.value;
    // A % change only means something for a positive series measured in its own units.
    const pctChange = o.changeAs !== 'points' && a.value > 0 && b.value > 0 ? diff / a.value : null;
    const diffText = o.changeAs === 'points' ? `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)} pts` : `${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))}`;
    const tone = diff >= 0 ? 'up' : 'down';
    const item = (label: string, value: string, cls = '') => h('span', {}, h('span', { class: 'muted' }, label), ' ', h('b', { class: cls }, value));
    stats.replaceChildren(
      item(`${s.name || 'Value'}:`, `${when(a.time)} → ${when(b.time)}`),
      item('Start', format(a.value)),
      item('End', format(b.value)),
      item('Change', `${diffText}${pctChange != null ? ` (${pctChange >= 0 ? '+' : ''}${(pctChange * 100).toFixed(2)}%)` : ''}`, tone),
      item('High', `${format(hi.value)} · ${when(hi.time)}`),
      item('Low', `${format(lo.value)} · ${when(lo.time)}`),
    );
  }
  chart.timeScale().subscribeVisibleTimeRangeChange(() => requestAnimationFrame(updateStats));

  win.append(bar, tools, studies.menu, studies.chips, box, stats, h('div', { class: 'chart-window-hint muted small' }, 'Scroll or pinch to zoom · drag to pan · drag the title bar to move · drag the corner to resize'), grip);
  document.body.append(win);
  chart.timeScale().fitContent();
  // The chart measures itself before the window is laid out; fit again once it has its real size.
  requestAnimationFrame(() => requestAnimationFrame(() => (chart.timeScale().fitContent(), updateStats())));
  return close;
}

/** Lightweight Charts needs strictly increasing, unique times. */
function dedupe(data: { time: string | number; value: number }[]) {
  const out: { time: string | number; value: number }[] = [];
  let prev = -Infinity;
  for (const p of [...data].sort((x, y) => toUnix(x.time) - toUnix(y.time))) {
    const t = toUnix(p.time);
    if (!Number.isFinite(p.value)) continue;
    if (t === prev) out[out.length - 1] = p;
    else out.push(p);
    prev = t;
  }
  return out;
}

function downloadCsv(title: string, lines: WindowLine[]) {
  const times = [...new Set(lines.flatMap((l) => l.data.map((p) => toUnix(p.time))))].sort((a, b) => a - b);
  const maps = lines.map((l) => new Map(l.data.map((p) => [toUnix(p.time), p.value])));
  const daily = isDailySeries(times);
  const rows = [['Date', ...lines.map((l) => l.name || 'Value')].join(','), ...times.map((t) => [csvDate(t, daily), ...maps.map((m) => m.get(t) ?? '')].join(','))];
  const a = h('a', { href: URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })), download: `${title.replace(/[^\w\- ]+/g, '').trim() || 'chart'}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
