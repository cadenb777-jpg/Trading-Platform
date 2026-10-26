/**
 * The futures order ticket (Trade page, Futures switch): contract picker (root + month, the front month first, expiry
 * shown), contracts, order type, prices on the contract's tick, an optional protective stop and a live estimate
 * (notional, tick value, loss to the stop). "Preview" hands the order to confirmOrder (src/trade/webull.ts), which
 * asks the helper to check it and shows the confirm window; nothing is sent from here.
 */
import { engineRequest } from '../data/schwab';
import { h, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { frontMonth, futuresBasis, notional, onTick, riskToStop, tickDollars, ticksBetween, type FuturesContract } from './futuresMath';
import { accountReady as isAccountReady } from './sizing';
import { confirmOrder, friendly, FUTURES_WARNING, OPEN, TYPE_LABELS, usd, type OrderType, type PlacedOrder, type Snapshot } from './webull';

export interface FuturesTicketHost {
  snapshot(): Snapshot | null;
  accountId(): string;
  /** The contract changed (the page shows its details). */
  onContract?(c: FuturesContract | null): void;
  onPlaced(order: PlacedOrder, ok: boolean): void;
}
export interface FuturesTicket {
  el: HTMLElement;
  setSide(side: 'BUY' | 'SELL'): void;
  setContract(symbol: string): void;
  preview(): void;
  refresh(): void;
  contract(): FuturesContract | null;
}

const ROOTS: [string, string][] = [['MES', 'Micro S&P 500'], ['MNQ', 'Micro Nasdaq-100'], ['ES', 'E-mini S&P 500'], ['NQ', 'E-mini Nasdaq-100'], ['CL', 'Crude oil'], ['GC', 'Gold']];
const ROOT_KEY = 'tp-trade-fut-root';
const TYPE_TEXT: Record<OrderType, string> = {
  MARKET: 'Fills now at the best price available. Fast, but the price can slip.',
  LIMIT: 'Fills only at your price or better. You may not get filled.',
  STOP: 'Waits until the price reaches your stop, then becomes a market order.',
  STOP_LIMIT: 'Waits for the stop, then becomes a limit order: you control the price but may not get filled.',
};
const num = (input: HTMLInputElement) => {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : null;
};
const decimals = (tick: number) => Math.max(0, Math.min(6, (String(tick).split('.')[1] ?? '').length));

export function createFuturesTicket(host: FuturesTicketHost): FuturesTicket {
  let side: 'BUY' | 'SELL' = 'BUY';
  let type: OrderType = 'LIMIT';
  let tif: 'DAY' | 'GTC' = 'DAY';
  let root = (() => {
    try {
      return localStorage.getItem(ROOT_KEY) || 'MES';
    } catch {
      return 'MES';
    }
  })();
  let contracts: FuturesContract[] = [];
  let chosen: FuturesContract | null = null;
  let loadError = '';
  let seq = 0;

  const input = (attrs: Record<string, unknown>) => h('input', { class: 'input', autocomplete: 'off', ...attrs }) as HTMLInputElement;
  const rootInput = input({ value: root, spellcheck: false, maxlength: 4, 'aria-label': 'Futures root symbol', class: 'input tk-symbol' });
  const month = h('select', { class: 'input', 'aria-label': 'Contract month' }) as HTMLSelectElement;
  const qty = input({ type: 'number', min: 1, step: 1, value: 1, 'aria-label': 'Contracts', inputmode: 'numeric' });
  const limit = input({ type: 'number', min: 0, step: 0.25, placeholder: '0.00', 'aria-label': 'Limit price', inputmode: 'decimal' });
  const stop = input({ type: 'number', min: 0, step: 0.25, placeholder: '0.00', 'aria-label': 'Stop price', inputmode: 'decimal' });
  const protect = input({ type: 'number', min: 0, step: 0.25, placeholder: 'optional', 'aria-label': 'Protective stop', inputmode: 'decimal' });

  const sideEl = h('div', { class: 'tk-side', role: 'group', 'aria-label': 'Buy or sell' });
  const rootChips = h('div', { class: 'tk-quick' });
  const info = h('div', { class: 'tk-fut-info' });
  const typeEl = h('div', { class: 'segmented tk-seg', role: 'group', 'aria-label': 'Order type' });
  const typeText = h('p', { class: 'muted small tk-type-text' });
  const tifEl = h('div', { class: 'segmented tk-seg', role: 'group', 'aria-label': 'Time in force' });
  const helpers = h('div', { class: 'tk-helpers' });
  const summary = h('div', { class: 'tk-summary' });
  const optIn = h('div', { class: 'tk-optin' });
  const previewBtn = h('button', { class: 'btn primary tk-preview', type: 'submit' }, 'Preview buy') as HTMLButtonElement;

  const row = (label: Node | string, ...children: (Node | string)[]) => h('label', { class: 'tk-row' }, h('span', { class: 'tk-label' }, label), ...children);
  const limitRow = row('Limit price', limit, helpers);
  const stopRow = row('Stop price', stop);

  const segButtons = <T extends string>(el: HTMLElement, options: [T, string][], current: T, pick: (v: T) => void, disabled: (v: T) => boolean = () => false) =>
    el.replaceChildren(...options.map(([v, l]) => h('button', { type: 'button', class: v === current ? 'active' : '', disabled: disabled(v), 'aria-pressed': v === current, onclick: () => pick(v) }, l)));

  /** The signed position in the chosen contract (negative = short), and contracts already in open orders on this side. */
  const position = () => host.snapshot()?.positions?.find((p) => p.symbol === chosen?.symbol)?.qty ?? 0;
  const pending = () =>
    (host.snapshot()?.open ?? []).filter((o) => o.symbol === chosen?.symbol && o.side === side && OPEN.test(o.status)).reduce((t, o) => t + Math.max((o.qty ?? 0) - o.filled, 0), 0);
  const contractsN = () => Math.max(Math.floor(num(qty) ?? 0), 0);
  const basis = () => futuresBasis(type, chosen?.price ?? null, num(limit), num(stop));

  async function loadContracts(r: string, keep?: string) {
    const mine = ++seq;
    root = r;
    try {
      localStorage.setItem(ROOT_KEY, r);
    } catch {
      /* only a convenience */
    }
    loadError = '';
    try {
      const reply = await engineRequest<{ contracts: FuturesContract[]; front: string | null }>('webull.futures_contracts', { root: r }, 30000);
      if (mine !== seq) return;
      contracts = reply.contracts;
      chosen = contracts.find((c) => c.symbol === keep && (c.tradable || c.closable)) ?? frontMonth(contracts);
    } catch (err) {
      if (mine !== seq) return;
      contracts = [];
      chosen = null;
      loadError = friendly(err);
    }
    drawMonths();
    host.onContract?.(chosen);
    refresh();
  }

  function drawMonths() {
    month.replaceChildren(
      ...contracts.map((c) =>
        h('option', { value: c.symbol, selected: c.symbol === chosen?.symbol, disabled: !c.tradable && !c.closable }, `${c.symbol} · expires ${c.lastTrade}${c.tradable ? '' : c.closable ? ' (closing only: roll)' : ' (not tradable)'}`),
      ),
    );
    if (!contracts.length) month.append(h('option', { value: '' }, loadError ? 'No contracts' : 'Loading…'));
    const step = chosen ? String(chosen.tick) : '0.25';
    for (const i of [limit, stop, protect]) i.step = step;
  }

  function draw() {
    if (type === 'MARKET') tif = 'DAY';
    const buy = side === 'BUY';
    sideEl.replaceChildren(
      h('button', { type: 'button', class: `tk-buy${buy ? ' active' : ''}`, 'aria-pressed': buy, onclick: () => setSide('BUY'), title: 'Buy (B)' }, 'Buy'),
      h('button', { type: 'button', class: `tk-sell${buy ? '' : ' active'}`, 'aria-pressed': !buy, onclick: () => setSide('SELL'), title: 'Sell (S)' }, 'Sell'),
    );
    rootChips.replaceChildren(
      ...ROOTS.map(([r, name]) => h('button', { type: 'button', class: `chip${r === root ? ' active' : ''}`, title: name, onclick: () => ((rootInput.value = r), loadContracts(r), draw()) }, r)),
    );
    segButtons<OrderType>(typeEl, (Object.keys(TYPE_LABELS) as OrderType[]).map((t) => [t, TYPE_LABELS[t]]), type, (v) => ((type = v), draw()));
    typeText.textContent = TYPE_TEXT[type];
    segButtons<'DAY' | 'GTC'>(tifEl, [['DAY', 'Day'], ['GTC', 'GTC']], tif, (v) => ((tif = v), draw()), (v) => v === 'GTC' && type === 'MARKET');
    limitRow.hidden = !(type === 'LIMIT' || type === 'STOP_LIMIT');
    stopRow.hidden = !(type === 'STOP' || type === 'STOP_LIMIT');
    previewBtn.textContent = buy ? 'Preview buy' : 'Preview sell';
    previewBtn.classList.toggle('tk-is-sell', !buy);
    el.classList.toggle('tk-selling', !buy);
    refresh();
  }

  function refresh() {
    const snap = host.snapshot();
    const c = chosen;
    info.replaceChildren(
      loadError
        ? h('div', { class: 'ap-error' }, loadError)
        : c
          ? h(
              'div',
              { class: 'tk-fut-grid' },
              h('span', { class: 'muted' }, c.name),
              h('span', {}, h('span', { class: 'muted' }, 'Last '), h('b', { class: 'num' }, c.price != null ? c.price.toFixed(decimals(c.tick)) : '—')),
              h('span', {}, h('span', { class: 'muted' }, 'Expiry '), h('b', {}, c.lastTrade), h('span', { class: 'muted' }, ` (${c.daysLeft} days)`)),
              h('span', {}, h('span', { class: 'muted' }, 'Multiplier '), h('b', { class: 'num' }, `$${c.multiplier}`), infoTip('multiplier')),
              h('span', {}, h('span', { class: 'muted' }, 'Tick '), h('b', { class: 'num' }, `${c.tick} = ${usd(c.tickValue)}`), infoTip('tickvalue')),
            )
          : contracts.length
            ? h('p', { class: 'wb-warn small' }, `Every ${root} contract listed is within 2 days of expiry or closed to new trades. Roll to the next contract when it is listed.`)
            : h('p', { class: 'muted small' }, 'Loading contracts…'),
    );
    const q = c?.price;
    helpers.replaceChildren(...(q ? [h('button', { type: 'button', class: 'chip', title: 'Use the last price', onclick: (e: Event) => (e.preventDefault(), (limit.value = q.toFixed(decimals(c!.tick))), refresh()) }, 'Last')] : []));
    const n = contractsN();
    const entry = basis();
    const mult = c?.multiplier ?? 0;
    const value = notional(entry, mult, n);
    const tickOrder = c ? tickDollars(c.tick, mult, Math.max(n, 1)) : null;
    const stopPrice = num(protect);
    const risk = riskToStop(side, entry, stopPrice, mult, n);
    const held = position();
    const closing = (held > 0 && side === 'SELL') || (held < 0 && side === 'BUY');
    const lim = snap?.futuresLimits;
    const warns: string[] = [];
    if (lim && n > lim.maxContracts) warns.push(`Above your maximum of ${lim.maxContracts} contract${lim.maxContracts === 1 ? '' : 's'} per order (Settings).`);
    if (lim && snap?.placedContractsToday != null && snap.placedContractsToday + n > lim.maxPerDay) warns.push(`Would pass your daily maximum of ${lim.maxPerDay} contracts.`);
    if (!closing && side === 'SELL') warns.push("Short selling futures isn't enabled in this version: a sell can only close a long position.");
    if (!closing && c && !c.tradable) warns.push('This contract only takes closing orders now (near expiry or liquidate-only). Roll to the next contract.');
    if (closing && n > Math.abs(held) - pending()) warns.push(`A closing order can be at most ${Math.max(Math.abs(held) - pending(), 0)} (your position minus open orders).`);
    if (c) for (const [label, v] of [['Limit', num(limit)], ['Stop', num(stop)], ['Protective stop', stopPrice]] as const) if (v && !onTick(v, c.tick)) warns.push(`${label} price must be a multiple of the tick (${c.tick}).`);
    if (stopPrice && entry && risk == null) warns.push(side === 'BUY' ? 'For a buy, the protective stop must be below the entry.' : 'For a sell, the protective stop must be above the entry.');
    const ready = isAccountReady(snap?.accountId, host.accountId()) && snap?.asset === 'futures';
    const enabled = !!snap?.futuresEnabled;
    previewBtn.disabled = !ready || !enabled || !c;
    previewBtn.title = !enabled ? 'Switch on futures trading in Settings first' : ready ? '' : 'Loading the futures account…';
    optIn.replaceChildren(
      enabled
        ? ''
        : h(
            'div',
            { class: 'tk-optin-box' },
            h('b', {}, 'Futures trading is off.'),
            h('span', { class: 'muted small' }, ' Switch it on in Settings > Webull (you type FUTURES). Until then you can look, but not preview.'),
            h('button', { type: 'button', class: 'btn small', onclick: async () => (await import('../ui/settings')).openSettings() }, 'Open Settings'),
          ),
    );
    summary.replaceChildren(
      snap?.account ? h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Account'), h('b', {}, snap.account)) : '',
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Position'), h('b', { class: 'num' }, held ? `${held > 0 ? 'Long' : 'Short'} ${Math.abs(held)}` : 'None')),
      h('div', { class: 'tk-sum-row tk-sum-main' }, h('span', { class: 'muted' }, 'Notional', infoTip('notional')), h('b', { class: 'num' }, usd(value))),
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, `One tick × ${Math.max(n, 1)}`), h('span', { class: 'num' }, usd(tickOrder))),
      h(
        'div',
        { class: 'tk-sum-row' },
        h('span', { class: 'muted' }, 'Risk to stop'),
        h('span', { class: `num${risk != null ? ' down' : ''}` }, risk != null && entry && stopPrice && c ? `${usd(risk)} (${ticksBetween(entry, stopPrice, c.tick)} ticks)` : 'No stop'),
      ),
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Initial margin', infoTip('initialmargin')), h('span', { class: 'muted small' }, 'Set by Webull; check buying power')),
      h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Buying power'), h('span', { class: 'num' }, usd(snap?.balances?.buyingPower))),
      lim ? h('div', { class: 'tk-sum-row' }, h('span', { class: 'muted' }, 'Contracts today'), h('span', { class: 'num' }, `${snap?.placedContractsToday ?? '?'} / ${lim.maxPerDay}`)) : '',
      ...warns.map((w) => h('p', { class: 'wb-warn small tk-warn' }, `⚠ ${w}`)),
      h('p', { class: 'wb-warning small tk-warn' }, FUTURES_WARNING),
    );
  }

  function setSide(v: 'BUY' | 'SELL') {
    side = v;
    draw();
  }

  function setContract(symbol: string) {
    const m = /^([A-Z0-9]{1,4})[FGHJKMNQUVXZ]\d$/.exec(symbol.toUpperCase());
    if (!m) return;
    rootInput.value = m[1];
    loadContracts(m[1], symbol.toUpperCase());
    draw();
  }

  function preview() {
    const c = chosen;
    if (!c) return toast('Choose a contract');
    const snap = host.snapshot();
    if (!snap?.futuresEnabled) return toast('Switch on futures trading in Settings first');
    if (!isAccountReady(snap?.accountId, host.accountId()) || snap.asset !== 'futures') return toast('Wait for the futures account to load');
    const n = contractsN();
    if (!(n > 0)) return toast('Enter the number of contracts');
    const order: PlacedOrder = { asset: 'futures', symbol: c.symbol, side, qty: n, orderType: type, tif };
    if (type === 'LIMIT' || type === 'STOP_LIMIT') {
      const v = num(limit);
      if (!v) return toast('Enter a limit price');
      order.limitPrice = v;
    }
    if (type === 'STOP' || type === 'STOP_LIMIT') {
      const v = num(stop);
      if (!v) return toast('Enter a stop price');
      order.stopPrice = v;
    }
    const ps = num(protect);
    if (ps) order.protectStop = ps;
    confirmOrder(order, host.accountId(), (placed, ok) => host.onPlaced(placed, ok));
  }

  for (const i of [qty, limit, stop, protect]) i.addEventListener('input', refresh);
  month.addEventListener('change', () => {
    chosen = contracts.find((c) => c.symbol === month.value) ?? null;
    drawMonths();
    host.onContract?.(chosen);
    refresh();
  });
  let rootTimer: ReturnType<typeof setTimeout> | undefined;
  rootInput.addEventListener('input', () => {
    clearTimeout(rootTimer);
    const r = rootInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(r)) return;
    rootTimer = setTimeout(() => (loadContracts(r), draw()), 600);
  });

  const el = h(
    'form',
    { class: 'tk tk-futures', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), preview()) },
    optIn,
    sideEl,
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Contract', infoTip('futures')), rootChips, h('div', { class: 'tk-fut-pick' }, rootInput, month), info),
    row(h('span', {}, 'Contracts', infoTip('contractmonth')), qty),
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Order type', infoTip('ordertype')), typeEl, typeText),
    limitRow,
    stopRow,
    row(h('span', {}, 'Protective stop (for the risk figure)', infoTip('stop')), protect),
    h('div', { class: 'tk-block' }, h('span', { class: 'tk-label' }, 'Time in force', infoTip('tif')), tifEl),
    summary,
    previewBtn,
    h('p', { class: 'muted tiny tk-foot' }, 'Preview checks the order with Webull and your futures limits. Nothing is sent until you press Place order in the next window. The protective stop is not placed for you.'),
  );
  draw();
  drawMonths();
  loadContracts(root);
  return { el, setSide, setContract, preview, refresh, contract: () => chosen };
}
