/**
 * The plan next to the order ticket (Trade page): entry, stop, target, reward:risk, size, dollars at risk and the
 * share of the account, the trade guide's read when the ticket came from a setup, and the post-order checklist
 * (place the entry in the confirm window, then a stop sell once it fills, then alerts at the stop and target).
 *
 * Nothing here sends an order: "Fill stop order" only fills the ticket, which still goes through Preview and the
 * confirm window. Alerts are price alerts (the helper's when it has them), never orders.
 */
import { createPriceAlert } from '../ui/alerts';
import { formatPrice, h, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { checklist, tradePlan, type StepState } from './plan';
import type { TicketPlanState } from './ticket';
import type { Snapshot } from './webull';

export interface PlanCardHost {
  state(): TicketPlanState;
  snapshot(): Snapshot | null;
  /** Shares of the symbol a stop sell could cover. */
  canSell(symbol: string): number;
  /** The entry for the symbol was placed from this page (or an open buy order exists). */
  entryPlaced(symbol: string): boolean;
  /** Fills the ticket with a stop sell (the owner still previews and confirms). */
  fillStop(symbol: string, stop: number, qty: number): void;
}

const ALERTS_KEY = 'tp-plan-alerts';
const usd = (v: number) => `$${formatPrice(v)}`;
const money = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (v: number | null, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);

function readAlerts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}') ?? {};
  } catch {
    return {};
  }
}
function saveAlerts(v: Record<string, string>) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(v));
  } catch {
    /* only remembers the tick */
  }
}

export function createPlanCard(host: PlanCardHost) {
  const el = h('section', { class: 'tk-plan', 'aria-label': 'Trade plan', hidden: true });
  let alertsBusy = false;

  /** The plan's levels for the chart (null when there's no plan to show). */
  function levels(): { symbol: string; entry: number; stop: number; target: number } | null {
    const st = planState();
    if (!st) return null;
    const p = tradePlan({ entry: st.entry, stop: st.stop, target: st.setup?.target, account: st.account, riskPct: st.riskPct });
    return p ? { symbol: st.symbol, entry: p.entry, stop: p.stop, target: p.target } : null;
  }

  /** The last buy plan, kept while the ticket is switched to the stop sell for the same symbol (checklist step 2). */
  let lastBuy: TicketPlanState | null = null;
  function planState(): TicketPlanState | null {
    const st = host.state();
    if (st.side === 'BUY') {
      lastBuy = tradePlan({ entry: st.entry, stop: st.stop, account: st.account, riskPct: st.riskPct }) ? st : null;
      return lastBuy;
    }
    return lastBuy && lastBuy.symbol === st.symbol ? lastBuy : null;
  }

  function draw() {
    const st = planState();
    if (!st) {
      el.hidden = true;
      return el.replaceChildren();
    }
    const snap = host.snapshot();
    const p = tradePlan({ entry: st.entry, stop: st.stop, target: st.setup?.target, account: st.account, riskPct: st.riskPct, buyingPower: snap?.balances?.buyingPower, maxOrder: snap?.limits.maxOrder });
    el.hidden = !p || !st.symbol;
    if (!p) return el.replaceChildren();
    const shares = st.shares;
    const risk = shares * p.perShare;
    const cost = shares * p.entry;
    const acct = st.account;
    const key = `${p.stop}|${p.target}`;
    const done = checklist({
      entryPlaced: host.entryPlaced(st.symbol),
      canSell: host.canSell(st.symbol),
      stopWorking: (snap?.open ?? []).some((o) => o.symbol === st.symbol && o.side === 'SELL' && o.stopPrice != null),
      alertsSet: readAlerts()[st.symbol] === key,
    });
    const row = (label: Node | string, value: Node | string, cls = '', sub = '') =>
      h('div', { class: 'plan-row' }, h('dt', { class: 'muted small' }, label), h('dd', { class: `num ${cls}` }, value, sub ? h('span', { class: 'muted small' }, ` ${sub}`) : ''));
    const read = st.setup?.read;
    el.replaceChildren(
      h('div', { class: 'plan-head' }, h('h3', {}, `Plan · ${st.symbol}`), st.setup?.setup ? h('span', { class: 'muted small' }, st.setup.setup) : h('span', { class: 'muted small' }, 'from your entry and stop')),
      read ? h('div', { class: `plan-read ${read.tone}` }, h('b', {}, read.title), h('p', { class: 'small' }, read.action)) : '',
      h(
        'dl',
        { class: 'plan-grid' },
        row('Entry', usd(p.entry)),
        row(h('span', {}, 'Stop', infoTip('stop')), usd(p.stop), 'down', `−${pct(p.stopPct)}`),
        row(st.setup?.targetLabel ?? (p.guideTarget ? 'Target (2R guide)' : 'Target'), usd(p.target), 'up', `+${pct(p.targetPct)}`),
        row(h('span', {}, 'Reward:risk', infoTip('rr')), `${p.rMultiple.toFixed(1)}R`, p.rMultiple >= 1.5 ? '' : 'warn'),
        row('Size', shares ? `${shares.toLocaleString('en-US')} sh` : '—', '', shares ? money(cost) : ''),
        row('At risk', shares ? money(risk) : '—', 'down', acct && shares ? `${pct(risk / acct, 2)} of account` : ''),
        row('Of account', acct && shares ? pct(cost / acct) : '—', '', acct ? `of ${money(acct)}` : ''),
        row('Risk setting', `${st.riskPct}%`, '', p.shares !== shares && p.shares ? `= ${p.shares} sh` : ''),
      ),
      ...p.warnings.filter((w) => !/No account value/.test(w) || !snap?.ok).map((w) => h('p', { class: 'wb-warn small' }, `⚠ ${w}`)),
      h('h4', { class: 'plan-check-title' }, 'Checklist'),
      h(
        'ol',
        { class: 'plan-check' },
        step(done.entry, 'Place the entry', done.entry === 'done' ? 'Placed (or already held).' : 'Preview, then Place order in the confirm window.'),
        step(
          done.stop,
          `Set the stop order at ${usd(p.stop)}`,
          done.stop === 'done' ? 'A stop sell is working.' : done.stop === 'ready' ? `You hold ${host.canSell(st.symbol)}: fill a stop sell (GTC), then preview and confirm.` : 'Once the entry fills (a stop sell needs shares to sell).',
          done.stop === 'ready' ? h('button', { class: 'btn small primary', type: 'button', onclick: () => host.fillStop(st.symbol, p.stop, host.canSell(st.symbol)) }, 'Fill stop order') : null,
        ),
        step(
          done.alerts,
          'Set alerts at the stop and target',
          done.alerts === 'done' ? `Alerts at ${usd(p.stop)} and ${usd(p.target)}.` : 'Price alerts (to your phone when set up in Settings). They never trade.',
          done.alerts === 'done' ? null : h('button', { class: 'btn small', type: 'button', onclick: () => setAlerts(st.symbol, p.stop, p.target, key) }, 'Set alerts'),
        ),
      ),
      st.setup?.exitBy ? h('p', { class: 'muted tiny' }, `Plan to be out by ${new Date(`${st.setup.exitBy}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at the latest.`) : '',
    );
  }

  function step(state: StepState, title: string, detail: string, action: Node | null = null) {
    const mark = { done: '✓', ready: '○', waiting: '…' }[state];
    return h('li', { class: `plan-step ${state}` }, h('i', { 'aria-hidden': 'true' }, mark), h('div', {}, h('b', {}, title), h('div', { class: 'muted small' }, detail), action), h('span', { class: 'sr-only' }, state === 'done' ? 'done' : state === 'ready' ? 'to do' : 'waiting'));
  }

  async function setAlerts(symbol: string, stop: number, target: number, key: string) {
    if (alertsBusy) return;
    alertsBusy = true;
    try {
      const ref = { provider: 'schwab' as const, symbol };
      // each level on its own: the helper refuses a level the price is already past (then the plan needs a rethink)
      const [a, b] = await Promise.allSettled([createPriceAlert(ref, 'below', stop, 'Plan stop'), createPriceAlert(ref, 'above', target, 'Plan target')]);
      if (a.status === 'fulfilled' && b.status === 'fulfilled') {
        saveAlerts({ ...readAlerts(), [symbol]: key });
        toast(`🔔 Alerts set: ${symbol} at ${usd(stop)} and ${usd(target)}${a.value === 'helper' ? ' (they work with the platform closed)' : ''}`);
      } else {
        const failed = [a, b].flatMap((r, i) => (r.status === 'rejected' ? [`${i ? 'Target' : 'Stop'} alert not set: ${(r.reason as Error).message}`] : []));
        toast(failed.join(' '));
      }
    } finally {
      alertsBusy = false;
      draw();
    }
  }

  return { el, draw, levels };
}
