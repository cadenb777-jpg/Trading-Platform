/**
 * Alerts. Stock alerts run in the helper (helper/engine/alerts.py, version 32+), so they fire with the platform
 * closed and reach your phone by ntfy or Telegram (set up in Settings). Crypto alerts, and stock alerts with an older
 * helper, are watched here in the browser while the platform is open.
 */
import { refKey, subscribeQuote, type MarketRef } from '../data/quotes';
import { ALERTS_HELPER_VERSION, engineRequest, helper } from '../data/schwab';
import { onStateChange, persist, state } from '../state';
import { ALERT_CHOICES, alertStatus, choiceOf, deliverySummary, describeAlert, formAlert, type AlertChoice, type AlertsReply, type HelperAlert } from './alertsLogic';
import { formatPrice, h, openModal, toast } from './dom';
import { openSettings } from './settings';
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

export function beep() {
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

function showNotification(title: string, body: string) {
  toast(`🔔 ${title}: ${body}`);
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

// ---------- Helper alerts ----------

let helperList: HelperAlert[] = [];
let channels: AlertsReply['channels'] = { ntfy: false, telegram: false };
const changeListeners = new Set<() => void>();
const changed = () => changeListeners.forEach((fn) => fn());

/** Calls `fn` when the list of alerts changes (helper or browser). */
export function onAlertsChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** True when the running helper keeps alerts itself (connects first if needed). */
export async function helperAlertsAvailable(): Promise<boolean> {
  try {
    await helper.connect();
  } catch {
    return false;
  }
  return !helper.tooOld && (helper.version ?? 0) >= ALERTS_HELPER_VERSION;
}

function take(reply: AlertsReply) {
  helperList = reply.alerts;
  channels = reply.channels;
  changed();
  return reply;
}

export async function listHelperAlerts(): Promise<AlertsReply> {
  return take(await engineRequest<AlertsReply>('alerts.list', {}, 15000));
}

export async function saveHelperAlert(alert: Record<string, unknown>): Promise<HelperAlert> {
  const reply = await engineRequest<AlertsReply & { alert: HelperAlert }>('alerts.save', { alert }, 15000);
  take(reply);
  return reply.alert;
}

/** Deletes by alert id, by setup id (`setupId`), or the "every A and B setup" alert (`kind: 'setups_ab'`). */
export async function deleteHelperAlert(params: { docId?: string; setupId?: string; kind?: 'setups_ab' }) {
  return take(await engineRequest<AlertsReply>('alerts.delete', params, 15000));
}

export const helperAlerts = () => helperList;

/**
 * Sets a price alert: in the helper for stocks when it supports alerts, otherwise in this browser.
 * Returns where it was saved.
 */
export async function createPriceAlert(ref: MarketRef, condition: 'above' | 'below', price: number, note = '', repeat = false): Promise<'helper' | 'browser'> {
  if (ref.provider === 'schwab' && (await helperAlertsAvailable())) {
    await saveHelperAlert(formAlert(ref.symbol, condition, price, note, repeat));
    return 'helper';
  }
  state.alerts.push({ id: newId(), provider: ref.provider, symbol: ref.symbol, condition, price, note, created: Date.now() });
  persist();
  return 'browser';
}

/** Moves stock alerts saved in this browser into the helper (once it supports them), so they work with the tab closed. */
async function moveLocalAlerts() {
  const local = state.alerts.filter((a) => a.provider === 'schwab' && !a.triggeredAt);
  if (!local.length || !(await helperAlertsAvailable())) return;
  let moved = 0;
  for (const a of local) {
    try {
      await saveHelperAlert(formAlert(a.symbol, a.condition, a.price, a.note, false));
      state.alerts = state.alerts.filter((x) => x.id !== a.id);
      moved++;
    } catch {
      /* keep it in the browser */
    }
  }
  if (moved) {
    persist();
    toast(`Moved ${moved} alert${moved === 1 ? '' : 's'} to the helper: they now work with the platform closed.`);
  }
}

// ---------- Browser-only alerts (crypto, or an older helper) ----------

/** Watches every browser alert's symbol and fires once when its level is crossed; shows helper alerts as they fire. */
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
          let fired = false;
          for (const a of state.alerts) {
            if (a.triggeredAt || refKey(a) !== key) continue;
            if ((a.condition === 'above' && q.last >= a.price) || (a.condition === 'below' && q.last <= a.price)) {
              a.triggeredAt = Date.now();
              showNotification('Price alert', `${displaySymbol(a.symbol)} is ${a.condition} ${formatPrice(a.price)} (now ${formatPrice(q.last)})${a.note ? ` · ${a.note}` : ''}`);
              fired = true;
            }
          }
          if (fired) persist();
        }),
      );
    }
    changed();
  };
  onStateChange(sync);
  sync();
  helper.onAlert((a) => {
    showNotification(a.title, a.message);
    listHelperAlerts().catch(() => {});
  });
  helper.onAvailability((up) => {
    if (!up) return;
    moveLocalAlerts().catch(() => {});
    if ((helper.version ?? 0) >= ALERTS_HELPER_VERSION) listHelperAlerts().catch(() => {});
  });
}

/** Active alerts (for a chart's bell count). */
export function activeAlertCount(ref?: MarketRef) {
  const local = state.alerts.filter((a) => !a.triggeredAt && (!ref || refKey(a) === refKey(ref))).length;
  const remote = helperList.filter((a) => a.active && (a.kind === 'price' || a.kind === 'move') && (!ref || (ref.provider === 'schwab' && a.symbol === ref.symbol))).length;
  return local + remote;
}

// ---------- The alerts window ----------

/** Lists every alert and adds new ones (for `ref`'s symbol, or any symbol typed in). */
export async function openAlertsDialog(ref?: MarketRef, lastPrice: number | null = null) {
  const onHelper = await helperAlertsAvailable();
  const forStock = !ref || ref.provider === 'schwab';
  let editing: HelperAlert | null = null;

  const symbolInput = h('input', { class: 'input', placeholder: 'Symbol', value: ref ? ref.symbol : '', 'aria-label': 'Symbol', autocapitalize: 'characters', spellcheck: false });
  const choice = h('select', { class: 'input', 'aria-label': 'Alert when' }, ...ALERT_CHOICES.filter((c) => onHelper && forStock || c.kind === 'price').map((c) => h('option', { value: c.key }, c.label)));
  const valueInput = h('input', { class: 'input', type: 'number', step: 'any', min: '0', value: lastPrice != null ? Number(lastPrice.toFixed(lastPrice >= 1 ? 2 : 4)) : '', 'aria-label': 'Price or percent' });
  const noteInput = h('input', { class: 'input', placeholder: 'Note (optional)', 'aria-label': 'Note' });
  const repeat = h('input', { type: 'checkbox' });
  const addBtn = h('button', { class: 'btn primary' }, 'Add alert');
  const cancelEdit = h('button', { class: 'btn', hidden: true }, 'Cancel');
  const list = h('div', { class: 'alert-list' });
  const channelNote = h('div', { class: 'alerts-channels small' });

  const syncUnit = () => {
    const c = ALERT_CHOICES.find((x) => x.key === choice.value)!;
    valueInput.placeholder = c.unit === '%' ? '% move, e.g. 3' : 'Price';
  };
  choice.addEventListener('change', syncUnit);
  syncUnit();

  const resetForm = () => {
    editing = null;
    addBtn.textContent = 'Add alert';
    cancelEdit.hidden = true;
    noteInput.value = '';
    repeat.checked = false;
  };
  cancelEdit.addEventListener('click', resetForm);

  const edit = (a: HelperAlert) => {
    editing = a;
    symbolInput.value = a.symbol;
    choice.value = choiceOf(a);
    valueInput.value = String(a.kind === 'move' ? a.pct : a.price);
    noteInput.value = a.note ?? '';
    repeat.checked = a.repeat;
    addBtn.textContent = 'Save changes';
    cancelEdit.hidden = false;
    syncUnit();
    valueInput.focus();
  };

  const row = (a: HelperAlert) => {
    const st = alertStatus(a);
    const d = deliverySummary(a.lastDelivery?.results);
    const rep = h('input', { type: 'checkbox', checked: a.repeat, 'aria-label': 'Repeat' });
    rep.addEventListener('change', async () => {
      try {
        await saveHelperAlert({ ...a, repeat: rep.checked, active: rep.checked ? true : a.active });
        draw();
      } catch (err) {
        toast((err as Error).message);
      }
    });
    return h(
      'div',
      { class: `alert-item${a.active ? '' : ' done'}` },
      h('div', { class: 'alert-main' }, h('b', {}, describeAlert(a)), a.note ? h('span', { class: 'muted small' }, ` · ${a.note}`) : null),
      h('div', { class: `alert-state small ${st.tone}` }, st.text),
      d.text ? h('div', { class: `alert-delivery tiny${d.failed ? ' warn' : ''}`, title: a.lastDelivery?.message ?? '' }, d.text) : null,
      h(
        'div',
        { class: 'alert-actions' },
        a.kind === 'price' || a.kind === 'move' ? h('label', { class: 'small', title: 'Fire again each time price crosses back (at most every 30 minutes)' }, rep, ' Repeat') : null,
        a.kind === 'price' || a.kind === 'move' ? h('button', { class: 'mini-btn', title: 'Edit alert', onclick: () => edit(a) }, 'Edit') : null,
        h(
          'button',
          {
            class: 'mini-btn',
            title: 'Delete alert',
            'aria-label': `Delete alert ${describeAlert(a)}`,
            onclick: async () => {
              try {
                await deleteHelperAlert({ docId: a.id });
                if (editing?.id === a.id) resetForm();
                draw();
              } catch (err) {
                toast((err as Error).message);
              }
            },
          },
          '✕',
        ),
      ),
    );
  };

  const localRow = (a: PriceAlert) =>
    h(
      'div',
      { class: `alert-item${a.triggeredAt ? ' done' : ''}` },
      h('div', { class: 'alert-main' }, h('b', {}, `${displaySymbol(a.symbol)} ${a.condition === 'above' ? 'rises to' : 'falls to'} ${formatPrice(a.price)}`), a.note ? h('span', { class: 'muted small' }, ` · ${a.note}`) : null),
      h('div', { class: 'alert-state small muted' }, a.triggeredAt ? `Fired ${new Date(a.triggeredAt).toLocaleString()}` : 'This browser only (while the platform is open)'),
      h('div', { class: 'alert-actions' }, h('button', { class: 'mini-btn', title: 'Delete alert', 'aria-label': 'Delete alert', onclick: () => ((state.alerts = state.alerts.filter((x) => x.id !== a.id)), persist(), draw()) }, '✕')),
    );

  function renderList() {
    const remote = [...helperList].sort((a, b) => Number(b.active) - Number(a.active) || (b.firedAt ?? b.created) - (a.firedAt ?? a.created));
    list.replaceChildren(...remote.map(row), ...state.alerts.map(localRow));
    if (!list.childElementCount) list.append(h('p', { class: 'muted small' }, 'No alerts yet.'));
  }

  async function draw() {
    if (onHelper) {
      try {
        await listHelperAlerts();
      } catch (err) {
        list.replaceChildren(h('p', { class: 'ap-error' }, (err as Error).message));
        return;
      }
    }
    renderList();
    const phone = [channels.ntfy ? 'ntfy' : '', channels.telegram ? 'Telegram' : ''].filter(Boolean);
    channelNote.replaceChildren(
      onHelper
        ? h(
            'span',
            {},
            phone.length ? `Stock alerts are checked by the helper, even with this tab closed, and sent to ${phone.join(' and ')} plus any open tab. ` : 'Stock alerts are checked by the helper, even with this tab closed. To get them on your phone, set up ntfy or Telegram (free) in Settings. ',
            h('button', { class: 'btn small', onclick: () => openSettings('alerts') }, phone.length ? 'Alert settings' : 'Set up phone alerts'),
            ' ',
            h('button', { class: 'btn small', onclick: sendTest }, 'Send test'),
          )
        : h('span', { class: 'muted' }, helper.isConnected ? 'Alerts work while the platform is open. Update the helper so they also work with it closed and reach your phone.' : 'Alerts work while the platform is open in a tab. Start the helper to have stock alerts checked even when the tab is closed.'),
    );
  }

  async function sendTest() {
    try {
      const r = await engineRequest<{ results: Record<string, string> }>('alerts.test', {}, 30000);
      const d = deliverySummary(r.results);
      toast(d.text ? `Test sent: ${d.text}` : r.results.note ?? 'Test sent');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  addBtn.addEventListener('click', async () => {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return toast('Enter a symbol');
    const value = Number(valueInput.value);
    const pick = choice.value as AlertChoice;
    try {
      if (onHelper && forStock) {
        await saveHelperAlert(formAlert(symbol, pick, value, noteInput.value, repeat.checked, editing?.id));
      } else {
        if (!Number.isFinite(value) || value <= 0) return toast('Enter a price for the alert');
        const target = ref ?? { provider: 'schwab' as const, symbol };
        await createPriceAlert(target, pick === 'below' ? 'below' : 'above', value, noteInput.value.trim());
      }
      toast(editing ? 'Alert saved' : `Alert set: ${symbol}`);
      resetForm();
      draw();
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    } catch (err) {
      toast((err as Error).message);
    }
  });

  const close = openModal(
    'Alerts',
    h(
      'div',
      { class: 'form alerts-panel' },
      h('div', { class: 'form-section' }, ref ? `New alert for ${displaySymbol(ref.symbol)}${lastPrice != null ? ` (now ${formatPrice(lastPrice)})` : ''}` : 'New alert'),
      h('div', { class: ref ? 'alert-form' : 'alert-form with-symbol' }, ref ? null : symbolInput, choice, valueInput, noteInput),
      h('div', { class: 'alert-form-actions' }, onHelper && forStock ? h('label', { class: 'small', title: 'Fire again each time price crosses back (at most every 30 minutes)' }, repeat, ' Repeat') : null, addBtn, cancelEdit),
      channelNote,
      h('div', { class: 'form-section' }, 'All alerts'),
      list,
    ),
    { wide: true, onClose: () => stop() },
  );
  const stop = onAlertsChange(() => document.body.contains(list) && renderList());
  draw();
  return close;
}
