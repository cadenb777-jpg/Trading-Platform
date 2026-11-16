/**
 * Market pulse: the left menu's lower half (it was empty space) as a live mini board, Bloomberg-monitor style:
 * the big indexes, rates, gold, oil, bitcoin and the first names of the owner's watchlist, each with its last price
 * and day change, green/red only for up/down. Clicking a line opens that security. Quotes come from the same live
 * feed as the ticker tape (subscribeQuote); updates change text in place (no layout work on scroll).
 */
import { subscribeQuote, type MarketRef } from '../data/quotes';
import { state } from '../state';
import { runId } from './command';
import { h } from './dom';

export const PULSE_CORE: { ref: MarketRef; label: string }[] = [
  { ref: { provider: 'schwab', symbol: 'SPY' }, label: 'S&P 500' },
  { ref: { provider: 'schwab', symbol: 'QQQ' }, label: 'Nasdaq 100' },
  { ref: { provider: 'schwab', symbol: 'IWM' }, label: 'Russell 2000' },
  { ref: { provider: 'schwab', symbol: '$VIX' }, label: 'VIX' },
  { ref: { provider: 'schwab', symbol: 'TLT' }, label: '20y Treasuries' },
  { ref: { provider: 'schwab', symbol: 'GLD' }, label: 'Gold' },
  { ref: { provider: 'schwab', symbol: 'USO' }, label: 'Oil' },
  { ref: { provider: 'coinbase', symbol: 'BTC-USD' }, label: 'Bitcoin' },
];
const WATCH_MAX = 6;

/** "+1.23%" / "−0.40%" / "—" from a quote (pure, tested). */
export function changeText(last: number | null | undefined, prev: number | null | undefined): { text: string; tone: 'up' | 'down' | '' } {
  if (last == null || prev == null || !prev) return { text: '—', tone: '' };
  const pct = (last / prev - 1) * 100;
  return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`, tone: pct > 0 ? 'up' : pct < 0 ? 'down' : '' };
}

/** The core list plus watchlist names not already in it (pure, tested). */
export function pulseList(watch: MarketRef[], core = PULSE_CORE, max = WATCH_MAX) {
  const have = new Set(core.map((c) => `${c.ref.provider}:${c.ref.symbol}`));
  const extra = watch.filter((r) => !have.has(`${r.provider}:${r.symbol}`)).slice(0, max).map((ref) => ({ ref, label: ref.symbol }));
  return { core, watch: extra };
}

const price = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2));

export function railPulse(): HTMLElement {
  const { core, watch } = pulseList(state.watchlist);
  const row = (item: { ref: MarketRef; label: string }) => {
    const last = h('span', { class: 'rp-last' }, '—');
    const chg = h('span', { class: 'rp-chg' }, '');
    const el = h(
      'button',
      { type: 'button', class: 'rp-row', title: `${item.ref.symbol}: open it`, onclick: () => void runId(`tk:${item.ref.symbol}`) },
      h('span', { class: 'rp-name' }, item.label),
      last,
      chg,
    );
    subscribeQuote(item.ref, (q) => {
      if (q.last != null) last.textContent = price(q.last);
      const c = changeText(q.last, q.prevClose);
      chg.textContent = c.text;
      chg.className = `rp-chg ${c.tone}`;
    });
    return el;
  };
  return h(
    'div',
    { class: 'rail-pulse', 'aria-label': 'Market pulse' },
    h('div', { class: 'rp-head' }, 'Market pulse'),
    ...core.map(row),
    watch.length ? h('div', { class: 'rp-head' }, 'Watchlist') : '',
    ...watch.map(row),
  );
}
