import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';

/** Filled by the overlays family builder. */
export const OVERLAYS: IndicatorDef[] = [];

/** Plain-English guide per indicator id in this family (shown by the indicator info panel). */
export const OVERLAYS_GUIDES: Record<string, IndicatorGuide> = {};
