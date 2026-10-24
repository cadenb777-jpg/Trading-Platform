/**
 * Webull on the Portfolios page: balances, positions, open and recent orders, "Sync to Portfolios", and the order
 * ticket. Every order is previewed by the helper first (it checks the limits and returns a one-time token valid for
 * 60 seconds); the confirm window restates the exact order and only its "Place order" button sends that token.
 * Nothing here places an order on its own: the trade guide only pre-fills the ticket.
 */
import { engineRequest } from '../data/schwab';
import { dataTable, statCards } from '../ui/charts';
import { h, openModal, toast } from '../ui/dom';
import { termLabel } from '../ui/glossary';
import type { Portfolio } from './types';

type Env = 'test' | 'live';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export interface TicketPrefill {
  symbol?: string;
  side?: 'BUY' | 'SELL';
  qty?: number;
  orderType?: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'DAY' | 'GTC';
}

interface Status {
  ok: boolean;
  env: Env;
  message: string;
  accounts: { id: string; label: string }[];
  limits: { maxOrder: number; maxPerDay: number };
  placedToday?: number;
}
interface Balances {
  value: number | null;
  cash: number | null;
  buyingPower: number | null;
  marketValue: number | null;
}
interface Position {
  symbol: string;
  qty: number;
  avgCost: number | null;
  cost: number | null;
  price: number | null;
  value: number | null;
  gain: number | null;
}
interface Order {
  orderId: string;
  symbol: string;
  side: string;
  qty: number | null;
  filled: number;
  type: string;
  limitPrice: number | null;
  stopPrice: number | null;
  tif: string;
  status: string;
  placedAt: string;
}
interface Preview {
  token: string;
  expiresIn: number;
  summary: string;
  env: Env;
  account: string;
  estimate: { value: number; last: number; webullAmount: number | null; fees: number | null };
  warnings: string[];
  marketNote: string;
  limits: { maxOrder: number; maxPerDay: number };
  placedToday: number;
}

const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TYPE_LABELS: Record<OrderType, string> = { MARKET: 'Market', LIMIT: 'Limit', STOP: 'Stop', STOP_LIMIT: 'Stop-limit' };
const OPEN = /SUBMITTED|PARTIAL|PENDING|WORKING|NEW/;

/** The environment badge: calm for Test, red for Live. */
export function envBadge(env: Env) {
  return env === 'live' ? h('span', { class: 'badge down wb-env' }, 'LIVE — real money') : h('span', { class: 'badge accent wb-env' }, 'TEST — no real money');
}

function friendly(err: unknown) {
  const message = (err as Error).message;
  return /doesn.t know|unknown request|update/i.test(message) ? 'Your helper is too old for Webull: download the project ZIP again to update it.' : message;
}

export async function renderWebull(out: HTMLElement, onSynced: (p: Portfolio & { id: string }) => void) {
  out.replaceChildren(h('div', { class: 'muted pad' }, 'Connecting to Webull…'));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let status: Status;
  try {
    status = await engineRequest<Status>('webull.status', {}, 30000);
  } catch (err) {
    out.replaceChildren(h('div', { class: 'ap-error' }, friendly(err)));
    return;
  }
  if (!status.ok) {
    out.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'empty-state' },
          h('b', {}, 'Webull isn’t connected yet.'),
          h('span', {}, status.message),
          h('button', { class: 'btn primary', onclick: async () => (await import('../ui/settings')).openSettings() }, 'Open Settings'),
        ),
      ),
    );
    return;
  }
  let accountId = status.accounts[0]?.id ?? '';
  const body = h('div', { class: 'wb-body' });
  const accountPick =
    status.accounts.length > 1
      ? (() => {
          const sel = h('select', { class: 'input', 'aria-label': 'Account' }, ...status.accounts.map((a) => h('option', { value: a.id }, a.label))) as HTMLSelectElement;
          sel.addEventListener('change', () => ((accountId = sel.value), load()));
          return sel;
        })()
      : h('span', { class: 'muted small' }, status.accounts[0]?.label ?? '');
  const syncBtn = h('button', { class: 'btn', title: 'Save these holdings as a portfolio so analysis and Dividends work on them' }, 'Sync to Portfolios') as HTMLButtonElement;
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      const r = await engineRequest<{ portfolio: Portfolio & { id: string }; skipped: number }>('webull.sync', { accountId }, 60000);
      toast(`Saved "${r.portfolio.name}"${r.skipped ? ` (${r.skipped} non-stock position${r.skipped === 1 ? '' : 's'} left out)` : ''}`);
      onSynced(r.portfolio);
    } catch (err) {
      toast(friendly(err));
    } finally {
      syncBtn.disabled = false;
    }
  });
  out.replaceChildren(
    h(
      'section',
      { class: `panel wb-panel${status.env === 'live' ? ' wb-is-live' : ''}` },
      h(
        'div',
        { class: 'panel-head wb-head' },
        h('h3', {}, 'Webull'),
        envBadge(status.env),
        accountPick,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => load() }, 'Refresh'),
        syncBtn,
      ),
      status.env === 'live' ? h('p', { class: 'wb-warning small' }, 'Live: orders placed here use real money in your Webull account.') : h('p', { class: 'muted small' }, 'Test environment: Webull’s practice account. Nothing real is bought or sold. Switch in Settings.'),
      body,
    ),
  );

  async function load() {
    body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading your account…'));
    const [bal, pos, ord] = await Promise.allSettled([
      engineRequest<Balances>('webull.account', { accountId }, 30000),
      engineRequest<{ positions: Position[] }>('webull.positions', { accountId }, 30000),
      engineRequest<{ open: Order[]; recent: Order[] }>('webull.orders', { accountId }, 30000),
    ]);
    const fail = (r: PromiseRejectedResult) => h('div', { class: 'ap-error' }, friendly(r.reason));
    const held = pos.status === 'fulfilled' ? pos.value.positions : [];
    body.replaceChildren(
      bal.status === 'fulfilled'
        ? statCards([
            { label: 'Account value', value: usd(bal.value.value) },
            { label: 'Cash', value: usd(bal.value.cash) },
            { label: 'Buying power', value: usd(bal.value.buyingPower), hint: 'What you can spend on new orders now' },
            { label: 'Limits', value: `$${status.limits.maxOrder.toLocaleString('en-US', { maximumFractionDigits: 0 })} · ${status.limits.maxPerDay}/day`, hint: 'Max order value and orders per day (Settings)' },
          ])
        : fail(bal),
      h('h4', { class: 'section-label' }, 'Order ticket'),
      orderTicket({}, () => load(), held),
      h('h4', { class: 'section-label' }, 'Positions'),
      pos.status === 'fulfilled'
        ? held.length
          ? dataTable(
              ['Symbol', 'Shares', 'Avg cost', 'Price', 'Value', 'Gain'],
              held.map((p) => [
                { v: p.symbol, cls: 'label' },
                { v: p.qty.toLocaleString('en-US'), cls: 'num' },
                { v: usd(p.avgCost), cls: 'num' },
                { v: usd(p.price), cls: 'num' },
                { v: usd(p.value), cls: 'num' },
                { v: usd(p.gain), cls: `num ${p.gain == null ? '' : p.gain >= 0 ? 'up' : 'down'}` },
              ]),
            )
          : h('div', { class: 'empty-state' }, 'No positions in this account.')
        : fail(pos),
      h('h4', { class: 'section-label' }, 'Orders'),
      ord.status === 'fulfilled' ? ordersTable([...ord.value.open, ...ord.value.recent], () => load()) : fail(ord),
    );
  }
  load();
}

function ordersTable(orders: Order[], refresh: () => void) {
  if (!orders.length) return h('div', { class: 'empty-state' }, 'No open or recent orders.');
  const price = (o: Order) => [o.stopPrice != null ? `stop ${usd(o.stopPrice)}` : '', o.limitPrice != null ? `limit ${usd(o.limitPrice)}` : ''].filter(Boolean).join(' ') || '—';
  return dataTable(
    ['Symbol', 'Side', 'Qty', 'Type', 'Price', 'Time', 'Status', ''],
    orders.map((o) => [
      { v: o.symbol, cls: 'label' },
      o.side,
      { v: `${o.filled ? `${o.filled}/` : ''}${o.qty ?? '—'}`, cls: 'num' },
      o.type.replace(/_/g, ' ').toLowerCase(),
      price(o),
      o.tif,
      { v: o.status.replace(/_/g, ' ').toLowerCase(), cls: OPEN.test(o.status) ? 'wb-warn' : '' },
      OPEN.test(o.status) && o.orderId
        ? h(
            'button',
            {
              class: 'btn small',
              onclick: async (e: Event) => {
                if (!confirm(`Cancel the ${o.side.toLowerCase()} order for ${o.qty} ${o.symbol}?`)) return;
                (e.target as HTMLButtonElement).disabled = true;
                try {
                  await engineRequest('webull.cancel_order', { orderId: o.orderId }, 30000);
                  toast('Cancel sent');
                  refresh();
                } catch (err) {
                  toast(friendly(err));
                  (e.target as HTMLButtonElement).disabled = false;
                }
              },
            },
            'Cancel',
          )
        : '',
    ]),
    undefined,
    { id: 'webull:orders' },
  );
}

/** The order ticket: fill in, Preview (helper checks it), then confirm in a window that restates the order. */
export function orderTicket(prefill: TicketPrefill, onPlaced: () => void, held: Position[] = []): HTMLElement {
  let side: 'BUY' | 'SELL' = prefill.side ?? 'BUY';
  let tif: 'DAY' | 'GTC' = prefill.tif ?? 'DAY';
  const symbol = h('input', { class: 'input', value: prefill.symbol ?? '', placeholder: 'AAPL', autocomplete: 'off', spellcheck: false, 'aria-label': 'Symbol', maxlength: 7 }) as HTMLInputElement;
  const qty = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: prefill.qty ?? '', placeholder: 'Shares', 'aria-label': 'Quantity' }) as HTMLInputElement;
  const type = h('select', { class: 'input', 'aria-label': 'Order type' }, ...(Object.keys(TYPE_LABELS) as OrderType[]).map((t) => h('option', { value: t, selected: t === (prefill.orderType ?? 'LIMIT') }, TYPE_LABELS[t]))) as HTMLSelectElement;
  const limit = h('input', { class: 'input', type: 'number', min: 0, step: 0.01, value: prefill.limitPrice ?? '', placeholder: '0.00', 'aria-label': 'Limit price' }) as HTMLInputElement;
  const stop = h('input', { class: 'input', type: 'number', min: 0, step: 0.01, value: prefill.stopPrice ?? '', placeholder: '0.00', 'aria-label': 'Stop price' }) as HTMLInputElement;
  const redraws: (() => void)[] = [];
  const seg = <T extends string>(options: [T, string][], get: () => T, set: (v: T) => void, label: string) => {
    const el = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
    const draw = () =>
      el.replaceChildren(...options.map(([v, l]) => h('button', { type: 'button', class: `${v === get() ? 'active' : ''}${v === 'SELL' && v === get() ? ' wb-sell' : ''}`, onclick: () => (set(v), update()) }, l)));
    redraws.push(draw);
    return el;
  };
  const field = (label: Node | string, input: HTMLElement) => h('label', { class: 'wb-field' }, h('span', { class: 'muted tiny' }, label), input);
  const limitField = field('Limit price ($)', limit);
  const stopField = field('Stop price ($)', stop);
  const heldNote = h('p', { class: 'muted small' });
  const update = () => {
    const t = type.value as OrderType;
    limitField.hidden = !(t === 'LIMIT' || t === 'STOP_LIMIT');
    stopField.hidden = !(t === 'STOP' || t === 'STOP_LIMIT');
    if (t === 'MARKET' && tif === 'GTC') tif = 'DAY';
    redraws.forEach((draw) => draw());
    const own = held.find((p) => p.symbol === symbol.value.trim().toUpperCase());
    heldNote.textContent = side === 'SELL' ? (own ? `You hold ${own.qty} ${own.symbol}. Sells can’t be larger than that (no short selling).` : 'Sells can’t be larger than what you hold (no short selling).') : '';
  };
  type.addEventListener('change', update);
  symbol.addEventListener('input', update);
  const preview = h('button', { class: 'btn primary', type: 'button' }, 'Preview order') as HTMLButtonElement;
  preview.addEventListener('click', () => {
    const t = type.value as OrderType;
    const order: Record<string, unknown> = { symbol: symbol.value.trim().toUpperCase(), side, qty: Number(qty.value), orderType: t, tif };
    if (t === 'LIMIT' || t === 'STOP_LIMIT') order.limitPrice = Number(limit.value);
    if (t === 'STOP' || t === 'STOP_LIMIT') order.stopPrice = Number(stop.value);
    if (!order.symbol) return toast('Enter a symbol');
    if (!(Number(order.qty) > 0)) return toast('Enter the number of shares');
    confirmOrder(order, onPlaced);
  });
  const el = h(
    'div',
    { class: 'wb-ticket' },
    h(
      'div',
      { class: 'wb-ticket-grid' },
      field('Symbol', symbol),
      field('Side', seg<'BUY' | 'SELL'>([['BUY', 'Buy'], ['SELL', 'Sell']], () => side, (v) => (side = v), 'Side')),
      field('Quantity (shares)', qty),
      field(termLabel('Order type', 'ordertype'), type),
      limitField,
      stopField,
      field(termLabel('Time in force', 'tif'), seg<'DAY' | 'GTC'>([['DAY', 'Day'], ['GTC', 'GTC']], () => tif, (v) => (tif = type.value === 'MARKET' ? 'DAY' : v), 'Time in force')),
    ),
    heldNote,
    h('div', { class: 'ap-controls' }, preview, h('span', { class: 'muted small' }, 'Preview checks the order; nothing is sent until you press Place order in the next window.')),
  );
  update();
  return el;
}

/** Opens the ticket in a window (used by the Setups trade guide). Pre-fills only: the owner still previews and confirms. */
export function openOrderTicket(prefill: TicketPrefill) {
  const close = openModal('Order ticket (Webull)', h('div', {}, orderTicket(prefill, () => close())), { wide: true, noAutofocus: true });
}

/** The confirm window: asks the helper for a preview, restates it, and only then enables "Place order". */
function confirmOrder(order: Record<string, unknown>, onPlaced: () => void) {
  const content = h('div', { class: 'wb-confirm' }, h('div', { class: 'muted pad' }, 'Checking the order…'));
  const place = h('button', { class: 'btn primary', disabled: true }, 'Place order') as HTMLButtonElement;
  const timer = h('span', { class: 'muted small' });
  let tick: ReturnType<typeof setInterval> | undefined;
  const close = openModal('Confirm order', h('div', {}, content, h('div', { class: 'ap-controls wb-confirm-actions' }, timer, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), place)), {
    noAutofocus: true,
    onClose: () => clearInterval(tick),
  });
  engineRequest<Preview>('webull.preview_order', order, 30000).then(
    (p) => {
      const live = p.env === 'live';
      content.replaceChildren(
        h('div', { class: 'wb-confirm-env' }, envBadge(p.env), h('span', { class: 'muted small' }, `Account ${p.account}`)),
        live ? h('p', { class: 'wb-warning' }, 'This is a REAL order with real money.') : '',
        h('p', { class: 'wb-summary' }, p.summary),
        statCards([
          { label: 'Estimated value', value: usd(p.estimate.value), hint: 'Shares × price (limit, stop, or the last price for market orders)' },
          { label: 'Last price', value: usd(p.estimate.last) },
          ...(p.estimate.fees != null ? [{ label: 'Est. fees', value: usd(p.estimate.fees) }] : []),
          { label: 'Orders today', value: `${p.placedToday} of ${p.limits.maxPerDay}` },
        ]),
        h('p', { class: 'muted small' }, p.marketNote),
        ...p.warnings.map((w) => h('p', { class: 'wb-warn small' }, `⚠ ${w}`)),
      );
      place.disabled = false;
      place.classList.toggle('danger', live);
      place.classList.toggle('primary', !live);
      place.textContent = live ? 'Place LIVE order' : 'Place test order';
      let left = p.expiresIn - 2; // a little margin for the trip to the helper
      const draw = () => (timer.textContent = left > 0 ? `Preview valid for ${left}s` : 'Preview expired: close and preview again.');
      draw();
      tick = setInterval(() => {
        left -= 1;
        draw();
        if (left <= 0) {
          clearInterval(tick);
          place.disabled = true;
        }
      }, 1000);
      place.addEventListener(
        'click',
        async () => {
          place.disabled = true;
          clearInterval(tick);
          timer.textContent = 'Sending…';
          try {
            const r = await engineRequest<{ orderId: string; summary: string; env: Env }>('webull.place_order', { token: p.token }, 30000);
            close();
            toast(`Order placed${r.env === 'live' ? ' (LIVE)' : ' (Test)'}: ${r.summary}`);
            onPlaced();
          } catch (err) {
            timer.textContent = '';
            content.append(h('div', { class: 'ap-error' }, friendly(err)));
          }
        },
        { once: true },
      );
    },
    (err) => content.replaceChildren(h('div', { class: 'ap-error' }, friendly(err))),
  );
}
