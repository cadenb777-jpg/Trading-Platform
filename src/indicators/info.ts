/** Plain-English guides for every built-in indicator: what it shows, how to use it, and what to watch for. */

export interface IndicatorGuide {
  what: string;
  use: string[];
  signals: string[];
  tip?: string;
}

export const INDICATOR_GUIDES: Record<string, IndicatorGuide> = {
  volume: {
    what: 'How many shares traded in each bar. Volume shows how much conviction is behind a move.',
    use: ['Compare each bar with the average line: big moves on high volume are more trustworthy.', 'Watch volume at breakouts and at support/resistance.'],
    signals: ['Breakout on 1.5×+ average volume = stronger signal.', 'Price rising on falling volume = the move may be tiring.', 'Huge volume after a long fall can mark capitulation (a bottom).'],
  },
  sma: {
    what: 'The average closing price over the last N bars, drawn as a smooth line. It shows the trend direction.',
    use: ['Price above a rising SMA = uptrend; below a falling SMA = downtrend.', 'Popular lengths: 20 (short term), 50 (medium), 200 (long term).'],
    signals: ['Price crossing above/below the line.', '50-day crossing above the 200-day ("golden cross") or below it ("death cross").', 'The line often acts as support in uptrends and resistance in downtrends.'],
    tip: 'Shorter lengths react faster but give more false signals.',
  },
  ema: {
    what: 'Like the simple moving average but gives more weight to recent prices, so it reacts faster.',
    use: ['Use for trend direction and dynamic support/resistance.', 'Common pairs: 9/21 for short-term trading, 12/26, and 50/200 for the bigger trend.'],
    signals: ['Fast EMA crossing above a slow EMA = bullish; below = bearish.', 'Pullbacks to a rising EMA in an uptrend are classic entry points.'],
  },
  wma: {
    what: 'A moving average weighted towards the latest bars, a middle ground between SMA and EMA.',
    use: ['Use like an EMA for trend direction.'],
    signals: ['Price crossing the line; the line’s slope turning up or down.'],
  },
  vwap: {
    what: 'Volume-Weighted Average Price: the average price paid today, weighted by volume. It resets each session. Institutions use it as a fair-value benchmark.',
    use: ['Intraday only. Price above VWAP = buyers in control today; below = sellers.', 'Big funds often buy below VWAP and sell above it.'],
    signals: ['Reclaiming VWAP after trading below it is bullish; losing it is bearish.', 'First pullback to VWAP in a strong trend day is a common entry.'],
  },
  bb: {
    what: 'A moving average with bands 2 standard deviations above and below. The bands widen when the stock is volatile and narrow when it is quiet.',
    use: ['Touches of the outer bands show stretched prices; the middle band is the "mean".', 'A "squeeze" (very narrow bands) often comes before a big move.'],
    signals: ['In a range: buy near the lower band, sell near the upper band.', 'In a strong trend price can "walk the band"; don’t fade it.', 'Breakout from a squeeze in the direction of volume.'],
    tip: 'For very volatile stocks, 2.5 standard deviations reduces false touches.',
  },
  donchian: {
    what: 'The highest high and lowest low of the last N bars. It shows the trading range and breakouts.',
    use: ['Breakouts above the upper line or below the lower line start trend trades (the "Turtle" method).'],
    signals: ['Close above the upper channel = breakout; below the lower = breakdown.', 'The middle line can serve as a trailing stop.'],
  },
  rsi: {
    what: 'Relative Strength Index (0-100): the speed and size of recent gains versus losses.',
    use: ['Above 70 = overbought (stretched up), below 30 = oversold (stretched down).', 'In strong uptrends RSI often stays between 40 and 80; in downtrends between 20 and 60.'],
    signals: ['Moves back out of overbought/oversold zones.', 'Divergence: price makes a new high but RSI doesn’t (bearish), or a new low without RSI (bullish).', 'RSI crossing 50 confirms trend changes.'],
    tip: 'Overbought is not a sell signal by itself in a strong trend; wait for RSI to turn down.',
  },
  macd: {
    what: 'MACD shows momentum: the gap between a fast and slow EMA (MACD line), its average (signal line), and the difference (histogram).',
    use: ['MACD above zero = bullish momentum; below = bearish.', 'The histogram shrinking warns that momentum is fading.'],
    signals: ['MACD crossing above the signal line = bullish; below = bearish.', 'Zero-line crosses confirm the trend.', 'Divergences with price often come before reversals.'],
  },
  stoch: {
    what: 'Stochastic (0-100): where the close sits within the recent high-low range.',
    use: ['Above 80 = near the top of the range; below 20 = near the bottom.'],
    signals: ['%K crossing %D in the oversold zone = buy signal; in overbought = sell signal.', 'Works best in sideways markets.'],
  },
  cci: {
    what: 'Commodity Channel Index: how far price is from its average, in units of typical deviation.',
    use: ['Above +100 = unusually strong; below −100 = unusually weak.'],
    signals: ['Crossing above +100 can start an uptrend; crossing back below +100 = momentum fading.', 'Divergences with price.'],
  },
  willr: {
    what: 'Williams %R (0 to −100): like the Stochastic, where the close is within the recent range.',
    use: ['Above −20 = overbought; below −80 = oversold.'],
    signals: ['Turning up from below −80 = bullish; turning down from above −20 = bearish.'],
  },
  atr: {
    what: 'Average True Range: the average size of each bar’s move, including gaps. It measures volatility, not direction.',
    use: ['Set stop-losses 1.5-3 ATRs away so normal noise doesn’t stop you out.', 'Size positions so a 1-ATR move risks the same dollar amount on every trade.'],
    signals: ['Rising ATR = volatility expanding (often at big moves); falling ATR = calm.'],
  },
  obv: {
    what: 'On-Balance Volume adds volume on up days and subtracts it on down days, tracking buying vs selling pressure.',
    use: ['Compare the OBV trend with the price trend.'],
    signals: ['OBV making new highs before price = accumulation (bullish).', 'Price rising while OBV falls = distribution (bearish divergence).'],
  },
  hma: {
    what: 'Hull Moving Average: a very smooth, fast-reacting average that reduces lag.',
    use: ['Use the line’s colour/slope change as a trend signal.'],
    signals: ['Slope turning up = bullish; turning down = bearish.', 'Price crossing the HMA.'],
  },
  dema: { what: 'Double EMA: an EMA with less lag, reacting faster to new trends.', use: ['Use like an EMA when you want quicker signals.'], signals: ['Price or a faster average crossing it.'] },
  tema: { what: 'Triple EMA: even less lag than DEMA. Very responsive, but noisier.', use: ['Short-term trend following.'], signals: ['Slope changes and price crosses.'] },
  vwma: {
    what: 'Volume-Weighted Moving Average: bars with more volume count more.',
    use: ['Compare with an SMA of the same length.'],
    signals: ['VWMA above SMA = volume is coming in on up moves (bullish), and the other way round.'],
  },
  alma: { what: 'Arnaud Legoux Moving Average: a smooth average designed to cut lag and noise.', use: ['Trend direction with fewer whipsaws.'], signals: ['Price crossing the line; slope changes.'] },
  kama: {
    what: 'Kaufman Adaptive MA: speeds up in trends and slows down in choppy markets.',
    use: ['Good for avoiding false signals in sideways markets.'],
    signals: ['A flat KAMA = no trend; price breaking away from it = new trend.'],
  },
  linreg: { what: 'Linear Regression line: the best-fit straight line through recent prices, showing trend direction and slope.', use: ['Slope up = uptrend; down = downtrend.'], signals: ['Price far from the line tends to revert towards it.'] },
  keltner: {
    what: 'Keltner Channels: an EMA with bands based on ATR (volatility).',
    use: ['Closes outside the channel show strong momentum.', 'Combine with Bollinger Bands: Bollinger inside Keltner = a "squeeze".'],
    signals: ['Close above the upper band = strong uptrend; pullbacks to the middle are entries.'],
  },
  envelope: { what: 'A moving average with bands a fixed % above and below.', use: ['Shows when price is stretched from its average.'], signals: ['Touches of the bands in a range; breaks outside in trends.'] },
  ichimoku: {
    what: 'Ichimoku Cloud: a complete trend system showing support/resistance (the cloud), momentum and trend direction at once.',
    use: ['Price above the cloud = uptrend; below = downtrend; inside = no clear trend.', 'A thick cloud is strong support/resistance.'],
    signals: ['Conversion line crossing above the base line (TK cross) = bullish.', 'Breakout above the cloud.', 'Cloud colour changing ahead = trend shift.'],
  },
  supertrend: {
    what: 'SuperTrend: a trailing line based on ATR that flips sides when the trend changes.',
    use: ['Green line under price = uptrend; red line above = downtrend.', 'Use the line as a trailing stop.'],
    signals: ['Flip from red to green = buy; green to red = sell.'],
    tip: 'Raise the multiplier for volatile stocks to avoid flipping too often.',
  },
  psar: {
    what: 'Parabolic SAR: dots that trail price and accelerate as the trend continues.',
    use: ['Dots below price = uptrend; above = downtrend. Use as a trailing stop.'],
    signals: ['Dots flipping sides = possible reversal.'],
  },
  pivots: {
    what: 'Daily pivot points: support and resistance levels calculated from yesterday’s high, low and close. Many day traders watch them.',
    use: ['Expect reactions at the pivot (P), resistance (R1, R2) and support (S1, S2).'],
    signals: ['Holding above the pivot = bullish day bias; below = bearish.', 'Breaking R1 or S1 often extends to R2 or S2.'],
  },
  adx: {
    what: 'ADX measures trend strength (not direction); +DI and −DI show which side is in control.',
    use: ['ADX above 25 = trending market; below 20 = choppy.', 'Use trend tools when ADX is high and range tools when it is low.'],
    signals: ['+DI crossing above −DI with ADX rising = strong buy signal; the opposite = sell.'],
  },
  aroon: {
    what: 'Aroon: how recently the highest high and lowest low happened, showing trend starts.',
    use: ['Aroon Up near 100 = new highs recently (uptrend).'],
    signals: ['Aroon Up crossing above Aroon Down = new uptrend.'],
  },
  stochrsi: {
    what: 'Stochastic RSI: a Stochastic applied to RSI. Very sensitive; it shows short-term turns.',
    use: ['Above 80 = overbought, below 20 = oversold, on a short-term basis.'],
    signals: ['%K crossing %D from oversold = short-term buy.', 'Best combined with the main trend direction.'],
  },
  mfi: {
    what: 'Money Flow Index (0-100): RSI that includes volume, sometimes called "volume-weighted RSI".',
    use: ['Above 80 = overbought, below 20 = oversold.'],
    signals: ['Divergences between MFI and price are especially meaningful.'],
  },
  roc: { what: 'Rate of Change: the % change over N bars, showing momentum.', use: ['Above zero = price higher than N bars ago.'], signals: ['Zero-line crosses; extreme readings for this stock often revert.'] },
  mom: { what: 'Momentum: the price change over N bars.', use: ['Rising momentum = trend accelerating.'], signals: ['Zero-line crosses and divergences.'] },
  trix: { what: 'TRIX: the rate of change of a triple-smoothed EMA. It filters out noise.', use: ['Above zero = bullish momentum.'], signals: ['Zero-line and signal-line crosses.'] },
  ao: {
    what: 'Awesome Oscillator: the difference between a 5- and 34-bar average of the bar midpoints, showing momentum.',
    use: ['Green bars = momentum rising; red = falling.'],
    signals: ['Zero-line cross; "saucer" (two red then green above zero) = buy.'],
  },
  uo: { what: 'Ultimate Oscillator: momentum across three timeframes at once, to reduce false signals.', use: ['Above 70 overbought, below 30 oversold.'], signals: ['Bullish divergence below 30 followed by a break up.'] },
  cmf: {
    what: 'Chaikin Money Flow: whether volume is flowing in (closes near highs) or out (closes near lows).',
    use: ['Above zero = buying pressure; below = selling pressure.'],
    signals: ['Sustained readings above +0.1 confirm uptrends; below −0.1 confirm downtrends.'],
  },
  ad: { what: 'Accumulation/Distribution line: running total of money flow.', use: ['Rising line = accumulation.'], signals: ['Divergences with price warn of reversals.'] },
  stdev: { what: 'Standard deviation of price: how spread out recent prices are (volatility).', use: ['Rising = volatility expanding.'], signals: ['Very low readings often come before big moves.'] },
  bbpb: {
    what: 'Bollinger %B: where price is relative to the Bollinger Bands (0 = lower band, 1 = upper band).',
    use: ['Above 1 = above the upper band; below 0 = below the lower band.'],
    signals: ['Readings beyond 0 or 1 that come back inside often reverse.'],
  },
  bbw: { what: 'Bollinger Bandwidth: how wide the bands are, i.e. volatility.', use: ['Lowest readings in months = a "squeeze".'], signals: ['Expansion out of a squeeze = start of a big move.'] },
  vwapbands: {
    what: 'VWAP with bands 1, 2 and 3 standard deviations away. Shows how stretched today’s price is from fair value.',
    use: ['Intraday. ±2 bands are stretched; ±3 bands are extreme.'],
    signals: ['Fades back to VWAP from the ±2/±3 bands in range days.', 'Holding above +1 band = strong trend day.'],
  },
  zscore: {
    what: 'Z-Score: how many standard deviations price is from its average.',
    use: ['Above +2 = statistically stretched up; below −2 = stretched down.'],
    signals: ['Returns from beyond ±2 towards 0 (mean reversion).'],
  },
  zchannel: { what: 'Z-Score channels drawn on the price chart (average ±1/±2 standard deviations).', use: ['Shows statistically stretched price levels.'], signals: ['Mean reversion from the outer channels.'] },
  macross: {
    what: 'Arrows where a fast moving average crosses a slow one.',
    use: ['Green arrow = fast crossed above slow; red = below.'],
    signals: ['Best when the cross agrees with the longer-term trend and volume.'],
  },
  rsisignals: { what: 'Arrows where RSI leaves the oversold or overbought zone.', use: ['Green = RSI rising back above 30; red = falling back below 70.'], signals: ['Combine with support/resistance and trend direction.'] },
  cot: {
    what: 'How big speculators (hedge funds) and commercial hedgers are positioned in the futures market this symbol moves with (NVDA → Nasdaq-100, XOM → crude oil, gold miners → gold), as a 0-100 index of the last 3 years. From the CFTC’s weekly Commitment of Traders report.',
    use: ['Speculators near 100 = very crowded long; near 0 = very crowded short.', 'Hedgers usually trade against the trend; their extremes are often the better contrarian signal.', 'Weekly data (released Fridays for the prior Tuesday), so use it on daily or weekly charts for the bigger picture.'],
    signals: ['Speculator extremes (above 80 or below 20) turning back often come before reversals.', 'Hedgers at an extreme long while price falls = possible bottom.'],
    tip: 'Who is who: commercials (hedgers) = producers, banks and institutions that hedge real business; large speculators = hedge funds and other big funds; small speculators = the public. COT exists only for futures, so on a single stock this uses the futures market it moves with (NVDA → Nasdaq-100, XOM → crude oil).',
  },
  williamscot: {
    what: 'Larry Williams’ COT Index from the CFTC’s weekly Commitment of Traders report: each group’s net futures position scaled 0-100 against its own range over the look-back (26 weeks by default). Commercials are producers and big hedgers, large specs are funds, small traders are the public.',
    use: ['Williams focuses on the commercials: they are the "smart money" that buys weakness and sells strength.', 'Use it on daily or weekly charts; the data is weekly (Tuesday positions, released Friday).', 'For stocks it uses the futures market the stock moves with.'],
    signals: ['Commercials above 75 (and large specs/small traders low) = bullish setup; wait for price to confirm, e.g. a break of a recent high.', 'Commercials below 25 = bearish setup.', 'Signals work best at the extremes, against the crowd.'],
    tip: 'In plain words: commercials = hedgers and institutions (the smart money), large specs = funds that follow trends, small specs = the public. On a single stock (e.g. NVDA) it reads the futures market the stock moves with (Nasdaq-100), so it shows the market’s positioning, not the stock’s. Try 26 weeks for swing trades and 156 weeks (3 years) for the bigger picture.',
  },
  wad: {
    what: 'Williams Accumulation/Distribution: a running total of buying and selling pressure based on where each bar closes versus the previous close and the true high/low. It shows whether money is flowing in or out.',
    use: ['Compare its direction with price rather than reading the level.', 'The orange line is its average: WAD above it = accumulation.'],
    signals: ['Price makes a new low but WAD doesn’t = bullish divergence (accumulation).', 'Price makes a new high but WAD doesn’t = bearish divergence (distribution).'],
  },
  shortvol: {
    what: 'The share of each day’s trading volume that was short selling, from FINRA’s free daily data. Around 40-50% is normal for many stocks because market makers short to provide liquidity.',
    use: ['Compare with the average line rather than looking at the level alone.', 'Daily data: best on daily charts.'],
    signals: ['A spike well above average = heavy selling pressure (or hedging of heavy buying).', 'Short volume falling while price rises = less resistance from shorts.'],
  },
};
