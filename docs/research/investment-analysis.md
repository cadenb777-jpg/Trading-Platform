# Investment analysis and economics behind swing trades (research notes)

Written 2026-10-24 for the Nasdaq-100 scanner (helper/engine/strategies.py, helper/engine/lab.py) and the trade
guide (src/home/tradeGuide.ts). It covers four questions: why trading edges exist at all, which ones survive in big,
liquid stocks, how much to bet, and how to judge results. It does not repeat the other notes:
[setups-statistics.md](setups-statistics.md) covers simulation counts, multiple testing and the lab's safeguards;
`williams-cot.md` (branch conductor/1-williams) covers Williams' COT index; `trend-and-charts.md` (branch
conductor/1b-trend) covers trend following, moving averages, chart patterns, exits and the 0.5%-risk proposal.
This note points to those instead of restating them.

**How the sources were read (important).** Web search worked in this session, but every direct page download did
not: WebFetch failed with a DNS error and curl got a 403 from the proxy for IDEAS/RePEc, Berkeley and archive.org.
So **no paper here was read in full text.** Every claim comes from abstracts, publisher or archive landing pages
and catalogue records, as reported by the search tool. Where a number appears in an abstract, it is given as the
abstract states it. Numbers from secondary summaries are marked *(unverified)*. Numbers marked *(computed here)*
come from a small simulation written for this note (assumptions stated next to them). No quotes are given, because
no page could be read word for word.

---

## 1. Ten things a beginner must know

1. **Easy edges get competed away, so any edge that's left exists for a reason.** If prices already held all
   information, no one would be paid to collect it (Grossman & Stiglitz 1980). Edges last when they are risky,
   costly or awkward to trade (Shleifer & Vishny 1997). Ask of every rule: *who loses money to me, and why do
   they keep doing it?*
2. **Published edges shrink.** Across 97 published return predictors, returns were 26% lower out of sample and
   58% lower after publication (McLean & Pontiff 2016). Plan for a backtest result to be roughly halved.
3. **Most "anomalies" do not survive in large stocks.** With value weighting (which damps the effect of tiny
   stocks), 65% of 452 anomalies fail a basic t > 1.96 test, and 82% fail a stricter multiple-testing bar (Hou, Xue
   & Zhang 2020). Nasdaq-100 stocks are the hardest place to find an edge.
4. **Two price patterns are robust and come with a reason: medium-term momentum and short-term reversal.**
   Momentum (3-12 months) does not weaken with firm size (Israel & Moskowitz 2013). Short-term reversal is pay for
   supplying liquidity. It is largest in illiquid stocks and when fear (VIX) is high (Avramov, Chordia & Goyal
   2006; Nagel 2012), and it is weaker when the move was caused by real news (Da, Liu & Schaumburg 2014).
5. **Trading costs decide whether a fast strategy works.** Most anomalies trading less than about 50% of the book
   a month still pay after costs. Few faster ones do (Novy-Marx & Velikov 2016). Swing trading is fast, so costs
   must be counted in every result, including R-multiples.
6. **Macro forecasting barely helps short trades.** Well-known market-timing variables did not beat the historical
   average out of sample (Welch & Goyal 2008). The famous pre-Fed-meeting rally mostly disappeared after 2015
   (Kurov, Wolfe & Gilbert 2021). Expected returns do change over time (Cochrane 2011), but mostly over years,
   not days.
7. **Positioning data is a weak, mixed signal.** Hedging-pressure effects are clear in currency and farm futures
   and less clear in financial futures (Bessembinder 1992). Speculators, not hedgers, earned the trend profits in
   58 futures markets (Moskowitz, Ooi & Pedersen 2012), which is the opposite of the "follow the commercials" idea.
   FINRA daily short volume is not short interest (FINRA).
8. **Bet small and the same way every time.** Fixed-fractional risk (for example 0.5% of the account per trade,
   with the stop setting the share count) keeps losing streaks survivable. Full Kelly maximises long-run growth but
   gives deep drawdowns and is very sensitive to errors in the estimated edge. Betting twice Kelly gives zero
   growth (MacLean, Thorp & Ziemba 2010).
9. **Twenty Nasdaq-100 positions are not twenty bets.** Roughly 58-59% of the index is information technology
   (2026 figures, secondary sources), and stock correlations rise in falling markets (Ang & Chen 2002). Five
   tech-stock trades with correlation 0.6 behave like about 1.5 independent bets *(computed here)*.
10. **Every performance number has a trap.** Sharpe ratios are overstated when returns are serially correlated
    (Lo 2002) or skewed (Bailey & López de Prado 2012). Maximum drawdown grows with the length of the record
    (Magdon-Ismail & Atiya 2004). Profits from many trades taken on the same day are not independent.

---

## 2. Why edges exist and persist

### 2.1 Market efficiency and its limits

- **Fama (1970)** defined three information sets: past prices (weak form), public information (semi-strong) and
  any information (strong). He concluded that, with few exceptions, the efficient-markets model held up well
  [Fama 1970]. **Fama (1991)** revisited the evidence. Its key point for us is the *joint-hypothesis problem*: an
  apparent edge is always also a test of the model of "normal" return, so a backtest that beats a naive benchmark
  may only have taken more risk [Fama 1991; landing page only, abstract not retrieved. The joint-hypothesis
  framing is standard textbook content, BKM].
- **Grossman & Stiglitz (1980)** showed that perfect efficiency contradicts itself. If prices revealed everything,
  nobody would pay to collect information, so markets must stay inefficient enough to pay information gatherers.
  How inefficient depends on the cost and quality of information and the number of informed traders
  [Grossman & Stiglitz 1980; summary of the argument, abstract text not retrieved].
- **Shleifer & Vishny (1997)**: real arbitrage ties up capital and carries risk. It is done by a few specialists
  using other people's money, so it can fail exactly when prices are furthest from value. The model predicts
  where anomalies should persist [Shleifer & Vishny 1997, abstract via NBER w5167 and catalogue records].

**What this means for us:** an edge on Nasdaq-100 stocks is more believable when the trade is uncomfortable or
risky to hold: buying after a sharp drop, or holding through a choppy pullback. "Free money" patterns in the most
watched stocks on earth should be distrusted.

### 2.2 Behavioural explanations for momentum and reversal

Three classic models explain why prices first underreact and later overreact:

| Model | Mechanism | Prediction |
|---|---|---|
| Barberis, Shleifer & Vishny (1998) | *Conservatism* (slow updating on news) and *representativeness* (seeing a trend in a run of news) | Underreaction to single news items such as earnings, overreaction to a series of good or bad news |
| Daniel, Hirshleifer & Subrahmanyam (1998) | *Overconfidence* in private information and *biased self-attribution* (wins are skill, losses bad luck) | Short-lag momentum and earnings drift, long-lag reversal. Overreaction to private signals, underreaction to public ones (CFA Institute digest) |
| Hong & Stein (1999) | News spreads slowly among "news-watchers"; "momentum traders" chase the trend and overshoot | Underreaction first, then overreaction at long horizons |

Sources: the abstracts listed in the source table. All three predict the same broad shape (short-term
continuation after news, longer-term reversal) for different reasons. So the shape is well supported, but these
models cannot tell us which bias is at work in a given trade.

### 2.3 Risk premium or mispricing, and why it matters

- A **risk premium** (payment for bearing a risk others avoid) should persist, but it comes with bad periods:
  momentum crashes in rebounds after market falls [Daniel & Moskowitz 2016], and reversal profits are highest
  in turmoil [Nagel 2012].
- A **mispricing** should shrink as people learn about it. McLean & Pontiff (2016) found exactly that: the
  out-of-sample drop (26%) is their upper bound on data mining, and the further drop after publication (to 58%
  below in-sample) is investors trading on the papers [McLean & Pontiff 2016].
- Cross-check: Chordia, Subrahmanyam & Tong (2014) found that average returns from a portfolio of well-known
  anomalies roughly **halved after decimalization**, linked to hedge-fund assets, short interest and turnover.
  Auer & Rottmann later reported that this US result is not fully robust [Chordia et al. 2014; the
  disagreement is reported via a search summary, *(unverified)*]. Two independent sources agree on a large
  decline, and they disagree about how robust it is.

**Practical rule:** treat any backtest edge as **at most half as large live**. The lab already judges survivors
only on unseen data (setups-statistics.md, section 9). That handles the data-mining half of the problem but not
the publication-decay half.

---

## 3. Which anomalies matter for Nasdaq-100 swing trades

### 3.1 Survival in large caps and after costs

- **Hou, Xue & Zhang (2020)**: 452 anomalies with NYSE breakpoints and value-weighted returns. 65% fail
  |t| >= 1.96 and 82% fail |t| >= 2.78. Their "trading frictions" category fails worst (96%). Microcaps are about
  3% of market value but 60% of stocks *(unverified, secondary)* [HXZ 2020].
- **Novy-Marx & Velikov (2016)**: costs always reduce profits. Most anomalies with one-sided monthly turnover
  below 50% still earn significant net spreads, and few faster ones do. The best cost-cutting method is a
  **buy/hold spread**: stricter rules to open a position than to keep it [Novy-Marx & Velikov 2016].
- **Frazzini, Israel & Moskowitz (2018)**, from about $1.7 trillion of AQR's own executions: real institutional
  costs are an order of magnitude below earlier academic estimates, and price impact is the largest part
  [Frazzini et al. 2018]. This **disagrees** in part with Novy-Marx & Velikov, whose cost estimates are higher.
  For a retail account trading a few hundred shares of mega-caps, price impact is negligible, so the spread plus
  slippage on stops dominates. The scanner's flat 0.1% round trip is reasonable for normal fills, but it
  understates the cost of gaps through stops (which `simulate` already models by filling at the open).

### 3.2 Factor by factor (relevance to our three time frames)

| Effect | Core evidence | Large caps / after costs | Our horizon |
|---|---|---|---|
| **Short-term reversal** (1 week to 1 month) | Lehmann 1990, Jegadeesh 1990 (setups-statistics.md, section 5) | Concentrated in illiquid, high-turnover stocks; profits smaller than likely costs [Avramov, Chordia & Goyal 2006]. Returns are pay for liquidity and are highly predictable with the VIX, rising in turmoil [Nagel 2012]. Moves *not* explained by cash-flow news reverse more; using analyst revisions to strip news out gave about 4x the risk-adjusted return of plain reversal [Da, Liu & Schaumburg 2014] | short / swing: our `stretch`, `rsi2`, `down3`, `mean_reversion` |
| **Momentum** (3-12 months) | Winners keep winning over 3-12 month holds; part of it reverses in years 2-3 [Jegadeesh & Titman 1993]. Seen in 8 markets and asset classes, and negatively correlated with value [Asness, Moskowitz & Pedersen 2013] | No reliable relation with firm size, about half the profit from the long side [Israel & Moskowitz 2013]. Crashes in rebounds after bear markets [Daniel & Moskowitz 2016] | swing / position: trend filters, `high52`, `breakout` |
| **Industry momentum** | Industry momentum explains much of stock momentum and is strongest at a 1-month horizon *(that horizon claim is via a citing paper, unverified)* [Moskowitz & Grinblatt 1999] | Not tested on the Nasdaq-100 specifically. A Canadian replication disagreed *(unverified)* | Implication: in a tech-heavy index, "stock momentum" is partly "sector momentum", which feeds the concentration problem (section 6.4) |
| **52-week high** | Covered in trend-and-charts.md (George & Hwang 2004) | | `high52` |
| **Low volatility / low beta** | High idiosyncratic volatility stocks earn very low average returns [Ang, Hodrick, Xing & Zhang 2006]; disputed by Fu (2005) *(via search summary)*. Leverage-constrained investors bid up high-beta stocks, so low-beta stocks earn higher risk-adjusted returns [Frazzini & Pedersen 2014] | A slow, cross-sectional, monthly effect. Not a swing-trade trigger | Lab `lowvol` filter is the closest. Low priority |
| **Quality** (profitable, growing, safe) | High-quality stocks earn high risk-adjusted returns because their price premium is small; the price of quality was lowest during the internet bubble *(working-paper detail)* [Asness, Frazzini & Pedersen 2019] | Slow (quarterly data) | Not a swing signal; fine as background on the Research page |
| **Post-earnings drift (PEAD)** | Prices keep drifting in the direction of an earnings surprise [Bernard & Thomas 1989; the about 4.2% 60-day spread is *unverified, secondary*] | **Gone in large caps since about 2006** [Martineau 2022]; two 2025 papers dispute this and attribute the difference to research design *(UCLA Anderson brief, unverified)* | Do not add a PEAD trigger for mega-caps. The disagreement is open |
| **Analyst revisions / earnings momentum** | Past returns and past earnings surprises each predict drift; analysts' forecasts also respond sluggishly [Chan, Jegadeesh & Lakonishok 1996] | Needs revision data we do not have (free sources lack it) | Not actionable now |
| **Earnings-announcement premium** | Firms about to report earn a large abnormal return (9.9% annualised in the abstract), explained as extra systematic risk on announcement days [Savor & Wilson 2016] | A premium for *risk*: big gaps both ways | Supports keeping the "no earnings inside the hold" rule for risk control, not as an edge |

**Agreement check:** momentum's survival in large caps is supported by Israel & Moskowitz and by the trend
literature cited in trend-and-charts.md (two independent lines). The weakness of short-term reversal after costs is
supported by Avramov et al. and is consistent with Hou et al.'s friction-category failures and Novy-Marx &
Velikov's turnover result (three sources). The status of PEAD is **disputed** (Martineau against the 2025
replies).

---

## 4. Positioning and flows

### 4.1 Futures positioning (COT) beyond Wang 2003

| Source | Finding | Direction relative to the "follow commercials" idea |
|---|---|---|
| Bessembinder 1992 | Futures and asset markets price systematic risk alike. **Hedgers' net positions move returns in currency and farm futures** after controlling for risk, a sign of partial segmentation | Hedging pressure = hedgers *pay* a premium; effects are shown for currency and agricultural markets, not financials |
| de Roon, Nijman & Veld 2000 | In 20 futures markets (financial, agricultural, mineral, currency), own-market **and** cross-market hedging pressure affect futures returns, even after a price-pressure control, and help explain the underlying asset's return | Same hedging-pressure direction; does include financial futures |
| Moskowitz, Ooi & Pedersen 2012 | Weekly CFTC data, 58 futures: **speculators profit from time-series momentum at hedgers' expense** | Opposite of treating commercials as the informed side |
| Wang 2003 (already in setups-statistics.md) | Speculators' positions predict continuation, hedgers' predict reversal | Same as above |

**Reading:** the academic literature (four papers, three author groups) mostly says hedgers *pay* speculators,
which is the opposite of Williams' "commercials are the insiders". Bessembinder's financial-futures result is
weaker than de Roon et al.'s, which is a genuine disagreement. Both use hedging pressure as a premium, not as
information. williams-cot.md already concludes "measure it, don't assume it". The scanner's COT + z-score edge
study (setups-statistics.md, section 4) is the right tool, and this literature adds a prior: **expect the edge
study to find little or the opposite sign** for Nasdaq-100 E-mini commercials.

### 4.2 Fund-flow pressure

- **Coval & Stafford (2007)**: funds with large outflows sell their holdings, which pushes down stocks held in
  common by distressed funds, and inflows do the reverse. Traders who take the other side earn significant returns
  for providing liquidity, and flow-driven trades are predictable [Coval & Stafford 2007].
- **Lou (2012)**: aggregated flow-induced trading has a significant but temporary price impact; predictable flows
  forecast returns over the next year, which then reverse. It fully explains fund performance persistence and
  partly explains stock momentum [Lou 2012].
- Two independent sources agree on **temporary price pressure from non-information trading**. This is the same
  economic story as short-term reversal (Nagel's liquidity provision). It supports buying stretched large caps in
  an uptrend, but we have no flow data, and none is needed: the z-score stretch already proxies for the pressure.

### 4.3 Short selling, short interest and FINRA short volume

- **Boehmer, Jones & Zhang (2008)**, NYSE order data: heavily shorted stocks underperform lightly shorted ones by a
  risk-adjusted 1.16% over the next 20 trading days; institutional non-program shorts are the most informed
  (1.43%) [BJZ 2008].
- **Diether, Lee & Werner (2009)**, 2005 SEC data: short sales were 24% of NYSE and 31% of Nasdaq volume. Short
  sellers sell after price rises and predict negative abnormal returns, consistent with trading on short-term
  overreaction. A working-paper version noted that costs could wipe out the profits *(working-paper detail)*
  [DLW 2009].
- **Asquith, Pathak & Ritter (2005)**: short-sale-constrained stocks underperformed by about 215 bp a month
  equal-weighted, but only about 39 bp value-weighted, which is not significant [APR 2005]. So **in large caps the
  short-interest signal is weak**, which agrees with Hou et al.'s large-cap finding.
- **FINRA's own caveats**: the daily short-sale volume file counts trades marked short, often by market makers
  filling customer buy orders. It is not short interest (positions), is not consolidated with exchange volume, and
  leaves out some offsetting reports, which can make short volume look higher than it is [FINRA notice and
  pages; OTC Markets commentary].
- **Reading:** the academic signal comes from *proprietary* order-level data (who shorted, and whether it was a
  program trade). FINRA's public file mixes market-making with directional shorts. The research does not support
  using FINRA short-volume ratios as a grade input. setups-statistics.md already keeps it display-only; it should
  stay that way.

### 4.4 Options-implied signals (brief)

- **Pan & Poteshman (2006)**: put-call ratios from **buyer-initiated opening** option volume predict stock returns
  (more than 40 bp the next day and more than 1% the next week), driven by option traders' non-public
  information [Pan & Poteshman 2006]. That open/close and buyer/seller split is not in free public data.
- Cremers & Weinbaum (2010) on implied-volatility spreads could not be confirmed from a primary page and is left
  out.
- **Reading:** an option-flow edge would need paid, classified data. Not worth chasing.

---

## 5. Macro and regime

- **Time-varying expected returns.** Cochrane's presidential address: variation in price-dividend ratios is
  mostly about changing *discount rates* (expected returns), not cash flows [Cochrane 2011]. But the predictability
  he describes is at multi-year horizons. **Welch & Goyal (2008)**: the classic predictors performed poorly in
  and out of sample, were unstable, and would not have helped an investor time the market. A 2024 update found
  more than a third of newer variables insignificant even in sample *(via search summary)* [Welch & Goyal
  2008]. These two sources are compatible: expected returns vary, but forecasting the variation in real time is
  hard.
- **Credit spreads.** The **excess bond premium** (credit spread minus expected default) predicts economic
  activity, and shocks to it are followed by falling activity and asset prices [Gilchrist & Zakrajšek 2012]. It is
  a months-ahead macro signal, useful context on the Macro page, not a swing filter.
- **The Fed.** Large average US equity returns came in the 24 hours before scheduled FOMC decisions
  (1994-2011) [Lucca & Moench 2015]. **Extended to 2019, the drift essentially disappeared after 2015** [Kurov,
  Wolfe & Gilbert 2021]. Cieslak, Morse & Vissing-Jorgensen (2019) found that since 1994 the equity premium was
  earned in even weeks of the FOMC cycle, linked to Fed news [CMVJ 2019]. These are **three sources with a time
  disagreement**: the best-known effect has faded. Do not build an FOMC filter. Showing FOMC dates as event
  risk (the calendar already has them) is enough.
- **Volatility regimes, and why they matter in opposite ways.**
  - Reversal / liquidity provision: expected returns and Sharpe ratios **rise** when VIX is high [Nagel 2012].
  - Momentum: crashes happen in high-volatility "panic" states after market declines, when the market rebounds;
    forecasting momentum's mean and variance roughly doubled its Sharpe ratio [Daniel & Moskowitz 2016].
  - Volatility-managed portfolios (scale exposure down when recent volatility is high) improved alphas in Moreira
    & Muir (2017) *(via later papers)*, but across 103 strategies they did not reliably beat unmanaged versions in
    real-time tests, mainly because the regressions were unstable [Cederburg et al. 2020]. DeMiguel et al. (2024)
    defend a multifactor version. **Disputed.**
  - So a volatility-regime switch is the **one** macro-type condition with a theory that predicts *opposite*
    signs for our two strategy families. That makes it falsifiable, which is why it is the only regime idea in the
    recommendations (7.4).

---

## 6. Investment analysis for the trader

### 6.1 Expectancy and R-multiples

- **R** is the money at risk if the stop is hit: (entry - stop) x shares. A trade's **R-multiple** is its profit
  divided by R, and **expectancy** is the average R per trade (win rate x average win in R - loss rate x average
  loss in R). Popularised by Van Tharp in *Trade Your Way to Financial Freedom* (1998). System quality is judged by
  the distribution of R-multiples, not the win rate [Van Tharp, via secondary pages; the book was not read].
- Expectancy only describes your account if risk per trade is held constant, which is why R pairs with
  fixed-fractional sizing.
- **Code check:** `simulate` returns `ret` *after* the 0.1% cost but `r` *before* it
  (strategies.py:463-465), so `avgR` in `summarise` is gross. With a stop 1.5% from entry, the cost alone is
  about 0.07R per trade *(computed here: 0.1% / 1.5%)*. That is large next to a typical edge (section 6.2's
  example has 0.26R).

### 6.2 Position sizing: fixed fractional, volatility, Kelly

- **Kelly (1956)**: a gambler with an informative signal maximises the long-run growth rate of capital by betting
  the fraction that maximises expected log wealth. The best growth rate equals the information rate of the
  signal [Kelly 1956]. For a bet that wins b units with probability p, the Kelly fraction is f* = p - (1-p)/b.
- **Thorp (2006)** applies it to blackjack, sports and stocks [Thorp 2006]. **MacLean, Thorp & Ziemba (2010)**
  list the good and bad properties. Good: Kelly maximises long-run growth. Bad: bets can be very large; results
  are very sensitive to the estimated means; betting more than Kelly adds risk and lowers growth, with zero growth
  at about twice Kelly. Fractional Kelly blends Kelly with cash for smoother paths and less final wealth [MTZ
  2010].
- **Worked example *(computed here)*.** A strategy wins 45% of the time, averages +1.8R on wins and loses 1R.
  Expectancy = 0.45 x 1.8 - 0.55 = **+0.26R**. Kelly fraction = 0.45 - 0.55 / 1.8 = **14.4% of the account at risk
  per trade**. 20,000 simulated runs of 100 independent trades:

  | Risk per trade | Median max drawdown | 95th-percentile max drawdown | Median ending equity |
  |---|---|---|---|
  | 0.25% | 2.0% | 3.8% | 1.07x |
  | 0.5% | 4.0% | 7.5% | 1.14x |
  | 1% | 7.9% | 14.5% | 1.28x |
  | 2% | 15.4% | 27.3% | 1.62x |
  | 7.2% (half Kelly) | 47.9% | 72.0% | 3.95x |
  | 14.4% (full Kelly) | 77.2% | 94.7% | 6.17x |

  In the same runs the median longest losing streak was 6 trades, and 1 run in 20 had 11 or more. **This assumes
  the edge is known exactly.** McLean & Pontiff suggest a live edge could be half the backtest. If true
  expectancy is half the estimate, a bet sized at "half Kelly" is already full Kelly on the real edge, and "full
  Kelly" is about twice Kelly, the zero-growth point (MTZ 2010). Trades are also not independent (section 6.4), so
  real drawdowns are worse. Conclusion: **Kelly is a ceiling that shows how far we are from danger, not a
  sizing rule.** 0.25-0.5% fixed-fractional risk is far below even a heavily discounted Kelly.
- **Volatility-based sizing** is already built in: our stops are in ATR, so a fixed % of the account at risk
  automatically buys fewer shares of a jumpy stock. trend-and-charts.md section 6.5 covers this and proposes a
  0.5% default. The trade guide currently defaults to **1%** (tradeGuide.ts:27). This note **agrees** with 0.5%
  and adds the Kelly reasoning above.

### 6.3 Risk of ruin and drawdown statistics

- With fixed-fractional sizing the account never reaches exactly zero. The real "ruin" is a drawdown deep enough
  that you stop following the system. The table above gives those odds directly. At 2% risk per trade, about one
  run in twenty loses more than a quarter of the account within 100 trades, even with a genuine +0.26R edge.
- **Magdon-Ismail & Atiya (2004)**: expected maximum drawdown is tied to mean return and Sharpe ratio, and grows
  with the length of the record: logarithmically with positive drift, like the square root with zero drift, and
  linearly with negative drift. So **drawdowns can only be compared over equal lengths of history** [Magdon-Ismail
  & Atiya 2004; the formulas themselves were not seen]. The scanner's Monte Carlo of the next 20 trades
  (stationary bootstrap) already gives drawdowns over a fixed horizon, which is the right way to do it.

### 6.4 Correlation and concentration in a Nasdaq-100-only book

- **Sector weight:** information technology was about 59% of the Nasdaq-100 in an Invesco page dated
  2026-10-20, and 57.9% "technology" in ChartRow's July 2026 figures, with the top three sectors at 82%
  *(both secondary; classifications differ)*. The index caps single weights and the total of large weights
  *(secondary description of the methodology, unverified)*.
- **Downside correlation:** stock-market correlations are much higher in down markets, especially extreme ones,
  than in up markets, so diversification is overstated if this is ignored [Ang & Chen 2002].
- **Breadth:** Grinold's fundamental law: information ratio ≈ skill (IC) x √(number of *independent* bets).
  Practitioner sources stress that it overstates what constrained managers achieve [Grinold 1989, via secondary
  sources; Grinold & Kahn's book was not read]. The key word is *independent*.
- **Effective number of bets *(computed here)*:** n positions with average pairwise correlation ρ behave like
  n / (1 + (n-1)ρ) independent ones. Five positions at ρ = 0.3 behave like 2.3 bets; at ρ = 0.6, like 1.5; eight at
  ρ = 0.6, like 1.5. Five semiconductor longs at 0.5% risk each are close to **one 2.5% bet on semiconductors**.
- **Statistical consequence for our tests:** the pooled random-entry test (strategies.py:556) draws each random
  entry date **independently** per trade, but real signals cluster on the same dates (a market-wide sell-off
  triggers stretch signals in dozens of stocks at once). Clustered real trades have a more variable average than
  the independent random draws, so the test's null distribution is too narrow and **p-values come out too
  small**. This is the testing side of the concentration problem.

### 6.5 Performance measurement and its pitfalls

| Measure | What it is | Pitfall for swing trading |
|---|---|---|
| Sharpe ratio | Excess return / volatility | Annualising by √12 is only valid in special cases. Serial correlation overstated hedge-fund Sharpe ratios by more than 65% [Lo 2002]. Negative skew and fat tails make a given Sharpe less reliable and require longer records: the probabilistic Sharpe ratio and minimum track-record length [Bailey & López de Prado 2012] |
| Sortino ratio | Excess return over a minimum acceptable return / downside deviation [Sortino & Price 1994; CFA curriculum via AnalystPrep notes] | Better for skewed trade payoffs, but needs many losing periods to estimate downside deviation |
| Information ratio | Active return / tracking error vs a benchmark [Grinold 1989; BKM] | Benchmark choice: for long-only Nasdaq-100 swings the honest benchmark is simply holding QQQ |
| Max drawdown | Largest peak-to-trough loss | Grows with record length; says nothing about frequency or recovery time (CFA curriculum notes via AnalystPrep) |
| Per-trade statistics (win rate, PF, avgR) | What `summarise` reports | Ignore time in the market. A strategy invested 10% of the time with the same avgR as one invested 80% earns far less per year. Not risk-adjusted for overlapping positions |
| M² / Treynor | Sharpe rescaled to market risk / excess return per unit of beta (BKM chapter on performance evaluation) | Treynor suits a sleeve of a larger portfolio, which is the owner's RIA use case for client reports, not the trading account |

The scanner already reports the t-statistic of the average trade and the trades needed for t = 2, which is the
per-trade version of the minimum-track-record idea. **Do not add a Sharpe ratio to setup cards.** It would invite
the √-annualisation and serial-correlation errors above without adding information.

---

## 7. What this means for our scanner and trade guide

Five recommendations, simplest first. Two are fixes to existing calculations, one is a guard on what we show,
one is a single optional filter for the lab, and one is a reminder of what not to add. Each comes with a test
using the existing tools.

### 7.1 Fix: make R net of costs, and size at 0.5% risk

**Change.** In `simulate`, compute `r` after costs (subtract `COSTS * entry / risk` in R units, matching `ret`) so
`avgR`, expectancy and the trade guide's numbers are net. Change the trade guide's default risk from 1% to 0.5%
(agreeing with trend-and-charts.md 6.5). Show beside the size calculator the 95th-percentile drawdown of the next
20 trades at the chosen risk, from the existing Monte Carlo in R units.

**Why.** Costs are a large share of a small edge (6.1). Kelly reasoning with a discounted edge puts 0.5% far
inside the safe zone (6.2).

**Test.** (a) Unit test: a trade that exits at entry has `r` = -cost/risk, not 0. (b) Re-run `summarise` and the
pooled random-entry test for each strategy and side. The p-values must not change (the test uses `ret`, which
already includes costs), but `avgR` will fall. Any strategy whose net `avgR` drops below +0.1R should be
flagged in its evidence card. (c) Run `monte_carlo` in R units at 0.5% and 1% and check that the drawdown shown
matches the table in 6.2 for a similar trade distribution.

### 7.2 Fix: cluster-aware random-entry test (honest p-values)

**Change.** In `random_entry_test`, draw **one random date offset per signal date** and apply it to every trade
that signalled on that date (each stock keeps its own direction and holding time), instead of an independent
random date per trade. That keeps the real trades' clustering in the null distribution. The lab uses the same
test on its unseen windows, so it inherits the fix.

**Why.** Same-day signals across correlated Nasdaq-100 stocks are not independent (6.4). The current null is too
narrow and overstates significance, the testing version of the "20 positions are not 20 bets" problem.

**Test.** Synthetic check in helper/tests, as the lab's existing validation does: generate 100 stocks from a
one-factor model (a common market return plus stock noise, average correlation about 0.5, upward drift, **no
edge**), run `mean_reversion` and the reversal triggers, and repeat for 50 seeds. At the 10% level, a correct test
rejects about 10% of the time. Expect the current test to reject noticeably more often and the clustered test to
be near 10%. Then re-grade the real strategies. Any tier-A status that depended on p just under 0.10 should be
re-examined.

### 7.3 Guard: limit correlated exposure in "Today" and the trade guide

**Change.** When more than one A/B setup is open or triggering, group them by 60-day return correlation (pairs
with correlation of 0.7 or more in one group; no new data needed) and show **total open risk per group** in the
"Today" summary, with a soft cap: at most **2 positions or 1% total risk per correlated group**, and **3% total
open risk** for the whole book. The guide says "This adds to your existing semiconductor exposure (2 trades, 1.0%
at risk)." Display and warning only; it never blocks anything.

**Why.** About 58-59% tech weight and higher correlations in sell-offs (6.4) mean that unchecked signals become
one leveraged sector bet exactly when stops are most likely to gap.

**Test.** Portfolio replay over the swing history (no lab change): take every A/B signal in date order at 0.5%
risk, once with no cap and once with the cap (skip the lowest-ranked setup when a group is full). Compare total R,
worst drawdown and 95th-percentile drawdown from a stationary bootstrap of **daily portfolio P&L** (not of
trades, because trades overlap). Keep the cap if it cuts the 95th-percentile drawdown by clearly more than it cuts
total R, for example a drawdown/return ratio that improves by 20% or more. Report the cap's neighbourhood (0.6 /
0.7 / 0.8 correlation) only to show a plateau.

### 7.4 One regime idea, tested in the lab, not hard-wired: market volatility

**Change.** Add a single lab filter, `calmmarket`: QQQ's 20-day realised volatility, known as of the previous day,
below its own 250-day median (the inverse condition is the same filter's "false" side). It uses QQQ data the lab
already loads for `market` (market_trend_by_date). Do **not** add FOMC, credit-spread or macro filters.

**Why.** Theory predicts *opposite* effects: reversal and liquidity provision pay more in turbulent markets
(Nagel 2012), while momentum crashes in high-volatility rebounds (Daniel & Moskowitz 2016). Volatility timing in
general is disputed out of sample (Cederburg et al. 2020), and macro predictors and the pre-FOMC drift have
failed or faded (section 5). A filter with a signed prediction can be falsified, which a generic regime switch
cannot.

**Test.** Run the lab as usual (walk-forward, embargo, Holm, PBO; nothing changes there). The prediction passes
only if survivors that use the filter follow theory: momentum triggers (`breakout`, `high52`, `gapgo`) with
`calmmarket` and reversal triggers (`stretch`, `rsi2`, `down3`) **without** it (turbulent side). Survivors with the
wrong sign, or a filter chosen in only one fold, count as noise, and the filter is removed after two lab cycles
with no theory-consistent survivor. In the pooled random-entry test, split each main strategy's trades by regime
and compare the two sides' average returns with a 1,000-run permutation (the method of `edge_summary`).

### 7.5 Keep the earnings rule, and add nothing that needs data we cannot get

**Change.** None in code. Keep "no earnings inside the hold" as a risk rule (and "unavailable" never meaning
"none"). **Do not** add PEAD, analyst-revision, short-interest, FINRA-short-volume or option-flow signals to grades.

**Why.** Announcement days carry extra systematic risk and big gaps (Savor & Wilson 2016), which blow through
ATR stops. PEAD in large caps is gone or disputed (Martineau 2022 vs the 2025 replies). Revision data is not free.
Short-selling evidence relies on proprietary order data and is weak value-weighted (APR 2005), and FINRA's own
notes warn against reading the public file as short interest. Option-flow predictability relies on non-public
open/close classification (Pan & Poteshman 2006). Da, Liu & Schaumburg (2014) also suggest that news-driven moves
reverse less, another reason not to fade an earnings gap.

**Test.** Check the rule's value with data already on hand. In the swing history, mark trades whose holding
period contains an overnight gap larger than 3 ATR (a proxy for an earnings or news gap, since there is no free
history of earnings dates). Compare the R distribution of those trades with the rest: mean R, 5th-percentile R and
the share of stops filled beyond the stop price. The rule is supported if gap trades have similar or lower mean R
and a much worse 5th percentile. For reversal strategies, also compare stretches that *started* with a 3-ATR gap
against those that did not. Theory (DLS 2014) predicts that gap-started stretches reverse less. If so, the
existing `gapfade` trigger is suspect and should face its own lab evidence.

---

## 8. Limits of this research

- **No full texts.** Every source was read through abstracts, landing pages or catalogue records found by search.
  Direct downloads failed (DNS error in WebFetch, proxy 403 for curl). Abstract wording was taken from search
  summaries, which can paraphrase. The textbooks (Bodie/Kane/Marcus, Ilmanen, Grinold & Kahn, Cochrane's
  *Asset Pricing*) were known only from publisher pages, course slides and study notes. Their contents are cited
  only for standard definitions.
- **Most evidence is from broad US samples, not the Nasdaq-100.** Results about "large caps" are the closest
  match. No source studied swing trades on Nasdaq-100 constituents specifically.
- **The computed examples are illustrative.** The sizing table assumes independent trades with a fixed, known win
  rate and payoff. Real trades cluster and edges are uncertain, so real drawdowns will be larger.
- **Unresolved disagreements:** institutional trading-cost levels (Frazzini et al. vs Novy-Marx & Velikov);
  whether anomaly decay after decimalization is robust (Chordia et al. vs Auer & Rottmann); PEAD in large caps
  (Martineau vs 2025 replies); volatility timing (Moreira & Muir vs Cederburg et al. vs DeMiguel et al.);
  hedging pressure in financial futures (Bessembinder vs de Roon et al.).
- **Survivorship and costs** are as stated in setups-statistics.md section 7: today's index list, flat 0.1% costs.
- **Nothing here is advice to trade.** The platform stays market-data only and never places orders.

---

## 9. Sources

Access column: "Abstract" = abstract or summary seen via search on that landing page, not the full paper.
"Catalogue" = bibliographic record or secondary summary only. No source was read in full text (section 8).

| # | Source | Type | Archive / publisher (link) | Access | What it contributed |
|---|---|---|---|---|---|
| 1 | Fama (1970), Efficient Capital Markets: A Review, *J. Finance* 25(2) | Peer-reviewed | [JSTOR-derived PDF copy](https://datagolf.com/static/blogs/fl_bias/fama_1970.pdf), [Econlib](https://www.econlib.org/library/Enc/EfficientCapitalMarkets.html) | Abstract / intro | Weak, semi-strong and strong forms; efficiency "stands up well" |
| 2 | Fama (1991), Efficient Capital Markets: II, *J. Finance* 46(5) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/p/hal/journl/hal-01618347.html) | Catalogue | Revisited semi-strong evidence; joint-hypothesis framing (with BKM) |
| 3 | Grossman & Stiglitz (1980), *AER* 70(3) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org:443/p/cla/levarc/1908.html), [CiNii](https://cir.nii.ac.jp/crid/1130000794301884928) | Catalogue + summaries | Why some inefficiency must persist |
| 4 | Shleifer & Vishny (1997), The Limits of Arbitrage, *J. Finance* 52(1) | Peer-reviewed | [NBER w5167](https://www.nber.org/papers/w5167), [Harvard](https://shleifer.scholars.harvard.edu/publications/limits-arbitrage) | Abstract | Arbitrage is risky and capital-limited; where anomalies persist |
| 5 | Barberis, Shleifer & Vishny (1998), *JFE* 49 | Peer-reviewed | [NBER w5926](https://www.nber.org/papers/w5926), [Harvard](https://shleifer.scholars.harvard.edu/publications/model-investor-sentiment) | Abstract | Conservatism and representativeness, underreaction and overreaction |
| 6 | Daniel, Hirshleifer & Subrahmanyam (1998), *J. Finance* 53(6) | Peer-reviewed | [Deep Blue (U. Michigan)](https://deepblue.lib.umich.edu/items/82bda098-6737-4b4d-8995-2dcf0ee82e55), [CFA Institute digest](https://rpc.cfainstitute.org/en/research/cfa-digest/1999/05/investor-psychology-and-security-market-under--and-overreactions-digest-summary) | Abstract + digest | Overconfidence and self-attribution, momentum then reversal |
| 7 | Hong & Stein (1999), *J. Finance* 54(6) | Peer-reviewed | [IDEAS/RePEc (NBER 6324)](https://ideas.repec.org/p/nbr/nberwo/6324.html), [Harvard](https://stein.scholars.harvard.edu/publications/unified-theory-underreaction-momentum-trading-and-overreaction-asset-markets) | Abstract | News-watchers and momentum traders |
| 8 | McLean & Pontiff (2016), *J. Finance* | Peer-reviewed | [Ivey (author copy)](https://ivey.uwo.ca/media/3775549/pontiff.pdf), [Boston College](https://www.bc.edu/content/bc-web/schools/carroll-school/news/2017/pontiff-paper.html) | Abstract | 26% lower out of sample, 58% after publication |
| 9 | Hou, Xue & Zhang (2020), Replicating Anomalies, *RFS* 33(5) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/oup/rfinst/v33y2020i5p2019-2133..html) | Abstract | 65% / 82% fail; anomalies weak in value-weighted, large stocks |
| 10 | Novy-Marx & Velikov (2016), *RFS* 29 | Peer-reviewed | [NBER w20721](https://nber.org/papers/w20721), [Rochester (author)](https://mysimon.rochester.edu/novy-marx/research/ToAatTC.pdf) | Abstract | 50% monthly turnover threshold; buy/hold spread |
| 11 | Frazzini, Israel & Moskowitz (2018), Trading Costs | Working paper | [SSRN 3229719](https://papers.ssrn.com/abstract=3229719), [Yale Insights](https://insights.som.yale.edu/insights/how-big-investors-avoid-market-predators-and-keep-trading-costs-low) | Abstract | Real costs an order of magnitude below estimates; price impact dominates |
| 12 | Chordia, Subrahmanyam & Tong (2014), *J. Accounting & Economics* 58(1) | Peer-reviewed | [SMU InK](https://ink.library.smu.edu.sg/lkcsb_research/4735) | Abstract | Anomaly returns roughly halved after decimalization (disputed) |
| 13 | Jegadeesh & Titman (1993), *J. Finance* 48(1) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v48y1993i1p65-91.html) | Abstract | 3-12 month momentum; partial reversal in years 2-3 |
| 14 | Asness, Moskowitz & Pedersen (2013), *J. Finance* 68(3) | Peer-reviewed | [NYU Stern (author)](https://pages.stern.nyu.edu/~lpederse/papers/ValMomEverywhere.pdf), [AQR data](https://www.aqr.com/Insights/Datasets/Value-and-Momentum-Everywhere-Original-Paper-Data?aqrPDF=1) | Abstract | Momentum in 8 markets; negative correlation with value |
| 15 | Israel & Moskowitz (2013), *JFE* 108 | Peer-reviewed | [AQR](https://www.aqr.com/Insights/Research/Journal-Article/The-Role-of-Shorting-Firm-Size-and-Time-on-Market-Anomalies), [IDEAS](https://ideas.repec.org/a/eee/jfinec/v108y2013i2p275-301.html) | Abstract | Momentum unrelated to size; value weak in large caps |
| 16 | Moskowitz & Grinblatt (1999), *J. Finance* 54(4) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v54y1999i4p1249-1290.html) | Abstract | Industry momentum explains much of stock momentum |
| 17 | Daniel & Moskowitz (2016), Momentum Crashes, *JFE* 122(2) | Peer-reviewed | [NBER w20439](https://www.nber.org/papers/w20439), [Columbia](https://business.columbia.edu/sites/default/files-efs/pubfiles/4607/mom11.pdf) | Abstract | Crashes in panic states; dynamic version roughly doubles Sharpe |
| 18 | Avramov, Chordia & Goyal (2006), *J. Finance* 61(5) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v61y2006i5p2365-2394.html), [NY Fed SR303](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr303.html) | Abstract | Reversal concentrated in illiquid stocks; profits below costs |
| 19 | Nagel (2012), Evaporating Liquidity, *RFS* 25(7) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/oup/rfinst/v25y2012i7p2005-2039.html), [NBER 17653 via IDEAS](https://ideas.repec.org:443/p/nbr/nberwo/17653.html) | Abstract | Reversal = liquidity provision; predictable with VIX, spikes in turmoil |
| 20 | Da, Liu & Schaumburg (2014), *Management Science* 60(3) | Peer-reviewed | [INFORMS](https://pubsonline.informs.org/doi/fpi/10.1287/mnsc.2013.1766), [IDEAS](https://ideas.repec.org/a/inm/ormnsc/v60y2014i3p658-674.html) | Abstract | Non-news moves reverse more; about 4x risk-adjusted return |
| 21 | Ang, Hodrick, Xing & Zhang (2006), *J. Finance* 61(1) | Peer-reviewed | [Columbia](https://business.columbia.edu/faculty/research/cross-section-volatility-and-expected-returns), [NBER w10852](https://www.nber.org/system/files/working_papers/w10852/w10852.pdf) | Abstract | High idiosyncratic volatility, low returns |
| 22 | Frazzini & Pedersen (2014), Betting Against Beta, *JFE* 111(1) | Peer-reviewed | [NBER conference copy](https://conference.nber.org/confer/2010/BEf10/Frazzini.pdf), [CBS (publisher version)](https://research-api.cbs.dk/ws/portalfiles/portal/60082899/lasse_heje_pedersen_et_al_betting_against_beta_publishersversion.pdf) | Abstract | Leverage constraints, low-beta premium |
| 23 | Asness, Frazzini & Pedersen (2019), Quality Minus Junk, *Rev. Accounting Studies* 24(1) | Peer-reviewed | [SSRN 2312432](https://papers.ssrn.com/abstract=2312432), [IDEAS](https://ideas.repec.org/a/spr/reaccs/v24y2019i1d10.1007_s11142-018-9470-2.html) | Abstract | Quality earns high risk-adjusted returns |
| 24 | Bernard & Thomas (1989), *J. Accounting Research* 27 | Peer-reviewed | [Wikipedia PEAD page (citation)](https://en.wikipedia.org/wiki/Post%E2%80%93earnings-announcement_drift) | Catalogue | Classic PEAD (secondary numbers unverified) |
| 25 | Martineau (2022), Rest in Peace PEAD, *Critical Finance Review* 11 | Peer-reviewed | [CFR (author/journal)](https://cfr.ivo-welch.info/published/papers/martineau2021rest.pdf), [IDEAS](https://ideas.repec.org/a/now/jnlcfr/104.00000122.html), [UCLA Anderson brief](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again/) | Abstract + brief | PEAD gone in large caps since 2006; 2025 dispute |
| 26 | Chan, Jegadeesh & Lakonishok (1996), Momentum Strategies, *J. Finance* 51(5) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v51y1996i5p1681-1713.html), [CFA Institute digest](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1997/dig-v27-n3-113-pdf.pdf) | Abstract + digest | Price and earnings momentum; sluggish analysts |
| 27 | Savor & Wilson (2016), *J. Finance* 71(1) | Peer-reviewed | [Wharton working paper](https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Draft20111215p_edited.pdf), [SUFE index](https://academicnewsletter.sufe.edu.cn/info/359814) | Abstract | Earnings-announcement premium as systematic risk |
| 28 | Bessembinder (1992), *RFS* 5(4) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/oup/rfinst/v5y1992i4p637-67.html) | Abstract | Hedging pressure in currency and farm futures |
| 29 | de Roon, Nijman & Veld (2000), *J. Finance* 55(3) | Peer-reviewed | [Tilburg](https://research.tilburguniversity.edu/en/publications/hedging-pressure-effects-in-futures-markets/), [IDEAS](https://ideas.repec.org/a/bla/jfinan/v55y2000i3p1437-1456.html) | Abstract | Own- and cross-market hedging pressure in 20 futures |
| 30 | Moskowitz, Ooi & Pedersen (2012), Time Series Momentum, *JFE* 104(2) | Peer-reviewed | [SSRN 2089463](https://papers.ssrn.com/abstract=2089463), [Yale course copy](https://fairmodel.econ.yale.edu/ec439/jpde.pdf) | Abstract | Speculators profit at hedgers' expense (CFTC data) |
| 31 | Coval & Stafford (2007), *JFE* 86(2) | Peer-reviewed | [NBER w11357](https://www.nber.org/papers/w11357), [NY Fed conference copy](https://www.newyorkfed.org/medialibrary/media/research/conference/2005/liquidity/Coval_Stafford.pdf) | Abstract | Flow-driven fire sales; liquidity providers earn returns |
| 32 | Lou (2012), *RFS* 25(12) | Peer-reviewed | [LSE Research Online](https://researchonline.lse.ac.uk/id/eprint/46328), [IDEAS](https://ideas.repec.org/a/oup/rfinst/v25y2012i12p3457-3489.html) | Abstract | Temporary flow-induced price pressure; part of momentum |
| 33 | Boehmer, Jones & Zhang (2008), *J. Finance* 63(2) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v63y2008i2p491-527.html) | Abstract | Heavily shorted stocks lag by 1.16% in 20 days |
| 34 | Diether, Lee & Werner (2009), *RFS* 22(2) | Peer-reviewed | [IDEAS/RePEc](https://ideas.repec.org/a/oup/rfinst/v22y2009i2p575-607.html), [NBER conference copy](https://users.nber.org/~confer/2005/mmf05/werner.pdf) | Abstract | Short sellers trade on short-term overreaction |
| 35 | Asquith, Pathak & Ritter (2005), *JFE* 78(2) | Peer-reviewed | [Ritter (U. Florida)](https://site.warrington.ufl.edu/ritter/files/2015/04/Short-interest-institutional-ownership-and-stock-returns-2005-08.pdf), [IDEAS](https://ideas.repec.org/a/eee/jfinec/v78y2005i2p243-276.html) | Abstract | Short-interest effect weak when value-weighted |
| 36 | FINRA, short-sale volume data pages and 2019 information notice | Regulator documentation | [FINRA monthly/daily files](https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/monthly-short-sale-volume-files), [TRF Reg SHO](https://www.finra.org/filing-reporting/trf/trf-regulation-sho-2019), [OTC Markets commentary](https://blog.otcmarkets.com/2023/05/08/what-investors-should-know-about-finra-daily-short-sale-volume-data/) | Summary of pages | Short volume is not short interest; market-making and reporting caveats |
| 37 | Pan & Poteshman (2006), *RFS* 19(3) | Peer-reviewed | [NBER w10925](https://www.nber.org/papers/w10925) | Abstract | Option-volume put-call ratios predict returns (non-public classification) |
| 38 | Lucca & Moench (2015), *J. Finance* 70(1) | Peer-reviewed / Fed | [NY Fed Staff Report 512](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr512.pdf), [IDEAS](https://ideas.repec.org/a/bla/jfinan/v70y2015i1p329-371.html) | Abstract | Pre-FOMC drift 1994-2011 |
| 39 | Kurov, Wolfe & Gilbert (2021), *Finance Research Letters* 40 | Peer-reviewed | [Skidmore (author copy)](https://www.skidmore.edu/economics/documents/KurovWolfeGilbert-TheDisappearingPre-FOMC-Announce-Drift-200914.pdf), [IDEAS](https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html) | Abstract | Drift essentially gone after 2015 |
| 40 | Cieslak, Morse & Vissing-Jorgensen (2019), *J. Finance* 74(5) | Peer-reviewed | [SSRN 2687614](https://papers.ssrn.com/abstract=2687614), [BIS conference copy](https://www.bis.org/events/conf150310/cieslak_morse_vissing.pdf) | Abstract | Equity premium earned in even FOMC-cycle weeks |
| 41 | Cochrane (2011), Discount Rates, *J. Finance* 66 | Peer-reviewed | [NBER w16972](https://www.nber.org/papers/w16972.pdf), [author page](https://www.johnhcochrane.com/research-all/discount-rates) | Abstract | Time-varying expected returns dominate price variation |
| 42 | Welch & Goyal (2008), *RFS* 21(4) | Peer-reviewed | [NBER w10483](https://nber.org/papers/w10483), [SFI 2022 update](https://sfi.ch/en/publications/a-comprehensive-2022-look-at-the-empirical-performance-of-equity-premium-prediction) | Abstract | Market-timing predictors fail out of sample |
| 43 | Gilchrist & Zakrajšek (2012), *AER* 102(4) | Peer-reviewed | [NBER w17021](https://www.nber.org/papers/w17021) | Abstract | Excess bond premium predicts activity and asset prices |
| 44 | Cederburg, O'Doherty, Wang & Yan (2020), *JFE* 138 (with Moreira & Muir 2017 and DeMiguel et al. 2024 via citing pages) | Peer-reviewed | [Lehigh (author copy)](https://www.lehigh.edu/~xuy219/research/COWY.pdf), [LBS (DeMiguel et al.)](https://lbsresearch.london.edu/id/eprint/3716) | Abstract | Volatility management does not reliably beat unmanaged out of sample; disputed |
| 45 | Kelly (1956), *Bell System Technical Journal* 35(4) | Peer-reviewed | [Internet Archive](https://archive.org/details/bstj35-4-917), [Nokia Bell Labs](https://nokia.com/bell-labs/publications-and-media/publications/a-new-interpretation-of-information-rate) | Catalogue + summary | Log-optimal betting; growth rate = information rate |
| 46 | Thorp (2006), The Kelly Criterion in Blackjack, Sports Betting and the Stock Market | Handbook chapter | [IDEAS/RePEc (World Scientific chapter)](https://ideas.repec.org/h/wsi/wschap/9789814293501_0054.html), [Occidental College copy](https://sites.oxy.edu/lengyel/M330/thorp/paper.htm) | Abstract | Kelly applied to stocks |
| 47 | MacLean, Thorp & Ziemba (2010), *Quantitative Finance* 10(7) | Peer-reviewed | [Berkeley course copy](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf), [IDEAS chapter](https://ideas.repec.org/h/wsi/wschap/9789814293501_0039.html) | Abstract + summary | Good and bad Kelly properties; zero growth at 2x Kelly; fractional Kelly |
| 48 | Van Tharp (1998), *Trade Your Way to Financial Freedom* | Practitioner book | [Van Tharp newsletter](https://vantharp.com/Tharps-Thoughts/639_July_24_2013.html), [TraderLion summary](https://www.traderlion.com/risk-management/r-and-r-multiples/) | Secondary | R-multiples and expectancy |
| 49 | Lo (2002), The Statistics of Sharpe Ratios, *Financial Analysts Journal* 58(4) | Peer-reviewed (CFA Institute) | [CFA Institute](https://rpc.cfainstitute.org/research/financial-analysts-journal/2002/the-statistics-of-sharpe-ratios), [IDEAS](https://ideas.repec.org/a/taf/ufajxx/v58y2002i4p36-52.html) | Abstract | √12 annualisation invalid; overstatement above 65% |
| 50 | Bailey & López de Prado (2012/13), The Sharpe Ratio Efficient Frontier, *J. Risk* 15(2) | Peer-reviewed | [Risk.net](https://www.risk.net/journal-risk/2223785/sharpe-ratio-efficient-frontier), [IDEAS](https://ideas.repec.org/a/rsk/journ4/2223785.html) | Abstract | Probabilistic Sharpe; minimum track-record length rises with negative skew and fat tails |
| 51 | Magdon-Ismail & Atiya (2004), Maximum Drawdown, *Risk* 17(10); with Magdon-Ismail et al., *J. Applied Probability* 41 | Peer-reviewed / trade journal | [SSRN 874069](https://papers.ssrn.com/abstract=874069), [Cambridge](https://www.cambridge.org/core/journals/journal-of-applied-probability/article/on-the-maximum-drawdown-of-a-brownian-motion/F9E3B8A454B020DDEBF0AC3390EF7807) | Abstract | Expected max drawdown scaling with record length |
| 52 | Sortino & Price (1994), *Journal of Investing* | Peer-reviewed (practitioner journal) | [R PerformanceAnalytics docs (citation)](https://www.rdocumentation.org/packages/PerformanceAnalytics/versions/2.0.4/topics/SortinoRatio) | Catalogue | Downside deviation and minimum acceptable return |
| 53 | Grinold (1989), The Fundamental Law of Active Management, *J. Portfolio Management*; Grinold & Kahn, *Active Portfolio Management* | Peer-reviewed / textbook | [New Frontier Advisors note](https://newfrontieradvisors.com/media/1744/fundamental-law-september-2019.pdf), [CFI summary](https://corporatefinanceinstitute.com/resources/capital-markets/fundamental-law-of-active-management/) | Secondary | IR ≈ IC x √breadth; independence of bets |
| 54 | Ilmanen (2011), *Expected Returns*, Wiley | Textbook | [Wiley](https://gov.wiley.com/WileyCDA/WileyTitle/productCd-1119990726,descCd-authorInfo.html), [library catalogue](https://discover.knoxcountylibrary.org/oreilly/ocn756501425) | Publisher description | Framing: blend history, theory and current conditions; time-varying returns |
| 55 | Bodie, Kane & Marcus, *Investments* / *Essentials of Investments* (McGraw-Hill), performance evaluation chapter | Textbook | [ISEG Lisbon course slides](https://fenix.iseg.ulisboa.pt/downloadFile/281608120713035/Cap4.PortEval.pdf) | Course slides | Sharpe vs Treynor vs M² vs information ratio; when each fits |
| 56 | CFA Institute Level III curriculum, performance appraisal (via AnalystPrep study notes) | Professional curriculum (secondary) | [AnalystPrep](https://analystprep.com/study-notes/cfa-level-iii/risk-based-measures-of-performance-appraisal-2/) | Secondary | Sortino, capture ratios, max drawdown and its limits |
| 57 | Ang & Chen (2002), Asymmetric Correlations of Equity Portfolios, *JFE* 63 | Peer-reviewed | [Columbia](https://drupalgsb-test.paas.cc.columbia.edu/sites/default/files-efs/pubfiles/1516/corr.pdf), [SUFE index](https://academicnewsletter.sufe.edu.cn/info/357811) | Abstract | Correlations much higher in down markets |
| 58 | Nasdaq-100 sector weights (Invesco page 2026-10-20; ChartRow July 2026; Nasdaq NDXT factsheet) | Index / fund data | [Invesco](https://www.invesco.com/uitml/product-detail?trustId=QQQG0264), [ChartRow](https://chartrow.com/nasdaq-100/sector-weights), [Nasdaq](https://www.nasdaq.com/docs/index/ndxt) | Secondary | About 58-59% technology; top three sectors 82% |

**Count:** 58 entries, of which 50 are primary academic or official sources (peer-reviewed papers, working papers,
Fed staff reports, regulator documentation) and the rest are textbooks, a practitioner book and secondary data
pages. **Archives and publishers used (more than 10):** IDEAS/RePEc, NBER, SSRN, Federal Reserve Bank of New York, AQR,
CFA Institute (FAJ and Digest), journal and publisher sites (INFORMS, Risk.net, Cambridge, Critical Finance
Review / now publishers, Wiley), Internet Archive, university repositories (Harvard, Michigan Deep Blue, LSE,
SMU, Tilburg, Columbia), FINRA and BIS.
