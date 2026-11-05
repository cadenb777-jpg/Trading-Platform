/**
 * Home's widget layout: which widgets show, in what order, how wide (columns of 12) and whether folded. Saved per
 * device in localStorage. Pure and tested (widgets.test.ts); homePage.ts draws it.
 */

export type WidgetId = 'indexes' | 'accounts' | 'brief' | 'setups' | 'news' | 'events' | 'watchlist';

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
  { id: 'indexes', title: 'Market indexes', span: 12, about: 'S&P 500, Nasdaq, Dow and more, with 1D / 5D / 1M charts and the AI market read' },
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
}

export const LAYOUT_KEY = 'tp-home-layout';

export const defaultLayout = (): Layout => ({ v: 1, items: WIDGETS.map((w) => ({ id: w.id, span: w.span })) });

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
    return { v: 1, items };
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
  return { v: 1, items };
}

export const removeWidget = (l: Layout, id: WidgetId): Layout => ({ v: 1, items: l.items.filter((i) => i.id !== id) });

/** Adds a widget at the end (at its default width); no-op when it is already shown. */
export function addWidget(l: Layout, id: WidgetId): Layout {
  if (l.items.some((i) => i.id === id) || !known.has(id)) return l;
  return { v: 1, items: [...l.items, { id, span: WIDGETS.find((w) => w.id === id)!.span }] };
}

/** The next width in the cycle 4 → 6 → 8 → 12 → 4. */
export const nextSpan = (s: Span): Span => SPANS[(SPANS.indexOf(s) + 1) % SPANS.length];

export const updateWidget = (l: Layout, id: WidgetId, patch: Partial<Omit<LayoutItem, 'id'>>): Layout => ({ v: 1, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

/** Widgets not on the board (for "Add widget"). */
export const hiddenWidgets = (l: Layout): WidgetDef[] => WIDGETS.filter((w) => !l.items.some((i) => i.id === w.id));
