import { allIndicators, defaultColors, defaultParams, getIndicator } from '../indicators/library';
import { PRICE_SOURCES, type IndicatorCategory, type IndicatorDef, type IndicatorInstance } from '../indicators/types';
import { TIMEFRAME_DEFS, TIMEFRAME_SECONDS, type Timeframe } from '../types';
import { h, openModal, toast } from './dom';
import { icon, type IconName } from './icons';
import { openIndicatorInfo } from './indicatorInfo';
import { buildIndex, favourites, recents, searchIndex } from './indicatorPicker';

export interface IndicatorManagerOps {
  list(): IndicatorInstance[];
  label(instance: IndicatorInstance): string;
  add(def: IndicatorDef): void;
  edit(uid: string): void;
  toggle(uid: string): void;
  remove(uid: string): void;
  togglePlot(uid: string, key: string): void;
}

type PickerFilter = 'all' | 'fav' | 'recent' | IndicatorCategory;
const FILTER_KEY = 'tp.indicatorFilter';

function savedFilter(): PickerFilter {
  try {
    return (localStorage.getItem(FILTER_KEY) as PickerFilter | null) ?? 'all';
  } catch {
    return 'all';
  }
}

/**
 * The indicator manager: every built-in indicator on the left (search by name, id or alias; category chips with
 * counts; favourites and recently used; arrow keys move through the list, Enter adds), the ones on the chart on
 * the right, each with show/hide, settings, remove and a chip per line to hide or show that line on its own.
 * Returns a refresh function the chart calls when indicators change elsewhere (legend, settings).
 */
export function openIndicatorManager(ops: IndicatorManagerOps): { refresh: () => void; close: () => void } {
  const list = h('div', { class: 'picker-list', role: 'list', 'aria-label': 'Indicators you can add' });
  const added = h('div', { class: 'mgr-added' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, short name or alias, e.g. RSI, bollinger, pivots', 'aria-label': 'Search indicators' });
  const chips = h('div', { class: 'chip-row picker-chips', role: 'toolbar', 'aria-label': 'Show a group of indicators' });
  const status = h('p', { class: 'muted tiny picker-status', 'aria-live': 'polite' });
  const addedTitle = h('h3', { class: 'mgr-title' });
  const index = buildIndex(allIndicators());
  let filter: PickerFilter = savedFilter();

  const add = (def: IndicatorDef) => {
    ops.add(def);
    recents.add(def.id);
    toast(`Added ${def.name}`);
    refresh();
  };

  // One row per indicator, built the first time it is shown and reused, so filtering 400 entries stays instant.
  const rows = new Map<string, { row: HTMLElement; count: HTMLElement; star: HTMLButtonElement }>();
  const rowFor = (def: IndicatorDef) => {
    let r = rows.get(def.id);
    if (r) return r;
    const count = h('span', { class: 'mgr-count' });
    const star = h('button', { class: 'picker-star', 'data-nav': 'star', onclick: () => (favourites.toggle(def.id), renderAvailable()) }, icon('star', 18));
    const row = h(
      'div',
      { class: 'picker-row', role: 'listitem', 'data-id': def.id },
      h(
        'button',
        { class: 'picker-item', 'data-nav': 'item', title: `Add ${def.name}`, onclick: () => add(def) },
        h('span', { class: 'picker-name' }, def.name, h('span', { class: 'picker-short' }, def.shortName), h('span', { class: 'picker-cat' }, def.category), count),
        h('span', { class: 'picker-desc' }, def.description),
      ),
      star,
      h('button', { class: 'picker-info', 'data-nav': 'info', title: `What is ${def.shortName}?`, 'aria-label': `About ${def.name}`, onclick: () => openIndicatorInfo(def) }, icon('info', 18)),
      h('button', { class: 'mgr-add', 'data-nav': 'add', title: `Add ${def.name}`, 'aria-label': `Add ${def.name}`, onclick: () => add(def) }, icon('plus', 18)),
    );
    r = { row, count, star };
    rows.set(def.id, r);
    return r;
  };

  const chip = (value: PickerFilter, label: string, n: number) =>
    h(
      'button',
      {
        class: `chip${filter === value ? ' on' : ''}`,
        'aria-pressed': String(filter === value),
        onclick: () => {
          filter = value;
          try {
            localStorage.setItem(FILTER_KEY, value);
          } catch {
            /* not remembered */
          }
          renderAvailable();
        },
      },
      label,
      h('span', { class: 'chip-count' }, String(n)),
    );

  const renderAvailable = () => {
    const q = search.value.trim();
    const matches = searchIndex(index, q).map((e) => e.def);
    const favs = favourites.list();
    const recent = recents.list();
    const favSet = new Set(favs);
    const byCategory = new Map<string, IndicatorDef[]>();
    for (const d of matches) byCategory.set(d.category, [...(byCategory.get(d.category) ?? []), d]);
    const byId = new Map(matches.map((d) => [d.id, d]));
    const recentDefs = recent.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const favDefs = matches.filter((d) => favSet.has(d.id));
    const categories = [...new Set(index.map((e) => e.def.category))];
    if (filter !== 'all' && filter !== 'fav' && filter !== 'recent' && !categories.includes(filter)) filter = 'all';

    const focusedChip = chips.contains(document.activeElement) ? [...chips.children].indexOf(document.activeElement as Element) : -1;
    chips.replaceChildren(
      chip('all', 'All', matches.length),
      chip('fav', '★ Favourites', favDefs.length),
      chip('recent', 'Recent', recentDefs.length),
      // while searching, groups with no match are left out so the chips stay short
      ...categories.filter((c) => !q || byCategory.has(c) || filter === c).map((c) => chip(c, c, byCategory.get(c)?.length ?? 0)),
    );
    if (focusedChip >= 0) (chips.children[focusedChip] as HTMLElement | undefined)?.focus();

    const shown = filter === 'all' ? matches : filter === 'fav' ? favDefs : filter === 'recent' ? recentDefs : (byCategory.get(filter) ?? []);
    const grouped = filter === 'all' && !q;
    const onChart = new Map<string, number>();
    for (const i of ops.list()) onChart.set(i.defId, (onChart.get(i.defId) ?? 0) + 1);
    const frag = document.createDocumentFragment();
    let lastCategory = '';
    for (const def of shown) {
      if (grouped && def.category !== lastCategory) frag.append(h('div', { class: 'picker-category', role: 'presentation' }, (lastCategory = def.category)));
      const r = rowFor(def);
      const n = onChart.get(def.id) ?? 0;
      r.count.textContent = n ? `on chart ×${n}` : '';
      const fav = favSet.has(def.id);
      r.star.classList.toggle('on', fav);
      r.star.setAttribute('aria-pressed', String(fav));
      r.star.setAttribute('aria-label', `Favourite: ${def.name}`);
      r.star.title = fav ? 'Remove from favourites' : 'Add to favourites';
      frag.append(r.row);
    }
    if (!shown.length) {
      const why =
        filter === 'fav' && !favs.length
          ? 'No favourites yet. Click the star next to an indicator to keep it here.'
          : filter === 'recent' && !recent.length
            ? 'Indicators you add will show up here.'
            : 'No indicators match your search.';
      frag.append(h('div', { class: 'muted pad' }, why));
    }
    list.classList.toggle('flat', !grouped);
    list.replaceChildren(frag);
    status.textContent = `${shown.length} indicator${shown.length === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}`;
  };

  // Keyboard: arrows move between rows (same column) and across a row's buttons; typing jumps back to the search.
  const navTargets = (nav: string) => [...list.querySelectorAll<HTMLElement>(`[data-nav="${nav}"]`)];
  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const nav = target.dataset.nav;
    if (!nav) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const items = navTargets(nav);
      const at = items.indexOf(target);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : at + (e.key === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
      if (next < 0) search.focus();
      else items[Math.min(next, items.length - 1)]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const inRow = [...(target.closest('.picker-row')?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])];
      const next = inRow[inRow.indexOf(target) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) (e.preventDefault(), next.focus());
    } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      search.focus(); // the key lands in the search box
    }
  });
  chips.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const all = [...chips.children] as HTMLElement[];
    const next = all[all.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) (e.preventDefault(), next.focus());
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const first = navTargets('item')[0];
      if (first) (e.preventDefault(), first.focus());
    } else if (e.key === 'Escape' && search.value) {
      e.stopPropagation(); // clear the search instead of closing the window
      search.value = '';
      renderAvailable();
    }
  });

  const renderAdded = () => {
    const items = ops.list();
    addedTitle.textContent = `On your chart (${items.length})`;
    added.replaceChildren();
    if (!items.length) added.append(h('p', { class: 'muted small pad' }, 'Nothing yet. Add indicators from the list on the left.'));
    for (const instance of items) {
      const def = getIndicator(instance.defId);
      if (!def) continue;
      const btn = (name: IconName, title: string, fn: () => void, cls = '') =>
        h('button', { class: `legend-btn${cls}`, title, 'aria-label': title, onclick: () => (fn(), refresh()) }, icon(name, 16));
      added.append(
        h(
          'div',
          { class: `mgr-item${instance.visible ? '' : ' hidden-ind'}` },
          h(
            'div',
            { class: 'mgr-item-head' },
            h('button', { class: 'legend-name mgr-name', title: 'Settings', onclick: () => ops.edit(instance.uid) }, ops.label(instance)),
            h(
              'span',
              { class: 'mgr-actions' },
              btn(instance.visible ? 'eye' : 'eyeOff', instance.visible ? 'Hide' : 'Show', () => ops.toggle(instance.uid)),
              btn('gear', 'Settings: inputs, colours, lines', () => ops.edit(instance.uid)),
              btn('trash', 'Remove', () => ops.remove(instance.uid), ' danger'),
            ),
          ),
          def.plots.length > 1
            ? h(
                'div',
                { class: 'mgr-plots' },
                ...def.plots.map((plot) => {
                  const hidden = instance.hiddenPlots?.includes(plot.key);
                  return h(
                    'button',
                    { class: `legend-value${hidden ? ' off' : ''}`, style: `--c:${instance.colors[plot.key] ?? plot.color}`, title: `Click to ${hidden ? 'show' : 'hide'} ${plot.title}`, onclick: () => (ops.togglePlot(instance.uid, plot.key), refresh()) },
                    h('i', {}),
                    plot.title,
                  );
                }),
              )
            : '',
        ),
      );
    }
  };

  const refresh = () => {
    renderAdded();
    renderAvailable();
  };

  search.addEventListener('input', () => {
    // a search looks through everything unless favourites or recent are picked
    if (search.value.trim() && filter !== 'fav' && filter !== 'recent') filter = 'all';
    renderAvailable();
  });
  refresh();
  const close = openModal(
    'Indicators',
    h(
      'div',
      { class: 'mgr' },
      h('div', { class: 'mgr-col' }, h('h3', { class: 'mgr-title' }, 'Add indicators'), search, chips, status, list),
      h('div', { class: 'mgr-col mgr-right' }, addedTitle, added, h('p', { class: 'muted tiny' }, 'Tip: click a coloured line name to hide or show just that line. The same works on the chart’s legend.')),
      h(
        'div',
        { class: 'picker-footer mgr-footer' },
        h('span', { class: 'muted small' }, 'Want something that isn\'t here?'),
        h('button', { class: 'btn', onclick: () => ((location.hash = '#chart/scripts'), close()) }, '✎ Write your own indicator'),
      ),
    ),
    { wide: true },
  );
  return { refresh, close };
}

/** Settings for one indicator on the chart. Changes apply immediately. */
export function openIndicatorSettings(
  def: IndicatorDef,
  instance: IndicatorInstance,
  chartTimeframe: Timeframe,
  onChange: (updated: IndicatorInstance) => void,
  onRemove: () => void,
) {
  let current: IndicatorInstance = structuredClone(instance);
  const emit = () => onChange(structuredClone(current));
  const form = h('div', { class: 'form' });

  const render = () => {
    form.replaceChildren();
    if (def.inputs.length) form.append(h('div', { class: 'form-section' }, 'Inputs'));
    for (const input of def.inputs) {
      const id = `in-${input.key}`;
      let field: HTMLInputElement | HTMLSelectElement;
      if (input.type === 'number') {
        field = h('input', { id, class: 'input', type: 'number', value: current.params[input.key], min: input.min, max: input.max, step: input.step ?? 1 });
        field.addEventListener('change', () => {
          const value = Number(field.value);
          if (!Number.isFinite(value)) return;
          const clamped = Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, value));
          field.value = String(clamped);
          current.params[input.key] = clamped;
          emit();
        });
      } else {
        field = h('select', { id, class: 'input' }, ...PRICE_SOURCES.map((s) => h('option', { value: s, selected: current.params[input.key] === s }, s)));
        field.addEventListener('change', () => {
          current.params[input.key] = field.value;
          emit();
        });
      }
      form.append(h('label', { class: 'form-row', for: id }, h('span', {}, input.label), field));
    }

    form.append(h('div', { class: 'form-section' }, 'Timeframe & placement'));
    // Higher timeframes than the chart only; "Chart" means use the chart's own timeframe.
    const tfOptions = TIMEFRAME_DEFS.filter((d) => d.seconds >= 60 && d.seconds > TIMEFRAME_SECONDS[chartTimeframe]);
    const tfSelect = h(
      'select',
      { id: 'ind-tf', class: 'input' },
      h('option', { value: '', selected: !current.timeframe }, `Chart (${chartTimeframe})`),
      ...tfOptions.map((d) => h('option', { value: d.id, selected: current.timeframe === d.id }, d.label)),
    );
    tfSelect.addEventListener('change', () => {
      current.timeframe = (tfSelect.value || null) as Timeframe | null;
      emit();
    });
    form.append(h('label', { class: 'form-row', for: 'ind-tf' }, h('span', {}, 'Timeframe'), tfSelect));
    if (def.placement !== 'volume') {
      const placement = current.placement ?? def.placement;
      const placeSelect = h(
        'select',
        { id: 'ind-place', class: 'input' },
        h('option', { value: 'overlay', selected: placement === 'overlay' }, 'On the price chart'),
        h('option', { value: 'separate', selected: placement === 'separate' }, 'In its own pane below'),
      );
      placeSelect.addEventListener('change', () => {
        current.placement = placeSelect.value as 'overlay' | 'separate';
        emit();
      });
      form.append(h('label', { class: 'form-row', for: 'ind-place' }, h('span', {}, 'Placement'), placeSelect));
    }

    form.append(h('div', { class: 'form-section' }, 'Lines: show, colour, thickness'));
    for (const plot of def.plots) {
      const id = `color-${plot.key}`;
      const stored = current.colors[plot.key] ?? plot.color;
      const alpha = stored.length === 9 ? stored.slice(7) : '';
      const field = h('input', { id, class: 'color', type: 'color', value: stored.slice(0, 7), title: 'Colour' });
      field.addEventListener('input', () => {
        current.colors[plot.key] = field.value + alpha;
        emit();
      });
      const shown = h('input', { type: 'checkbox', checked: !current.hiddenPlots?.includes(plot.key), title: 'Show this line', 'aria-label': `Show ${plot.title}` });
      shown.addEventListener('change', () => {
        const hidden = new Set(current.hiddenPlots ?? []);
        if (shown.checked) hidden.delete(plot.key);
        else hidden.add(plot.key);
        current.hiddenPlots = [...hidden];
        emit();
      });
      const controls = h('span', { class: 'style-controls' }, shown, field);
      if (plot.type === 'line') {
        const width = current.lineWidths?.[plot.key] ?? plot.lineWidth ?? 2;
        const widthSelect = h(
          'select',
          { class: 'input width-select', 'aria-label': `${plot.title} thickness`, title: 'Thickness' },
          ...[1, 2, 3, 4].map((w) => h('option', { value: w, selected: w === width }, `${w}px`)),
        );
        widthSelect.addEventListener('change', () => {
          current.lineWidths = { ...current.lineWidths, [plot.key]: Number(widthSelect.value) };
          emit();
        });
        controls.append(widthSelect);
      }
      form.append(h('label', { class: 'form-row', for: id }, h('span', {}, plot.title), controls));
    }
    if (def.levels?.length) {
      const levels = h('input', { id: 'levels', type: 'checkbox', checked: !current.hideLevels });
      levels.addEventListener('change', () => {
        current.hideLevels = !levels.checked;
        emit();
      });
      form.append(h('label', { class: 'form-row', for: 'levels' }, h('span', {}, `Reference levels (${def.levels.join(' / ')})`), levels));
    }
    const visible = h('input', { id: 'visible', type: 'checkbox', checked: current.visible });
    visible.addEventListener('change', () => {
      current.visible = visible.checked;
      emit();
    });
    form.append(h('label', { class: 'form-row', for: 'visible' }, h('span', {}, 'Visible'), visible));
  };

  render();
  const actions = h(
    'div',
    { class: 'modal-actions' },
    h('button', { class: 'btn danger', onclick: () => (close(), onRemove()) }, 'Remove'),
    h('span', { class: 'spacer' }),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          current = { ...current, params: defaultParams(def), colors: defaultColors(def), lineWidths: undefined, placement: undefined, timeframe: null, hiddenPlots: undefined, hideLevels: undefined };
          render();
          emit();
        },
      },
      'Reset',
    ),
    h('button', { class: 'btn primary', onclick: () => close() }, 'Done'),
  );
  const close = openModal(def.name, h('div', {}, h('p', { class: 'muted' }, def.description), form, actions));
}
