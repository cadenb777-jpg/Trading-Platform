/**
 * The indicators most traders actually use on a stock chart: the picker opens on these ("Essentials"). The rest of
 * the library (cycle filters, rolling statistics, 60 single candlestick patterns ...) stays under "All" and in search,
 * so no saved chart loses an indicator. Keep this list short: add one only when it earns its place.
 */
export const ESSENTIALS: readonly string[] = [
  // volume and money flow
  'volume', 'relvol', 'vwap', 'vwapperiodic', 'avwap', 'obv', 'mfi', 'cmf', 'ad',
  // moving averages
  'sma', 'ema', 'hma', 'vwma', 'macross',
  // bands and channels
  'bb', 'keltner', 'donchian', 'vwapbands', 'squeeze',
  // trend and stops
  'ichimoku', 'supertrend', 'psar', 'adx', 'chandelier', 'atrtrail',
  // momentum
  'rsi', 'rsisignals', 'macd', 'stoch', 'stochrsi', 'cci', 'willr', 'roc', 'ao',
  // volatility
  'atr', 'hv', 'bbw', 'vixfix',
  // levels
  'pivots', 'prevhlc', 'openingrange', 'pivothl', 'zigzag', 'fibretrace', 'autosr',
  // who is positioned how (outside data)
  'cot', 'williamscot', 'shortvol', 'insiders', 'inst13f', 'putcall',
  // candles and statistics
  'cdl_all', 'zscore', 'drawdown',
];

export const ESSENTIAL_SET = new Set(ESSENTIALS);
