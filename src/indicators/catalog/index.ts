/**
 * The expanded indicator catalog, one file per family (StockCharts ChartSchool's full list plus extras from
 * TA-Lib, Ehlers, Achelis "Technical Analysis from A to Z" and Pine built-ins). Each family file exports an
 * IndicatorDef[]; library.ts appends them all after the original indicators.
 */
import type { IndicatorGuide } from '../info';
import type { IndicatorDef } from '../types';
import { MOMENTUM, MOMENTUM_GUIDES } from './momentum';
import { OVERLAYS, OVERLAYS_GUIDES } from './overlays';
import { TREND_STATS, TREND_STATS_GUIDES } from './trendStats';
import { VOLUME_PATTERNS, VOLUME_PATTERNS_GUIDES } from './volumePatterns';

export const CATALOG: IndicatorDef[] = [...OVERLAYS, ...MOMENTUM, ...TREND_STATS, ...VOLUME_PATTERNS];

export const CATALOG_GUIDES: Record<string, IndicatorGuide> = { ...OVERLAYS_GUIDES, ...MOMENTUM_GUIDES, ...TREND_STATS_GUIDES, ...VOLUME_PATTERNS_GUIDES };
