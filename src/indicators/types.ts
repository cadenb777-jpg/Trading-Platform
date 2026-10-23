import type { Bar, Timeframe } from '../types';

export type IndicatorCategory = 'Moving Averages' | 'Bands & Channels' | 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Positioning' | 'My scripts';

export interface NumberInput {
  key: string;
  label: string;
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface SourceInput {
  key: string;
  label: string;
  type: 'source';
  default: PriceSource;
}

export type IndicatorInput = NumberInput | SourceInput;

export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
export const PRICE_SOURCES: PriceSource[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

export interface PlotDef {
  key: string;
  title: string;
  /** 'marker' draws a signal (arrow, dot...) on the price chart on every bar where the value is non-zero. */
  type: 'line' | 'histogram' | 'marker';
  marker?: { shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; position: 'aboveBar' | 'belowBar' | 'inBar'; text?: string };
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  /** Lines only: draw as dots instead of a connected line (e.g. Parabolic SAR). */
  style?: 'line' | 'dots';
  /** Histogram only: colour each bar by the sign of its value, the candle's direction, or whether it rose. */
  colorBy?: 'sign' | 'candle' | 'change';
  /** Second colour used for negative values / down candles when `colorBy` is set. */
  negativeColor?: string;
}

export interface IndicatorDef {
  id: string;
  name: string;
  shortName: string;
  category: IndicatorCategory;
  description: string;
  /**
   * overlay: drawn on top of the price candles.
   * volume: drawn along the bottom of the price pane on its own scale.
   * separate: gets its own pane below the price chart.
   */
  placement: 'overlay' | 'volume' | 'separate';
  inputs: IndicatorInput[];
  plots: PlotDef[];
  /** Horizontal reference lines, e.g. RSI 30 / 70. */
  levels?: number[];
  /**
   * Indicators that need data from outside the chart (e.g. futures positioning) load it here once per
   * symbol; the chart passes it to `compute` as `external` and redraws when it arrives.
   */
  external?: { load(symbol: string): Promise<ExternalPoint[]> };
  compute(bars: Bar[], params: IndicatorParams, external?: ExternalPoint[]): Record<string, number[]>;
}

/** A dated value from outside the chart; `time` is when it became known (UTC seconds). */
export interface ExternalPoint {
  time: number;
  values: Record<string, number>;
}

export type IndicatorParams = Record<string, number | string>;

/** An indicator the user has added to the chart, with their chosen settings. */
export interface IndicatorInstance {
  uid: string;
  defId: string;
  params: IndicatorParams;
  colors: Record<string, string>;
  visible: boolean;
  /** Line thickness per plot (1-4); defaults to the plot's own width. */
  lineWidths?: Record<string, number>;
  /** Where to draw it; defaults to the indicator's usual place. Volume always sits under the price. */
  placement?: 'overlay' | 'separate';
  /** Calculate on a higher timeframe than the chart (e.g. a 1h RSI on a 5m chart). Empty = chart timeframe. */
  timeframe?: Timeframe | null;
}
