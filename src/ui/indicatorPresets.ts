import { INDICATOR_PRESETS, presetDefs } from '../indicators/presets';
import type { IndicatorDef } from '../indicators/types';
import { h, toast } from './dom';
import { icon } from './icons';

/** "Presets" rows for the indicator picker: one click adds the whole set. */
export function presetRows(add: (def: IndicatorDef) => void, done: () => void): HTMLElement[] {
  if (!INDICATOR_PRESETS.length) return [];
  const rows: HTMLElement[] = [h('div', { class: 'picker-category' }, 'Presets')];
  for (const preset of INDICATOR_PRESETS) {
    const addAll = () => {
      const defs = presetDefs(preset);
      for (const def of defs) add(def);
      toast(`Added ${preset.name} (${defs.length} indicators)`);
      done();
    };
    rows.push(
      h(
        'div',
        { class: 'picker-row' },
        h('button', { class: 'picker-item', title: `Add ${preset.name}`, onclick: addAll }, h('span', { class: 'picker-name' }, preset.name), h('span', { class: 'picker-desc' }, preset.description)),
        h('button', { class: 'mgr-add', title: `Add ${preset.name}`, 'aria-label': `Add ${preset.name}`, onclick: addAll }, icon('plus', 18)),
      ),
    );
  }
  return rows;
}
