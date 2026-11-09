/**
 * The Account page's "Working orders" card: every order still working in all your Webull accounts, read-only (the
 * Account page never changes orders). "Manage in Trade" opens the Trade page's All working orders tab, where each
 * order has its Cancel button.
 */
import { helper } from '../data/schwab';
import { friendly, loadWorkingOrders, orderPrice, WORKING_ORDERS_HELPER_VERSION, type WorkingOrder } from '../trade/webull';
import { dataTable } from '../ui/charts';
import { h, timeAgo } from '../ui/dom';

/** Opens the Trade page on its All working orders tab. */
export function openWorkingOrders(): void {
  try {
    sessionStorage.setItem('tp:tradeTab', 'working');
  } catch {
    /* no storage: the event below still switches an open Trade page */
  }
  location.hash = '#trade';
  window.dispatchEvent(new CustomEvent('tp:trade-tab', { detail: 'working' }));
}

/** "3 orders working" / "No orders working". */
export function workingSummary(n: number, accounts: number): string {
  if (!n) return `No orders working in ${accounts === 1 ? 'your account' : `your ${accounts} accounts`}`;
  return `${n} order${n === 1 ? '' : 's'} working`;
}

/** The card; hidden when Webull isn't set up or the helper is too old for the all-accounts list. */
export function workingOrdersCard(): HTMLElement {
  const note = h('span', { class: 'muted small' }, 'Orders placed but not yet filled or cancelled, in every Webull account');
  const body = h('div', {}, h('p', { class: 'muted small pad' }, 'Loading…'));
  const manage = h('button', { class: 'btn small', type: 'button', onclick: openWorkingOrders }, 'Manage in Trade');
  const card = h('section', { class: 'panel', hidden: true }, h('div', { class: 'panel-head' }, h('h3', {}, 'Working orders'), note, h('span', { class: 'spacer' }), manage), body);
  if ((helper.version ?? 0) < WORKING_ORDERS_HELPER_VERSION) return card;
  card.hidden = false;
  loadWorkingOrders().then(
    (r) => {
      if (!r.ok) {
        card.hidden = true; // Webull not set up: nothing to show here
        return;
      }
      const errors = Object.entries(r.errors).map(([name, why]) => h('div', { class: 'ap-error' }, `${name}: ${why}`));
      const when = r.asOf ? h('p', { class: 'muted small pad' }, `${workingSummary(r.orders.length, r.accounts.length)} · from Webull ${timeAgo(r.asOf)}`) : null;
      if (!r.orders.length) return body.replaceChildren(...errors, when ?? h('p', { class: 'muted small pad' }, workingSummary(0, r.accounts.length)));
      body.replaceChildren(
        ...errors,
        dataTable(
          ['Account', 'Symbol', 'Side', 'Filled / qty', 'Price', 'Status', 'Placed'],
          r.orders.map((o: WorkingOrder) => [
            { v: o.account, cls: 'label' },
            { v: o.symbol, cls: 'label' },
            { v: o.side, cls: o.side === 'BUY' ? 'up' : 'down' },
            { v: `${o.filled || 0} / ${o.qty ?? '—'}`, cls: 'num' },
            orderPrice(o),
            { v: o.status.replace(/_/g, ' ').toLowerCase(), cls: 'wb-warn' },
            o.placedAt ? new Date(o.placedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
          ]),
          undefined,
          { id: 'account:working' },
        ),
        ...(when ? [when] : []),
      );
    },
    (err) => body.replaceChildren(h('div', { class: 'ap-error' }, `Working orders unavailable: ${friendly(err)}`)),
  );
  return card;
}
