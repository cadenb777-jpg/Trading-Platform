# Indicator settings by time frame (for the AI assistant)

When the owner asks the AI for "a momentum indicator on my 5-minute chart", the AI adds it with settings that suit the
time frame. The table lives in `src/ai/tuning.ts` (tested in `tuning.test.ts`) and reaches the model through the
`find_indicators` tool and `add_indicator` (no `params` = recommended settings).

**These are rules of thumb, not optimised values.** They are the conventions practitioners use, collected from the
sources below. Nothing here was fitted to data; if a setting matters to a trade, test it in the Backtest page.

## Why short bars get (a little) shorter lookbacks

The classic defaults (RSI 14, MACD 12-26-9, Bollinger 20/2) were designed for daily bars. Copying the *time span* to
intraday bars doesn't work: 14 days of 5-minute bars is over 1,000 bars, which reacts far too slowly for a day trade.
Practitioners instead keep similar bar counts and shorten them modestly on very short bars, so the indicator reacts
within one session (Murphy 1999, ch. 10, on shorter periods for short-term trading).

## The table

Buckets: seconds-3m → 1m, 5-10m → 5m, 15-45m → 15m, 1-4h → 1h, 1D, 1W-1M → 1W.

| Indicator (id) | 1m | 5m | 15m | 1h | 1D | 1W | Source |
|---|---|---|---|---|---|---|---|
| RSI (`rsi`) | 7 | 9 | 14 | 14 | 14 | 14 | Wilder 1978 (14); 7-9 is the common intraday shortening |
| Stochastic (`stoch`) | 5,3,3 | 5,3,3 | 8,3,3 | 14,3,3 | 14,3,3 | 14,3,3 | Lane (14-3-3); 5-3-3 "fast" intraday convention |
| Stochastic RSI (`stochrsi`) | 9/9 | 9/9 | 14/14 | 14/14 | 14/14 | 14/14 | Chande & Kroll 1994 |
| MACD (`macd`), PPO (`ppo`) | 3-10-16 | 8-17-9 | 12-26-9 | 12-26-9 | 12-26-9 | 12-26-9 | Appel 2005 (12-26-9 and the faster 8-17-9); Raschke & Connors 1995 (3-10 oscillator, 16 signal) |
| Rate of Change (`roc`) | 9 | 9 | 12 | 12 | 12 | 13 | Murphy 1999 (12-day ROC); 13 weeks = a quarter |
| Momentum (`mom`) | 9 | 9 | 10 | 10 | 10 | 13 | Murphy 1999 (10-day momentum) |
| CCI (`cci`) | 14 | 14 | 20 | 20 | 20 | 20 | Lambert 1980 (20) |
| Williams %R (`willr`) | 10 | 10 | 14 | 14 | 14 | 14 | Williams; 14 is the usual default, 10 a common shorter choice |
| Chande Momentum (`cmo`) | 9 | 9 | 9 | 14 | 14 | 20 | Chande & Kroll 1994 |
| True Strength Index (`tsi`) | 13/7 | 13/7 | 25/13 | 25/13 | 25/13 | 25/13 | Blau 1995 (25/13) |
| ADX / DMI (`adx`) | 10 | 10 | 14 | 14 | 14 | 14 | Wilder 1978 (14) |
| ATR (`atr`) | 14 | 14 | 14 | 14 | 14 | 14 | Wilder 1978; ATR measures bar size, so it adapts by itself |
| Bollinger Bands (`bb`) | 20/2 | 20/2 | 20/2 | 20/2 | 20/2 | 20/2 | Bollinger 2001 (20/2 across time frames; 10/1.9 and 50/2.1 if the length changes) |
| Keltner (`keltner`) | 20, 2×ATR10 | same | same | same | same | same | Modern ATR Keltner as popularised by Raschke |
| VWAP (`vwap`, `vwapbands`) | session | session | session | session | rolling VWAP instead | rolling VWAP instead | Session VWAP resets daily, so it is an intraday tool |
| Rolling VWAP (`vwaprolling`) | 30 | 78 | 26 | 35 | 20 | 13 | About a session (5m: 78 bars, 15m: 26), a week hourly, a month daily, a quarter weekly |
| EMA / SMA (`ema`, `sma`) | 9 | 20 | 20 | 50 | 50 | 40 | Common intraday 9/20; 50 for the trend; 40 weeks ≈ 200 days |
| EMA ribbon (`emacloud`) | 5/12, 34/50 | same | same | same | same | 4/10, 30/40 | Ripster-style EMA clouds (built for intraday) |

## Fallback rule (every other indicator)

Lookback inputs (keys like `length`, `fast`, `slow`, `signal`, `k`, `period`) are multiplied by 0.5 on 1-minute,
0.65 on 5-minute and 0.8 on 15-minute bars, and kept on hourly and longer bars. Multipliers, levels and switches are
never changed, values of 3 or less (smoothing) are kept, and every result is clamped to the input's min/max. With RSI
14 this gives 7 / 9 / 11, matching the table's intraday shortening.

## Sources

- J. Welles Wilder Jr., *New Concepts in Technical Trading Systems* (1978): RSI, ATR, ADX/DMI, 14 periods.
- George C. Lane, "Lane's Stochastics", *Technical Analysis of Stocks & Commodities* (1984).
- Gerald Appel, *Technical Analysis: Power Tools for Active Investors* (2005): MACD.
- Linda Bradford Raschke and Laurence Connors, *Street Smarts* (1995): the 3/10 oscillator.
- Donald Lambert, "Commodity Channel Index: Tool for Trading Cyclic Trends", *Commodities* (1980).
- Tushar Chande and Stanley Kroll, *The New Technical Trader* (1994): CMO, Stochastic RSI.
- William Blau, *Momentum, Direction, and Divergence* (1995): True Strength Index.
- John Bollinger, *Bollinger on Bollinger Bands* (2001).
- John J. Murphy, *Technical Analysis of the Financial Markets* (1999): ROC, momentum, shorter periods for short-term work.
