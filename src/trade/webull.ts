/**
 * Webull pieces shared by the Trade page and the Portfolios > Webull view: the reply types, the environment badge,
 * the one-request account snapshot, cancelling with a confirm, and the confirm window.
 *
 * The safety flow lives in one place (confirmOrder): the helper previews the order (checks the limits and returns a
 * one-time token valid for 60 seconds), the window restates the exact order with the environment badge and a
 * countdown, and only its "Place order" button sends that token. Nothing places an order on its own; the Setups trade
 * guide only pre-fills the ticket (openOrderTicket).
 */
import { engineRequest } from '../data/schwab';
import { statCards } from '../ui/charts';
import { h, openModal, toast } from '../ui/dom';
import type { OrderKind } from './sizing';

export type Env = 'test' | 'live';
export type OrderType = OrderKind;

export interface TicketPrefill {
  symbol?: string;
  side?: 'BUY' | 'SELL';
  qty?: number;
  orderType?: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'DAY' | 'GTC';
  /** The trade guide's stop: remembered so "Protect" can offer a stop sell after the buy fills. */
  guideStop?: number;
}

export interface Balances {
  value: number | null;
  cash: number | null;
  buyingPower: number | null;
  marketValue?: number | null;
}
export interface Position {
  symbol: string;
  qty: number;
  avgCost: number | null;
  cost: number | null;
  price: number | null;
  value: number | null;
  gain: number | null;
  dayGain?: number | null;
  type?: string;
}
export interface Order {
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
/** webull.snapshot (helper v27): the status fields plus everything a view shows, in one request. */
export interface Snapshot {
  ok: boolean;
  busy?: boolean;
  env: Env;
  liveEnabled?: boolean;
  message: string;
  accounts: { id: string; label: string }[];
  limits: { maxOrder: number; maxPerDay: number };
  placedToday?: number | null;
  accountId?: string;
  account?: string;
  balances?: Balances | null;
  positions?: Position[] | null;
  open?: Order[] | null;
  recent?: Order[] | null;
  errors?: Record<string, string>;
  /** When the oldest section was fetched from Webull (unix seconds; the helper reuses answers for 20 s). */
  asOf?: number | null;
}
interface Preview {
  token: string;
  expiresIn: number;
  summary: string;
  env: Env;
  account: string;
  estimate: { value: number; last: number };
  warnings: string[];
  marketNote: string;
  limits: { maxOrder: number; maxPerDay: number };
  placedToday: number;
}
export interface PlacedOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif: 'DAY' | 'GTC';
}

export const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const TYPE_LABELS: Record<OrderType, string> = { MARKET: 'Market', LIMIT: 'Limit', STOP: 'Stop', STOP_LIMIT: 'Stop-limit' };
export const OPEN = /SUBMITTED|PARTIAL|PENDING|WORKING|NEW/;

/** The environment badge: calm for Test, red for Live. */
export function envBadge(env: Env) {
  return env === 'live' ? h('span', { class: 'badge down wb-env' }, 'LIVE — real money') : h('span', { class: 'badge accent wb-env' }, 'TEST — no real money');
}

export function friendly(err: unknown) {
  const message = (err as Error).message;
  return /doesn.t know|unknown request|update/i.test(message) ? 'Your helper is too old for this: download the project ZIP again to update it.' : message;
}

/** Everything about one Webull account in one helper request (the helper paces and reuses Webull calls). */
export function loadSnapshot(accountId?: string) {
  return engineRequest<Snapshot>('webull.snapshot', accountId ? { accountId } : {}, 60000);
}

/** Cancels an open order after a plain confirm. Resolves true when the cancel was sent. */
export async function cancelOrder(o: Order): Promise<boolean> {
  if (!confirm(`Cancel the ${o.side.toLowerCase()} order for ${o.qty} ${o.symbol}?`)) return false;
  try {
    await engineRequest('webull.cancel_order', { orderId: o.orderId }, 30000);
    toast('Cancel sent');
    return true;
  } catch (err) {
    toast(friendly(err));
    return false;
  }
}

/** "stop $120.00 limit $119.50", or — for a market order. */
export const orderPrice = (o: Order) => [o.stopPrice != null ? `stop ${usd(o.stopPrice)}` : '', o.limitPrice != null ? `limit ${usd(o.limitPrice)}` : ''].filter(Boolean).join(' ') || '—';

// ----- Pre-filling the Trade page from elsewhere (the Setups trade guide) -----

const PREFILL_KEY = 'tp-trade-prefill';

/** Opens the Trade page with the ticket filled in. Pre-fills only: the owner still previews and confirms. */
export function openOrderTicket(prefill: TicketPrefill) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* the event below still carries it when the page is already open */
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // close the trade guide window
  location.hash = '#trade';
  window.dispatchEvent(new CustomEvent('tp:trade-prefill', { detail: prefill }));
}

/** The waiting pre-fill, once (the Trade page reads it when it opens). */
export function takePrefill(): TicketPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    return raw ? (JSON.parse(raw) as TicketPrefill) : null;
  } catch {
    return null;
  }
}

// ----- The confirm window -----

/** Asks the helper for a preview, restates it, and only then enables "Place order". */
const UNCONFIRMED = 'We couldn’t confirm whether the order was placed. Check Orders before trying again.';

/** onPlaced(order, ok): ok=false after a failed or unconfirmed place (the caller only refreshes). */
export function confirmOrder(order: PlacedOrder, onPlaced: (order: PlacedOrder, ok: boolean) => void) {
  const content = h('div', { class: 'wb-confirm' }, h('div', { class: 'muted pad' }, 'Checking the order…'));
  const place = h('button', { class: 'btn primary', disabled: true }, 'Place order') as HTMLButtonElement;
  const timer = h('span', { class: 'muted small' });
  let tick: ReturnType<typeof setInterval> | undefined;
  const close = openModal('Confirm order', h('div', {}, content, h('div', { class: 'ap-controls wb-confirm-actions' }, timer, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), place)), {
    noAutofocus: true,
    onClose: () => clearInterval(tick),
  });
  engineRequest<Preview>('webull.preview_order', { ...order }, 30000).then(
    (p) => {
      const live = p.env === 'live';
      content.replaceChildren(
        h('div', { class: 'wb-confirm-env' }, envBadge(p.env), h('span', { class: 'muted small' }, `Account ${p.account}`)),
        live ? h('p', { class: 'wb-warning' }, 'This is a REAL order with real money.') : '',
        h('p', { class: `wb-summary ${order.side === 'SELL' ? 'is-sell' : 'is-buy'}` }, p.summary),
        statCards([
          { label: 'Estimated value', value: usd(p.estimate.value), hint: 'Shares × price (limit, stop, or the last price for market orders)' },
          { label: 'Last price', value: usd(p.estimate.last) },
          { label: 'Orders today', value: `${p.placedToday} of ${p.limits.maxPerDay}`, hint: 'Every order sent today counts, even one that failed' },
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
            // 90 s: well above the helper's 10 s send deadline plus Webull's answer and a lookup by order id
            const r = await engineRequest<{ orderId: string; summary: string; env: Env }>('webull.place_order', { token: p.token }, 90000);
            close();
            toast(`Order placed${r.env === 'live' ? ' (LIVE)' : ' (Test)'}: ${r.summary}`);
            onPlaced(order, true);
          } catch (err) {
            timer.textContent = '';
            // No answer from the helper (timeout or lost connection): the order may have gone through.
            const unknown = /took too long|Lost connection/i.test((err as Error).message);
            content.append(h('div', { class: 'ap-error' }, unknown ? UNCONFIRMED : friendly(err)));
            onPlaced(order, false); // refresh the account anyway, so Orders shows what Webull has
          }
        },
        { once: true },
      );
    },
    (err) => content.replaceChildren(h('div', { class: 'ap-error' }, friendly(err))),
  );
}
