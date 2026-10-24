# How chart and trend specialists trade, and what it means for the scanner (research notes)

Written 2026-10-24 for the Setups scanner (helper v20). The question: what do professional trend followers and
chart traders do that has real evidence behind it, and how can the scanner copy that **with fewer indicators,
not more**? The owner's rule is "simplicity scales".

How to read this:

- Every factual claim has a source link. Most links are abstracts, publisher pages or reputable summaries. Page
  fetches were blocked in this session (the proxy refused direct PDF downloads), so **the numbers here come from
  search-result summaries of the papers, not from reading the full texts.** Anything I could not check against a
  primary source is marked *(unverified)*: that covers every number whose only source is a secondary summary.
- Copyrighted books were not read. They are described from publisher pages, reviews and summaries, and cited as
  such. Pirated PDF mirrors that turned up in searches were ignored.
- No numbers or quotes are invented. Where a source gives no figure, this doc gives none.

---

## 1. The short version

1. **Long trends are robust. Short trends and complicated rules are fragile.** Trend following based on
   12-month returns or ~10-month / 200-day averages has worked for a century across markets. Short-lookback trend
   rules have weakened, and the many-rule studies show most fancy rules are luck. (Sections 2 and 3.)
2. **The trend definitions are nearly the same thing.** Moving-average rules, time-series momentum and other
   linear trend filters are mathematically close relatives (Levine & Pedersen 2016). Pick one, slow, and use it
   everywhere.
3. **Exits matter more than entries for trend trades.** Trend profits come from a few big winners, so trend trades
   need a trailing stop and no fixed target or short time limit. Reversal trades are the opposite: take the quick
   snap-back and leave.
4. **Most oscillators measure the same thing.** RSI, stochastics, Williams %R, CCI and z-score all ask "is price
   stretched?" Stacking them adds conditions, not information.
5. **Named chart patterns have weak evidence as standalone trades.** Head-and-shoulders, candlesticks, Fibonacci,
   SuperTrend and the like are not worth coding as signals.

The five recommendations are in section 6. The best trend filter is in 6.1, and the best exit for each kind of
strategy is in 6.2.

---

## 2. Trend following: what the evidence says

### 2.1 Time-series momentum (an asset's own past return)

- **Moskowitz, Ooi & Pedersen (2012), "Time Series Momentum", *Journal of Financial Economics* 104(2).**
  58 liquid futures (equity indices, currencies, commodities, bonds), 25+ years. An instrument's past 12-month
  excess return predicts its own future return. The effect lasts about a year, then partly reverses. It holds across
  subsamples and other lookback/holding periods.
  [AQR page](https://www.aqr.com/library/journal-articles/time-series-momentum),
  [SSRN](https://papers.ssrn.com/abstract=2089463).
- **Hurst, Ooi & Pedersen (2017), "A Century of Evidence on Trend-Following Investing", *Journal of Portfolio
  Management*.** 67 markets, 1880-2016. They combine 1-, 3- and 12-month lookbacks, and scale positions to a 10%
  annual volatility target. They report positive returns and low correlation to stocks and bonds in every decade,
  and positive returns in 8 of the 10 largest 60/40 drawdowns. The 1/3/12-month design and the 10% target come
  from secondary summaries *(details unverified)*.
  [AQR page](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing),
  [Cambridge Associates summary](https://publishedresearch.cambridgeassociates.com/wp-content/uploads/2018/02/Investment-Publications-Highlights-1Q18.pdf).
- **Lempérière et al. (2014), "Two centuries of trend following".** The t-stat of excess returns is about 5 since
  1960 and about 10 since 1800, after adjusting for drift. The key finding for us: **"no sign of a statistical
  degradation of long trends, whereas shorter trends have significantly withered."** The paper also says the recent
  weakness of short trends is "fully compatible with a statistical fluctuation" *(this second quote was supplied in
  review; I could not check it myself)*. So treat "short trends have withered" as a warning, not as proof.
  [arXiv](https://arxiv.org/abs/1404.3274), [RePEc](https://ideas.repec.org/a/rsk/journ6/2349968.html).
- **Individual stocks, not only futures:** Lim, Wang & Yao (2018, *Journal of Banking & Finance* 97) find strong
  time-series momentum in US individual stocks from 1927 to 2017, robust across sub-periods, firm sizes and
  formation/holding lengths. It depends on the market state and on investor sentiment.
  [Univ. of Melbourne listing](https://findanexpert.unimelb.edu.au/scholarlywork/1355921-time-series-momentum-in-nearly-100-years-of-stock-returns).
- **The crash risk:** momentum strategies crash in high-volatility rebounds after market sell-offs (Daniel &
  Moskowitz 2016, *JFE* 122(2)). [NBER w20439](https://www.nber.org/papers/w20439).

### 2.2 Moving-average timing

- **Faber (2007, revised later), 10-month SMA:** hold when the month-end price is above its 10-month average,
  otherwise cash. Secondary summaries report much lower volatility and a higher Sharpe ratio than buy-and-hold.
  Faber himself notes it lagged stocks in 6 of the 8 years after 2009 *(unverified)*.
  [Swedroe/ETF.com summary](https://www.etf.com/sections/index-investor-corner/swedroe-why-financial-trends-persist).
- **Zakamulin:** on the S&P Composite, 1860-2009, the average optimal SMA lookback was about 10 months (median 11) *(unverified)*.
  His later revision found that once look-ahead bias is removed, the advantage over buy-and-hold is marginal at
  best, and mostly comes from lower risk. Daily signals did marginally better than monthly ones in back-tests and
  marginally worse in forward tests.
  [CXO summary](https://www.cxoadvisory.com/technical-trading/market-timing-with-moving-averages-over-the-very-long-run),
  [Alpha Architect on daily vs monthly](https://alphaarchitect.com/2020/04/daily-vs-monthly-trend-following-rules-plus-some-diy-tools/).
- **Clare, Seaton, Smith & Thomas (2013, *Journal of Asset Management* 14(3)):** on the S&P 500, 1952-2011, simple
  rules including the 200-day MA beat buy-and-hold. Longer signals beat shorter ones, because shorter signals cost
  more to trade. Checking more often gave no real advantage once signals lasted more than about 100 days.
  [City Research Online](https://openaccess.city.ac.uk/id/eprint/17842).
- **Han, Zhou & Zhu (2016), "A trend factor", *JFE* 122.** A blend of short-, medium- and long-term moving
  averages beats the classic momentum and reversal factors in the cross-section of stocks.
  [WUSTL listing](https://profiles.wustl.edu/en/publications/a-trend-factor-any-economic-gains-from-using-information-over-inv/).
- **Han, Yang & Zhou (2013, *JFQA* 48(5)):** applying a 10-day MA to portfolios sorted by volatility gave returns
  that **rise with volatility**. Secondary summaries put the range at 8.4% to 18.7% a year, 1964-2009 *(unverified)*.
  [RePEc](https://ideas.repec.org/a/cup/jfinqa/v48y2013i05p1433-1461_00.html),
  [CFA digest](https://rpc.cfainstitute.org/research/cfa-digest/2014/08/a-new-anomaly-the-cross-sectional-profitability-of-technical-analysis-digest-summary).
- **Avramov, Kaplanski & Subrahmanyam (2021), "Moving average distance" (MAD).** The ratio of the 21-day to the
  200-day average predicts stock returns, beyond momentum and 52-week highs. Annual value-weighted alphas are about
  9% and survive institutional trading costs. **The long side is stronger than the short side.**
  [RePEc](https://ideas.repec.org/a/wly/revfec/v39y2021i2p127-145.html).

### 2.3 They are the same signal in different clothes

- **Levine & Pedersen (2016), "Which Trend Is Your Friend?", *Financial Analysts Journal* 72(3).** Time-series
  momentum and moving-average crossovers are "equivalent representations" in their general forms. So are other
  linear filters (HP, Kalman). [CBS research page](https://research.cbs.dk/en/publications/which-trend-is-your-friend/),
  [CFA Institute](https://rpc.cfainstitute.org/research/financial-analysts-journal/2016/which-trend-is-your-friend).
- **Marshall, Nguyen & Visaltanachoti (2017, *Quantitative Finance* 17(3)):** MA rules often signal **earlier**
  than time-series momentum, which gives meaningful return gains. Both work best outside large stocks.
  [RePEc](https://ideas.repec.org/a/taf/quantf/v17y2017i3p405-421.html).
- **What it means for us:** arguing over SMA vs EMA vs momentum sign is mostly arguing over lookback length. The
  evidence points to a **slow** lookback (~10 months / 200 days / 12 months) as the robust choice.

### 2.4 Breakout (Donchian / Turtle) rules and trend following on single stocks

- **Turtle rules**, as published by Curtis Faith (*Way of the Turtle*, 2007). Described from secondary sources:
  System 1 enters on a 20-day breakout and exits on a 10-day opposite breakout. System 2 uses 55 days to enter and
  20 days to exit. N = 20-day ATR, the initial stop is 2N, and one unit risks 1% of equity per N.
  [MQL5 article](https://www.mql5.com/en/articles/23448) *(secondary; book not read)*.
- **Wilcox & Crittenden (2005), "Does Trend Following Work on Stocks?"** 24,000+ stocks over 22 years *(unverified)*, delisted
  names included, with costs. Buy at a new **all-time high**, exit on an ATR trailing stop. The authors found a
  positive expectancy. The 10-day ATR period comes from a podcast summary *(unverified)*.
  [CXO summary](https://cxoadvisory.com/momentum-investing/all-time-high-trend-following).
- **Zarattini, Pagani & Wilcox (2025), update to 1950-2024:** the strategy still works, but **under 7% of trades
  produce the cumulative profit** *(unverified)*, and turnover is high. A secondary summary describes the trailing stop as raised
  daily and never lowered, with exits on a close below it.
  [CXO summary](https://www.cxoadvisory.com/?p=46400),
  [Harbourfront summary](https://harbourfrontquant.substack.com/p/does-trend-following-still-work-on).
- **52-week high (George & Hwang 2004, *Journal of Finance*):** how close a stock is to its 52-week high predicts
  future returns better than its past return does, and the effect does not reverse in the long run.
  [Alpha Architect summary](https://alphaarchitect.com/the-secret-to-momentum-is-the-52-week-high/).

### 2.5 Volatility-based trend lines and exits

- **Chandelier exit (Chuck LeBeau, popularised by Elder):** long stop = highest high minus 3 x ATR(22). LeBeau's
  original measures from the **highest high since entry**; the fixed 22-bar window is a charting adaptation. Most
  traders use multiples of 2.5 to 3.5, and most versions only let the stop move up.
  [Barchart](https://www.barchart.com/education/technical-indicators/chandelier-exit),
  [LuxAlgo](https://www.luxalgo.com/library/concept/chandelier-stop/),
  [Incredible Charts](https://www.incrediblecharts.com/indicators/chandelier_exits.php).
- **SuperTrend:** I found no peer-reviewed test. Practitioner tests disagree. One test of 4,052 trades on Dow
  stocks found it unprofitable for daily swing trading, and another found the best settings did not hold in a
  later sub-period. [Liberated Stock Trader](https://www.liberatedstocktrader.com/supertrend-indicator/),
  [HackerNoon](https://hackernoon.com/the-truth-about-tradingviews-supertrend-strategy-after-67-years-of-backtesting).
- **Larry Williams' WillTrend** is described as a line over price: above it means uptrend, below it means
  downtrend. According to the owner's transcript of Williams' Bloomberg video, it combines trend with volatility
  ("market expansions"). The formula is not disclosed.
  [StockCharts plug-in help](https://help.stockcharts.com/charts-and-tools/stockchartsacp-plug-ins/larry-williams-stock-trading-starter-pack-plug-in).

### 2.6 How professional trend followers size positions

- **Size by volatility, not by conviction.** CTAs scale each position so it carries the same risk (Hurst et al.'s
  10% volatility target; the Turtles' 1% per N). Baltas & Kosowski show that better volatility estimates
  (range-based, Yang-Zhang) and smoother trend signals cut turnover by more than a third with no significant loss
  of performance. [SSRN](https://papers.ssrn.com/abstract=2140091).
- **Volatility scaling also helps stock momentum:** Barroso & Santa-Clara (2015, *JFE*) report that managing
  momentum's predictable risk "virtually eliminates crashes and nearly doubles the Sharpe ratio".
  [UCP listing](https://ciencia.ucp.pt/en/publications/momentum-has-its-moments/).

**Robust vs fragile.**

- *Robust:* slow lookbacks (~10-12 months / 200 days); trading in the direction of the trend; risk sized by
  volatility; letting winners run.
- *Fragile:* short lookbacks (Lempérière: short trends have withered); exact parameter values (SuperTrend
  settings, chosen MA lengths); timing rules tested with look-ahead (Zakamulin); anything whose edge depends on
  low costs (Bajgrowicz & Scaillet, section 3).

---

## 3. Chart and price-action evidence

| Topic | What the evidence says | Source |
|---|---|---|
| MA and range-break rules on the Dow | Buy signals beat sell signals over 1897-1986 (Brock, Lakonishok & LeBaron 1992). The profits vanish once costs are included (Bessembinder & Chan 1998), and the edge has decayed since. | [RePEc BLL](https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html), [summary of follow-ups](https://ideas.repec.org/a/bor/iserev/v11y2009i41p25-44.html) |
| Data snooping | Sullivan, Timmermann & White (1999) correct BLL's rules for the whole universe of rules tried, using White's Reality Check. Bajgrowicz & Scaillet (2012), on the Dow 1897-2011: even after a false-discovery correction, nobody could have picked the future best rules in advance, and low costs wipe out the in-sample edge. | [LSE](https://researchonline.lse.ac.uk/id/eprint/119144), [RePEc B&S](https://ideas.repec.org:443/a/eee/jfinec/v106y2012i3p473-491.html) |
| Overall literature | Of 92 modern studies, 58 were positive, 24 negative and 10 mixed (Park & Irwin 2004 working paper; later published in 2007). Many positive results suffer from snooping and cost problems. | [AgEcon](https://ageconsearch.umn.edu/record/37487) |
| Chart patterns, automated (Lo, Mamaysky & Wang 2000) | Kernel-regression pattern detection on US stocks, 1962-1996. Some patterns give **incremental information** (more so on Nasdaq), but a pattern that detects an anomaly need not make money, and head-and-shoulders "may not be optimal". | [NBER w7613](https://www.nber.org/papers/w7613), [CFA digest](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/2001/dig-v31-n1-811-pdf.pdf) |
| Head-and-shoulders (Savin, Weller & Zvingelis 2007) | Predicts excess returns, but there is "little or no support" for a profitable standalone strategy. Part of its effect is just negative momentum. | [RePEc](https://ideas.repec.org/a/oup/jfinec/v5yi2p243-265.html), [CXO](https://www.cxoadvisory.com/technical-trading/testing-the-head-and-shoulders-pattern/) |
| Candlesticks (Marshall, Young & Rose 2006, *JBF*) | Not generally profitable on large US stocks. | [RePEc](https://ideas.repec.org/a/ris/jofitr/0834.html), [CXO](https://www.cxoadvisory.com/technical-trading/candlesticks-fiddlesticks/) |
| Bulkowski's pattern statistics | The rankings changed between editions: the high-and-tight flag went from "best" to rank 43 of 56 *(unverified)*. Results depend on his definition of failure (reversing before a 5% move). There is no random-entry comparison in what I found. | [ThePatternSite HTF](https://thepatternsite.com/htf.html), [LuxAlgo on failure definitions](https://www.luxalgo.com/library/concept/pattern-failure-statistics/) |
| Support / resistance | Published intraday S/R levels predicted trend interruptions in FX, 1996-1998, but the effect varied by firm and currency (Osler 2000). There is no comparable daily-stock evidence in what I found. | [NY Fed EPR](https://www.newyorkfed.org/medialibrary/media/research/epr/00v06n2/0007osle.html) |
| 52-week high | Strong, peer-reviewed evidence (George & Hwang 2004). | above |
| Volatility contraction / NR7 (Crabel) | Only practitioner backtests; I found no peer-reviewed study. | [Quantified Strategies](https://quantifiedstrategies.substack.com/p/nr7-trading-strategy-the-narrow-range-0f3) |
| Pullback in trend | No direct peer-reviewed test of "buy the dip in an uptrend" was found. It is supported indirectly by short-term reversal (Lehmann 1990; Jegadeesh 1990) combined with medium-term momentum (already cited in setups-statistics.md). Connors' RSI(2) rule rests on his own backtests, with no out-of-sample decay study found. | [LuxAlgo RSI(2)](https://www.luxalgo.com/library/concept/rsi-2/) |
| Short-term reversal vs continuation | Reversal holds in low-turnover stocks, while **high-turnover large stocks show short-term momentum** (Medhat & Schmeling 2022, *RFS*). This matters for Nasdaq-100 names. | [City Research Online](https://openaccess.city.ac.uk/id/eprint/31278/) |
| Gaps | Overnight gaps tend to partly reverse intraday (a thesis-level study). Earnings surprises drift for weeks (Bernard & Thomas 1989, seen only via secondary pages). The two effects describe different horizons. | [Turku thesis](https://www.utupub.fi/bitstreams/88057d2a-1ee8-4c05-9592-c535a21b502c/download) *(weak)* |
| Volume | Unusually high volume is followed by higher returns over the next month (Gervais, Kaniel & Mingelgrin 2001; confirmed in 41 countries). But high-volume momentum winners reverse faster (Lee & Swaminathan 2000). Mixed evidence for "volume confirms the breakout". | [Duke](https://scholars.duke.edu/publication/773086), [RePEc L&S](https://ideas.repec.org/a/bla/jfinan/v55y2000i5p2017-2069.html) |
| Multi-time-frame (Elder triple screen) | Trade the weekly trend's direction, enter on a daily pullback, trigger on a break of the prior day's high. I found it described only by practitioners; there is no academic test. | [TradingView education](https://www.tradingview.com/education/triplescreenstrategy) |
| Fibonacci | No peer-reviewed support found. A student backtest found it underperformed passive investing. With five levels, price nearly always "respects" one of them. | [HKUST project](https://cse.hkust.edu.hk/~rossiter/independent_studies_projects/fibonacci_trading/fibonacci_trading.pdf) *(weak)* |

**The earliest tests, from the journal archives** (abstract or secondary pages only):

- **Cowles (1933), "Can Stock Market Forecasters Forecast?", *Econometrica* 1(3).** Professional forecasters,
  including Hamilton's Dow-theory calls, could not be told apart from chance. Later critics (Brown, Goetzmann &
  Kumar 1998) argue the Dow-theory test ignored risk.
  [Econometric Society archive](https://econometricsociety.org/publications/econometrica/1933/07/01/can-stock-market-forecasters-forecast),
  [Dimand & Veloce abstract](https://journals.uvu.edu/index.php/jbi/article/view/217).
- **Cowles & Jones (1937), *Econometrica* 5(3).** They counted "sequences" (a rise after a rise) vs "reversals" and
  found more sequences, an early sign of persistence. Cowles himself corrected part of it in 1960: averaging
  within time periods had created false serial correlation.
  [1937 archive page](https://www.econometricsociety.org/publications/econometrica/1937/07/01/some-posteriori-probabilities-stock-market-action),
  [1960 revision](https://www.econometricsociety.org/publications/econometrica/1960/10/01/revision-previous-conclusions-regarding-stock-price-behavior).
  *Lesson: a measured effect can come from how the data were built. That is why the scanner computes everything
  causally.*
- **Fama & Blume (1966), "Filter Rules and Stock-Market Trading", *Journal of Business* 39.** On Dow 30 stocks,
  the best (0.5%) filter earned nothing after transaction costs.
  [RePEc](https://ideas.repec.org/a/ucp/jnlbus/v39y1965p226.html),
  [Sweeney 1988 follow-up](https://ideas.repec.org/a/cup/jfinqa/v23y1988i03p285-300_01.html).
- **CFA Institute Research Foundation, "Technical Analysis: Modern Perspectives" (Scott, Carr & Cremonie 2016),
  a free literature review.** It concludes technical analysis has value as one tool among many, with momentum /
  relative strength the best-supported idea. It was written by CMT charterholders, so read it as an advocate's
  review. [CFA RF page](https://rpc.cfainstitute.org/research/foundation/2017/technical-analysis).

**The pattern across the table:** the chart ideas with evidence are the ones that are really **trend or momentum
measures** (52-week high, MA distance, breakouts in a trend). Named shapes add little beyond the momentum they
contain.

---

## 4. How professional discretionary traders structure a trade

Nearly every professional source uses the same five steps:

1. **Setup:** the context that makes a trade worth looking for. This means the higher-timeframe trend (Elder's
   "tide", Weinstein's Stage 2, Minervini's trend template), plus for some traders a "stretch" or a base.
2. **Trigger:** a price event that proves the move has started. Examples are a break of the prior bar's high
   (Elder's third screen), a breakout from a base (O'Neil, Weinstein) or a new N-day high (Turtles).
3. **Stop:** where the idea is wrong, set **before** entry. That distance defines **1R**. Van Tharp's R-multiples
   measure every trade in units of its initial risk.
   [TraderLion](https://www.traderlion.com/risk-management/r-and-r-multiples/).
4. **Size:** shares = (equity x risk %) / (entry - stop). Elder's rules are at most 2% of equity per trade, and
   stop trading for the month once losses plus open risk reach 6% *(unverified)*.
   [TD Ameritrade summary](https://tickertape.tdameritrade.com/trading/rules-to-manage-risk-15908). The Turtles used
   1% per N. Clenow's stock model (as implemented by others) risks 0.1% of equity per ATR(20).
   [QuantConnect forum](https://www.quantconnect.com/forum/discussion/16578) *(implementation, not the book)*.
   Lower figures (0.5-1%) are common advice. I found no academic source that fixes an optimal percentage.
5. **Exit:** trailing stops for trend trades (Turtles, chandelier, Wilcox). Quick targets or time stops for
   reversal trades (Connors' close above the 5-day average).

**Stops and the type of market.** Kaminski & Lo (2014, *Journal of Financial Markets*) show that under a random
walk, stop-loss rules **reduce** expected return, and that they can add value when returns have momentum or switch
between regimes. *Implication (our reading, not a finding of the paper):* use tight trailing stops on trend trades,
and only wide disaster stops on reversal trades, since a mean-reverting market behaves at least as badly for stops
as a random walk. [MIT DSpace](https://dspace.mit.edu/handle/1721.1/114876).

**Why stacking indicators fails.** StockCharts' "multicollinearity" guidance groups indicators as trend, momentum,
volatility and volume, and advises against using several from one group. RSI, MACD, stochastics and rate-of-change
are all momentum measures and highly correlated.
[StockCharts MailBag](https://stockcharts.com/articles/mailbag/2009/08/how-do-you-choose-which-indicators-to-use.html),
[Traders.com](https://technical.traders.com/tradersonline/display.asp?art=5513). Williams %R is essentially an
inverted fast stochastic, since both measure where the close sits in the recent high-low range *(standard formula;
not from a cited study)*. Each extra rule is also one more "try" in the data-snooping sense (Aronson, Bajgrowicz &
Scaillet), so it raises the bar the scanner's tests must clear.

---

## 5. What the classic books agree on

I did not read these books. Each is described from publisher pages, reviews or summaries, as noted in the table.

**The few principles nearly all of them share:**

1. **Trade in the direction of the higher-timeframe trend.** Murphy starts from monthly and weekly charts. Elder's
   first screen is the weekly trend. Weinstein buys only in Stage 2, above a rising 30-week MA. Minervini requires
   price above the 150- and 200-day MAs. Clenow requires the index above its 200-day average. The Turtles traded
   only breakouts. *Evidence: strong* (section 2).
2. **Cut losses short and let winners run.** This means a predefined stop, no fixed upside for trend trades, and a
   trailing exit (Covel, Faith/Turtles, O'Neil's 7-8% stop, Clenow's 3-ATR stop). *Evidence: supported* for trend
   trades: profits are concentrated in few trades (Zarattini et al.), and stops can add value when returns have
   momentum (Kaminski & Lo).
3. **Risk a small, fixed fraction per trade, sized by volatility** (Elder 2%/6%, Turtles 1% per N, Clenow ATR
   sizing). *Evidence: supported* for volatility scaling (Barroso & Santa-Clara; Hurst et al.). The exact
   percentage is convention.
4. **Volume confirms the breakout** (Edwards & Magee, Weinstein, O'Neil). *Evidence: mixed* (Gervais et al. for;
   Lee & Swaminathan against for winners).
5. **Buy strength, not weakness, for trend trades:** new highs, near the 52-week high, Stage 2. *Evidence: strong*
   (George & Hwang; Wilcox & Crittenden).

| Book (how accessed) | Core rule | Evidence for it |
|---|---|---|
| Murphy, *Technical Analysis of the Financial Markets* ([StockCharts "Ten Laws"](https://articles.stockcharts.com/article/members-analysis-20041103-1/)) | Map the trend from long-term charts down, and trade with it | **Academic support** (trend following, section 2) |
| Edwards & Magee, *Technical Analysis of Stock Trends* (secondary summaries only) | Dow-theory primary trend; patterns with volume confirmation | Trend: **support**. Named patterns: **weak** (Lo et al.; Savin et al.). Volume: **mixed** |
| Kaufman, *Trading Systems and Methods* ([TA-Lib ER reference](https://ta-lib.org/functions/er.html)) | Systematic rules; efficiency ratio / adaptive MA (KAMA) | Systematic testing: **support** (it is how the evidence was produced). KAMA specifically: **none found** |
| Elder, *Trading for a Living* / *Come Into My Trading Room* ([Wiley page](https://www.wiley-vch.de/en/areas-interest/finance-economics-law/come-into-my-trading-room-978-0-471-22534-8); [TradingView](https://www.tradingview.com/education/triplescreenstrategy)) | Triple screen (weekly trend, daily pullback, break of the prior high); 2% / 6% rules | Trend + pullback: **indirect support** (momentum + short-term reversal). The screen itself: **none** (untested). 2%/6%: convention |
| Covel, *Trend Following* ([review summary](https://9natree.castos.com/episodes/review-trend-following-learn-to-make-millions-in-up-or-down-markets-michael-covel-summarized)) | React to price, not forecasts; cut losses, let profits run | **Academic support** (Hurst et al.; Moskowitz et al.) |
| Faith, *Way of the Turtle* ([MQL5 rule summary](https://www.mql5.com/en/articles/23448)) | 20/55-day breakouts, 10/20-day exits, 2N stop, 1% per N | Breakout trend following: **support** (on futures). The 20-day version: **fragile** (short trends have withered, Lempérière) |
| Clenow, *Following the Trend* / *Stocks on the Move* ([ProRealCode](https://prorealcode.com/topic/the-clenow-plunger-finding-the-pain-threshold-for-trend-followers); [QuantConnect](https://www.quantconnect.com/forum/discussion/16578)) | 50/100 EMA filter, 50-day breakout, 3-ATR stop; for stocks: rank by regression slope x R², index above its 200-day, stock above its 100-day, ATR sizing | Trend filter + volatility sizing: **support**. The ranking formula itself: **none** (practitioner only) |
| Aronson, *Evidence-Based Technical Analysis* ([CXO review](https://www.cxoadvisory.com/technical-trading/evidence-based-technical-analysis-applying-the-scientific-method-and-statistical-inference-to-trading-signals-chapter-by-chapter-review)) | Correct for data mining; tested 6,402 rules *(unverified)* on the S&P 500, none significant after correction | **It is the evidence standard.** Agrees with Sullivan et al. and Bajgrowicz & Scaillet |
| Bulkowski, *Encyclopedia of Chart Patterns* ([ThePatternSite](https://thepatternsite.com/htf.html)) | Pattern-by-pattern breakout statistics | **Weak / none:** rankings unstable across editions, no random baseline found |
| Weinstein, *Secrets for Profiting in Bull and Bear Markets* ([LuxAlgo](https://www.luxalgo.com/library/concept/weinstein-stage-analysis/), [TraderLion](https://traderlion.com/trading-strategies/stage-analysis/)) | Buy Stage 2: breakout above a base, with a rising 30-week MA, volume and relative strength | Rising long MA + relative strength: **support** (MA timing, momentum). Base geometry: **none** |
| O'Neil, *How to Make Money in Stocks* / Minervini trend template ([getAbstract](https://www.getabstract.com/de/zusammenfassung/the-successful-investor/3506); [ProRealCode template](https://prorealcode.com/prorealtime-market-screeners/trend-template-mark-minervini)) | Buy base breakouts on volume, cut losses at 7-8%; price above rising 150/200-day MAs and near the 52-week high | Near the 52-week high + above the 200-day: **support** (George & Hwang; MA). VCP / base shapes: **none found** |

**What I could not access:** none of the books' full texts. The full PDFs of Hurst et al., Wilcox & Crittenden,
Lempérière et al., Sullivan et al. and Levine & Pedersen were blocked by the session's network proxy.

**How the books sharpen the recommendations:** they confirm (a) one slow trend filter (200-day / 30-40-week MA),
(b) strength-based breakouts near highs, (c) trailing ATR exits for trend trades, and (d) 1R sizing. None of them
argues for more oscillators.

---

## 6. Recommendations for the scanner (five, each removing more than it adds, plus the tests that settle conflicts)

The scanner today, read from the code (`helper/engine/strategies.py`):

- `weekly_swing` stacks five conditions: weekly trend (last finished week vs its **10-week** SMA), COT, z-score
  stretch, a Williams %R cross and Williams A/D.
- `breakout` stacks five conditions: 20-bar Donchian, weekly trend, close above the 50-bar SMA, ADX >= 20 and
  volume >= 1.3x. Its exit is a 10-bar trailing low with a **20-bar cap** on the swing time frame.
- `mean_reversion` requires both RSI(2) and z-score at extremes, above the 200-bar SMA.
- The lab's market filter is QQQ vs its **50-day** average.

### 6.1 One trend filter everywhere: price vs its 200-day average (the best trend-side filter)

**Rule.** Trend up = the last finished daily close is above its 200-day SMA. Trend down = below. On weekly bars use
the 40-week SMA, and on hourly bars use the daily 200-day value known at the previous close. Optional strict form
for buys: the 200-day SMA is also above its own value 20 sessions ago (rising, as in Weinstein/Minervini). Use the
same rule for the market regime (QQQ above its 200-day, as Clenow does), known from the previous day.

**Why this one, compared with the alternatives:**

| Candidate | Evidence | Verdict |
|---|---|---|
| 10-period higher-timeframe SMA (today's filter: ~50 days on swing) | Short lookback. Short trends have withered (Lempérière); longer signals beat shorter ones (Clare et al.) | Replace |
| **200-day SMA (~10 months)** | Faber, Zakamulin (optimal ~10-11 months), Clare et al.; MAD uses 200 days; Weinstein/Minervini/Clenow use 150-200 days. Signals earlier than TSMOM (Marshall et al.) | **Choose** |
| 12-month time-series momentum sign | Strongest academic pedigree (MOP 2012; Lim et al. on stocks), but equivalent to an MA filter (Levine & Pedersen) and slower to turn (Marshall et al.) | Keep only as the head-to-head control |
| ATR / volatility trend line (SuperTrend, chandelier side) | No peer-reviewed support as a trend definition; fragile to parameters | Use for **exits** (6.2), not as the trend filter |

**What it replaces:** the 10-period `weekly_trend` check in `weekly_swing` and `breakout` (strategies.py:309, 353,
357), the `sma50` condition in breakout, and mean reversion's own `sma200` check (strategies.py:337-344; it already
uses 200 bars and simply becomes the shared rule). It also replaces the 50-day QQQ
market filter. That is **four trend definitions reduced to one**.

**What it changes per time frame.** `weekly_trend` takes the last finished higher-timeframe period vs its
10-period average (`HORIZONS[h]['trend']`):

- *Swing:* 10 weeks, about 50 days. This is where 6.1 makes the real change.
- *Short (hourly):* a 10-**day** trend built from hourly bars grouped into days. A 200-day rule needs real daily
  history joined to the hourly series. That is a **new dependency** (more Schwab requests, and joining by date
  known at the previous close).
- *Position (weekly):* 10 **months**, about 43 weeks. That is already close to 40 weeks, so 6.1 changes almost
  nothing there.

**How to test it:**

- Run the pooled random-entry test for each strategy and side, with the filter swapped (10-week, 200-day,
  12-month TSMOM sign). Keep the 200-day unless another wins on **unseen** windows by a clear margin, meaning a
  higher average R and a lower p.
- In the lab, the existing `trend` and `above200` filters already allow this comparison. Check that combinations
  using `above200` survive walk-forward more often than ones using `trend`.
- Report a small neighbourhood (150 / 200 / 250 days) only to show a **plateau**. Do not pick the best one (that
  would be snooping).

### 6.2 Exits by strategy type (the best exit for each)

| Strategy type | Best exit | Evidence | Change from today |
|---|---|---|---|
| **Trend / breakout** | Initial stop 2 x ATR(20) (Turtle 2N). Then a **chandelier trail: highest high since entry minus 3 x ATR(22)**, only ever raised, exit on a **close** below it. No fixed target. Safety cap 120 sessions (swing), 52 weeks (position), 15 sessions (hourly). | Few winners carry trend profits (Zarattini et al.); stops can add value under momentum (Kaminski & Lo; applying it to trend trades is our implication); LeBeau anchors the stop to the high since entry | Replaces the 10-bar-low exit and the **20-bar cap**, which cuts off the big winners the strategy exists for |
| **Mean reversion** | Keep today's rule: exit on the first close back across the 5-bar average, a time stop (7 bars swing), and a **wide** disaster stop (2.5 ATR). No trailing stop and no break-even move. | Implication of Kaminski & Lo (stops lower returns under a random walk; mean reversion is not tested there); Connors' exit | None (confirmed) |
| **Pullback in trend** (`weekly_swing`) | Stop beyond the 3-bar swing (0.75-2 ATR) as today, then a choice: **(A) today's target (+1 SD band)** plus break-even at +1R, or **(B) after +1R, switch to the chandelier trail** and drop the 5-bar time cap. Pick by test; do not keep both. | It is a trend trade with a reversal entry. Large, high-turnover stocks show short-term momentum (Medhat & Schmeling), which argues for B on Nasdaq-100 names; the one-week reversal literature argues for A | Pick one variant after the test |

**How to test it:** in `simulate`, give each exit style the same entries, so only the exit differs. Compare average
R, profit factor and the share of profit from the top 10% of trades, on the lab's three unseen windows. The existing
random-entry test already matches each real trade's direction and holding time (strategies.py:556-572), so drift is
controlled even for variable-length trailing exits. Running the exact same exit rule from random entries would be
**new test code**: a stricter optional check, not a requirement.

**Data limit: the long caps cannot be tested on today's history.**

- Swing loads 1,100 calendar days (scanner.py:223), about 757 daily bars.
- Each lab unseen window is 15%, about 113 bars.
- The embargo is the longest `maxHold` + 1 (lab.py:322), and the warm-up is 210 bars (lab.py:329).
- A 52-week trigger needs 250 bars before its first signal.

A 120-session cap would swallow the embargo and most of a window. So before testing long caps, do one of these:

1. Extend daily history (planned: about 15 years).
2. Test 40- and 60-session caps for now.
3. Exclude trend exits from the embargo calculation, and accept that some trades straddle windows (say so on the
   card).

Until then, the 120-session figure is the target design, not a tested rule. A trend exit should show **positive skew**: a low win rate, and average win much larger than
average loss.

### 6.3 One stretch measure, not three (remove collinear oscillators)

**Rule.**

- *Pullback:* trend filter (6.1) + z-score(20) beyond the stock's own 10th/90th percentile and turning back
  (already in the code) + entry on a **buy-stop above the signal bar's high** (already the plan, Elder's third
  screen). **Drop the Williams %R cross.** The buy-stop already proves the turn.
- *Mean reversion:* require **either** RSI(2) **or** z-score, not both. Prefer z-score, so one stretch concept
  runs through the whole scanner.
- **Move Williams A/D and ADX out of the main strategies** into lab filters only (`flow` and `adx` already exist
  there). They stay in the main rules only if the lab shows they add value on unseen data.

**What it replaces:** %R, A/D and ADX in the main strategies, and the RSI(2)-and-z double condition. COT is not
changed here. The COT changes proposed in williams-cot.md (a 156-week index, 75/25 vs 80/20 thresholds, and missing
COT = no signal) are judged by the COT + z-score edge study (setups-statistics.md section 4), not assumed.

**How to test it:** run the pooled random-entry test with and without each removed condition. A condition stays
only if removing it **lowers** unseen average R by more than noise, meaning outside the Monte Carlo 90% band. The
expected result is about the same edge with more trades, which gives a tighter t-stat and fewer "unproven" grades.

### 6.4 Breakout = strength near highs, long-only, with the trend filter only

**Rule (swing / daily):** buy when the close is above the highest close of the prior **250 sessions** (a 52-week
high) **or** above the prior 50-session high (the Clenow / Turtle System 2 length). Fix one of the two in advance;
the default is the 52-week version, which has the stronger stock-specific evidence. Also require the 200-day trend
filter up (6.1). Enter on a buy-stop above the signal bar's high, as today. Exit with the chandelier trail (6.2).
**Long-only** on the Nasdaq-100. Short breakdowns run only if their own side passes its tests (v20 already separates
the sides).

**What it replaces:** the 20-bar Donchian (a short trend, the fragile kind), ADX >= 20 (a trend measure that
duplicates the breakout itself), the 50-bar SMA check and the mandatory 1.3x volume. Volume becomes a lab filter
only, because the evidence on volume confirmation is mixed.

**Evidence:** George & Hwang (52-week high); Wilcox & Crittenden and Zarattini et al. (highs + trailing stop on
stocks); Lempérière (long trends robust, short ones withered); MAD and the v20 note on drift (the long side is
stronger).

**How to test it:** pooled random-entry test, long side, compared against today's breakout with the same exit.
The 250-bar lookback plus the 210-bar warm-up leaves few signals in about 757 swing bars (see the data limit in 6.2).
Test the 50-session version first, or extend daily history before judging the 52-week one.
The lab's `high52` trigger already exists: check that it survives walk-forward with the `above200` filter. Expect a
lower win rate and higher average R. Judge it on R and skew, not on win rate.

### 6.5 Size every setup in R, by volatility, with a default of 0.5% risk

**Rule:** the trade guide's size calculator defaults to **0.5% of equity at risk** per trade (the owner can set
0.25-1%): shares = equity x 0.005 / (entry - stop). Add a soft brake in the guide: when realised losses plus open
risk this month reach **6%** (Elder's rule), new setups show "pause". Statistics are shown in R (they already are:
`avgR`).

**What it replaces:** nothing new is computed. It turns the existing stop distance (already ATR-based) into the
position size, which is how the Turtles, Clenow and Elder all work. Because the stop is in ATR, a wilder stock
automatically gets a smaller position: volatility scaling for free (Barroso & Santa-Clara; Hurst et al.).

**How to test it:** run the existing stationary-bootstrap Monte Carlo of the next 20 trades in **R units**, and show
the 5th-percentile drawdown at 0.5% and at 1% risk. If the 5th-percentile path at 1% loses more than the owner
accepts, the default stays at 0.5%. No live-trading logic changes: the platform still never places orders.


### 6.6 Conflicts with williams-cot.md, settled by test

This doc and williams-cot.md disagree in places. Neither wins by argument. Each conflict is settled by the pooled
random-entry test and the lab's walk-forward, per time frame and side. **Rule: the simplest version that survives
wins.**

1. **Turn trigger** (`weekly_swing`). Test these variants:
   - (a) the current rule;
   - (b) z-stretch + %R cross;
   - (c) z-stretch + z-score turn;
   - (d) z-stretch + buy-stop only (this doc's 6.3).
2. **Trend filter:** none / 10-period (today) / 10-period with a ±0.5 ATR band / 200-day (6.1). Use 150 and 250 days
   only to show a plateau.
3. **Williams A/D:** williams-cot.md's divergence rule becomes a lab filter. It enters the main rules only if it
   survives walk-forward with a Holm-corrected p <= 0.10. Otherwise A/D leaves the entry.
4. **COT:** a 26- vs 156-week index, crossed with 60/40, 75/25, 80/20 thresholds and off, judged by the edge study.
5. **Pullback exit:** the +1 SD target vs the chandelier trail after +1R (6.2).
6. **Hourly trend:** decided only after daily history is joined to the hourly series (6.1).

---

## 7. Not worth coding (weak or no evidence)

- **Named geometric patterns as signals:** head-and-shoulders, double tops/bottoms, triangles, flags/pennants,
  cup-and-handle and VCP base shapes. There is no profitable standalone strategy in the peer-reviewed tests (Lo
  et al.; Savin et al.), and Bulkowski's rankings are unstable with no random baseline. The useful part, a breakout
  near highs in an uptrend, is already captured by 6.4.
- **Candlestick patterns:** not profitable on large US stocks (Marshall, Young & Rose).
- **Fibonacci retracements / extensions:** no peer-reviewed support found, and close to unfalsifiable.
- **SuperTrend and other parameter-heavy ATR trend lines as entry signals:** no peer-reviewed support, and the
  best settings don't carry over to later years. The chandelier exit covers the useful idea.
- **Extra oscillators** (stochastic, CCI, MACD histogram, Elder Force Index, KAMA): they duplicate the stretch
  measure we already have (section 4).
- **NR7 / inside-day squeezes in the main strategies:** practitioner evidence only. They can stay as a lab trigger,
  judged by walk-forward, but should not be promoted without passing it.
- **Gap fades / gap-and-go in the main strategies:** thesis-level evidence and opposite effects at different
  horizons. Lab only.
- **Hand-drawn support/resistance as an entry rule:** the evidence is intraday FX with published levels (Osler).
  Keep the `swing_levels` display for context only.

---

## 8. Limits of this research

**What was full text and what was not.** Every direct download from this session (WebFetch and curl to arXiv,
NBER, SSRN, AQR, CORE, archive.org, the NY Fed, university repositories) was refused by the network proxy.
**So no source here was read in full text.** Every claim rests on abstracts, publisher or archive landing pages
(RePEc/IDEAS, Econometric Society/JSTOR archive pages, NBER, SSRN, AQR, the CFA Institute) or reputable secondary
summaries (CXO Advisory, Alpha Architect, ETF.com/Swedroe), as linked beside each claim. Internet Archive copies of
older texts and JSTOR's Early Journal Content could not be opened. No login was bypassed and no pirated copy was
used. Re-checking the starred and *(unverified)* numbers against the full texts is the first follow-up if a
recommendation is adopted.

- **Sources were read through search summaries.** Direct fetches of the papers' PDFs were blocked, so numbers such
  as Hurst et al.'s 10% volatility target and 1/3/12-month mix, Wilcox & Crittenden's 10-day ATR, and Clenow's
  0.1% risk are second-hand and marked as such. The books were not read.
- **Most trend evidence is on futures and indices, not single Nasdaq-100 stocks.** Stock-level support exists (Lim
  et al.; Wilcox & Crittenden; George & Hwang; MAD), but often comes from broad universes where small stocks drive
  the results. Marshall et al. find both MA and TSMOM rules work best **outside** large stocks, so our edge may be
  smaller.
- **Survivorship:** the scanner's Nasdaq-100 list is today's (setups-statistics.md section 7). A buy-new-highs
  strategy tested on today's winners will look better than it was. This bias matters most for 6.4.
- **Costs:** the scanner uses a flat 0.1% round trip. Trend exits trade less often, while hourly strategies trade
  more. Bajgrowicz & Scaillet show that small costs can erase the in-sample edge of technical rules.
- **Regime risk:** trend rules suffer in sideways markets and in sharp rebounds after sell-offs (Daniel &
  Moskowitz). A long-run edge can still mean multi-year flat stretches (Faber's own post-2009 note).
- **Parameters here are taken from the literature, not fitted:** 200 days, 250 days, 3 x ATR(22), 2 x ATR(20),
  0.5%. Tuning them on our data would bring back the snooping problem the lab is built to avoid.
