/**
 * The range bar beside the timeframe buttons (1D 3D 1M 6M YTD 1Y 5Y Max) and the logic both chart hosts share:
 * pick a range, show it, fetch more history when the bars don't reach, and remember the choice per timeframe.
 */
import type { Timeframe } from '../types';
import { h } from '../ui/dom';
import type { ChartView } from './ChartView';
import { RANGES, daysNeeded, marketTimeZone, rangeFits, rangeStart, saveRange, savedRange, type RangeId } from './range';

export interface RangeHost {
  view: () => ChartView | null;
  timeframe: () => Timeframe;
  /** Load the history again asking for at least `days` calendar days (Infinity = all there is). */
  reload: (days: number) => void;
}

export function createRangeBar(host: RangeHost) {
  const el = h('div', { class: 'segmented cf-range', role: 'group', 'aria-label': 'Range' });
  /** The range a reload was already made for (symbol/timeframe change clears it), so a short history isn't refetched forever. */
  let fetchedFor = '';

  function render() {
    const tf = host.timeframe();
    const active = savedRange(tf);
    el.replaceChildren(
      ...RANGES.map((r) => {
        const fits = rangeFits(r.id, tf);
        return h(
          'button',
          {
            type: 'button',
            class: r.id === active ? 'active' : '',
            'aria-pressed': String(r.id === active),
            disabled: !fits,
            title: fits ? `${r.title} (remembered for ${tf} bars)` : `${r.title}: too few ${tf} bars; pick a shorter timeframe`,
            onclick: () => select(r.id === active ? null : r.id),
          },
          r.label,
        );
      }),
    );
  }

  function select(range: RangeId | null) {
    saveRange(host.timeframe(), range);
    render();
    if (range) apply(true);
    else host.view()?.fit();
  }

  /**
   * Shows the remembered range for this timeframe. Returns false when there is none (the host then fits as usual).
   * With `fetch`, a range the loaded bars don't reach triggers one reload with more history.
   */
  function apply(fetch = false): boolean {
    const view = host.view();
    const tf = host.timeframe();
    const range = savedRange(tf);
    if (!view || !range || !rangeFits(range, tf)) return false;
    const times = view.allBars().map((b) => b.time);
    const start = rangeStart(range, times, marketTimeZone(view.market));
    if (!start) return false;
    const key = `${view.market}:${view.symbol}:${tf}:${range}`;
    if (!start.covered && fetch && fetchedFor !== key) {
      fetchedFor = key;
      host.reload(daysNeeded(range, Date.now() / 1000));
      return true;
    }
    view.showFrom(start.from);
    return true;
  }

  /** Days of history to ask for up front at this timeframe (undefined = the provider's usual amount). */
  function daysWanted(): number | undefined {
    const tf = host.timeframe();
    const range = savedRange(tf);
    return range && rangeFits(range, tf) ? daysNeeded(range, Date.now() / 1000) : undefined;
  }

  return { el, render, apply, daysWanted };
}

export type RangeBar = ReturnType<typeof createRangeBar>;
