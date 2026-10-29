/** One-click indicator sets shown at the top of the indicator picker. */
import { getIndicator } from './library';
import type { IndicatorDef } from './types';

export interface IndicatorPreset {
  name: string;
  description: string;
  ids: string[];
}

export const INDICATOR_PRESETS: IndicatorPreset[] = [
  {
    name: 'Larry Williams set',
    description: 'COT Index (related futures), Pro Go, Williams %R, Williams A/D and the Ultimate Oscillator.',
    ids: ['williamscot', 'progo', 'willr', 'wad', 'uo'],
  },
];

/** The preset's indicators that exist in this build, in order. */
export function presetDefs(preset: IndicatorPreset): IndicatorDef[] {
  return preset.ids.map((id) => getIndicator(id)).filter((d): d is IndicatorDef => !!d);
}
