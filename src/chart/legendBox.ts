/**
 * The in-chart legend box (top left): a translucent rounded card with, for the bars on screen, the last price, the
 * high and low with their dates and the average close, then one row per indicator (colour chip and current value).
 * It follows scrolling and zooming (at most every 80 ms) and folds away with its chevron. The Chart page puts its
 * own indicator rows (with hide/settings/remove buttons) in `rows`; the security GP tab lets the box build simple ones.
 */
import { indicatorLabel } from '../indicators/library';
import { THEME } from '../ui/theme';
import { h } from '../ui/dom';
import type { ChartView } from './ChartView';
import { visibleStats } from './summary';
import { TIMEFRAME_SECONDS } from '../types';

const KEY = 'tp-legend-folded';
const THROTTLE_MS = 80;

const dailyFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "Nov 5 '26": Bloomberg's "High on 12/16/14", in words. */
const dailyDate = { format: (ms: number) => `${dailyFmt.format(ms)} '${String(new Date(ms).getUTCFullYear()).slice(2)}` };
const intradayDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export interface ExtraRow {
  label: string;
  color: string;
  value: string;
  /** Which price axis the line is read on (Bloomberg's L1 / R1). */
  axis?: string;
}

export class LegendBox {
  readonly el: HTMLElement;
  /** Left part of the card's head (the host puts the symbol line here). */
  readonly title: HTMLElement;
  /** Indicator rows: filled by the host, or by the box itself with `autoRows`. */
  readonly rows: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly cells: Record<'last' | 'high' | 'avg' | 'low', { label: HTMLElement; value: HTMLElement }>;
  private readonly extra: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private lastRun = 0;
  private readonly stop: () => void;
  private autoKey = '';
  private autoNums: { uid: string; nums: HTMLElement[] }[] = [];

  constructor(
    private readonly view: ChartView,
    private readonly opts: { autoRows?: boolean; title?: string } = {},
  ) {
    let folded = false;
    try {
      folded = localStorage.getItem(KEY) === '1';
    } catch {
      // ignore
    }
    const toggle = h('button', { type: 'button', class: 'cf-fold', title: 'Fold or unfold the legend', 'aria-label': 'Fold legend', 'aria-expanded': String(!folded) });
    this.title = h('span', { class: 'cf-legend-title' }, opts.title ?? '');
    const cell = (key: string, color: string) => {
      const label = h('span', { class: 'cf-stat-k' });
      const value = h('span', { class: 'cf-stat-v' });
      this.stats.append(h('div', { class: `cf-stat cf-stat-${key}`, style: `--c:${color}` }, h('i', {}), label, value));
      return { label, value };
    };
    this.stats = h('div', { class: 'cf-stats' });
    this.cells = { last: cell('last', 'var(--accent)'), high: cell('high', 'var(--up)'), avg: cell('avg', 'var(--muted)'), low: cell('low', 'var(--down)') };
    this.extra = h('div', { class: 'cf-extra' });
    this.rows = h('div', { class: 'cf-rows' });
    this.el = h('div', { class: `legend cf-legend${folded ? ' folded' : ''}` }, h('div', { class: 'cf-legend-head' }, this.title, toggle), h('div', { class: 'cf-legend-body' }, this.stats, this.extra, this.rows));
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = this.el.classList.toggle('folded');
      toggle.setAttribute('aria-expanded', String(!now));
      try {
        localStorage.setItem(KEY, now ? '1' : '0');
      } catch {
        // ignore
      }
    });
    this.stop = view.onVisibleRange(() => this.schedule());
  }

  /** Recomputes on the next quiet moment (scroll and zoom fire every frame; the stats follow at most every 80 ms). */
  schedule() {
    if (this.timer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - this.lastRun));
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.lastRun = performance.now();
      this.refresh();
    }, wait);
  }

  setExtra(rows: ExtraRow[]) {
    this.extra.replaceChildren(
      ...rows.map((r) => h('div', { class: 'cf-stat', style: `--c:${r.color}` }, h('i', {}), h('span', { class: 'cf-stat-k' }, r.axis ? h('span', { class: 'cf-axis-tag' }, r.axis) : null, r.label), h('span', { class: 'cf-stat-v' }, r.value))),
    );
  }

  /** Updates every number now. */
  refresh() {
    const bars = this.view.allBars();
    const range = this.view.visibleLogicalRange();
    const s = range ? visibleStats(bars as never, range.from, range.to) : null;
    this.stats.hidden = !s;
    if (s) {
      const daily = TIMEFRAME_SECONDS[this.view.currentTimeframe] >= 86400;
      const when = (t: number) => (daily ? dailyDate : intradayDate).format(t * 1000);
      const f = (v: number) => this.view.formatPrice(v);
      const set = (el: HTMLElement, text: string) => el.textContent !== text && (el.textContent = text);
      const atEnd = range!.to >= bars.length - 1;
      set(this.cells.last.label, atEnd ? 'Last price' : 'Last on screen');
      set(this.cells.last.value, f(s.last));
      set(this.cells.high.label, `High on ${when(s.highTime)}`);
      set(this.cells.high.value, f(s.high));
      set(this.cells.avg.label, 'Average');
      set(this.cells.avg.value, f(s.average));
      set(this.cells.low.label, `Low on ${when(s.lowTime)}`);
      set(this.cells.low.value, f(s.low));
      const lastBar = bars[Math.min(bars.length - 1, Math.floor(range!.to))];
      this.stats.style.setProperty('--last', lastBar && lastBar.close < lastBar.open ? THEME.down : THEME.up);
    }
    if (this.opts.autoRows) this.paintAutoRows();
  }

  private paintAutoRows() {
    const list = this.view.indicatorList().filter(({ def }) => def.plots.some((p) => p.type !== 'marker'));
    const key = list.map(({ instance }) => `${instance.uid}:${instance.visible}`).join('|');
    if (key !== this.autoKey) {
      this.autoKey = key;
      this.autoNums = [];
      this.rows.replaceChildren(
        ...list.map(({ instance, def }) => {
          const values = this.view.valuesAt(instance.uid, this.view.barCount - 1).filter((v) => !v.hidden);
          const nums = values.map(() => h('span', { class: 'cf-stat-v' }));
          this.autoNums.push({ uid: instance.uid, nums });
          return h(
            'div',
            { class: 'cf-stat cf-ind', style: `--c:${values[0]?.color ?? THEME.text}` },
            h('i', {}),
            h('span', { class: 'cf-stat-k' }, indicatorLabel(def, instance)),
            h('span', { class: 'cf-ind-vals' }, ...nums),
          );
        }),
      );
    }
    for (const { uid, nums } of this.autoNums) {
      this.view
        .valuesAt(uid, this.view.barCount - 1)
        .filter((v) => !v.hidden)
        .forEach((v, i) => nums[i] && (nums[i].textContent = Number.isFinite(v.value) ? (Math.abs(v.value) >= 1e5 ? compact(v.value) : this.view.formatPrice(v.value)) : '—'));
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.stop();
  }
}

function compact(v: number) {
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${(v / 1e3).toFixed(1)}K`;
}
