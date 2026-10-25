/**
 * Webull on the Portfolios page: balances, positions, open and recent orders (with Cancel) and "Sync to Portfolios".
 * Orders are placed on the Trade page (src/pages/tradePage.ts), whose ticket goes through the shared preview ->
 * confirm flow in src/trade/webull.ts.
 */
import { engineRequest } from '../data/schwab';
import { cancelOrder, envBadge, friendly, loadSnapshot, OPEN, orderPrice, usd, type Order, type Snapshot } from '../trade/webull';
import { dataTable, statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';
import type { Portfolio } from './types';

export async function renderWebull(out: HTMLElement, onSynced: (p: Portfolio & { id: string }) => void) {
  out.replaceChildren(h('div', { class: 'muted pad' }, 'Connecting to Webull…'));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let status: Snapshot;
  try {
    status = await loadSnapshot();
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
          h('b', {}, status.busy ? 'Webull is busy right now.' : 'Webull isn’t connected yet.'),
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
          sel.addEventListener('change', () => ((accountId = sel.value), load(true)));
          return sel;
        })()
      : h('span', { class: 'muted small' }, status.accounts[0]?.label ?? '');
  const syncBtn = syncButton('Sync to Portfolios', () => accountId, onSynced);
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
        h('a', { class: 'btn primary', href: '#trade', title: 'Place orders on the Trade page' }, 'Trade'),
        h('button', { class: 'btn', onclick: () => load(true) }, 'Refresh'),
        syncBtn,
      ),
      status.env === 'live' ? h('p', { class: 'wb-warning small' }, 'Live: orders placed here use real money in your Webull account.') : h('p', { class: 'muted small' }, 'Test environment: Webull’s practice account. Nothing real is bought or sold. Switch in Settings.'),
      body,
    ),
  );

  // One helper request per refresh (webull.snapshot): the helper reads Webull one call at a time and reuses
  // recent answers, so Webull never sees a burst ("too many requests").
  async function load(again = false) {
    body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading your account…'));
    let snap: Snapshot = status;
    if (again) {
      try {
        snap = await loadSnapshot(accountId);
      } catch (err) {
        return body.replaceChildren(h('div', { class: 'ap-error' }, friendly(err)));
      }
      if (!snap.ok) return body.replaceChildren(h('div', { class: 'ap-error' }, snap.message));
    }
    const fail = (section: string) => h('div', { class: 'ap-error' }, snap.errors?.[section] ?? 'Not available.');
    const bal = snap.balances;
    const held = snap.positions ?? [];
    body.replaceChildren(
      bal
        ? statCards([
            { label: 'Account value', value: usd(bal.value) },
            { label: 'Cash', value: usd(bal.cash) },
            { label: 'Buying power', value: usd(bal.buyingPower), hint: 'What you can spend on new orders now' },
            { label: 'Limits', value: `$${snap.limits.maxOrder.toLocaleString('en-US', { maximumFractionDigits: 0 })} · ${snap.limits.maxPerDay}/day`, hint: 'Max order value and orders per day (Settings)' },
          ])
        : fail('balances'),
      h('h4', { class: 'section-label' }, 'Positions'),
      snap.positions
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
        : fail('positions'),
      h('h4', { class: 'section-label' }, 'Orders'),
      snap.open ? ordersTable([...snap.open, ...(snap.recent ?? [])], () => load(true)) : fail('orders'),
    );
  }
  load();
}

/** Saves the Webull account's holdings as a portfolio (helper request webull.sync). */
function syncButton(label: string, accountId: () => string, onSynced: (p: Portfolio & { id: string }) => void) {
  const btn = h('button', { class: 'btn', title: 'Save these holdings as a portfolio so analysis and Dividends work on them' }, label) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await engineRequest<{ portfolio: Portfolio & { id: string }; skipped: number }>('webull.sync', { accountId: accountId() }, 60000);
      toast(`Saved "${r.portfolio.name}"${r.skipped ? ` (${r.skipped} non-stock position${r.skipped === 1 ? '' : 's'} left out)` : ''}`);
      onSynced(r.portfolio);
    } catch (err) {
      toast(friendly(err));
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

/**
 * A small read-only Webull card for the Account page: balances and buying power per account, "Sync now", and a link to
 * the full Webull view (the only place with the order ticket). Draws nothing when Webull isn't set up.
 */
export async function renderWebullCard(out: HTMLElement, onSynced: (p: Portfolio & { id: string }) => void, openFull: () => void) {
  let status: Snapshot;
  try {
    status = await loadSnapshot();
  } catch {
    return out.replaceChildren(); // older helper or offline: the accounts list still works without it
  }
  if (!status.ok) return out.replaceChildren();
  const cards: HTMLElement[] = [];
  for (const a of status.accounts) {
    // one account after another: the helper paces Webull calls anyway, and the first snapshot already holds account 1
    const snap = a.id === status.accountId ? status : await loadSnapshot(a.id).catch((err) => err as Error);
    const bal = snap instanceof Error ? snap : snap.balances ?? new Error(snap.errors?.balances ?? snap.message ?? 'Not available.');
    cards.push(
      h(
        'div',
        { class: 'acct-card' },
        h('div', { class: 'acct-card-head' }, h('b', {}, `Webull ${a.label}`), envBadge(status.env)),
        bal instanceof Error
          ? h('div', { class: 'ap-error' }, friendly(bal))
          : statCards([
              { label: 'Account value', value: usd(bal.value) },
              { label: 'Cash', value: usd(bal.cash) },
              { label: 'Buying power', value: usd(bal.buyingPower), hint: 'What you can spend on new orders now' },
            ]),
        h('div', { class: 'ap-controls' }, syncButton('Sync now', () => a.id, onSynced), h('button', { class: 'btn', onclick: openFull }, 'Open Webull view')),
      ),
    );
  }
  out.replaceChildren(...cards);
}

function ordersTable(orders: Order[], refresh: () => void) {
  if (!orders.length) return h('div', { class: 'empty-state' }, 'No open or recent orders.');
  return dataTable(
    ['Symbol', 'Side', 'Qty', 'Type', 'Price', 'Time in force', 'Status', ''],
    orders.map((o) => [
      { v: o.symbol, cls: 'label' },
      o.side,
      { v: `${o.filled ? `${o.filled}/` : ''}${o.qty ?? '—'}`, cls: 'num' },
      o.type.replace(/_/g, ' ').toLowerCase(),
      orderPrice(o),
      o.tif,
      { v: o.status.replace(/_/g, ' ').toLowerCase(), cls: OPEN.test(o.status) ? 'wb-warn' : '' },
      OPEN.test(o.status) && o.orderId
        ? h(
            'button',
            {
              class: 'btn small',
              onclick: async (e: Event) => {
                const btn = e.target as HTMLButtonElement;
                btn.disabled = true;
                if (await cancelOrder(o)) refresh();
                else btn.disabled = false;
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
