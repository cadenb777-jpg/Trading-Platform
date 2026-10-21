import { INDICATORS, defaultColors, defaultParams } from '../indicators/library';
import { PRICE_SOURCES, type IndicatorDef, type IndicatorInstance } from '../indicators/types';
import { h, openModal, toast } from './dom';

/** The searchable list of every built-in indicator. Clicking one adds it to the chart. */
export function openIndicatorPicker(onAdd: (def: IndicatorDef) => void) {
  const list = h('div', { class: 'picker-list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search indicators, e.g. RSI', 'aria-label': 'Search indicators' });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const matches = INDICATORS.filter((d) => `${d.name} ${d.shortName} ${d.category}`.toLowerCase().includes(q));
    list.replaceChildren();
    const categories = [...new Set(matches.map((d) => d.category))];
    for (const category of categories) {
      list.append(h('div', { class: 'picker-category' }, category));
      for (const def of matches.filter((d) => d.category === category)) {
        list.append(
          h(
            'button',
            {
              class: 'picker-item',
              onclick: () => {
                onAdd(def);
                toast(`Added ${def.name}`);
              },
            },
            h('span', { class: 'picker-name' }, def.name, h('span', { class: 'picker-short' }, def.shortName)),
            h('span', { class: 'picker-desc' }, def.description),
          ),
        );
      }
    }
    if (!matches.length) list.append(h('div', { class: 'muted pad' }, 'No indicators match your search.'));
  };

  search.addEventListener('input', render);
  render();
  openModal('Indicators', h('div', {}, search, list), { wide: true });
}

/** Settings for one indicator on the chart. Changes apply immediately. */
export function openIndicatorSettings(
  def: IndicatorDef,
  instance: IndicatorInstance,
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

    form.append(h('div', { class: 'form-section' }, 'Style'));
    for (const plot of def.plots) {
      const id = `color-${plot.key}`;
      const stored = current.colors[plot.key] ?? plot.color;
      const alpha = stored.length === 9 ? stored.slice(7) : '';
      const field = h('input', { id, class: 'color', type: 'color', value: stored.slice(0, 7) });
      field.addEventListener('input', () => {
        current.colors[plot.key] = field.value + alpha;
        emit();
      });
      form.append(h('label', { class: 'form-row', for: id }, h('span', {}, plot.title), field));
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
          current = { ...current, params: defaultParams(def), colors: defaultColors(def) };
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
