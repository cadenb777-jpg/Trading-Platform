/**
 * The range bar beside the timeframe buttons (1D 3D 1M 6M YTD 1Y 5Y Max) and the logic both chart hosts share:
 * pick a range, show it, fetch more history when the bars don't reach, and remember the choice per timeframe.
 * A range longer than the provider keeps at that timeframe (1Y of 1-minute crypto) is capped to what it has, and the
 * bar says so; it is never refetched in a loop or on every symbol switch.
 */
import { TIMEFRAME_SECONDS, type Timeframe } from '../types';
import { h } from '../ui/dom';
import type { ChartView } from './ChartView';
import { RANGES, daysNeeded, marketTimeZone, rangeFits, rangeStart, saveRange, savedRange, timeframeFor, type RangeId } from './range';

export interface RangeHost {
  view: () => ChartView | null;
  timeframe: () => Timeframe;
  /** The most calendar days of history the provider has at the current timeframe. */
  maxDays: () => number;
  /** Load the history again asking for at least `days` calendar days. */
  reload: (days: number) => void;
  /** Switch the chart's timeframe (a range the current one can't show switches to one that can). */
  setTimeframe?: (tf: Timeframe) => void;
}

const fmtDays = (d: number) => (d >= 730 ? `${Math.round(d / 365)} years` : d >= 60 ? `${Math.round(d / 30)} months` : `${Math.max(1, Math.floor(d))} days`);

export function createRangeBar(host: RangeHost) {
  const buttons = h('div', { class: 'segmented cf-range', role: 'group', 'aria-label': 'Range' });
  const note = h('span', { class: 'cf-range-note', hidden: true, role: 'status' });
  const el = h('span', { class: 'cf-range-wrap' }, buttons, note);
  /** What the last load asked for (market:symbol:timeframe -> days), so a range already asked for isn't refetched. */
  let asked = { key: '', days: 0 };
  const keyOf = (view: ChartView) => `${view.market}:${view.symbol}:${host.timeframe()}`;

  /** Calendar days a range needs here, capped to what the provider keeps; `capped` when it can't all be shown. */
  function want(range: RangeId): { days: number; capped: boolean } {
    const need = daysNeeded(range, Date.now() / 1000);
    const max = host.maxDays();
    return need > max ? { days: max, capped: true } : { days: need, capped: false };
  }

  /** A range this timeframe can't show well: too few bars, more history than it keeps, or thousands of bars. */
  function needsSwitch(range: RangeId, tf: Timeframe): boolean {
    if (timeframeFor(range) === tf) return false;
    if (!rangeFits(range, tf)) return true;
    const days = daysNeeded(range, Date.now() / 1000);
    return want(range).capped || (days * 86400) / TIMEFRAME_SECONDS[tf] > 3000;
  }

  function render() {
    const tf = host.timeframe();
    const active = savedRange(tf);
    buttons.replaceChildren(
      ...RANGES.map((r) => {
        const switches = needsSwitch(r.id, tf) && !!host.setTimeframe;
        const fits = (rangeFits(r.id, tf) && host.maxDays() > 0) || switches;
        return h(
          'button',
          {
            type: 'button',
            class: r.id === active ? 'active' : '',
            'aria-pressed': String(r.id === active),
            disabled: !fits,
            title: switches ? `${r.title} (switches to ${timeframeFor(r.id)} bars)` : fits ? `${r.title} (remembered for ${tf} bars)` : `${r.title}: too few ${tf} bars; pick a shorter timeframe`,
            onclick: () => select(r.id === active ? null : r.id),
          },
          r.label,
        );
      }),
    );
    paintNote();
  }

  function paintNote() {
    const tf = host.timeframe();
    const range = savedRange(tf);
    const w = range && rangeFits(range, tf) ? want(range) : null;
    note.hidden = !w?.capped;
    if (w?.capped) {
      const label = RANGES.find((r) => r.id === range)!.label;
      note.textContent = `${label}: ${fmtDays(w.days)} max at ${tf}`;
      note.title = `${tf} history only goes back about ${fmtDays(w.days)} with this data source, so ${label} shows all of it. Pick a longer timeframe to see further back.`;
    }
  }

  function select(range: RangeId | null) {
    if (range && needsSwitch(range, host.timeframe()) && host.setTimeframe) {
      // the range needs longer bars: switch timeframe; the new load asks for enough history and shows the range
      const tf = timeframeFor(range);
      saveRange(tf, range);
      host.setTimeframe(tf);
      return;
    }
    saveRange(host.timeframe(), range);
    render();
    if (range) apply(true);
    else host.view()?.fit();
  }

  /**
   * Shows the remembered range for this timeframe. Returns false when there is none (the host then fits as usual).
   * With `fetch` (a click), a range the loaded bars don't reach triggers one reload with more history, unless that
   * much (or the provider's most) was already asked for.
   */
  function apply(fetch = false): boolean {
    const view = host.view();
    const tf = host.timeframe();
    const range = savedRange(tf);
    if (!view || !range || !rangeFits(range, tf)) return false;
    const start = rangeStart(range, view.allBars().map((b) => b.time), marketTimeZone(view.market));
    if (!start) return false;
    const w = want(range);
    const key = keyOf(view);
    if (!start.covered && fetch && !(asked.key === key && asked.days >= w.days)) {
      asked = { key, days: w.days };
      host.reload(w.days);
      return true;
    }
    view.showFrom(start.from);
    return true;
  }

  /** Days of history to ask for up front (undefined = the provider's usual amount); remembered for apply(). */
  function daysWanted(): number | undefined {
    const view = host.view();
    const tf = host.timeframe();
    const range = savedRange(tf);
    if (!range || !rangeFits(range, tf)) return undefined;
    const days = want(range).days;
    if (view) asked = { key: keyOf(view), days };
    return days;
  }

  return { el, render, apply, daysWanted };
}

export type RangeBar = ReturnType<typeof createRangeBar>;
