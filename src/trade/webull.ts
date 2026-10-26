/**
 * Webull pieces shared by the Trade page and the Portfolios > Webull view: the reply types, the environment badge,
 * the one-request account snapshot, cancelling with a confirm, and the confirm window.
 *
 * The safety flow lives in one place (confirmOrder): the helper previews the order (checks the limits and returns a
 * one-time token valid for 60 seconds), the window restates the exact order with the environment badge and a
 * countdown, and only its "Place order" button sends that token. Nothing places an order on its own; the Setups trade
 * guide only pre-fills the ticket (openOrderTicket). Futures orders (helper 31+) use the same window with the contract,
 * expiry, notional, tick value, margin and the loss to the protective stop, and a red line that futures can lose more
 * than the money put in.
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
  /** Futures account: open P/L in dollars, and the margin Webull reports (display only). */
  openPnl?: number | null;
  initMargin?: number | null;
  maintMargin?: number | null;
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
  /** Futures: dollars per one-point move of one contract (value and gain are then in dollars, qty < 0 = short). */
  multiplier?: number | null;
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
/** One Webull account: "Roth IRA ••1234". stocks=false (futures, crypto) = listed only, never viewed or traded here.
 * Helpers before the account names send only id and label. */
export interface WebullAccount {
  id: string;
  label: string;
  stocks?: boolean;
  /** The Webull futures account (helper 31+): futures only, never stocks. */
  futures?: boolean;
  retirement?: boolean;
}
/** The accounts the Trade page and the Webull view can show (older helpers: all of them). */
export const stockAccounts = (accounts: WebullAccount[]) => accounts.filter((a) => a.stocks !== false);
/** The futures account, when the owner has one and the helper knows about futures. */
export const futuresAccount = (accounts: WebullAccount[]) => accounts.find((a) => a.futures === true) ?? null;
export type Asset = 'stocks' | 'futures';
export const FUTURES_WARNING = 'Futures can lose more than you put in.';
export const IRA_NOTE = 'Retirement account (IRA): no margin and no short selling here; orders use the cash in the account.';

/** webull.snapshot (helper v27): the status fields plus everything a view shows, in one request. */
export interface Snapshot {
  ok: boolean;
  busy?: boolean;
  env: Env;
  liveEnabled?: boolean;
  message: string;
  accounts: WebullAccount[];
  limits: { maxOrder: number; maxPerDay: number };
  placedToday?: number | null;
  accountId?: string;
  account?: string;
  /** The chosen account is an IRA (no margin, no short selling). */
  retirement?: boolean;
  balances?: Balances | null;
  positions?: Position[] | null;
  open?: Order[] | null;
  recent?: Order[] | null;
  errors?: Record<string, string>;
  /** When the oldest section was fetched from Webull (unix seconds; the helper reuses answers for 20 s). */
  asOf?: number | null;
  /** Which account kind this snapshot is for (helper 31+). */
  asset?: Asset;
  futuresEnabled?: boolean;
  futuresLimits?: { maxContracts: number; maxPerDay: number };
  placedContractsToday?: number | null;
}
interface FuturesPreview {
  contract: string;
  name: string;
  expiry: string;
  cutoff: string;
  daysLeft: number;
  notional: number;
  tickValue: number;
  tickSize: number;
  multiplier: number;
  lossToStop: number | null;
  margin: number | null;
  marginNote: string;
  closing: boolean;
  /** "Opens a new LONG position of 1 contract", "Closes 1 of your 2 contracts (LONG position)". */
  effect?: string;
  stopNote?: string;
  buyingPowerNote?: string;
  contractsToday: number;
  limits: { maxContracts: number; maxPerDay: number };
}
interface Preview {
  token: string;
  expiresIn: number;
  summary: string;
  env: Env;
  account: string;
  accountId?: string;
  retirement?: boolean;
  estimate: { value: number; last: number };
  warnings: string[];
  marketNote: string;
  limits: { maxOrder: number; maxPerDay: number };
  placedToday: number;
  futures?: FuturesPreview;
}
export interface PlacedOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif: 'DAY' | 'GTC';
  /** 'futures': a contract (e.g. MESZ6) for the futures account. */
  asset?: Asset;
  /** Futures: the protective stop used only to show the loss to it (not placed with the order). */
  protectStop?: number;
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
export function loadSnapshot(accountId?: string, asset: Asset = 'stocks') {
  return engineRequest<Snapshot>('webull.snapshot', { ...(accountId ? { accountId } : {}), ...(asset === 'futures' ? { asset } : {}) }, 60000);
}

/** Cancels an open order of that account after a plain confirm. Resolves true when the cancel was sent. */
export async function cancelOrder(o: Order, accountId: string | undefined, asset: Asset = 'stocks'): Promise<boolean> {
  if (!accountId) {
    toast('The account for this order isn’t known yet. Refresh and try again.');
    return false;
  }
  if (!confirm(`Cancel the ${o.side.toLowerCase()} order for ${o.qty} ${o.symbol}?`)) return false;
  try {
    await engineRequest('webull.cancel_order', { orderId: o.orderId, accountId, ...(asset === 'futures' ? { asset } : {}) }, 30000);
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

/** onPlaced(order, ok, orderId): ok=false after a failed or unconfirmed place (the caller only refreshes).
 * accountId: the one account the order is for (never "all"); the window names it as the helper read it. */
export function confirmOrder(order: PlacedOrder, accountId: string, onPlaced: (order: PlacedOrder, ok: boolean, orderId?: string) => void) {
  const content = h('div', { class: 'wb-confirm' }, h('div', { class: 'muted pad' }, 'Checking the order…'));
  const place = h('button', { class: 'btn primary', disabled: true }, 'Place order') as HTMLButtonElement;
  const timer = h('span', { class: 'muted small' });
  let tick: ReturnType<typeof setInterval> | undefined;
  const close = openModal('Confirm order', h('div', {}, content, h('div', { class: 'ap-controls wb-confirm-actions' }, timer, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), place)), {
    noAutofocus: true,
    onClose: () => clearInterval(tick),
  });
  engineRequest<Preview>('webull.preview_order', { ...order, accountId }, 30000).then(
    (p) => {
      if (p.accountId && p.accountId !== accountId) {
        content.replaceChildren(h('div', { class: 'ap-error' }, 'The preview came back for a different account than the one chosen. Nothing was placed; close and preview again.'));
        return;
      }
      const live = p.env === 'live';
      if (order.asset === 'futures' && !p.futures) {
        // never show a futures order without its contract figures (an older helper would have answered as a stock order)
        content.replaceChildren(h('div', { class: 'ap-error' }, 'Your helper is too old for futures: download the project ZIP again to update it. Nothing was placed.'));
        return;
      }
      const f = p.futures;
      content.replaceChildren(
        h('div', { class: 'wb-confirm-env' }, envBadge(p.env), h('span', { class: 'wb-confirm-acct' }, 'Account: ', h('b', {}, p.account))),
        live ? h('p', { class: 'wb-warning' }, 'This is a REAL order with real money.') : '',
        f ? h('p', { class: 'wb-warning wb-fut-warning' }, FUTURES_WARNING) : '',
        p.retirement ? h('p', { class: 'muted small' }, IRA_NOTE) : '',
        h('p', { class: `wb-summary ${order.side === 'SELL' ? 'is-sell' : 'is-buy'}` }, p.summary),
        f?.effect ? h('p', { class: 'wb-effect' }, h('b', {}, f.effect)) : '',
        f
          ? statCards([
              { label: 'Contract', value: f.contract, hint: f.name },
              { label: 'Expiry', value: f.expiry, hint: `Last trading day. New positions stop 2 trading days before ${f.cutoff} (${f.daysLeft} trading days left); closing is allowed to the last day.` },
              { label: 'Contracts', value: String(order.qty), hint: f.closing ? 'Closing order (reduce only)' : 'Opening order (long only)' },
              { label: 'Notional', value: usd(f.notional), hint: 'Price × multiplier × contracts: what the contracts control' },
              { label: 'Tick value', value: usd(f.tickValue), hint: `One tick (${f.tickSize}) on one contract; multiplier ${f.multiplier}` },
              { label: 'Initial margin', value: f.margin != null ? usd(f.margin) : 'Set by Webull', hint: f.margin != null ? 'Money Webull sets aside to open the position' : `${f.marginNote}: money Webull sets aside to open the position` },
              { label: 'Max loss to stop', value: f.lossToStop != null ? usd(f.lossToStop) : 'No stop entered', hint: `${f.stopNote ?? 'Not placed: no stop order is sent. Place a stop separately.'} If the stop fills exactly; gaps can lose more.` },
              { label: 'Last price', value: p.estimate.last != null ? String(p.estimate.last) : '—' },
              { label: 'Contracts today', value: `${f.contractsToday} of ${f.limits.maxPerDay}`, hint: 'Every futures order sent today counts, even one that failed' },
            ])
          : statCards([
              { label: 'Estimated value', value: usd(p.estimate.value), hint: 'Shares × price (limit, stop, or the last price for market orders)' },
              { label: 'Last price', value: usd(p.estimate.last) },
              { label: 'Orders today', value: `${p.placedToday} of ${p.limits.maxPerDay}`, hint: 'Every order sent today counts, even one that failed' },
            ]),
        f ? h('p', { class: 'wb-warn small' }, f.stopNote ?? 'Not placed: no stop order is sent. Place a stop separately.') : '',
        f?.buyingPowerNote ? h('p', { class: 'muted small' }, f.buyingPowerNote) : '',
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
            onPlaced(order, true, r.orderId);
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
