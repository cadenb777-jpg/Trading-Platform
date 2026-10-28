/**
 * Home's morning brief: one screen that answers "what happened overnight, how are my accounts, what needs my
 * attention today". An overnight strip (index futures, the 10-year, the dollar, euro, gold, oil, bitcoin), my
 * accounts (value, today, biggest movers in my holdings) and a "Needs attention" list (alerts that fired or are close,
 * setups at their entry, today's market-moving events). Every item opens its home in one click, and j / k move
 * through the items from the keyboard (Enter opens). Browser only: it reuses requests the helper already answers
 * (futures.board, macro.curve, store.list, invest.board, alerts.list, scanner.results, the calendar).
 */
import type { MarketRef } from '../data/quotes';
import { engineRequest, helper } from '../data/schwab';
import { listDocs } from '../data/store';
import { combineHoldings, myPortfolios } from '../portfolio/account';
import { fetchPrices } from '../portfolio/prices';
import type { Portfolio } from '../portfolio/types';
import { getCalendar } from '../pages/calendarPage';
import { describeAlert, type HelperAlert } from '../ui/alertsLogic';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';
import { tickerAttr } from '../ui/tickerCard';
import type { CurvePoint } from '../ui/yieldCurve';
import { accountsBrief, alertAttention, readySetups, todaysEvents, type ReadySetup } from './brief';
import type { Setup } from './setupsPanel';

/** The overnight strip: futures that trade nearly 24 hours, so they show what happened while the US market was shut. */
const STRIP: [string, string, string][] = [
  ['ES', 'S&P 500 fut', 'E-mini S&P 500 futures'],
  ['NQ', 'Nasdaq fut', 'E-mini Nasdaq-100 futures'],
  ['RTY', 'Russell fut', 'E-mini Russell 2000 futures'],
  ['ZN', '10Y note', '10-year Treasury note futures: the price falls when yields rise'],
  ['DX', 'Dollar', 'US dollar index futures'],
  ['6E', 'Euro', 'Euro FX futures (dollars per euro)'],
  ['GC', 'Gold', 'Gold futures'],
  ['CL', 'Oil', 'WTI crude oil futures'],
  ['BTC', 'Bitcoin', 'Bitcoin futures (CME)'],
];

interface BoardRow {
  root: string;
  price: number | null;
  change: number | null;
}

export interface BriefDeps {
  openChart(ref: MarketRef): void;
  openPage(route: string, method?: string, ...args: unknown[]): void;
}

const money = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(v)}`;
const signedPct = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function createMorningBrief(d: BriefDeps) {
  const strip = h('div', { class: 'brief-strip', role: 'list', 'aria-label': 'Overnight: futures, rates, currencies and commodities' });
  const accountsBody = h('div', { class: 'brief-body' }, h('p', { class: 'muted small' }, 'Loading your accounts…'));
  const attentionBody = h('div', { class: 'brief-body' }, h('p', { class: 'muted small' }, 'Checking alerts, setups and today’s events…'));
  const attentionCount = h('span', { class: 'brief-count', hidden: true });
  const stamp = h('span', { class: 'muted tiny' });
  const accounts = h(
    'section',
    { class: 'panel brief-card', 'aria-labelledby': 'brief-accounts-h' },
    h('div', { class: 'panel-head' }, h('h3', { id: 'brief-accounts-h' }, icon('account', 18), ' My accounts'), h('span', { class: 'spacer' }), h('a', { class: 'link-btn', href: '#account' }, 'Account →')),
    accountsBody,
  );
  const attention = h(
    'section',
    { class: 'panel brief-card', 'aria-labelledby': 'brief-attention-h' },
    h('div', { class: 'panel-head' }, h('h3', { id: 'brief-attention-h' }, icon('bell', 18), ' Needs attention'), attentionCount, h('span', { class: 'spacer' }), h('a', { class: 'link-btn', href: '#setups' }, 'Setups →')),
    attentionBody,
  );
  const el = h(
    'section',
    { class: 'brief', 'aria-label': 'Morning brief' },
    h('div', { class: 'brief-head' }, h('h2', {}, 'Morning brief'), h('span', { class: 'muted small brief-keys' }, h('kbd', {}, 'j'), ' / ', h('kbd', {}, 'k'), ' move · ', h('kbd', {}, 'Enter'), ' opens'), h('span', { class: 'spacer' }), stamp),
    strip,
    h('div', { class: 'brief-grid' }, accounts, attention),
  );

  // ----- overnight strip -----
  function chip(label: string, title: string, value: string, change: number | null, onOpen: () => void) {
    return h(
      'button',
      { type: 'button', class: 'brief-chip', role: 'listitem', title, onclick: onOpen },
      h('span', { class: 'brief-chip-name' }, label),
      h('span', { class: 'num brief-chip-value' }, value),
      h('span', { class: `num brief-chip-chg ${tone(change)}` }, change == null ? '—' : signedPct(change)),
    );
  }

  async function loadStrip() {
    const [board, curve] = await Promise.allSettled([
      engineRequest<{ rows: BoardRow[] }>('futures.board', {}, 90_000),
      engineRequest<{ curve: CurvePoint[] }>('macro.curve', {}, 45_000),
    ]);
    const rows = board.status === 'fulfilled' ? board.value.rows : [];
    const ten = curve.status === 'fulfilled' ? curve.value.curve.find((p) => p.label === '10Y') : undefined;
    const items = STRIP.map(([root, label, title]) => {
      const r = rows.find((x) => x.root === root);
      return chip(label, `${title}. Open on Futures.`, r?.price != null ? formatPrice(r.price) : '—', r?.change ?? null, () => d.openPage('futures', 'open', root));
    });
    if (ten)
      items.splice(
        4,
        0,
        h(
          'button',
          { type: 'button', class: 'brief-chip', role: 'listitem', title: `10-year Treasury yield (FRED, ${ten.date}). Open Macro for the curve.`, onclick: () => (location.hash = '#macro') },
          h('span', { class: 'brief-chip-name' }, '10Y yield'),
          h('span', { class: 'num brief-chip-value' }, `${ten.now.toFixed(2)}%`),
          h('span', { class: 'muted tiny brief-chip-chg' }, ten.monthAgo != null ? `${ten.now - ten.monthAgo >= 0 ? '+' : '−'}${Math.abs((ten.now - ten.monthAgo) * 100).toFixed(0)} bp 1M` : ''),
        ),
      );
    strip.replaceChildren(...items);
    if (board.status === 'rejected' && !ten) strip.replaceChildren(h('p', { class: 'muted small' }, helper.isConnected ? `Futures unavailable: ${(board.reason as Error).message}` : 'Futures, rates and currencies appear here when the helper is running.'));
  }

  // ----- my accounts -----
  async function loadAccounts() {
    const mine = myPortfolios(await listDocs<Portfolio>('portfolios'));
    if (!mine.length) {
      // Not synced into Account yet: show Webull's own totals (as the Account page does) before the set-up hint.
      const webull = await webullTotals().catch(() => null);
      if (webull) {
        accountsBody.replaceChildren(
          h(
            'a',
            { class: 'brief-total brief-item', href: '#account', title: 'Open Account and press Sync to add holdings, movers and gains' },
            h('span', { class: 'muted tiny' }, `Total value · ${webull.count} Webull account${webull.count === 1 ? '' : 's'} (as Webull reports it)`),
            h('b', { class: 'num' }, money(webull.total)),
            h('span', { class: 'muted tiny' }, 'Press Sync on Account for holdings, today’s movers and gains'),
          ),
        );
        return;
      }
      accountsBody.replaceChildren(
        h('p', { class: 'muted small' }, 'No accounts yet. Import a statement or sync Webull on the Account page, and your value, today’s change and biggest movers show here.'),
        h('a', { class: 'btn small brief-item', href: '#account' }, 'Set up Account'),
      );
      return;
    }
    const rows = combineHoldings(mine);
    const symbols = rows.filter((r) => r.shares > 0).map((r) => r.symbol);
    // Draw straight away (last known total) and again when live prices arrive, so the card never waits on Schwab.
    drawAccounts(mine.length, rows, {}, true);
    const prices = symbols.length ? await fetchPrices(symbols) : {};
    drawAccounts(mine.length, rows, prices, false);
  }

  /** Sum of Webull's own stock-account values (null when Webull isn't set up or nothing could be read). */
  async function webullTotals(): Promise<{ total: number; count: number } | null> {
    const { loadSnapshot } = await import('../trade/webull');
    const status = await loadSnapshot();
    if (!status.ok) return null;
    let total = 0;
    let count = 0;
    for (const a of status.accounts) {
      if (a.futures || a.stocks === false) continue;
      const snap = a.id === status.accountId ? status : await loadSnapshot(a.id).catch(() => null);
      const v = snap?.balances?.value;
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        count++;
      }
    }
    return count ? { total, count } : null;
  }

  function drawAccounts(count: number, rows: ReturnType<typeof combineHoldings>, prices: Parameters<typeof accountsBrief>[1], pricing: boolean) {
    const mine = { length: count };
    const b = accountsBrief(rows, prices);
    // Never a bare dash: with no live prices, show the last total worked out on this device, labelled with its time.
    const lastKey = 'tp-brief-last-total';
    let last: { total: number; at: number } | null = null;
    try {
      if (b.total != null && !b.unpriced.length) localStorage.setItem(lastKey, JSON.stringify({ total: b.total, at: Date.now() }));
      else last = JSON.parse(localStorage.getItem(lastKey) ?? 'null');
    } catch {
      /* a per-device convenience only */
    }
    const totalText =
      b.total != null && !b.unpriced.length ? money(b.total)
        : last && Number.isFinite(last.total) ? money(last.total)
          : b.total != null ? money(b.total)
            : 'No live prices yet';
    const totalNote =
      b.total != null && !b.unpriced.length ? ''
        : last && Number.isFinite(last.total) ? `Last total, ${timeAgo(last.at / 1000)}${pricing ? ' · getting live prices…' : ' (live prices not in yet)'}`
          : b.total != null ? 'Partial: some holdings have no price yet'
            : pricing ? 'Getting live prices…' : helper.isConnected ? 'Schwab hasn’t sent prices for your holdings yet; it retries every 2 minutes' : 'Start the helper to price your holdings';
    accountsBody.replaceChildren(
      h(
        'a',
        { class: 'brief-total brief-item', href: '#account', title: 'Open Account: every account, holdings, risk, taxes and dividends' },
        h('span', { class: 'muted tiny' }, `Total value · ${mine.length} account${mine.length === 1 ? '' : 's'}`),
        h('b', { class: 'num' }, totalText),
        totalNote ? h('span', { class: 'muted tiny' }, totalNote) : '',
        h('span', { class: `num ${tone(b.today)}` }, b.today != null ? `${signedMoney(b.today)} today${b.todayPct != null ? ` (${signedPct(b.todayPct)})` : ''}` : 'Today: waiting for prices'),
      ),
      b.movers.length
        ? h(
            'ul',
            { class: 'brief-list', 'aria-label': 'Biggest movers in my holdings today' },
            ...b.movers.map((m) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', class: 'brief-row brief-item', title: `Open the ${m.symbol} chart`, onclick: () => d.openChart({ provider: 'schwab', symbol: m.symbol }) },
                  h('b', tickerAttr(m.symbol), m.symbol),
                  h('span', { class: 'muted small' }, money(m.value)),
                  h('span', { class: `num ${tone(m.today)}` }, signedMoney(m.today)),
                  h('span', { class: `num small ${tone(m.pct)}` }, signedPct(m.pct)),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'No moves in your holdings yet today.'),
      b.unpriced.length ? h('p', { class: 'muted tiny' }, `No price yet for ${b.unpriced.slice(0, 4).join(', ')}${b.unpriced.length > 4 ? '…' : ''}: left out of the total.`) : '',
    );
  }

  // ----- needs attention -----
  async function loadAttention() {
    const [alertsR, scanR, calR] = await Promise.allSettled([
      helper.version != null && helper.version >= 32 ? engineRequest<{ alerts: HelperAlert[] }>('alerts.list', {}, 15_000) : Promise.resolve({ alerts: [] as HelperAlert[] }),
      engineRequest<{ loading?: boolean; horizons?: Partial<Record<string, { setups: Setup[] }>>; setups?: Setup[] }>('scanner.results', {}, 30_000),
      getCalendar(),
    ]);
    const list = alertsR.status === 'fulfilled' ? alertsR.value.alerts : [];
    const priceSyms = [...new Set(list.filter((a) => a.active && a.kind === 'price').map((a) => a.symbol))];
    const prices = priceSyms.length ? await fetchPrices(priceSyms).catch(() => ({}) as Record<string, { price: number | null }>) : {};
    const alertItems = alertAttention(list, Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.price])), Date.now() / 1000, describeAlert);
    const scan = scanR.status === 'fulfilled' ? scanR.value : null;
    const ready: ReadySetup[] = scan?.horizons ? readySetups(scan.horizons, undefined, 12).filter((r, i, all) => all.findIndex((x) => x.setup.symbol === r.setup.symbol) === i).slice(0, 4) : [];
    const events = calR.status === 'fulfilled' ? todaysEvents(calR.value.events, new Date()) : [];

    const row = (kind: string, cls: string, main: Node | string, detail: string, onOpen: () => void, title: string) =>
      h('li', {}, h('button', { type: 'button', class: `brief-row brief-item ${cls}`, title, onclick: onOpen }, h('span', { class: `brief-kind ${cls}` }, kind), h('span', { class: 'brief-main' }, main), h('span', { class: 'muted small' }, detail)));
    const items = [
      ...alertItems.slice(0, 4).map((a) =>
        row(
          a.kind === 'fired' ? 'Fired' : 'Near',
          a.kind === 'fired' ? 'up' : 'warn',
          a.text,
          a.kind === 'fired' ? `${a.at ? clock(a.at) : ''}` : `${((a.distance ?? 0) * 100).toFixed(1)}% away`,
          async () => (await import('../ui/alerts')).openAlertsDialog(),
          'Open alerts',
        ),
      ),
      ...ready.map((r) => {
        const s = r.setup;
        const id = `${s.horizon ?? r.horizon}:${s.strategy}:${s.symbol}:${s.signalDate}`;
        return row(
          'Setup',
          r.zone === 'entry' ? 'up' : 'warn',
          h('span', {}, h('b', tickerAttr(s.symbol), s.symbol), ` ${s.direction > 0 ? 'BUY' : 'SELL'} ${s.tier} · ${r.label}`),
          `${s.strategyName.split(' (')[0]} · $${formatPrice(s.plan.trigger)}`,
          () => d.openPage('setups', 'open', id),
          `Open the ${s.symbol} setup: its read, chart and Trade this`,
        );
      }),
      ...events.slice(0, 3).map((e) => row('Event', 'event', e.title, clock(e.time), () => (location.hash = '#calendar'), 'Open the economic calendar')),
    ];
    attentionCount.hidden = !items.length;
    attentionCount.textContent = String(items.length);
    const watching = list.filter((a) => a.active).length;
    const waiting = scan?.horizons ? Object.values(scan.horizons).flatMap((x) => x?.setups ?? []).filter((s) => s.direction > 0 && (s.tier === 'A' || s.tier === 'B') && !s.trade && s.status !== 'forming').length : 0;
    attentionBody.replaceChildren(
      items.length ? h('ul', { class: 'brief-list' }, ...items) : h('p', { class: 'small' }, h('b', {}, 'Nothing needs you right now.')),
      h(
        'p',
        { class: 'muted tiny' },
        [
          `Watching ${watching} alert${watching === 1 ? '' : 's'}`,
          scan?.loading ? 'the first scan is running' : `${waiting} A/B setup${waiting === 1 ? '' : 's'} waiting for an entry`,
          events.length ? '' : 'no major US events today',
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }

  let loadedAt = 0;
  async function refresh() {
    if (!helper.isConnected) {
      strip.replaceChildren(h('p', { class: 'muted small' }, 'Futures, rates and currencies appear here when the helper is running.'));
      return;
    }
    await Promise.allSettled([
      loadStrip(),
      loadAccounts().catch((err) => accountsBody.replaceChildren(h('p', { class: 'muted small' }, (err as Error).message))),
      loadAttention().catch((err) => attentionBody.replaceChildren(h('p', { class: 'muted small' }, (err as Error).message))),
    ]);
    loadedAt = Date.now() / 1000;
    stamp.textContent = `Updated ${clock(loadedAt)}`;
    stamp.title = `Brief built ${timeAgo(loadedAt)}`;
  }

  return { el, refresh };
}

/**
 * j / k on Home move focus through the brief's rows (my accounts, then what needs attention) and Enter opens one
 * (the strip's chips are ordinary Tab stops). Ignored while
 * typing, with a dialog open, or when Home isn't showing.
 */
export function briefKeys(home: HTMLElement) {
  document.addEventListener('keydown', (e) => {
    if (home.hidden || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return;
    const t = e.target instanceof HTMLElement ? e.target : document.body;
    if (t.closest('input, select, textarea, [contenteditable="true"]') || document.querySelector('.modal-backdrop, .cmd-palette')) return;
    const items = [...home.querySelectorAll<HTMLElement>('.brief-item')].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(t);
    const next = items[i < 0 ? (e.key === 'j' ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  });
}
