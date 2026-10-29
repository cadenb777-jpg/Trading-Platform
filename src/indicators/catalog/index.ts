/**
 * The expanded indicator catalog, one file per family (StockCharts ChartSchool's full list plus extras from
 * TA-Lib, Ehlers, Achelis "Technical Analysis from A to Z" and Pine built-ins). Each family file exports an
 * IndicatorDef[]; library.ts appends them all after the original indicators.
 */
import type { IndicatorDef } from '../types';
import { MOMENTUM } from './momentum';
import { OVERLAYS } from './overlays';
import { TREND_STATS } from './trendStats';
import { VOLUME_PATTERNS } from './volumePatterns';

export const CATALOG: IndicatorDef[] = [...OVERLAYS, ...MOMENTUM, ...TREND_STATS, ...VOLUME_PATTERNS];
