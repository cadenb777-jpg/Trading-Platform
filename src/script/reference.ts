/** The syntax reference and example scripts shown on the Scripts page. */

export interface RefItem {
  sig: string;
  desc: string;
}

export const REFERENCE: { title: string; items: RefItem[] }[] = [
  {
    title: 'Getting started',
    items: [
      { sig: 'indicator("Name", overlay=true)', desc: 'First line of every script. overlay=true draws on the price chart; false gives it its own pane.' },
      { sig: 'x = ta.sma(close, 20)', desc: 'Create a variable. Every value is a series: one number per bar.' },
      { sig: 'plot(x, "Title", color=color.blue, linewidth=2)', desc: 'Draw a line. Each plot appears in the legend and can be restyled in the indicator settings.' },
      { sig: '// comment', desc: 'Anything after // is ignored.' },
      { sig: 'close[1]', desc: 'History: the value 1 bar ago. close[5] is five bars ago.' },
      { sig: 'cond ? a : b', desc: 'If cond is true use a, otherwise b. This replaces "if" blocks.' },
      { sig: 'f(x, y) => x * y', desc: 'Define your own one-line function, then call it: f(close, 2).' },
      { sig: '[a, b, c] = ta.macd(close, 12, 26, 9)', desc: 'Functions that return several series fill several variables at once.' },
    ],
  },
  {
    title: 'Inputs (adjustable settings)',
    items: [
      { sig: 'input.int(14, "Length", minval=1, maxval=500)', desc: 'Whole-number setting.' },
      { sig: 'input.float(2.0, "Multiplier", step=0.1)', desc: 'Decimal setting.' },
      { sig: 'input.source(close, "Source")', desc: 'Pick which price to use: open, high, low, close, hl2, hlc3, ohlc4.' },
      { sig: 'input.bool(true, "Show signal")', desc: 'On/off setting (shown as 1 / 0).' },
      { sig: 'input(14, "Length")', desc: 'Older Pine style; works like input.int / input.source.' },
    ],
  },
  {
    title: 'Plotting',
    items: [
      { sig: 'plot(series, title, color, linewidth, style)', desc: 'style can be plot.style_line, plot.style_histogram, plot.style_columns or plot.style_circles.' },
      { sig: 'hline(70, "Overbought")', desc: 'Horizontal reference line, e.g. RSI levels.' },
      { sig: 'plotshape(cond, "Buy", style=shape.arrowup, location=location.belowbar, color=color.green, text="Buy")', desc: 'Draw a signal (arrow, circle, square) on the candles wherever cond is true.' },
      { sig: 'plotchar(cond, "Signal", "★", location.abovebar)', desc: 'Like plotshape, with a text character.' },
      { sig: 'color.red · color.new(color.red, 50) · #ff9800 · color.rgb(255, 0, 0)', desc: 'Colours. color.new adds transparency (0 = solid, 100 = invisible).' },
    ],
  },
  {
    title: 'Price and bar values',
    items: [
      { sig: 'open high low close volume', desc: 'The current bar\'s values.' },
      { sig: 'hl2 hlc3 ohlc4 hlcc4', desc: 'Averages: (high+low)/2, (high+low+close)/3, ...' },
      { sig: 'bar_index time', desc: 'Bar number (0, 1, 2...) and bar time in milliseconds.' },
      { sig: 'na · nz(x, 0) · na(x) · fixnan(x)', desc: 'na = no value. nz replaces na with 0; na(x) checks for it; fixnan fills gaps with the last value.' },
    ],
  },
  {
    title: 'Moving averages & smoothing (ta.)',
    items: [
      { sig: 'ta.sma(src, len) · ta.ema · ta.wma · ta.rma · ta.hma · ta.vwma', desc: 'Moving averages.' },
      { sig: 'ta.alma(src, len, 0.85, 6)', desc: 'Arnaud Legoux moving average.' },
      { sig: 'ta.linreg(src, len, offset)', desc: 'Linear regression line value.' },
      { sig: 'ta.vwap · ta.vwap(src)', desc: 'Volume-weighted average price, resetting daily.' },
    ],
  },
  {
    title: 'Oscillators & momentum (ta.)',
    items: [
      { sig: 'ta.rsi(src, len)', desc: 'Relative Strength Index.' },
      { sig: '[macd, signal, hist] = ta.macd(src, 12, 26, 9)', desc: 'MACD line, signal line and histogram.' },
      { sig: 'ta.stoch(close, high, low, len)', desc: 'Raw stochastic %K (smooth it with ta.sma).' },
      { sig: 'ta.cci(src, len) · ta.mfi(hlc3, len) · ta.wpr(len)', desc: 'CCI, Money Flow Index, Williams %R.' },
      { sig: 'ta.mom(src, len) · ta.roc(src, len) · ta.change(src, len)', desc: 'Momentum, rate of change (%), change since N bars ago.' },
      { sig: '[plusDI, minusDI, adx] = ta.dmi(14, 14)', desc: 'Directional movement and trend strength.' },
    ],
  },
  {
    title: 'Volatility, bands & trend (ta.)',
    items: [
      { sig: 'ta.atr(len) · ta.tr · ta.stdev(src, len)', desc: 'Average true range, true range, standard deviation.' },
      { sig: '[mid, upper, lower] = ta.bb(src, 20, 2)', desc: 'Bollinger Bands.' },
      { sig: '[mid, upper, lower] = ta.kc(src, 20, 2)', desc: 'Keltner Channels.' },
      { sig: '[line, direction] = ta.supertrend(3, 10)', desc: 'SuperTrend; direction is -1 in an uptrend and 1 in a downtrend (like TradingView).' },
      { sig: 'ta.sar(0.02, 0.02, 0.2)', desc: 'Parabolic SAR.' },
      { sig: 'ta.highest(src, len) · ta.lowest(src, len)', desc: 'Highest / lowest value in the last N bars.' },
      { sig: 'ta.obv · ta.cum(src)', desc: 'On-balance volume; running total.' },
    ],
  },
  {
    title: 'Signals & conditions',
    items: [
      { sig: 'ta.crossover(a, b) · ta.crossunder(a, b) · ta.cross(a, b)', desc: '1 on the bar where a crosses above / below b, otherwise 0.' },
      { sig: 'ta.rising(src, len) · ta.falling(src, len)', desc: '1 if src has risen / fallen for len bars.' },
      { sig: 'ta.barssince(cond) · ta.valuewhen(cond, src, 0)', desc: 'Bars since cond was last true; src\'s value when it was.' },
      { sig: 'and or not  ==  !=  <  <=  >  >=', desc: 'Comparisons give 1 (true) or 0 (false).' },
    ],
  },
  {
    title: 'Maths (math.)',
    items: [
      { sig: 'math.abs math.sqrt math.pow math.log math.exp', desc: 'Standard maths, applied bar by bar.' },
      { sig: 'math.max(a, b) math.min(a, b) math.avg(a, b, c)', desc: 'Largest / smallest / average of the arguments.' },
      { sig: 'math.round(x, 2) math.floor math.ceil math.sign', desc: 'Rounding.' },
      { sig: 'math.sum(src, len)', desc: 'Rolling sum over the last N bars.' },
    ],
  },
  {
    title: 'Not supported yet',
    items: [
      { sig: 'if / for / while / switch blocks', desc: 'Use ? : instead, or ask Claude to convert the script.' },
      { sig: 'strategy(), strategy.entry()', desc: 'Coming with backtesting.' },
      { sig: 'fill, bgcolor, label, line, table', desc: 'Skipped for now; the rest of the script still runs.' },
      { sig: 'request.security (other symbols / timeframes)', desc: 'Use the indicator\'s Timeframe setting instead.' },
    ],
  },
];

export const EXAMPLES: { name: string; source: string }[] = [
  {
    name: 'RSI with levels',
    source: `//@version=5
indicator("My RSI", overlay=false)
length = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
r = ta.rsi(src, length)
plot(r, "RSI", color=color.purple, linewidth=2)
hline(70, "Overbought")
hline(30, "Oversold")
`,
  },
  {
    name: 'Moving average crossover',
    source: `//@version=5
indicator("MA Cross", overlay=true)
fastLen = input.int(9, "Fast length")
slowLen = input.int(21, "Slow length")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast", color=color.teal, linewidth=2)
plot(slow, "Slow", color=color.orange, linewidth=2)
`,
  },
  {
    name: 'MACD',
    source: `//@version=5
indicator("My MACD", overlay=false)
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
plot(hist, "Histogram", color=color.new(color.teal, 40), style=plot.style_columns)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
hline(0)
`,
  },
  {
    name: 'Bollinger Bands',
    source: `//@version=5
indicator("My Bollinger", overlay=true)
length = input.int(20, "Length")
mult = input.float(2.0, "Std dev", step=0.1)
[mid, upper, lower] = ta.bb(close, length, mult)
plot(mid, "Basis", color=color.orange)
plot(upper, "Upper", color=color.blue)
plot(lower, "Lower", color=color.blue)
`,
  },
  {
    name: 'SuperTrend',
    source: `//@version=5
indicator("My SuperTrend", overlay=true)
factor = input.float(3.0, "Factor", step=0.1)
atrLen = input.int(10, "ATR length")
[st, dir] = ta.supertrend(factor, atrLen)
plot(dir < 0 ? st : na, "Up", color=color.green, linewidth=2)
plot(dir > 0 ? st : na, "Down", color=color.red, linewidth=2)
`,
  },
  {
    name: 'Crossover signals',
    source: `//@version=5
indicator("EMA Cross Signals", overlay=true)
fast = ta.ema(close, input.int(9, "Fast"))
slow = ta.ema(close, input.int(21, "Slow"))
plot(fast, "Fast", color=color.teal)
plot(slow, "Slow", color=color.orange)
plotshape(ta.crossover(fast, slow), "Buy", style=shape.arrowup, location=location.belowbar, color=color.green, text="Buy")
plotshape(ta.crossunder(fast, slow), "Sell", style=shape.arrowdown, location=location.abovebar, color=color.red, text="Sell")
`,
  },
  {
    name: 'Volume spike detector',
    source: `//@version=5
indicator("Volume Spikes", overlay=false)
len = input.int(20, "Average length")
mult = input.float(2.0, "Spike multiple", step=0.1)
avgVol = ta.sma(volume, len)
spike = volume > avgVol * mult ? volume : na
plot(volume, "Volume", color=color.new(color.gray, 50), style=plot.style_columns)
plot(spike, "Spike", color=color.orange, style=plot.style_columns)
plot(avgVol, "Average", color=color.blue)
`,
  },
];

export const NEW_SCRIPT = `//@version=5
indicator("My indicator", overlay=true)
length = input.int(20, "Length")
plot(ta.sma(close, length), "SMA", color=color.blue, linewidth=2)
`;
