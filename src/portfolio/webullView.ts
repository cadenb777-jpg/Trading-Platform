/**
 * Webull on the Account page: a read-only card per Webull account (value, cash, buying power) and Sync. Ordering
 * info for one account (positions, open orders with Cancel, fills) has one home, the Trade page
 * (src/pages/tradePage.ts), whose ticket goes through the shared preview -> confirm flow in src/trade/webull.ts.
 * (The old Portfolios > Webull view was folded into those two pages; #portfolio/webull redirects to #trade.)
 */
import { engineRequest } from '../data/schwab';
import { envBadge, friendly, loadSnapshot, usd, type Snapshot } from '../trade/webull';
import { statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';
import type { Portfolio } from './types';

type Synced = Portfolio & { id: string };

/**
 * Saves Webull holdings as portfolios (helper request webull.sync), one per account: accountId() = that account
 * (saved even when empty: the owner chose it), '' = every stock account with something in it.
 */
export function syncButton(label: string, accountId: () => string, onSynced: (p: Synced) => void) {
  const btn = h('button', { class: 'btn', title: 'Save the holdings as a portfolio per account so analysis and Dividends work on them' }, label) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const saved = await syncAccounts(accountId());
    if (saved[0]) onSynced(saved[0]);
    btn.disabled = false;
  });
  return btn;
}

/** Runs webull.sync for one account ('' = all) and says what was saved. Also used by the command bar. */
export async function syncAccounts(id: string): Promise<Synced[]> {
  try {
    const r = await engineRequest<{ portfolio?: Synced; portfolios?: Synced[]; empty?: string[]; skipped: number }>('webull.sync', id ? { accountId: id } : {}, 120000);
    const saved = r.portfolios ?? (r.portfolio ? [r.portfolio] : []); // helpers before the account names send only portfolio
    const names = saved.map((p) => `"${p.name}"`).join(', ');
    const empty = r.empty?.length ? ` Not saved (empty): ${r.empty.join(', ')}.` : '';
    toast(`${saved.length ? `Saved ${names}` : 'Nothing saved'}${r.skipped ? ` (${r.skipped} non-stock position${r.skipped === 1 ? '' : 's'} left out)` : ''}.${empty}`);
    return saved;
  } catch (err) {
    toast(friendly(err));
    return [];
  }
}

/**
 * A small read-only Webull card for the Account page: balances and buying power per account, "Sync now", and
 * "Order in Trade" (the only place with the order ticket). Draws nothing when Webull isn't set up.
 */
export async function renderWebullCard(out: HTMLElement, onSynced: (p: Portfolio & { id: string }) => void, openTrade: (accountId: string) => void, only?: string, exclude: string[] = []) {
  let status: Snapshot;
  try {
    status = await loadSnapshot();
  } catch {
    return out.replaceChildren(); // older helper or offline: the accounts list still works without it
  }
  if (!status.ok) return out.replaceChildren();
  const cards: HTMLElement[] = [];
  for (const a of status.accounts) {
    if ((only && a.id !== only) || exclude.includes(a.id)) continue;
    if (a.futures) {
      cards.push(await futuresCard(a.label, a.id, status.env));
      continue;
    }
    if (a.stocks === false) {
      cards.push(h('div', { class: 'acct-card' }, h('div', { class: 'acct-card-head' }, h('b', {}, `Webull ${a.label}`)), h('span', { class: 'muted small' }, 'Only US stock accounts (cash, margin, IRA) are shown for now.')));
      continue;
    }
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
              { label: 'Value (as Webull reports it)', value: usd(bal.value), hint: 'Not synced yet, so not in the totals above. Sync it to add it.' },
              { label: 'Cash', value: usd(bal.cash) },
              { label: 'Buying power', value: usd(bal.buyingPower), hint: 'What you can spend on new orders in this account now' },
            ]),
        h('div', { class: 'ap-controls' }, syncButton('Sync now', () => a.id, onSynced), h('button', { class: 'btn', title: 'Positions, open orders and the order ticket for this account', onclick: () => openTrade(a.id) }, 'Order in Trade')),
      ),
    );
  }
  out.replaceChildren(...cards);
}

/** The futures account as its own card: kept out of the stock risk and tax figures, shown with its balance and open P/L. */
async function futuresCard(label: string, id: string, env: Snapshot['env']): Promise<HTMLElement> {
  const snap = await loadSnapshot(id, 'futures').catch((err) => err as Error);
  const bal = snap instanceof Error ? snap : snap.balances ?? new Error(snap.errors?.balances ?? snap.message ?? 'Not available.');
  const open = snap instanceof Error ? 0 : (snap.positions ?? []).length;
  return h(
    'div',
    { class: 'acct-card' },
    h('div', { class: 'acct-card-head' }, h('b', {}, `Webull ${label}`), envBadge(env)),
    bal instanceof Error
      ? h('div', { class: 'ap-error' }, friendly(bal))
      : statCards([
          { label: 'Net liquidation', value: usd(bal.value), hint: 'What the futures account would be worth if every position were closed now' },
          { label: 'Open P/L', value: bal.openPnl == null ? '—' : `${bal.openPnl >= 0 ? '+' : ''}${usd(bal.openPnl)}`, hint: `${open} open position${open === 1 ? '' : 's'}, in dollars` },
          { label: 'Buying power', value: usd(bal.buyingPower) },
        ]),
    h('p', { class: 'muted small' }, 'Futures are kept out of the stock risk and tax figures on this page.'),
    h('div', { class: 'ap-controls' }, h('a', { class: 'btn', href: '#trade' }, 'Open Trade page')),
  );
}
