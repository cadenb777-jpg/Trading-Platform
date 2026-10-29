import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';
import { CYCLE_ENTRIES } from './b-cycles';
import { MOMENTUM_ENTRIES } from './b-momentum';
import { OSCILLATOR_ENTRIES } from './b-oscillators';

const ENTRIES = [...MOMENTUM_ENTRIES, ...OSCILLATOR_ENTRIES, ...CYCLE_ENTRIES];

/** Momentum family: the 'Momentum', 'Oscillators' and 'Cycles' categories (b-momentum.ts, b-oscillators.ts, b-cycles.ts). */
export const MOMENTUM: IndicatorDef[] = ENTRIES.map((e) => e.def);

/** Plain-English guide per indicator id in this family (shown by the indicator info panel). */
export const MOMENTUM_GUIDES: Record<string, IndicatorGuide> = Object.fromEntries(ENTRIES.map((e) => [e.def.id, e.guide]));
