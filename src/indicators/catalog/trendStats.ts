import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';
import type { Entry } from './c-math';
import { C_STATS } from './c-stats';
import { C_TREND } from './c-trend';
import { C_VOLATILITY } from './c-volatility';

const ENTRIES: Entry[] = [...C_TREND, ...C_VOLATILITY, ...C_STATS];

/** Trend, volatility and statistics indicators (c-trend.ts, c-volatility.ts, c-stats.ts). */
export const TREND_STATS: IndicatorDef[] = ENTRIES.map((e) => e.def);

/** Plain-English guide per indicator id in this family (shown by the indicator info panel). */
export const TREND_STATS_GUIDES: Record<string, IndicatorGuide> = Object.fromEntries(ENTRIES.map((e) => [e.def.id, e.guide]));
