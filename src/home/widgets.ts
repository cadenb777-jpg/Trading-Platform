/**
 * Home's widget layout: which widgets show, in what order, how wide (columns of 12) and whether folded. Saved per
 * device in localStorage. Pure and tested (widgets.test.ts); homePage.ts draws it.
 */

export type WidgetId = 'read' | 'mood' | 'indexes' | 'edge' | 'accounts' | 'brief' | 'setups' | 'news' | 'events' | 'watchlist';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  /** Default width in columns of 12. */
  span: Span;
  /** Takes two rows (a tall list beside shorter cards). */
  tall?: boolean;
  about: string;
}

export const SPANS = [4, 6, 8, 12] as const;
export type Span = (typeof SPANS)[number];

export const WIDGETS: readonly WidgetDef[] = [
  { id: 'read', title: 'Why it’s moving', span: 12, about: 'One read across stocks, bonds, the Fed, futures moves and trader positioning (fixed rules, not AI)' },
  { id: 'mood', title: 'Market mood', span: 12, about: 'The fear gauge (VIX) and a heat map of the 11 S&P 500 sectors today' },
  { id: 'indexes', title: 'Market indexes', span: 12, about: 'S&P 500, Nasdaq, Dow and more, with 1D / 5D / 1M charts and the AI market read' },
  { id: 'edge', title: 'Edge today', span: 12, about: 'Where the market is set to open, futures against fair value and lending through box spreads against T-bills' },
  { id: 'accounts', title: 'My accounts', span: 4, about: 'Total value, today’s change and the biggest movers in your holdings' },
  { id: 'brief', title: 'Needs attention', span: 4, about: 'Alerts that fired or are close, ready setups and today’s big events' },
  { id: 'setups', title: 'Setups', span: 4, about: 'How many A/B setups are ready or waiting' },
  { id: 'news', title: 'Market news', span: 8, tall: true, about: 'Headlines ranked by market impact, plus your watchlist and holdings' },
  { id: 'events', title: 'Upcoming events', span: 4, about: 'The next economic releases' },
  { id: 'watchlist', title: 'Watchlist', span: 4, about: 'Your symbols with live prices' },
];

export interface LayoutItem {
  id: WidgetId;
  span: Span;
  collapsed?: boolean;
}
export interface Layout {
  v: 1;
  items: LayoutItem[];
  /** Every widget this layout has been offered, so a newly released one joins once and a removed one stays removed. */
  seen?: string[];
}

export const LAYOUT_KEY = 'tp-home-layout';

export const defaultLayout = (): Layout => ({ v: 1, items: WIDGETS.map((w) => ({ id: w.id, span: w.span })), seen: WIDGETS.map((w) => w.id) });

/** The widgets that existed before layouts remembered what they had seen: a saved layout without `seen` knew these. */
const ORIGINAL: readonly string[] = ['indexes', 'accounts', 'brief', 'setups', 'news', 'events', 'watchlist'];

const known = new Set<string>(WIDGETS.map((w) => w.id));

/** Reads a saved layout, dropping unknown or repeated widgets and bad widths; anything unreadable is the default. */
export function parseLayout(raw: string | null | undefined): Layout {
  if (!raw) return defaultLayout();
  try {
    const v = JSON.parse(raw) as Partial<Layout>;
    if (!v || v.v !== 1 || !Array.isArray(v.items)) return defaultLayout();
    const seen = new Set<string>();
    const items: LayoutItem[] = [];
    for (const it of v.items) {
      if (!it || typeof it.id !== 'string' || !known.has(it.id) || seen.has(it.id)) continue;
      seen.add(it.id);
      const span = (SPANS as readonly number[]).includes(it.span as number) ? (it.span as Span) : WIDGETS.find((w) => w.id === it.id)!.span;
      items.push({ id: it.id as WidgetId, span, ...(it.collapsed ? { collapsed: true } : {}) });
    }
    // A widget released after this layout was saved joins it once, after the first card (removing it later sticks).
    const seenBefore = new Set<string>(Array.isArray(v.seen) ? v.seen : ORIGINAL);
    let at = Math.min(1, items.length);
    for (const w of WIDGETS) if (!seenBefore.has(w.id) && !seen.has(w.id)) items.splice(at++, 0, { id: w.id, span: w.span });
    return { v: 1, items, seen: WIDGETS.map((w) => w.id) };
  } catch {
    return defaultLayout();
  }
}

/** Moves the widget at `from` to position `to` (clamped). */
export function moveWidget(l: Layout, from: number, to: number): Layout {
  const items = [...l.items];
  if (from < 0 || from >= items.length) return l;
  const [it] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, it);
  return { ...l, items };
}

export const removeWidget = (l: Layout, id: WidgetId): Layout => ({ ...l, items: l.items.filter((i) => i.id !== id) });

/** Adds a widget at the end (at its default width); no-op when it is already shown. */
export function addWidget(l: Layout, id: WidgetId): Layout {
  if (l.items.some((i) => i.id === id) || !known.has(id)) return l;
  return { ...l, items: [...l.items, { id, span: WIDGETS.find((w) => w.id === id)!.span }] };
}

/** The next width in the cycle 4 → 6 → 8 → 12 → 4. */
export const nextSpan = (s: Span): Span => SPANS[(SPANS.indexOf(s) + 1) % SPANS.length];

export const updateWidget = (l: Layout, id: WidgetId, patch: Partial<Omit<LayoutItem, 'id'>>): Layout => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

/** Widgets not on the board (for "Add widget"). */
export const hiddenWidgets = (l: Layout): WidgetDef[] => WIDGETS.filter((w) => !l.items.some((i) => i.id === w.id));
