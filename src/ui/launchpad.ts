/**
 * The launchpad (Ctrl+L or the rail's grid button): every page and function in one searchable grid, grouped by
 * section, with their codes, plus recent and favourite ones. Read from the nav registry (nav.ts). The top half is
 * pure and tested (launchpad.test.ts).
 */
import { fuzzyScore } from './command';
import { h, openModal } from './dom';
import { icon, type IconName } from './icons';
import { FUNCTIONS, PAGES, SECTIONS, type NavPage, type SectionId } from './nav';

export interface LaunchItem {
  /** A command id (command.ts runId): page:route, act:name, fn:CODE, set:. Also the recent/favourite key. */
  id: string;
  code: string;
  label: string;
  section: SectionId | 'system';
  icon: IconName;
  keywords: string;
  about?: string;
}

/** Every launchable thing: the visible pages, then the functions. */
export function launchItems(): LaunchItem[] {
  const pages = (PAGES as readonly NavPage[])
    .filter((p) => !p.hidden)
    .map((p) => ({ id: `page:${p.route}`, code: p.code, label: p.label, section: p.section, icon: p.icon, keywords: p.keywords, about: p.about }));
  return [...pages, ...FUNCTIONS.map((f) => ({ id: f.target, code: f.code, label: f.label, section: f.section, icon: f.icon, keywords: f.keywords }))];
}

/**
 * Ranks items for a query: an exact code first ("WEI"), then code prefixes, then name matches, then keyword
 * matches; favourites win ties. An empty query returns nothing (the grid shows everything instead).
 */
export function searchLaunch(query: string, items: LaunchItem[], favourites: readonly string[] = []): LaunchItem[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase();
  const scored: { item: LaunchItem; score: number }[] = [];
  for (const item of items) {
    let score: number | null = null;
    if (item.code === upper) score = 1000;
    else if (item.code.startsWith(upper)) score = 800 - (item.code.length - upper.length);
    const byName = fuzzyScore(q, item.label);
    if (byName != null) score = Math.max(score ?? 0, byName + 100);
    const byWords = fuzzyScore(q, `${item.keywords} ${item.about ?? ''}`);
    if (byWords != null) score = Math.max(score ?? 0, byWords - 100);
    if (score == null) continue;
    scored.push({ item, score: score + (favourites.includes(item.id) ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}

/** Adds an id to the front of a recent list (no duplicates, at most `max`). */
export function pushId(list: readonly string[], id: string, max = 6): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Adds or removes a favourite. */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// ---------- the window ----------

const RECENT_KEY = 'tp-launch-recent';
const FAV_KEY = 'tp-launch-favs';

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // private window: recents and favourites just aren't remembered
  }
}

const SECTION_LABEL: Record<SectionId | 'system', string> = { ...Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])), system: 'Settings and data' } as Record<SectionId | 'system', string>;

let closeOpen: (() => void) | null = null;

/** Opens the launchpad. `run` carries out an item's command id. Calling it while open closes it. */
export function openLaunchpad(run: (id: string) => void) {
  if (closeOpen) return closeOpen();
  const items = launchItems();
  let favs = readList(FAV_KEY);
  const byId = new Map(items.map((i) => [i.id, i]));
  const input = h('input', { class: 'input lp-search', type: 'search', placeholder: 'Search pages and functions, or type a code like WEI', 'aria-label': 'Search the launchpad', spellcheck: false });
  const body = h('div', { class: 'lp-body' });

  const launch = (item: LaunchItem) => {
    writeList(RECENT_KEY, pushId(readList(RECENT_KEY), item.id));
    close();
    run(item.id);
  };
  const tile = (item: LaunchItem) => {
    const fav = favs.includes(item.id);
    return h(
      'div',
      { class: 'lp-tile' },
      h(
        'button',
        { type: 'button', class: 'lp-go', 'data-id': item.id, title: item.about ?? item.label, onclick: () => launch(item) },
        h('span', { class: 'lp-icon' }, icon(item.icon, 18)),
        h('span', { class: 'lp-code' }, item.code),
        h('span', { class: 'lp-label' }, item.label),
      ),
      h(
        'button',
        {
          type: 'button',
          class: `lp-fav${fav ? ' on' : ''}`,
          title: fav ? 'Remove from favourites' : 'Add to favourites',
          'aria-label': `${fav ? 'Remove' : 'Add'} ${item.label} ${fav ? 'from' : 'to'} favourites`,
          'aria-pressed': fav ? 'true' : 'false',
          onclick: () => {
            favs = toggleId(favs, item.id);
            writeList(FAV_KEY, favs);
            draw();
          },
        },
        icon('star', 14),
      ),
    );
  };
  const group = (label: string, list: LaunchItem[]) => (list.length ? h('section', { class: 'lp-group' }, h('h3', { class: 'section-label' }, label), h('div', { class: 'lp-grid' }, ...list.map(tile))) : null);

  function draw() {
    const q = input.value;
    if (q.trim()) {
      const hits = searchLaunch(q, items, favs);
      body.replaceChildren(hits.length ? group('Best matches', hits) ?? '' : h('p', { class: 'muted pad' }, 'Nothing matches. Try a code like WEI, a page name or a word like “dividends”.'));
      return;
    }
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((x): x is LaunchItem => !!x);
    body.replaceChildren(
      ...[group('Favourites', pick(favs)), group('Recent', pick(readList(RECENT_KEY)))].filter(Boolean) as HTMLElement[],
      ...(['markets', 'analyze', 'money', 'business', 'ai', 'system'] as const).map((s) => group(SECTION_LABEL[s], items.filter((i) => i.section === s))).filter((x): x is HTMLElement => !!x),
    );
  }
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = searchLaunch(input.value, items, favs)[0];
      if (first) launch(first);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      body.querySelector<HTMLElement>('.lp-go')?.focus();
    }
  });
  // arrow keys move between tiles
  body.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const tiles = [...body.querySelectorAll<HTMLElement>('.lp-go')];
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = tiles[i + step];
    if (next) next.focus();
    else if (step < 0) input.focus();
  });
  draw();
  const close = openModal('Launchpad', h('div', { class: 'launchpad' }, input, body, h('p', { class: 'muted tiny lp-foot' }, h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'L'), ' opens this anywhere · ', h('kbd', {}, '/'), ' opens the command bar for tickers')), {
    wide: true,
    onClose: () => (closeOpen = null),
  });
  input.closest('.modal')?.classList.add('lp-modal');
  closeOpen = close;
}
