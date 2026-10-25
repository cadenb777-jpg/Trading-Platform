/**
 * The order ticket (Trade page and Portfolios > Webull): Buy/Sell, order type, size by shares, dollars or risk, quick
 * buttons, price helpers and a live estimate. "Preview" hands the order to confirmOrder (src/trade/webull.ts), which
 * asks the helper to check it and shows the confirm window; nothing is sent from here.
 */
import { formatPrice, h, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { basisPrice, estimate, maxBuyShares, readSize, riskShares, saveSize, sellFraction, sharesForDollars } from './sizing';
import { confirmOrder, OPEN, TYPE_LABELS, usd, type OrderType, type PlacedOrder, type Snapshot, type TicketPrefill } from './webull';

export interface TicketQuote {
  last: number | null;
  bid?: number | null;
  ask?: number | null;
}
export interface TicketHost {
  snapshot(): Snapshot | null;
  quote(symbol: string): TicketQuote | null;
  /** The symbol field changed (the Trade page loads that symbol's chart and quote). */
  onSymbol?(symbol: string): void;
  /** ok=false: the place failed or is unconfirmed (refresh only). */
  onPlaced(order: PlacedOrder, protectStop: number | null, ok: boolean, orderId?: string): void;
}
export interface Ticket {
  el: HTMLElement;
  fill(p: TicketPrefill): void;
  setSide(side: 'BUY' | 'SELL'): void;
  setSymbol(symbol: string): void;
  preview(): void;
  /** Redraws the estimate after new quotes or a new snapshot. */
  refresh(): void;
}

type SizeMode = 'shares' | 'dollars' | 'risk';
const TYPE_TEXT: Record<OrderType, string> = {
  MARKET: 'Fills now at the best price available. Fast, but the price can slip.',
  LIMIT: 'Fills only at your price or better. You may not get filled.',
  STOP: 'Waits until the price reaches your stop, then becomes a market order.',
  STOP_LIMIT: 'Waits for the stop, then becomes a limit order: you control the price but may not get filled.',
};
const money = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const num = (input: HTMLInputElement) => {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : null;
};

export function createTicket(host: TicketHost, prefill: TicketPrefill = {}): Ticket {
  let side: 'BUY' | 'SELL' = 'BUY';
  let type: OrderType = 'LIMIT';
  let tif: 'DAY' | 'GTC' = 'DAY';
  let mode: SizeMode = 'shares';
  const size = readSize();

  const input = (attrs: Record<string, unknown>) => h('input', { class: 'input', autocomplete: 'off', ...attrs }) as HTMLInputElement;
  const symbol = input({ placeholder: 'AAPL', spellcheck: false, 'aria-label': 'Symbol', maxlength: 7, class: 'input tk-symbol' });
  const qty = input({ type: 'number', min: 1, step: 1, placeholder: '0', 'aria-label': 'Shares', inputmode: 'numeric' });
  const dollars = input({ type: 'number', min: 1, step: 50, placeholder: '1000', 'aria-label': 'Dollar amount', inputmode: 'decimal' });
  const riskStop = input({ type: 'number', min: 0, step: 0.01, placeholder: '0.00', 'aria-label': 'Your stop (exit) price', inputmode: 'decimal' });
  const riskPct = input({ type: 'number', min: 0.1, max: 5, step: 0.25, value: size.risk, 'aria-label': 'Risk per trade (%)', inputmode: 'decimal' });
  const limit = input({ type: 'number', min: 0, step: 0.01, placeholder: '0.00', 'aria-label': 'Limit price', inputmode: 'decimal' });
  const stop = input({ type: 'number', min: 0, step: 0.01, placeholder: '0.00', 'aria-label': 'Stop price', inputmode: 'decimal' });

  const sideEl = h('div', { class: 'tk-side', role: 'group', 'aria-label': 'Buy or sell' });
  const typeEl = h('div', { class: 'segmented tk-seg', role: 'group', 'aria-label': 'Order type' });
  const typeText = h('p', { class: 'muted small tk-type-text' });
  const tifEl = h('div', { class: 'segmented tk-seg', role: 'group', 'aria-label': 'Time in force' });
  const modeEl = h('div', { class: 'segmented tk-seg', role: 'group', 'aria-label': 'Size by' });
  const helpers = h('div', { class: 'tk-helpers' });
  const quick = h('div', { class: 'tk-quick' });
  const sizeNote = h('p', { class: 'muted small tk-note' });
  const summary = h('div', { class: 'tk-summary' });
  const previewBtn = h('button', { class: 'btn primary tk-preview', type: 'submit' }, 'Preview buy') as HTMLButtonElement;
  const lastEl = h('span', { class: 'muted small tk-last' });

  const row = (label: Node | string, ...children: (Node | string)[]) => h('label', { class: 'tk-row' }, h('span', { class: 'tk-label' }, label), ...children);
  const limitRow = row('Limit price', h('div', { class: 'tk-price' }, limit), helpers);
  const stopRow = row('Stop price', stop);
  const sharesRow = row('Shares', qty);
  const dollarsRow = row('Amount ($)', dollars);
  const riskRow = h('div', { class: 'tk-risk' }, row(h('span', {}, 'Your stop (exit)', infoTip('stop')), riskStop), row('Risk % of account', riskPct));

  const segButtons = <T extends string>(el: HTMLElement, options: [T, string][], current: T, pick: (v: T) => void, disabled: (v: T) => boolean = () => false) =>
    el.replaceChildren(...options.map(([v, l]) => h('button', { type: 'button', class: v === current ? 'active' : '', disabled: disabled(v), 'aria-pressed': v === current, onclick: () => pick(v) }, l)));

  const sym = () => symbol.value.trim().toUpperCase();
  const quote = () => host.quote(sym());
  const position = () => host.snapshot()?.positions?.find((p) => p.symbol === sym());
  /** Shares that can be sold: the position minus shares already in open sell orders (as the helper checks). */
  const available = () => {
    const held = position()?.qty ?? 0;
    const selling = (host.snapshot()?.open ?? []).filter((o) => o.symbol === sym() && o.side === 'SELL' && OPEN.test(o.status)).reduce((t, o) => t + Math.max((o.qty ?? 0) - o.filled, 0), 0);
    return Math.max(held - selling, 0);
  };
  const basis = () => basisPrice(type, quote()?.last ?? null, num(limit), num(stop));
  const accountValue = () => host.snapshot()?.balances?.value ?? size.account;

  /** Shares the ticket would send, and a sentence on how they were worked out. */
  function shares(): { n: number; note: string } {
    const price = basis();
    if (mode === 'shares') return { n: Math.max(Math.floor(num(qty) ?? 0), 0), note: '' };
    if (mode === 'dollars') {
      const d = num(dollars) ?? 0;
      if (!price) return { n: 0, note: 'Waiting for a price to work out the shares.' };
      const r = sharesForDollars(d, price);
      return { n: r.shares, note: d > 0 ? (r.shares ? `= ${r.shares} share${r.shares === 1 ? '' : 's'} (${usd(r.cost)}); ${usd(r.left)} left over, because only whole shares are bought.` : `${usd(d)} is less than one share at ${usd(price)}.`) : '' };
    }
    const s = num(riskStop);
    const pct = num(riskPct) ?? 0;
    if (!price) return { n: 0, note: 'Waiting for a price to work out the shares.' };
    if (!s) return { n: 0, note: 'Enter the price where you would get out if the trade goes wrong.' };
    if (s >= price) return { n: 0, note: 'For a buy, your stop has to be below the entry price.' };
    const r = riskShares(accountValue(), pct, price, s);
    return { n: r.shares, note: `Risk ${usd(r.riskDollars)} (${pct}% of ${money(accountValue())}) ÷ ${usd(r.perShare)} a share = ${r.shares} share${r.shares === 1 ? '' : 's'}. If the stop is hit you lose about ${usd(r.shares * r.perShare)}.` };
  }

  function draw() {
    if (type === 'MARKET') tif = 'DAY';
    if (side === 'SELL' && mode === 'risk') mode = 'shares';
    const buy = side === 'BUY';
    sideEl.replaceChildren(
      h('button', { type: 'button', class: `tk-buy${buy ? ' active' : ''}`, 'aria-pressed': buy, onclick: () => setSide('BUY'), title: 'Buy (B)' }, 'Buy'),
      h('button', { type: 'button', class: `tk-sell${buy ? '' : ' active'}`, 'aria-pressed': !buy, onclick: () => setSide('SELL'), title: 'Sell (S)' }, 'Sell'),
    );
    segButtons<OrderType>(typeEl, (Object.keys(TYPE_LABELS) as OrderType[]).map((t) => [t, TYPE_LABELS[t]]), type, (v) => ((type = v), draw()));
    typeText.textContent = TYPE_TEXT[type];
    segButtons<'DAY' | 'GTC'>(tifEl, [['DAY', 'Day'], ['GTC', 'GTC']], tif, (v) => ((tif = v), draw()), (v) => v === 'GTC' && type === 'MARKET');
    segButtons<SizeMode>(modeEl, [['shares', 'Shares'], ['dollars', 'Dollars'], ['risk', 'Risk']], mode, (v) => ((mode = v), draw()), (v) => v === 'risk' && !buy);
    limitRow.hidden = !(type === 'LIMIT' || type === 'STOP_LIMIT');
    stopRow.hidden = !(type === 'STOP' || type === 'STOP_LIMIT');
    sharesRow.hidden = mode !== 'shares';
    dollarsRow.hidden = mode !== 'dollars';
    riskRow.hidden = mode !== 'risk';
    previewBtn.textContent = buy ? 'Preview buy' : 'Preview sell';
    previewBtn.classList.toggle('tk-is-sell', !buy);
    el.classList.toggle('tk-selling', !buy);
    refresh();
  }

  function refresh() {
    const q = quote();
    lastEl.textContent = q?.last ? `Last ${usd(q.last)}${q.bid && q.ask ? ` · bid ${formatPrice(q.bid)} / ask ${formatPrice(q.ask)}` : ''}` : sym() ? 'No live price yet' : '';
    // limit price helpers
    const mid = q?.bid && q?.ask ? (q.bid + q.ask) / 2 : null;
    const priceButtons: [string, number | null | undefined][] = [['Bid', q?.bid], ['Mid', mid], ['Ask', q?.ask], ['Last', q?.last]];
    helpers.replaceChildren(
      ...priceButtons
        .filter(([, v]) => v && v > 0)
        .map(([label, v]) => h('button', { type: 'button', class: 'chip', title: `Use the ${label.toLowerCase()} price`, onclick: (e: Event) => (e.preventDefault(), (limit.value = (v as number).toFixed(2)), refresh()) }, label)),
    );
    // quick buttons
    const snap = host.snapshot();
    const price = basis();
    if (side === 'BUY') {
      const max = price ? maxBuyShares(price, snap?.limits.maxOrder ?? 0, snap?.balances?.buyingPower) : 0;
      quick.replaceChildren(
        ...[500, 1000].map((d) => h('button', { type: 'button', class: 'chip', onclick: () => ((mode = 'dollars'), (dollars.value = String(d)), draw()) }, money(d))),
        h('button', { type: 'button', class: 'chip', disabled: !max, title: 'The most whole shares under your max order value and buying power', onclick: () => ((mode = 'shares'), (qty.value = String(max)), draw()) }, max ? `Max ${max}` : 'Max'),
      );
    } else {
      const can = available();
      quick.replaceChildren(
        ...[0.25, 0.5, 1].map((f) => h('button', { type: 'button', class: 'chip', disabled: !can, onclick: () => ((mode = 'shares'), (qty.value = String(sellFraction(can, f))), draw()) }, `${f * 100}%`)),
        h('span', { class: 'muted small' }, sym() ? (can ? `You can sell ${can.toLocaleString('en-US')}` : `You hold no ${sym()} to sell`) : ''),
      );
    }
    const s = shares();
    sizeNote.textContent = s.note;
    sizeNote.hidden = !s.note;
    const est = estimate(side, s.n, price, snap?.balances?.buyingPower);
    const warns: string[] = [];
    if (est.value != null && snap && est.value > snap.limits.maxOrder) warns.push(`Above your max order value of ${money(snap.limits.maxOrder)} (Settings).`);
    if (side === 'BUY' && est.after != null && est.after < 0) warns.push('More than your buying power.');
    if (side === 'SELL' && s.n > available()) warns.push('More than you can sell (no short selling).');
    summary.replaceChildren(
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Shares'), h('b', { class: 'num' }, s.n ? s.n.toLocaleString('en-US') : '—')),
      h('div', { class: 'tk-sum-row tk-sum-main' }, h('span', { class: 'muted' }, side === 'BUY' ? 'Estimated cost' : 'Estimated proceeds'), h('b', { class: 'num' }, usd(est.value))),
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Buying power after'), h('span', { class: `num${est.after != null && est.after < 0 ? ' down' : ''}` }, usd(est.after))),
      ...warns.map((w) => h('p', { class: 'wb-warn small tk-warn' }, `⚠ ${w}`)),
    );
  }

  function setSide(v: 'BUY' | 'SELL') {
    side = v;
    draw();
  }

  function setSymbol(v: string) {
    symbol.value = v.toUpperCase();
    draw();
  }

  function fill(p: TicketPrefill) {
    if (p.symbol) symbol.value = p.symbol.toUpperCase();
    if (p.side) side = p.side;
    if (p.orderType) type = p.orderType;
    if (p.tif) tif = p.tif;
    if (p.qty) ((mode = 'shares'), (qty.value = String(p.qty)));
    limit.value = p.limitPrice != null ? String(p.limitPrice) : p.orderType ? '' : limit.value;
    stop.value = p.stopPrice != null ? String(p.stopPrice) : p.orderType ? '' : stop.value;
    if (p.guideStop != null) riskStop.value = String(p.guideStop);
    draw();
    if (p.symbol) host.onSymbol?.(sym());
  }

  function preview() {
    const s = sym();
    if (!s) return toast('Enter a symbol');
    const n = shares().n;
    if (!(n > 0)) return toast(mode === 'shares' ? 'Enter the number of shares' : 'The size works out to 0 shares');
    const order: PlacedOrder = { symbol: s, side, qty: n, orderType: type, tif };
    if (type === 'LIMIT' || type === 'STOP_LIMIT') {
      const v = num(limit);
      if (!v) return toast('Enter a limit price');
      order.limitPrice = v;
    }
    if (type === 'STOP' || type === 'STOP_LIMIT') {
      const v = num(stop);
      if (!v) return toast('Enter a stop price');
      order.stopPrice = v;
    }
    const protect = side === 'BUY' ? num(riskStop) : null;
    confirmOrder(order, (placed, ok, orderId) => host.onPlaced(placed, protect, ok, orderId));
  }

  for (const i of [qty, dollars, riskStop, limit, stop]) i.addEventListener('input', refresh);
  riskPct.addEventListener('input', () => {
    const v = num(riskPct);
    if (v && v > 0 && v <= 5) saveSize({ ...readSize(), risk: v });
    refresh();
  });
  let symTimer: ReturnType<typeof setTimeout> | undefined;
  symbol.addEventListener('input', () => {
    refresh();
    clearTimeout(symTimer);
    symTimer = setTimeout(() => sym() && host.onSymbol?.(sym()), 600);
  });

  const el = h(
    'form',
    { class: 'tk', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), preview()) },
    sideEl,
    h('div', { class: 'tk-symrow' }, row('Symbol', symbol), lastEl),
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Order type', infoTip('ordertype')), typeEl, typeText),
    limitRow,
    stopRow,
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Size by'), modeEl),
    sharesRow,
    dollarsRow,
    riskRow,
    sizeNote,
    quick,
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Time in force', infoTip('tif')), tifEl),
    summary,
    previewBtn,
    h('p', { class: 'muted tiny tk-foot' }, 'Preview checks the order with Webull and your limits. Nothing is sent until you press Place order in the next window.'),
  );
  fill(prefill);
  return { el, fill, setSide, setSymbol, preview, refresh };
}
