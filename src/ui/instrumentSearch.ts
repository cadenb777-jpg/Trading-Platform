/**
 * The one research search (owner: "like Schwab's research page", no duplication): type a ticker or a name (several
 * words fine), see stocks, ETFs, mutual funds, indexes, bonds (a 9-character CUSIP) and private funds grouped by kind,
 * and press Enter: each kind opens where it lives in the platform (pure routing below, tested):
 *   stock, ETF, mutual fund, index, crypto -> the security page (#sec/SYM: Overview, chart, financials, fund facts)
 *   bond (CUSIP)                          -> Investments -> Bonds -> CUSIP lookup (#invest/bonds/lookup/<CUSIP>)
 *   private fund (catalog)                -> Investments -> Alternatives -> fund detail (#invest/alts/fund/<id>)
 *   "search private funds for ..."        -> every Form D at the SEC (#invest/alts/search/<words>)
 * Used by Security -> Search (src/pages/findPage.ts) and the Investments page; the command bar uses the same helper
 * search (invest.search) for names.
 */
import { engineRequest, helper } from '../data/schwab';
import { searchCatalog } from '../invest/catalog';
import { secHash } from '../security/codes';
import { h } from './dom';

export type Kind = 'stock' | 'etf' | 'mutual_fund' | 'index' | 'bond' | 'alt' | 'crypto' | 'other';
export interface Hit {
  kind: Kind;
  /** Ticker, CUSIP or private-fund catalog id */
  id: string;
  label: string;
  sub: string;
  /** For "search private funds for ..." */
  query?: string;
}

export const KIND_LABEL: Record<Kind, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  mutual_fund: 'Mutual funds',
  index: 'Indexes',
  bond: 'Bonds',
  alt: 'Private funds and alternatives',
  crypto: 'Crypto',
  other: 'Other',
};
/** The filter tabs, in Schwab's research order. */
export const FILTERS: { id: 'all' | Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stock', label: 'Stocks' },
  { id: 'etf', label: 'ETFs' },
  { id: 'mutual_fund', label: 'Mutual funds' },
  { id: 'bond', label: 'Bonds' },
  { id: 'alt', label: 'Alternatives' },
];

const CUSIP = /^[0-9A-Z]{8}[0-9]$/;
export const isCusip = (q: string) => CUSIP.test(q.trim().toUpperCase());

/** Where a hit opens (pure, tested). */
export function hrefFor(hit: Hit): string {
  switch (hit.kind) {
    case 'bond':
      return `#invest/bonds/lookup/${encodeURIComponent(hit.id)}`;
    case 'alt':
      return hit.query ? `#invest/alts/search/${encodeURIComponent(hit.query)}` : `#invest/alts/fund/${encodeURIComponent(hit.id)}`;
    default:
      return secHash(hit.id);
  }
}

const SCHWAB_KINDS: Record<string, Kind> = { stock: 'stock', etf: 'etf', mutual_fund: 'mutual_fund', index: 'index', bond: 'bond' };

/** Schwab's answer as hits; older helpers send no kind, so it is read from Schwab's asset type (pure, tested). */
export function schwabHits(results: { symbol: string; name: string; assetType?: string; kind?: string }[]): Hit[] {
  return results.map((r) => {
    const t = (r.assetType ?? '').toUpperCase();
    const kind: Kind = SCHWAB_KINDS[r.kind ?? ''] ?? (t === 'MUTUAL_FUND' ? 'mutual_fund' : t === 'ETF' ? 'etf' : t === 'INDEX' ? 'index' : t === 'BOND' ? 'bond' : t === 'EQUITY' ? 'stock' : 'other');
    return { kind, id: r.symbol, label: r.name || r.symbol, sub: r.symbol.replace(/^\$/, '') };
  });
}

/** What the platform already knows without asking Schwab: a CUSIP, its own lists and the private-fund directory. */
export function localHits(query: string): Hit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const out: Hit[] = [];
  if (isCusip(q)) out.push({ kind: 'bond', id: q.toUpperCase(), label: `Bond CUSIP ${q.toUpperCase()}`, sub: 'Look it up: issuer, coupon, maturity, price' });
  const { symbols, funds } = searchCatalog(q);
  for (const s of symbols.slice(0, 8)) {
    // the Investments lists: $ = an index, crypto pairs, the stock lists' stocks; everything else there is a listed fund
    const kind: Kind = s.symbol.startsWith('$') ? 'index' : s.section === 'crypto' && s.symbol.includes('-') ? 'crypto' : s.section === 'stocks' ? 'stock' : 'etf';
    out.push({ kind, id: s.symbol, label: s.label, sub: s.symbol.replace(/^\$/, '') });
  }
  for (const f of funds.slice(0, 8)) out.push({ kind: 'alt', id: f.id, label: f.name, sub: `${f.short} · ${f.manager} · ${f.structure}` });
  out.push({ kind: 'alt', id: 'search', label: `Search private funds for “${q}”`, sub: 'Every Form D filed with the SEC (hedge, private equity, venture, feeder funds)', query: q });
  return out;
}

/** Local and Schwab hits merged (one per id, Schwab's kind wins), filtered to one kind, grouped in display order. */
export function mergeHits(local: Hit[], remote: Hit[], filter: 'all' | Kind): { kind: Kind; hits: Hit[] }[] {
  const byId = new Map<string, Hit>();
  for (const x of [...remote, ...local]) if (!byId.has(`${x.kind === 'alt' ? 'alt:' : ''}${x.id}`)) byId.set(`${x.kind === 'alt' ? 'alt:' : ''}${x.id}`, x);
  const order: Kind[] = ['stock', 'etf', 'mutual_fund', 'bond', 'index', 'alt', 'crypto', 'other'];
  return order
    .filter((k) => filter === 'all' || k === filter)
    .map((k) => ({ kind: k, hits: [...byId.values()].filter((x) => x.kind === k) }))
    .filter((g) => g.hits.length);
}

/**
 * The search box with its results list. `filter` limits it to one kind (the tabs); `autofocus` puts the cursor in it.
 * Arrow keys move, Enter opens the highlighted (or first) result.
 */
export function instrumentSearch(o: { placeholder?: string; autofocus?: boolean; filter?: () => 'all' | Kind; inline?: boolean } = {}) {
  const input = h('input', {
    class: 'input isearch-input',
    type: 'search',
    'aria-label': 'Search by name or ticker',
    placeholder: o.placeholder ?? 'Name or ticker: Apple, AAPL, Vanguard 500, VFIAX, a bond CUSIP, Blackstone…',
    autocomplete: 'off',
    spellcheck: false,
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': 'isearch-list',
  }) as HTMLInputElement;
  const list = h('div', { class: `isearch-list ${o.inline ? 'inline' : ''}`, id: 'isearch-list', role: 'listbox', hidden: true });
  const el = h('div', { class: 'isearch' }, input, list);
  let remote: Hit[] = [];
  let status = '';
  let active = 0;
  let seq = 0;
  let timer = 0;
  let buttons: HTMLButtonElement[] = [];

  const open = (hit: Hit) => {
    list.hidden = true;
    location.hash = hrefFor(hit);
  };

  function render() {
    const q = input.value.trim();
    if (q.length < 2) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    const groups = mergeHits(localHits(q), remote, o.filter?.() ?? 'all');
    buttons = [];
    list.replaceChildren(
      ...groups.flatMap((g) => [
        h('div', { class: 'isearch-group', role: 'presentation' }, KIND_LABEL[g.kind]),
        ...g.hits.map((hit) => {
          const b = h(
            'button',
            { type: 'button', class: 'isearch-hit', role: 'option', onmousedown: (e: Event) => e.preventDefault(), onclick: () => open(hit) },
            h('b', {}, hit.label),
            h('span', { class: 'muted small' }, hit.sub),
          ) as HTMLButtonElement;
          buttons.push(b);
          return b;
        }),
      ]),
      ...(status ? [h('p', { class: 'muted small isearch-note' }, status)] : []),
    );
    active = Math.min(active, Math.max(0, buttons.length - 1));
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    list.hidden = !buttons.length && !status;
    input.setAttribute('aria-expanded', String(!list.hidden));
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    remote = [];
    active = 0;
    clearTimeout(timer);
    const mine = ++seq;
    status = q.length >= 2 && !isCusip(q) ? (helper.isConnected ? 'Searching Schwab…' : 'Start the helper to search everything at Schwab.') : '';
    render();
    if (q.length < 2 || isCusip(q) || !helper.isConnected) return;
    timer = window.setTimeout(() => {
      engineRequest<{ results: { symbol: string; name: string; assetType?: string; kind?: string }[] }>('invest.search', { query: q }, 20000).then(
        (r) => {
          if (mine !== seq) return;
          remote = schwabHits(r.results);
          status = remote.length ? '' : 'No matches at Schwab.';
          render();
        },
        (err: Error) => {
          if (mine !== seq) return;
          status = err.message;
          render();
        },
      );
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!buttons.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
      buttons[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      buttons[active]?.click();
    } else if (e.key === 'Escape') list.hidden = true;
  });
  if (!o.inline) input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  input.addEventListener('focus', () => render());
  if (o.autofocus) setTimeout(() => input.focus(), 50);
  return { el, input, refresh: render };
}
