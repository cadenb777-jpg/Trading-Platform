/**
 * Linked symbol groups (like Bloomberg's coloured link chips). Every panel that shows one symbol (the Chart, the
 * workspace panels, Research, Flow, the Futures detail, the Setups detail, the Trade ticket, the Home news, the
 * watchlist) has a small chip: Not linked, Red, Green, Blue or Yellow. Changing the symbol in one panel changes it in
 * every other panel of the same colour. Everything starts on Blue, so the platform follows what you're looking at;
 * pick "Not linked" to keep a panel to itself. Each panel's colour and each group's symbol are saved in this browser
 * (localStorage, with a memory fallback when storage is blocked).
 *
 * The bus (createLinkBus) is pure and tested in linkGroups.test.ts; linkChip and linkPanel are the browser part.
 * Trade only pre-fills its ticket from a group; nothing is ever previewed or placed by a link.
 */
import { h } from './dom';

export const LINK_COLORS = ['none', 'red', 'green', 'blue', 'yellow'] as const;
export type LinkColor = (typeof LINK_COLORS)[number];
export const DEFAULT_LINK: LinkColor = 'blue';
export const LINK_LABELS: Record<LinkColor, string> = { none: 'Not linked', red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow' };

const KEY = 'tp-link-groups';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;
type Listener = (symbol: string) => void;

interface Saved {
  panels: Record<string, LinkColor>;
  symbols: Partial<Record<LinkColor, string>>;
}

const isColor = (c: unknown): c is LinkColor => typeof c === 'string' && (LINK_COLORS as readonly string[]).includes(c);
const clean = (s: string) => s.trim().toUpperCase();

/** A link bus: each panel has a colour, each colour a symbol; publishing tells the rest of the group. */
export function createLinkBus(store: KeyStore | null) {
  const saved: Saved = read();
  const subs = new Map<string, Set<Listener>>();
  const colorSubs = new Set<(panelId: string, color: LinkColor) => void>();

  function read(): Saved {
    try {
      const raw = store?.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
      const panels = Object.fromEntries(Object.entries(v.panels ?? {}).filter(([, c]) => isColor(c))) as Record<string, LinkColor>;
      const symbols = Object.fromEntries(Object.entries(v.symbols ?? {}).filter(([c, s]) => isColor(c) && c !== 'none' && typeof s === 'string' && s)) as Saved['symbols'];
      return { panels, symbols };
    } catch {
      return { panels: {}, symbols: {} };
    }
  }

  function write() {
    try {
      store?.setItem(KEY, JSON.stringify(saved));
    } catch {
      // private window or blocked storage: links still work until the page is closed
    }
  }

  const colorOf = (panelId: string): LinkColor => saved.panels[panelId] ?? DEFAULT_LINK;
  const tell = (panelId: string, symbol: string) => subs.get(panelId)?.forEach((fn) => fn(symbol));

  /** Sets a group's symbol and tells its panels (except `from`, which already shows it). False when nothing changed. */
  function publishTo(color: LinkColor, symbol: string, from?: string): boolean {
    const s = clean(symbol);
    if (color === 'none' || !s || saved.symbols[color] === s) return false;
    saved.symbols[color] = s;
    write();
    for (const id of [...subs.keys()]) if (id !== from && colorOf(id) === color) tell(id, s);
    return true;
  }

  return {
    colorOf,
    /** Moves a panel to a group. Joining a group that already has a symbol shows that symbol in the panel. */
    setColor(panelId: string, color: LinkColor) {
      if (!isColor(color)) return;
      saved.panels[panelId] = color;
      write();
      colorSubs.forEach((fn) => fn(panelId, color));
      const s = color === 'none' ? undefined : saved.symbols[color];
      if (s) tell(panelId, s);
    },
    /** The symbol of the panel's group, or null when it isn't linked or the group has none yet. */
    symbolFor(panelId: string): string | null {
      const c = colorOf(panelId);
      return c === 'none' ? null : (saved.symbols[c] ?? null);
    },
    groupSymbol: (color: LinkColor): string | null => (color === 'none' ? null : (saved.symbols[color] ?? null)),
    /** The panel changed its own symbol: the rest of its group follows. Unlinked panels tell nobody. */
    publish(panelId: string, symbol: string): boolean {
      return publishTo(colorOf(panelId), symbol, panelId);
    },
    publishTo,
    /** Changes a panel from outside (the command bar scoped to a panel): the panel and its whole group. */
    set(panelId: string, symbol: string) {
      const s = clean(symbol);
      if (!s) return;
      const c = colorOf(panelId);
      if (c === 'none' || !publishTo(c, s)) tell(panelId, s); // unlinked, or the group already had it
    },
    /** Calls `fn(symbol)` when the panel's group symbol changes (or the panel is set directly). Returns unsubscribe. */
    subscribe(panelId: string, fn: Listener): () => void {
      let set = subs.get(panelId);
      if (!set) subs.set(panelId, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    onColorChange(fn: (panelId: string, color: LinkColor) => void): () => void {
      colorSubs.add(fn);
      return () => colorSubs.delete(fn);
    },
  };
}

export type LinkBus = ReturnType<typeof createLinkBus>;

const browserStore = (): KeyStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The app's one bus. */
export const links = createLinkBus(browserStore());

// ---------- what a panel can show ----------

/** A US stock or fund symbol (what Research, Flow and the Trade ticket take). */
export const isStockSymbol = (s: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(s);
export const isFuturesSymbol = (s: string) => /^\/[A-Z0-9]{1,4}$/.test(s);

// ---------- keyboard: moving between panels ----------

/** The panel index after moving `dir` (+1 / -1) from `current` (-1 = none focused) among `count`, wrapping round. */
export function cyclePanel(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}

export const PANEL_ATTR = 'data-link-panel';

/** The linkable panels on screen, in page order (hidden pages, modes and panels are skipped). */
export function visiblePanels(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${PANEL_ATTR}]`)].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

/** Moves focus to the next/previous panel, or to panel `n` (0-based). */
export function focusPanel(target: { dir: 1 | -1 } | { index: number }) {
  const list = visiblePanels();
  if (!list.length) return;
  const at = list.findIndex((p) => p.contains(document.activeElement));
  const i = 'dir' in target ? cyclePanel(at, list.length, target.dir) : target.index;
  const el = list[i];
  if (!el) return;
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: false });
  el.scrollIntoView({ block: 'nearest' });
}

/** The panel holding focus: its id and a short label for the command bar. */
export function focusedPanel(): { id: string; label: string } | null {
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(`[${PANEL_ATTR}]`);
  const id = el?.getAttribute(PANEL_ATTR);
  return el && id ? { id, label: el.dataset.linkLabel ?? id } : null;
}

// ---------- the chip (browser) ----------

let openMenu: { el: HTMLElement; chip: HTMLElement } | null = null;

function closeMenu(refocus = false) {
  if (!openMenu) return;
  const { el, chip } = openMenu;
  openMenu = null;
  el.remove();
  document.removeEventListener('pointerdown', onOutside, true);
  if (refocus) chip.focus();
}
const onOutside = (e: Event) => openMenu && !openMenu.el.contains(e.target as Node) && !openMenu.chip.contains(e.target as Node) && closeMenu();

/** The colour chip for a panel: a coloured dot that opens a small menu of groups. */
export function linkChip(panelId: string, label: string): HTMLElement {
  const chip = h('button', { type: 'button', class: 'link-chip', 'aria-haspopup': 'menu' });
  const paint = () => {
    const c = links.colorOf(panelId);
    chip.dataset.color = c;
    const sym = links.groupSymbol(c);
    const text = c === 'none' ? `${label}: not linked. Click to link it to a colour group.` : `${label}: linked to the ${LINK_LABELS[c]} group${sym ? ` (${sym.replace(/^\$/, '')})` : ''}. Panels with the same colour follow the same symbol.`;
    chip.title = text;
    chip.setAttribute('aria-label', text);
  };
  paint();
  links.onColorChange((id) => id === panelId && paint());
  chip.addEventListener('pointerenter', paint); // the group's symbol may have changed since
  chip.addEventListener('focus', paint);
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu?.chip === chip) return closeMenu();
    closeMenu();
    const items = LINK_COLORS.map((c) =>
      h(
        'button',
        { type: 'button', role: 'menuitemradio', class: 'link-opt', 'aria-checked': String(links.colorOf(panelId) === c), 'data-color': c, onclick: () => (links.setColor(panelId, c), closeMenu(true)) },
        h('i', { class: 'link-dot', 'data-color': c }),
        LINK_LABELS[c],
      ),
    );
    const menu = h('div', { class: 'link-menu', role: 'menu', 'aria-label': `Link group for ${label}` }, h('div', { class: 'muted tiny link-menu-head' }, 'Same colour = same symbol'), ...items);
    menu.addEventListener('keydown', (ev) => {
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === 'Escape') (ev.preventDefault(), ev.stopPropagation(), closeMenu(true));
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') (ev.preventDefault(), items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus());
      else if (ev.key === 'Tab') closeMenu();
    });
    document.body.append(menu);
    const r = chip.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
    openMenu = { el: menu, chip };
    document.addEventListener('pointerdown', onOutside, true);
    (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0]).focus();
  });
  return chip;
}

export interface LinkPanelOptions {
  id: string;
  /** Shown in the chip's tooltip and the command bar ("Research", "Panel 2"). */
  label: string;
  /** The panel element: it becomes focusable for Ctrl+[ ] and typing a ticker. */
  el?: HTMLElement;
  /** Which symbols the panel can show (Research takes stocks only, the Futures detail futures only). */
  accepts?(symbol: string): boolean;
  /** Shows a symbol from the group. Never publish from here. */
  apply(symbol: string): void;
  /** False while the page is hidden: the symbol is picked up by wanted() when it is shown again. */
  active?(): boolean;
}

/** Makes an element a panel for the keyboard (Ctrl+[ ], Alt+1-6, typing a ticker). */
export function markPanel(el: HTMLElement, id: string, label: string) {
  el.setAttribute(PANEL_ATTR, id);
  el.dataset.linkLabel = label;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
}

/** Connects a page's panel to the bus. Call publish() only when the user changed the symbol. */
export function linkPanel(o: LinkPanelOptions) {
  const ok = (s: string) => !o.accepts || o.accepts(s);
  if (o.el) markPanel(o.el, o.id, o.label);
  links.subscribe(o.id, (s) => ok(s) && (!o.active || o.active()) && o.apply(s));
  return {
    chip: linkChip(o.id, o.label),
    publish: (symbol: string) => links.publish(o.id, symbol),
    /** On showing the page: the group's symbol when the panel should switch to it (null to keep `current`). */
    wanted(current?: string | null): string | null {
      const s = links.symbolFor(o.id);
      return s && ok(s) && s !== (current ?? '').trim().toUpperCase() ? s : null;
    },
  };
}
