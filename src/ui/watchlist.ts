/** Your list of symbols with live prices. Click one to open its chart. */
import { guessMarket, quoteChange, refKey, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { onStateChange, persist, state } from '../state';
import { formatPrice, h, toast } from './dom';
import { icon } from './icons';

export const DISPLAY_NAMES: Record<string, string> = {
  $SPX: 'S&P 500',
  $DJI: 'Dow Jones',
  $COMPX: 'Nasdaq Composite',
  $VIX: 'Volatility Index',
  $RUT: 'Russell 2000',
};

export const displaySymbol = (symbol: string) => symbol.replace(/^\$/, '');

export function createWatchlist(opts: { onSelect: (ref: MarketRef) => void; isActive?: (ref: MarketRef) => boolean; title?: string }) {
  const list = h('div', { class: 'wl-list', role: 'list' });
  const input = h('input', { class: 'input wl-input', placeholder: 'Add symbol, e.g. AMD or BTC', 'aria-label': 'Add symbol', spellcheck: false, autocomplete: 'off' });
  const form = h('form', { class: 'wl-add' }, input, h('button', { class: 'icon-btn', type: 'submit', title: 'Add', 'aria-label': 'Add symbol' }, icon('plus', 20)));
  const el = h(
    'section',
    { class: 'watchlist' },
    h('div', { class: 'panel-head' }, h('h3', {}, opts.title ?? 'Watchlist'), h('span', { class: 'muted small wl-count' })),
    form,
    h('div', { class: 'wl-columns muted small' }, h('span', {}, 'Symbol'), h('span', {}, 'Last'), h('span', {}, 'Chg%')),
    list,
  );

  const quotes = new Map<string, Quote>();
  let stops: (() => void)[] = [];
  let rendered = '';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ref = guessMarket(input.value);
    input.value = '';
    if (!ref) return;
    if (state.watchlist.some((r) => refKey(r) === refKey(ref))) return toast(`${ref.symbol} is already on your watchlist`);
    state.watchlist.push(ref);
    persist();
  });

  const updateRow = (row: HTMLElement, q: Quote | undefined) => {
    const change = quoteChange(q);
    row.querySelector('.wl-last')!.textContent = formatPrice(q?.last);
    const chg = row.querySelector('.wl-chg')!;
    chg.textContent = change ? `${change.percent >= 0 ? '+' : ''}${change.percent.toFixed(2)}%` : '—';
    chg.className = `wl-chg ${change ? (change.percent >= 0 ? 'up' : 'down') : ''}`;
    chg.setAttribute('title', q?.lastSession ? 'Change in the latest session (the market is closed)' : 'Change today');
  };

  const render = () => {
    const key = state.watchlist.map(refKey).join('|');
    el.querySelector('.wl-count')!.textContent = `${state.watchlist.length}`;
    if (key !== rendered) {
      rendered = key;
      for (const stop of stops) stop();
      stops = [];
      list.replaceChildren(
        ...state.watchlist.map((ref) => {
          const k = refKey(ref);
          const row = h(
            'div',
            { class: 'wl-row', role: 'listitem', tabindex: 0, 'data-key': k },
            h(
              'span',
              { class: 'wl-sym' },
              h('b', {}, displaySymbol(ref.symbol)),
              h('span', { class: 'wl-sub' }, DISPLAY_NAMES[ref.symbol] ?? (ref.provider === 'coinbase' ? 'Crypto' : 'Stock')),
            ),
            h('span', { class: 'wl-last' }),
            h('span', { class: 'wl-chg' }),
            h(
              'button',
              {
                class: 'wl-remove',
                title: 'Remove',
                'aria-label': `Remove ${ref.symbol}`,
                onclick: (e: Event) => {
                  e.stopPropagation();
                  state.watchlist = state.watchlist.filter((r) => refKey(r) !== k);
                  persist();
                },
              },
              icon('close', 15),
            ),
          );
          row.addEventListener('click', () => opts.onSelect(ref));
          row.addEventListener('keydown', (e) => e.key === 'Enter' && opts.onSelect(ref));
          updateRow(row, quotes.get(k));
          stops.push(
            subscribeQuote(ref, (q) => {
              quotes.set(k, q);
              updateRow(row, q);
            }),
          );
          return row;
        }),
      );
      if (!state.watchlist.length) list.append(h('div', { class: 'muted pad small' }, 'Your watchlist is empty. Add a symbol above.'));
    }
    for (const row of list.querySelectorAll<HTMLElement>('.wl-row')) {
      const ref = state.watchlist.find((r) => refKey(r) === row.dataset.key);
      row.classList.toggle('active', !!ref && !!opts.isActive?.(ref));
    }
  };

  onStateChange(render);
  render();
  return { el, render };
}
