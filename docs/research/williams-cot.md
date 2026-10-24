# Larry Williams: COT, "flow of money" and the z-score

Research note for the scanner (helper/engine/strategies.py, `weekly_swing`). Written 2026-10-24.
Plain-language summary first; every factual claim has a source in brackets, listed at the end.

## 0. What could and could not be verified (read this first)

- **The video is now known** [S25]: Larry Williams presenting his indicators for the Bloomberg terminal, recorded
  April 15 2013. It was **read from a transcript the owner pasted** (YouTube itself is blocked in this session).
  Section 1 paraphrases it; there are no long quotes, and timestamps are the transcript's. It is not an interview
  about the CFTC COT report as such: it shows six of his tools, none with its formula.
  Other COT interviews used here: Crowded Market Report with Jason Shapiro (Oct 2024, chapter "COT Proxy for
  Stocks" at 15:07) [S2], Foundation for the Study of Cycles with Lars von Thienen (2026) [S3], and two Better
  System Trader podcasts [S4]. His bio lists Bloomberg appearances without dates [S1].
- **No web page could be opened from this session.** Page fetching was blocked by the network; only web search
  worked. So everything below comes from search-engine summaries of the pages listed in Sources, not from reading
  the pages or the book myself. Treat any single-source detail as "reported, not checked".
- **No quotes are given**, because none could be read word for word.
- **The book's exact text was not available** (Trade Stocks and Commodities with the Insiders: Secrets of the COT
  Report, Wiley 2005 [S5]). Its page 34 formula is known only through a TradingView script that cites it [S6].

## 1. What the video says (owner's transcript, paraphrased) [S25]

| Time | Tool | What he says it does | Formula given? |
|---|---|---|---|
| 0:00-4:27 | **Acquisition Index** | Built from his COT work since 1973: a formula that emulates how commercials buy and sell, applied to stocks and futures, shown on **weekly** charts (IBM, Google, GE, gold, bonds). High = being acquired by large money, expect substantial **intermediate-term** rallies (not 1-2 day moves); low = no acquisition or distribution, expect declines. The price level does not matter. It is a **setup** to improve timing, not an entry | No |
| 4:27-7:38 | Cycle Forecast | Projects about 3 months ahead; he says it is not perfect | No (proprietary) |
| 7:38-11:22 | **Institutional accumulation index** | His improved "unbalanced volume" (first built 1966). Main use is **divergence**: accumulation breaks above its prior peak while price is still flat in a range = bullish; price makes a new high but accumulation does not = distribution, expect a decline | No |
| 11:22-15:45 | LW Sentiment Index | Contrarian, from advisors' bullish %. Not a licence to buy: once set up, use short-term and trend tools to get in | No |
| 15:45-21:34 | True Seasonal | Seasonal pattern built only from data known up to each date (**no look-ahead**); price stronger than the seasonal into a seasonal buy = strong signal | No |
| 21:34-25:18 | **WillTrend** | A trend line from trend plus volatility ("market expansions"). Above it, take only short-term buys; below it, only sells; any time frame | No |

**Common structure:** a weekly **SETUP** (acquisition, accumulation, sentiment or seasonal) says a substantial move
is likely and in which direction -> a **TREND** tool keeps you on the right side -> a **SHORT-TERM trigger** times
the entry. This matches the written sources (Section 2, points 3-4) and is the shape of the rule set in Section 7.

**What we can and cannot copy:** none of the six formulas is in the video, so we do not reproduce them. Our
stand-ins are: the COT index of Nasdaq-100 futures commercials (setup, market-wide), Williams A/D (the public
accumulation line), the higher-timeframe trend (trend side) and %R (trigger).

## 2. Summary of what Williams says (verified as far as possible)

1. **Commercials are the "insiders".** Commercial hedgers (firms that produce or use the underlying) are the group
   he follows; the book's theme is that they are the closest thing to insiders in futures markets [S5][S7].
2. **Look at extremes, not raw numbers.** Their net position is judged against its own history [S7].
3. **COT is a condition, not a timing signal.** It is weekly and lagged, so it says *which way* to lean, and a
   price-based timing tool says *when* [S3][S8][S9].
4. **He is a "conditional trader".** In the 2026 cycles interview he lists three conditions: commercials' COT
   index above 75 on the weekly report, a supportive seasonal window, and a cycle low due in the same zone. When at
   least two of three agree, a timing tool takes over, typically Williams %R turning up out of oversold (below
   -80), or a volatility breakout from the open [S3]. (Single source; reported via a summary.)
5. **Small traders (the public)** are used as a contrary sentiment gauge: he looks for times they are lopsided and
   leans the other way [S10].
6. **Stocks have no COT report.** His indicator guide says all COT indicators need continuous futures contracts and
   there is no COT data for stocks [S11]. For stocks he built a "COT proxy" from price alone (discussed in [S2]);
   a community version is `MA(open - close) / MA(range) * 50 + 50`, reportedly with a 13-week (65-day) lookback
   for stocks [S12] (unverified; not from Williams directly).
7. **Independent evidence is weak.** A 2026 study of 4,889 backtests found commercial extremes in E-mini S&P
   futures gave a median 20-day forward return of 1.081% against 1.076% for all days, i.e. about no edge; as a
   filter on an RSI(2) strategy it raised the average trade but not total profit [S13]. Academic work (Wang 2003)
   found hedgers' positions *negatively* related to later returns [S14]. This is why the scanner measures COT
   (the edge study) instead of trusting it.

## 3. The COT index, exactly

Formula (consistent across every source) [S6][S8][S15]:

    COT index = 100 * (net_now - lowest net in lookback) / (highest net in lookback - lowest net in lookback)
    net = commercial longs - commercial shorts   (CFTC legacy report, "Commercial" category)

- **Lookback:** 3 years (156 weekly reports) is what the book is cited for (p. 34) [S6], what his indicator
  scripts default to [S6], and what the 2026 interview uses [S3]. Forum posts (QuantNet 2008 [S26], metalsmine
  [S27]) report that the book **also** describes a **26-week** index of commercial net position divided by open
  interest (see WILLCO below); not checked. Vendor pages repeat the 26-week attribution without a page reference
  [S15][S16]; one indicator author argues 26-52 weeks give unstable readings because old extremes drop out quickly
  [S16].
- **Thresholds:** 75 / 25 in the 2026 interview [S3] (single source, seen only in a summary) and in a third-party
  script's description of his line plot [S16]. 80 / 20 is used by the script that cites the book [S6] and is the
  common convention [S15]. The two are **equally supported**; our edge study should decide between them. Above the upper level = commercials bullish, below the
  lower level = bearish.
- **Group:** commercials (not large speculators, not small traders) [S3][S7].
- **Open-interest variant (WILLCO):** net commercial position divided by open interest, then indexed; a
  community script defaults it to 26 weeks [S17]. **Possibly from the book (unverified):** the forum posts above
  [S26][S27] describe it as the book's 26-week index, and the book has a chapter "Opening Up on Open Interest"
  [S10], whose text could not be read.
- **Timing of data:** positions are as of Tuesday and published on Friday [S16][S18]. Our `align_cot` already
  uses a report only from the Friday after its Tuesday date.
- **Futures vs stocks caveat:** the reading is for the futures market (we use Nasdaq-100 E-mini, CFTC code
  209742). It is one number for the whole market, so it switches every Nasdaq-100 stock on or off together. It
  says nothing about any single stock [S11].

**Our code today:** the scanner's `cot_index` (strategies.py) uses **26 weeks**, while the Flow page
(`flow.py` `cot_index`) and `positioning.rolling_index` use **156 weeks**. The scanner disagrees with both
Williams' cited lookback and the rest of the app. The scanner's 60 / 40 thresholds are not Williams' numbers.
Note that `positioning.rolling_index` (positioning.py:70) already returns values after 26 weeks, so its earliest
readings (weeks 26-155) are not true 156-week values.

## 4. "Flow of money"

- Searches found **no named "flow of money" or "cash flow" method by Williams** [S9]. The closest ideas are:
  - **Who is putting money in (COT):** the weekly change in commercials' net position. That is what the COT
    index tracks; the Flow page already shows the weekly change.
  - **Williams Accumulation/Distribution (1967) [S19]:** adds (close - true low) on up closes and (close - true
    high) on down closes, true high/low including yesterday's close [S20][S21]. Sources disagree on whether his
    original multiplies by volume [S20][S21][S22]. The common no-volume version (the one our code uses) measures
    closing strength, **not money** [S21].
  - **POIV (price + open interest + volume):** cumulative open interest x price change / true range, plus OBV
    [S23]. Futures only (needs open interest).
- **In the video [S25]** the "flow of money" tools are the Acquisition Index (commercial-style buying pressure
  applied to single stocks, weekly) and the institutional accumulation index ("unbalanced volume"). Neither
  formula is disclosed. His exact unbalanced-volume formula is **not** in the video; our Williams A/D is the
  public stand-in.
- Plain reading: for futures, "the money" is the commercials' position (COT). For single stocks he uses his own
  undisclosed formulas. Our Nasdaq-100 futures COT is a **market-wide** read, not a stock-level one; our
  stock-level stand-ins are Williams A/D and the existing positioning work (FINRA short volume). We do not guess
  his formula. Used as "A/D above its EMA", our A/D only repeats what the z-score and %R measure; used for
  **divergence** (his main use in the video) it measures something different (Section 7, rule 5).

## 5. How he times entries

COT gives the direction; price gives the moment [S3][S8]. The video says the same: the setup is read on
**weekly** charts and forecasts substantial **intermediate-term** moves, then a trend tool and a short-term
trigger take over [S25]. That supports COT as a weekly direction setup with a daily trigger, as in our swing
time frame. His timing tools named in the sources are **Williams
%R turning up out of oversold (below -80)** for buys (overbought above -20 for sells, per the standard definition
[S24]) and a **volatility breakout from the open** [S3]. Our plan already enters with a buy-stop above the signal
bar's high, which is a breakout-style confirmation.

## 6. Pairing with the z-score (testable)

The logic, in one line: *commercials are buying (COT high), price is "on sale" for this stock (z-score low), and
price has started to turn (%R crosses up).* The z-score is not a Williams tool; it is our measure of "stretched".
Its role is the same as his oversold condition, so **%R and a z-score "turning" check do the same job**; keep one
turn signal, not two.

## 7. Recommended simple rule set for the scanner

One strategy, in the video's order: setup (COT), trend side, stretch (z-score), trigger (%R), plus ATR for the
stop. Accumulation divergence is one optional confirmation, kept only if the tests support it.

**Buy (long)**
1. Direction: Nasdaq-100 E-mini commercials COT index, **156-week** lookback, **>= 75**, using the latest report
   whose Tuesday date is at least 3 days old (as now).
2. Stretch: z-score(20 bars) at or below this stock's own **10th percentile over the last 250 bars** (current
   `zlo`, clamped -2.5..-0.75) on any of the last **3** bars.
3. Turn: Williams **%R(14) crosses up through -80** on this bar or the one before, and is still above -80.
4. Trend side: the higher-timeframe trend is up (current rule: the last finished week closed above its 10-week
   average). Test variant (WillTrend-like, since his formula is not given): up only if that close is above the
   10-week average **+ 0.5 x ATR(10 weeks)**, down only if below the average **- 0.5 x ATR(10 weeks)**, no trade in
   between. Keep the plain version unless the variant clearly wins the tests.
5. Optional confirmation, accumulation divergence (test before using): on any of the last **5** bars, Williams A/D
   was **above its highest value of the previous 20 bars** while that bar's close was **below the highest close of
   the previous 20 bars** (accumulation breaks out, price does not). Uses only bars up to the signal bar.
6. Entry/exit unchanged: buy-stop above the signal bar's high; stop past the 3-bar swing low kept between
   **0.75 and 2 ATR(14)**; target = 20-bar average **+1 SD**, skipped if the target is less than **0.5 ATR** away
   (strategies.py `weekly_swing_plan`); break-even at +1R. Order validity and the time exit come from each time
   frame's `HORIZONS` values (strategies.py:192-203): swing = valid **2** bars, exit after **5** bars; short =
   4 / 21 hourly bars; position = 2 / 6 weekly bars. These stay as they are.

**Sell (short)**: mirror image: COT **<= 25**; trend side down; z-score at or above the stock's **90th percentile**
(`zhi`) within 3 bars; %R(14) **crosses down through -20**; optional divergence = A/D **below its lowest of the
previous 20 bars** while the close is **above the lowest close of the previous 20 bars**, within 5 bars; sell-stop
below the signal bar's low; target 20-bar average -1 SD.

**COT 25-75 (neutral) or missing:** no `weekly_swing` signal. (Today a missing COT lets the signal through.)

**Grading must change the same way.** `cot_view` (strategies.py:289-294) uses 60 / 40 and feeds both the grade
and the edge study; it needs the same 75 / 25 (or 80 / 20) thresholds. Also, a missing COT reading passes the
grade's COT check today (scanner.py:625: `cotView != 'against'` is true when `cotView` is None), not only the
signal; it should count as "not confirmed", not as a pass.

**Keep / drop**

| Indicator in `weekly_swing` today | Decision | Why |
|---|---|---|
| COT index of commercials | **Keep**, change to 156 weeks and 75/25 or 80/20 | 156 weeks: book as cited by [S6], matches the Flow page. 75/25: [S3] (single source, summary only) and [S16] (third-party). 80/20: [S6]. Equally supported; let the edge study pick |
| z-score(20), per-stock percentile band | **Keep** (the "stretch") | Simple, already causal and per-stock |
| Williams %R(14) cross of -80/-20 | **Keep** (the "turn") | Williams' own named timing tool [S3] |
| z-score "turning" (`z[i] > z[i-1]`) | **Drop** | Same job as the %R cross |
| Williams A/D vs 20-bar EMA | **Replace** with the 20-bar divergence rule (rule 5), optional | The video's main accumulation use is divergence, not "above its average" [S25]; "above its EMA" overlaps z-score/%R [S21]. Keep the divergence rule only if the random-entry test and edge study support it; otherwise drop A/D from the entry |
| Weekly trend (10-week average) | **Keep a trend side filter; test a volatility version** | The video takes short-term signals only on the trend line's side, and his line uses trend plus volatility [S25] (formula not given). Test plain vs the 0.5 ATR band (rule 4); the simplest that survives wins. Caveat: commercials hedge against price moves [S14], so "COT bullish" and "uptrend" may rarely coincide; run a no-trend control too |
| ATR | Keep (stops only) | Risk sizing, not a signal |

**How to accept the change (no guesswork):** run the existing pooled random-entry test and the COT + z-score edge
study on both versions (current vs this one) over the same history. Switch only if the new version is at least as
good (profit factor and p-value) with fewer rules. Note that a 156-week index needs 3 years of warm-up. With 520
weekly reports (positioning.cot_rows) about 7 years of COT readings exist, but that only helps the **position**
time frame (15 years of weekly bars). The **swing** time frame loads only 1,100 daily bars (scanner.py:223, about
3 years), so its test window is about 3 years whichever lookback is used. If COT shows no edge in the study (the
outside evidence [S13][S14] suggests it may not), keep COT as a displayed reading only and let z-score + %R stand
alone.

**Not recommended now (more clutter than value):** seasonals, cycles and sentiment (his other conditions [S3]
and video tools [S25]: proprietary or no free data), the Acquisition Index (formula not disclosed [S25]), the COT
proxy for stocks [S12], WILLCO [S17], POIV [S23]. The video's True Seasonal is built only from data known at each
date [S25], the same no-look-ahead rule the scanner already follows (every value at bar i uses bars <= i).

## Sources

- [S1] Larry Williams, About Larry: https://www.ireallytrade.com/aboutlarry/
- [S2] Crowded Market Report, "CMR Interviews: Larry Williams" (Oct 2024): https://crowdedmarketreport.substack.com/p/cmr-interviews-larry-williams ; announcement: https://x.com/Crowded_Mkt_Rpt/status/1848376568768328189
- [S3] Foundation for the Study of Cycles, "Larry Williams: Six Decades of Trading Market Cycles" (2026): https://lars.cycles.org/p/larry-williams-lars-von-thienen-interview-market-cycles-market-timing (mirror: https://research.marketzeitgeist.com/p/larry-williams-lars-von-thienen-interview-market-cycles-market-timing)
- [S4] Better System Trader: https://bettersystemtrader.com/020-larry-williams/ and https://bettersystemtrader.com/use-indicators-like-a-trading-champion-with-larry-williams/
- [S5] L. Williams, *Trade Stocks and Commodities with the Insiders: Secrets of the COT Report*, Wiley 2005, ISBN 978-0-471-74125-1: https://oreilly.com/library/view/trade-stocks-and/9780471741251
- [S6] TradingView "COT Index" script (cites the book, p. 34; 3-year default; 80/20): https://www.tradingview.com/script/FDi7l1v6-COT-Index
- [S7] Book review summary: https://9natree.castos.com/episodes/review-trade-stocks-and-commodities-with-the-insiders-larry-r-williams-summarized
- [S8] COT-Reports, "Larry Williams and the COT Report: the COT Index Explained": https://cot-reports.com/blog/larry-williams-cot-report-cot-index/
- [S9] EBC, "Larry Williams Strategy Explained": https://www.ebc.com/forex/larry-williams-strategy-wr-cot-signals-2026 ; Picture Perfect Portfolios: https://pictureperfectportfolios.com/how-to-invest-like-larry-williams-trading-strategies-and-systems/
- [S10] Book listing with table of contents (Chapter 9 "Opening Up on Open Interest"): https://www.perlego.com/book/1006937/trade-stocks-and-commodities-with-the-insiders-secrets-of-the-cot-report-pdf ; Investors Daily Edge interview: https://www.ireallytrade.com/investorsdailyedge.html
- [S11] Larry Williams Indicators guide (PDF): https://ireallytrade.com/newsletters/Larry-Williams-Indicators.pdf
- [S12] COT proxy, community formula: https://uncleti88.blogspot.com/2011/05/commitments-of-traders-report-cot-proxy.html ; https://stonehillforex.com/2022/07/larry-williams-proxy-index-as-a-confirmation-indicator/
- [S13] StatOasis, "Does the COT Report Actually Work? 4,889 Backtests": https://statoasis.com/overfit/research/larry-williams-cot-filter
- [S14] Wang (2003), Journal of Futures Markets: https://ideas.repec.org/a/wly/jfutmk/v23y2003i1p1-31.html
- [S15] COT Insight, "COT Index Explained: The Williams Formula": https://cotinsight.com/blog/cot-index-explained ; COT Unchained: https://cotunchained.com/en/Info/Commitments-of-Traders-CoT-Reports/Williams-Commercial-Index
- [S16] TradingView COT script listing (lookback stability, 25/75 line plot, Tuesday/Friday lag): https://cn.tradingview.com/scripts/cot ; https://www.tradingview.com/script/uxZcuIjG-Larry-Williams-COT-Analysis-Enhanced-tradeviZion/
- [S17] TradingView "CoT MK WillCo Index": https://www.tradingview.com/script/9Na7z1YC-CoT-MK-WillCo-Index
- [S18] CFTC Commitments of Traders: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
- [S19] Larry Williams, Trading Innovation timeline (%R 1966, A/D 1967): https://www.ireallytrade.com/innovation/
- [S20] Incredible Charts, Williams A/D: https://incrediblecharts.com/indicators/williams_accumulation_distribution.php
- [S21] LuxAlgo, Williams A/D: https://www.luxalgo.com/library/concept/williams-a-d/
- [S22] TA-Lib, WAD: https://ta-lib.org/functions/wad.html
- [S23] POIV formula: https://prorealcode.com/topic/indicatore-poiv-di-larry-williams
- [S24] Williams %R: https://en.wikipedia.org/wiki/Williams_%25R
- [S25] Larry Williams presenting his Bloomberg-terminal indicators, recorded April 15 2013: https://www.youtube.com/watch?v=D9Q4S0YhO3k (the video the owner referred to; read from the owner-supplied transcript, paraphrased; the video itself was not viewed because YouTube is blocked in this session)
- [S26] QuantNet forum (2008), "Open interest, COT report, stochastic": https://quantnet.com/threads/open-interest-cot-report-stochastic.1428/
- [S27] Metalsmine forum post on Williams' 3-year and 26-week indexes: https://www.metalsmine.com/thread/post/4559826
