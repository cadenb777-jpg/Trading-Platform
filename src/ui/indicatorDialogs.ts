import { allIndicators, defaultColors, defaultParams } from '../indicators/library';
import { PRICE_SOURCES, type IndicatorDef, type IndicatorInstance } from '../indicators/types';
import { TIMEFRAME_DEFS, TIMEFRAME_SECONDS, type Timeframe } from '../types';
import { h, openModal, toast } from './dom';
import { icon } from './icons';
import { openIndicatorInfo } from './indicatorInfo';

/** The searchable list of every built-in indicator. Clicking one adds it to the chart. */
export function openIndicatorPicker(onAdd: (def: IndicatorDef) => void) {
  const list = h('div', { class: 'picker-list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search indicators, e.g. RSI', 'aria-label': 'Search indicators' });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const matches = allIndicators().filter((d) => `${d.name} ${d.shortName} ${d.category}`.toLowerCase().includes(q));
    list.replaceChildren();
    const categories = [...new Set(matches.map((d) => d.category))];
    for (const category of categories) {
      list.append(h('div', { class: 'picker-category' }, category));
      for (const def of matches.filter((d) => d.category === category)) {
        list.append(
          h(
            'div',
            { class: 'picker-row' },
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
            h('button', { class: 'picker-info', title: `What is ${def.shortName}?`, 'aria-label': `About ${def.name}`, onclick: () => openIndicatorInfo(def) }, icon('info', 18)),
          ),
        );
      }
    }
    if (!matches.length) list.append(h('div', { class: 'muted pad' }, 'No indicators match your search.'));
  };

  search.addEventListener('input', render);
  render();
  const close = openModal(
    'Indicators',
    h(
      'div',
      {},
      search,
      list,
      h(
        'div',
        { class: 'picker-footer' },
        h('span', { class: 'muted small' }, 'Want something that isn\'t here?'),
        h('button', { class: 'btn', onclick: () => ((location.hash = '#scripts'), close()) }, '✎ Write your own indicator'),
      ),
    ),
    { wide: true },
  );
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

    form.append(h('div', { class: 'form-section' }, 'Style'));
    for (const plot of def.plots) {
      const id = `color-${plot.key}`;
      const stored = current.colors[plot.key] ?? plot.color;
      const alpha = stored.length === 9 ? stored.slice(7) : '';
      const field = h('input', { id, class: 'color', type: 'color', value: stored.slice(0, 7), title: 'Colour' });
      field.addEventListener('input', () => {
        current.colors[plot.key] = field.value + alpha;
        emit();
      });
      const controls = h('span', { class: 'style-controls' }, field);
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
          current = { ...current, params: defaultParams(def), colors: defaultColors(def), lineWidths: undefined, placement: undefined, timeframe: null };
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
