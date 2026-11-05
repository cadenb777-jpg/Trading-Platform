/** The chart's own loading and empty states: a quiet card over the chart instead of a blank canvas. */
import { h } from '../ui/dom';

export function createChartState() {
  const text = h('span', {});
  const el = h('div', { class: 'cf-state', hidden: true, role: 'status', 'aria-live': 'polite' }, h('div', { class: 'cf-state-card' }, h('div', { class: 'cf-state-bars', 'aria-hidden': 'true' }, ...[1, 2, 3, 4, 5].map(() => h('i', {}))), text));
  const show = (kind: 'loading' | 'empty', message: string) => {
    el.className = `cf-state ${kind}`;
    text.textContent = message;
    el.hidden = false;
  };
  return {
    el,
    loading: (message: string) => show('loading', message),
    empty: (message: string) => show('empty', message),
    hide: () => (el.hidden = true),
  };
}
