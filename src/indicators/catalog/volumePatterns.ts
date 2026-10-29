import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';
import { ALL_CANDLES_DEF, CANDLE_DEFS, CANDLE_GUIDES } from './d-candles';
import { VOLUME_DEFS, VOLUME_GUIDES } from './d-volume';

/**
 * Family D: volume indicators (d-volume.ts) and the 61 TA-Lib candlestick patterns plus a combined layer
 * (d-candles.ts on top of the TA-Lib port in d-talibCandles.ts).
 * Skipped on purpose: Demand Index (Sibbet; no agreed public formula), Herrick Payoff Index and other open-interest
 * indicators (no open-interest data), Kase and "positive volume trend" (no clear definition).
 */
export const VOLUME_PATTERNS: IndicatorDef[] = [...VOLUME_DEFS, ALL_CANDLES_DEF, ...CANDLE_DEFS];

/** Plain-English guide per indicator id in this family (shown by the indicator info panel). */
export const VOLUME_PATTERNS_GUIDES: Record<string, IndicatorGuide> = { ...VOLUME_GUIDES, ...CANDLE_GUIDES };
