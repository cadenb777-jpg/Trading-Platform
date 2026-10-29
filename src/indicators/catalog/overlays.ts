import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';
import { AVERAGES } from './a-averages';
import { BANDS } from './a-bands';
import { OVERLAY_GUIDES } from './a-guides';
import { LEVELS } from './a-levels';
import { TREND_LINES } from './a-trend';

/** The overlays family: moving averages, bands & channels, trend stops and support/resistance levels. */
export const OVERLAYS: IndicatorDef[] = [...AVERAGES, ...BANDS, ...TREND_LINES, ...LEVELS];

/** Plain-English guide per indicator id in this family (shown by the indicator info panel). */
export const OVERLAYS_GUIDES: Record<string, IndicatorGuide> = OVERLAY_GUIDES;
