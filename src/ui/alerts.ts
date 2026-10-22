/** Price alerts: watch live prices and notify when a level is crossed (while the platform is open). */
import { refKey, subscribeQuote, type MarketRef } from '../data/quotes';
import { onStateChange, persist, state } from '../state';
import { formatPrice, h, openModal, toast } from './dom';
import { displaySymbol } from './watchlist';

export interface PriceAlert {
  id: string;
  provider: MarketRef['provider'];
  symbol: string;
  condition: 'above' | 'below';
  price: number;
  note: string;
  created: number;
  triggeredAt?: number;
}

const newId = () => Math.random().toString(36).slice(2, 10);

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Sound is optional.
  }
}

function notify(alert: PriceAlert, price: number) {
  const message = `${displaySymbol(alert.symbol)} is ${alert.condition} ${formatPrice(alert.price)} (now ${formatPrice(price)})${alert.note ? ` · ${alert.note}` : ''}`;
  toast(`🔔 ${message}`);
  beep();
  if ('Notification' in window && Notification.permission === 'granted') new Notification('Price alert', { body: message });
}

/** Watches every active alert's symbol and fires once when its level is crossed. */
export function startAlertWatcher() {
  const watching = new Map<string, () => void>();
  const sync = () => {
    const active = state.alerts.filter((a) => !a.triggeredAt);
    const wanted = new Set(active.map((a) => refKey(a)));
    for (const [key, stop] of watching) {
      if (!wanted.has(key)) {
        stop();
        watching.delete(key);
      }
    }
    for (const alert of active) {
      const key = refKey(alert);
      if (watching.has(key)) continue;
      watching.set(
        key,
        subscribeQuote(alert, (q) => {
          if (q.last == null) return;
          let changed = false;
          for (const a of state.alerts) {
            if (a.triggeredAt || refKey(a) !== key) continue;
            if ((a.condition === 'above' && q.last >= a.price) || (a.condition === 'below' && q.last <= a.price)) {
              a.triggeredAt = Date.now();
              notify(a, q.last);
              changed = true;
            }
          }
          if (changed) persist();
        }),
      );
    }
  };
  onStateChange(sync);
  sync();
}

export function activeAlertCount(ref?: MarketRef) {
  return state.alerts.filter((a) => !a.triggeredAt && (!ref || refKey(a) === refKey(ref))).length;
}

/** The alerts window: add an alert for the current symbol and manage all alerts. */
export function openAlertsDialog(ref: MarketRef, lastPrice: number | null) {
  const priceInput = h('input', { class: 'input', type: 'number', step: 'any', value: lastPrice ?? '', 'aria-label': 'Alert price' });
  const noteInput = h('input', { class: 'input', placeholder: 'Note (optional)', 'aria-label': 'Note' });
  const list = h('div', { class: 'alert-list' });

  const renderList = () => {
    list.replaceChildren(
      ...state.alerts.map((a) =>
        h(
          'div',
          { class: `alert-row${a.triggeredAt ? ' done' : ''}` },
          h('b', {}, displaySymbol(a.symbol)),
          h('span', {}, `${a.condition === 'above' ? '≥' : '≤'} ${formatPrice(a.price)}`),
          h('span', { class: 'muted small' }, a.triggeredAt ? `Triggered ${new Date(a.triggeredAt).toLocaleString()}` : a.note || 'Active'),
          h(
            'button',
            {
              class: 'mini-btn',
              title: 'Delete alert',
              onclick: () => {
                state.alerts = state.alerts.filter((x) => x.id !== a.id);
                persist();
                renderList();
              },
            },
            '✕',
          ),
        ),
      ),
    );
    if (!state.alerts.length) list.append(h('p', { class: 'muted small' }, 'No alerts yet.'));
  };

  const add = async () => {
    const price = Number(priceInput.value);
    if (!Number.isFinite(price) || price <= 0) return toast('Enter a price for the alert');
    // Alert fires when price moves to the level from where it is now.
    const condition: PriceAlert['condition'] = lastPrice != null && price < lastPrice ? 'below' : 'above';
    state.alerts.push({ id: newId(), provider: ref.provider, symbol: ref.symbol, condition, price, note: noteInput.value.trim(), created: Date.now() });
    persist();
    noteInput.value = '';
    renderList();
    toast(`Alert set: ${displaySymbol(ref.symbol)} ${condition} ${formatPrice(price)}`);
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  };

  renderList();
  openModal(
    'Price alerts',
    h(
      'div',
      { class: 'form' },
      h('div', { class: 'form-section' }, `New alert for ${displaySymbol(ref.symbol)}${lastPrice != null ? ` (now ${formatPrice(lastPrice)})` : ''}`),
      h('div', { class: 'alert-add' }, priceInput, noteInput, h('button', { class: 'btn primary', onclick: add }, 'Add alert')),
      h('p', { class: 'muted small' }, 'Alerts work while the platform is open in a browser tab. Allow notifications to get a pop-up even when the tab is in the background.'),
      h('div', { class: 'form-section' }, 'All alerts'),
      list,
    ),
    { wide: true },
  );
}
