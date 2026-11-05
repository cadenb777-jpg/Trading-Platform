/**
 * The Home hero's ticker tape: the main markets and the watchlist scrolling right to left along the hero's bottom
 * edge (symbol in amber, price in white, change in green/red with an arrow). Live from the helper's quotes; a symbol
 * opens its card on click. Pauses on hover and on keyboard focus; still (and scrollable by hand) for reduced motion.
 * The list is drawn twice so the CSS loop is seamless.
 */
import { quoteChange, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { state } from '../state';
import { formatPrice, h } from '../ui/dom';
import { tickerAttr } from '../ui/tickerCard';

const CORE = ['SPY', 'QQQ', 'DIA', 'IWM', 'TLT', 'GLD', 'USO', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];

/** The tape's symbols: the core list, then the watchlist's stocks not already in it (at most 24). */
export function tapeSymbols(watch: string[]): string[] {
  const out = [...CORE];
  for (const s of watch) if (!out.includes(s) && /^[A-Z][A-Z.]{0,5}$/.test(s)) out.push(s);
  return out.slice(0, 24);
}

/** "▲ +0.62%" / "▼ −1.10%" / "—". */
export function tapeChange(q: Quote | undefined): { text: string; tone: '' | 'up' | 'down' } {
  const c = quoteChange(q);
  if (!c) return { text: '—', tone: '' };
  const up = c.percent >= 0;
  return { text: `${up ? '▲ +' : '▼ −'}${Math.abs(c.percent).toFixed(2)}%`, tone: up ? 'up' : 'down' };
}

export function createTickerTape(): { el: HTMLElement; stop: () => void } {
  const symbols = tapeSymbols(state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol));
  const quotes = new Map<string, Quote>();
  const cells = new Map<string, HTMLElement[]>();
  const item = (s: string) => {
    const price = h('span', { class: 'tape-price' }, '—');
    const chg = h('span', { class: 'tape-chg' }, '—');
    const el = h('span', { class: 'tape-item', ...tickerAttr(s) }, h('b', { class: 'tape-sym' }, s), price, chg);
    cells.set(s, [...(cells.get(s) ?? []), el]);
    return el;
  };
  const run = () => h('div', { class: 'tape-run' }, ...symbols.map(item));
  const track = h('div', { class: 'tape-track' }, run(), run());
  const el = h('div', { class: 'ticker-tape', role: 'marquee', 'aria-label': 'Market ticker tape', tabindex: 0 }, track);
  const draw = (s: string) => {
    const q = quotes.get(s);
    const c = tapeChange(q);
    for (const cell of cells.get(s) ?? []) {
      cell.querySelector('.tape-price')!.textContent = q?.last != null ? formatPrice(q.last) : '—';
      const chg = cell.querySelector('.tape-chg')!;
      chg.textContent = c.text;
      chg.className = `tape-chg ${c.tone}`;
    }
  };
  const stops = symbols.map((s) =>
    subscribeQuote({ provider: 'schwab', symbol: s } as MarketRef, (q) => {
      quotes.set(s, q);
      draw(s);
    }),
  );
  // speed: about 60 px a second whatever the length
  requestAnimationFrame(() => {
    const w = track.scrollWidth / 2;
    if (w > 0) track.style.setProperty('--tape-seconds', `${Math.max(30, Math.round(w / 60))}s`);
  });
  return { el, stop: () => stops.forEach((f) => f()) };
}
