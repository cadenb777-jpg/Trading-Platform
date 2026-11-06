/**
 * The security header row above a chart (Bloomberg's ordered header, in our own style): symbol, last with an up/down
 * arrow and the change in colour, then label/value pairs a trader reads at a glance: At, Op, Hi, Lo, day range,
 * previous close, volume and volume against normal, dollar value, distance from VWAP and the session clock.
 * Built once; update() only changes text in place, so live ticks cost almost nothing.
 */
import { h } from '../ui/dom';
import { clockText } from './clock';
import { formatCompact, formatPrice, sessionClock, type DaySummary } from './summary';

export interface HeaderInput {
  symbol: string;
  summary: DaySummary | null;
  /** Time of the latest trade/quote (unix seconds); defaults to the newest bar's time. */
  at?: number | null;
  daily: boolean;
  /** Provider id: 'schwab' shows the US session clock. */
  market: string;
  /** Price formatter (the chart's precision); defaults to formatPrice. */
  price?: (v: number) => string;
  /** Only these pairs (a line chart has no open, range or volume). */
  fields?: HeaderField[];
}

export type HeaderField = Key;

type Key = 'at' | 'op' | 'hi' | 'lo' | 'rng' | 'prev' | 'vol' | 'rvol' | 'val' | 'vwap' | 'pre' | 'clock';

const FIELDS: { key: Key; label: string; title: string; wide?: boolean }[] = [
  { key: 'at', label: 'At', title: 'Time of the latest price' },
  { key: 'op', label: 'Op', title: 'Open of the trading day', wide: true },
  { key: 'hi', label: 'Hi', title: 'High of the trading day' },
  { key: 'lo', label: 'Lo', title: 'Low of the trading day' },
  { key: 'rng', label: 'Rng', title: 'Day range: high minus low, and as a % of the last price', wide: true },
  { key: 'prev', label: 'Close', title: 'Previous close', wide: true },
  { key: 'vol', label: 'Vol', title: 'Volume of the trading day' },
  { key: 'rvol', label: 'RVol', title: 'Volume against normal: today so far against the average of the last 20 days up to the same time (daily bars: the last bar against the 20 before). 1.0× is a normal day.', wide: true },
  { key: 'val', label: 'Value', title: 'Dollar volume: volume times the typical price of each bar', wide: true },
  { key: 'vwap', label: 'VWAP', title: 'Distance of the last price from the volume-weighted average price since the 09:30 New York open (crypto: since midnight UTC). Shown on bars of 1 hour or less.', wide: true },
  { key: 'pre', label: 'Pre VWAP', title: 'Distance of the last price from the pre-market (04:00-09:30 New York) volume-weighted average price', wide: true },
  { key: 'clock', label: '', title: 'US stock session (9:30-16:00 New York; NYSE holidays and 13:00 early closes for 2026-2027)', wide: true },
];

const timeFormat = { format: (ms: number) => { const d = new Date(ms); return clockText(d.getHours(), d.getMinutes()); } };
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function createSecurityHeader() {
  const sym = h('b', { class: 'cf-sym' });
  const arrow = h('span', { class: 'cf-arrow', 'aria-hidden': 'true' });
  const last = h('span', { class: 'cf-last' });
  const chg = h('span', { class: 'cf-chg' });
  const values = {} as Record<Key, HTMLElement>;
  const items = {} as Record<Key, HTMLElement>;
  const pairs = FIELDS.map((f) => {
    values[f.key] = h('span', { class: 'cf-v' });
    items[f.key] = h('span', { class: `cf-kv${f.wide ? ' cf-wide' : ''}`, title: f.title }, f.label ? h('span', { class: 'cf-k' }, f.label) : null, values[f.key]);
    return items[f.key];
  });
  // On a phone the less important pairs fold behind "More" (the row never scrolls sideways).
  const more = h('button', { type: 'button', class: 'cf-more', 'aria-expanded': 'false', title: 'Show every figure' }, 'More');
  const el = h('div', { class: 'cf-head', role: 'group', 'aria-label': 'Security header' }, h('span', { class: 'cf-quote' }, sym, h('span', { class: 'cf-lastbox' }, arrow, last), chg, more), h('span', { class: 'cf-pairs' }, ...pairs));
  more.addEventListener('click', () => {
    const open = el.classList.toggle('cf-open');
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Less' : 'More';
  });
  let input: HeaderInput | null = null;

  const set = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };

  function paint() {
    if (!input) return;
    const s = input.summary;
    const px = input.price ?? formatPrice;
    const p = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : px(v));
    set(sym, input.symbol);
    // the symbol opens its security view (overview, financials, options...), like a ticker anywhere else; crypto has none
    if (/^[A-Z][A-Z.]{0,5}$/.test(input.symbol)) sym.setAttribute('data-ticker', input.symbol);
    else sym.removeAttribute('data-ticker');
    el.classList.toggle('cf-empty', !s);
    const dir = !s || s.change === null ? '' : s.change >= 0 ? 'up' : 'down';
    el.dataset.dir = dir;
    set(arrow, dir === 'up' ? '↑' : dir === 'down' ? '↓' : '');
    set(last, p(s?.last));
    set(chg, s && s.change !== null ? `${s.change >= 0 ? '+' : '−'}${px(Math.abs(s.change))}  ${s.changePct! >= 0 ? '+' : '−'}${Math.abs(s.changePct!).toFixed(2)}%` : '');
    const at = input.at ?? s?.time ?? null;
    set(values.at, at === null ? '—' : input.daily && input.at == null ? dateFormat.format(at * 1000) : timeFormat.format(at * 1000));
    set(values.op, p(s?.open));
    set(values.hi, p(s?.high));
    set(values.lo, p(s?.low));
    set(values.rng, s ? `${px(s.high - s.low)} · ${s.last ? (((s.high - s.low) / s.last) * 100).toFixed(1) : '0'}%` : '—');
    set(values.prev, p(s?.prevClose));
    set(values.vol, s && s.volume ? formatCompact(s.volume) : '—');
    set(values.rvol, s?.relVolume != null ? `${s.relVolume.toFixed(1)}×` : '—');
    values.rvol.dataset.level = s?.relVolume == null ? '' : s.relVolume >= 1.5 ? 'high' : s.relVolume <= 0.6 ? 'low' : '';
    set(values.val, s && s.value ? `$${formatCompact(s.value)}` : '—');
    const distance = (key: 'vwap' | 'pre', ref: number | null | undefined) => {
      const dist = s && ref ? ((s.last - ref) / ref) * 100 : null;
      items[key].dataset.none = String(dist === null);
      set(values[key], dist === null ? '—' : `${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}%`);
      values[key].dataset.dir = dist === null ? '' : dist >= 0 ? 'up' : 'down';
    };
    distance('vwap', s?.vwap);
    distance('pre', s?.preVwap);
    const clock = sessionClock(Date.now() / 1000, input.market);
    items.clock.hidden = clock === null;
    set(values.clock, clock ?? '');
    values.clock.dataset.open = String(!!clock?.startsWith('Closes'));
    for (const f of FIELDS) {
      if (f.key === 'clock') continue;
      // hidden: not asked for, or no VWAP to show (bars above 1 hour; no pre-market)
      items[f.key].hidden = (!!input.fields && !input.fields.includes(f.key)) || ((f.key === 'vwap' || f.key === 'pre') && items[f.key].dataset.none === 'true');
    }
    if (input.fields && !input.fields.includes('clock')) items.clock.hidden = true;
  }

  // The session clock moves on its own: repaint every 30 s while the header is on screen.
  const timer = setInterval(() => {
    if (!el.isConnected) return;
    paint();
  }, 30_000);

  return {
    el,
    update(next: HeaderInput) {
      input = next;
      paint();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}

export type SecurityHeader = ReturnType<typeof createSecurityHeader>;
