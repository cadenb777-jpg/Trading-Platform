# Time frames: what the econometrics says about 1-hour, daily and weekly trading (research notes)

Written 2026-10-24 for the multi-time-frame scanner (helper v20: `strategies.HORIZONS` short / swing / position, and
the strategy lab in `helper/engine/lab.py`). The question: **how do returns, volatility and news behave at each
horizon, how should the tests be run at each horizon, and over what horizon does a signal's information fade?**

This note does not repeat its sister notes. It covers time-series and microstructure evidence, not:

- trend rules, exits and chart patterns (`docs/research/trend-and-charts.md`, branch `conductor/1b-trend`);
- Larry Williams and COT (`docs/research/williams-cot.md`, branch `conductor/1-williams`);
- general backtest statistics: p-values, multiple testing, PBO, costs (`docs/research/backtest-statistics.md`,
  branch `conductor/1c-stats`); and what the scanner already does (`docs/research/setups-statistics.md`).

How to read this:

- **Page fetches were blocked in this session** (the network could not resolve publisher hosts, e.g. nber.org), so
  no full text was opened. Every finding comes from **search-engine summaries of abstracts and landing pages**
  (journal, NBER, RePEc/IDEAS, SSRN, arXiv, Federal Reserve, CFA Institute, university repositories). The
  "Access" column of the source table says this for each source.
- A number whose only source is a third party (blog, thesis, later paper) is marked *(unverified)*.
- Two results in this note are **our own computations** on the scanner's code, not literature. They are labelled
  *(our simulation)*, with the script described in section 4, so anyone can rerun them.
- No quotes are given (nothing could be read word for word), and no numbers are invented.

---

## 1. Ten things a beginner must know

1. **The sign of predictability flips with the horizon.** Over days to a month, single stocks tend to *reverse*
   (losers bounce, winners give back). Over 3-12 months they tend to *continue* (momentum). Over 3-5 years they
   reverse again. A signal built for one horizon can be wrong at another. (Section 2.2-2.4.)
2. **For big, heavily traded stocks like the Nasdaq-100 the short-term reversal is weak, and can even flip to
   short-term momentum.** Much of the classic one-week reversal was bid-ask bounce in small stocks, and it pays
   mainly in panics (high VIX). Do not assume "buy the dip" works on its own in mega-caps. (2.2.)
3. **Inside the day, time of day matters.** A stock's return in a given half hour tends to repeat at the *same*
   half hour on following days, and the market's first half hour (with the overnight gap) helps predict the last
   half hour. The overnight gap and the trading day behave like two different assets. (2.1.)
4. **Volatility clusters and is predictable; direction mostly is not.** Calm follows calm and storms follow storms
   at every horizon. That is why stops and targets sized in ATR from the same bar size are the right idea. (2.5.)
5. **"Multiply daily volatility by the square root of time" is only a rough rule.** It fails when returns are
   autocorrelated or volatility clusters. Measure volatility on the bar size you trade. (2.5.)
6. **Markets change regime.** Calm-trending and volatile-choppy periods alternate, and relationships break. A short
   history (a few months) may show only one regime. (2.6.)
7. **Calendar effects are real but small, fragile and easy to fake.** Turn of the month, pre-holiday and Monday
   effects were found in old data; several weakened or vanished after publication, and many were luck once all the
   calendar rules tried are counted. If used at all, they must be defined exactly as published. (2.7.)
8. **Scheduled news days carry much of the stock market's return.** Macro announcement days, the run-up to Fed
   decisions and earnings days have historically earned outsized returns, but the pre-Fed drift has faded since
   2015 and the post-earnings drift for large stocks may be gone. Trades that span these days carry extra risk
   and a different distribution. (2.8.)
9. **Many overlapping or same-day observations are not many independent ones.** Thirty trades opened on the same
   sell-off are closer to one bet. Ordinary t-statistics and simple shuffles overstate certainty; the fix is to
   count independent dates (or use Newey-West / clustered errors). (2.9.)
10. **Every edge has a half-life.** Published anomalies lose about half their returns after publication, and
    many weakened in the high-liquidity era after 2001. Re-test on recent data and expect less than the backtest.
    (2.10.)

The recommendations for the scanner are in section 3 (five, each with a test). Sources are in section 5.

---

## 2. Findings by horizon

### 2.1 Intraday (minutes to hours): periodicity, opening and closing half hours, overnight vs day

- **Same-time-of-day continuation.** Heston, Korajczyk & Sadka (2010, *Journal of Finance*) split the day into 13
  half hours. A stock's return in one half hour is *negatively* related to the next few half hours (bid-ask bounce,
  thin liquidity), but *positively* related to the same half hour on following days (lags of 13, 26, 39 ...), for
  at least 40 trading days. The pattern is strongest, though not only, in the first and last half hours, and is not
  explained by volume, volatility, spreads, size or S&P 500 membership [S11]. A later study found it in the UK and
  Brazil but weaker in China [S11b]. Bogousslavsky (2016, *JF*) gives a mechanism: traders who rebalance at fixed
  intervals create autocorrelation that turns positive at the rebalancing horizon and seasonality in the
  cross-section [S14].
- **The first half hour predicts the last half hour (market level).** Gao, Han, Li & Zhou (2018, *Journal of
  Financial Economics*): the S&P 500 ETF's return from the previous close through the first half hour predicts the
  last half hour, 1993-2013; stronger on volatile, high-volume, recession and macro-news days; also in ten other
  ETFs [S12]. Baltussen, Da, Lammers & Martens (2021, *JFE*) confirm a last-30-minute continuation in 60+ futures,
  1974-2020, tie it to gamma hedging by option dealers and leveraged ETFs, and find it **reverses over the
  following days** [S13]. *Disagreement:* one practitioner write-up could not reproduce an exploitable intraday
  momentum in its own tests [S15b, unverified]. Either way this is a *market*-level, last-half-hour effect; the
  scanner's 1-hour bars and 1-3 day holds cannot capture it.
- **Overnight and intraday returns are different animals.** Lou, Polk & Skouras (2019, *JFE*): across 14 trading
  strategies, profits are earned either entirely overnight (momentum and some reversal strategies) or entirely
  intraday, usually with opposite signs; the effect is stronger in large, high-priced stocks, and they link it to
  institutions trading during the day against momentum [S15]. Kelly & Clark (2011, *Journal of Asset Management*)
  and the Cliff, Cooper & Gulen working paper report that broad equity returns were earned mostly overnight, with
  near-zero intraday returns [S16; Cliff et al. seen only via secondary pages, *unverified*]. Branch & Ma report
  that intraday returns tend to reverse the overnight move, weaker in 2011-2017 and **absent in S&P 500 names**
  [S16b, secondary only, *unverified*].
- **Intraday volatility has a strong daily shape.** Andersen & Bollerslev (1997, *Journal of Empirical Finance*):
  intraday periodicity in volatility is so strong that volatility dynamics can only be seen after removing it
  [S19]. Tsay's textbook (ch. 5) covers the microstructure side: bid-ask bounce and nonsynchronous trading create
  spurious negative autocorrelation at very short horizons [T2].

**What this means at 1-hour bars:** the first regular-session bar of each day contains the overnight gap and the
most volatile half hour, so it is a different kind of bar from 11:30 or 14:30. A rule that treats every hourly bar
alike (z-score, RSI(2), %R, ATR) will fire disproportionately on the opening bar. See recommendation R3.

### 2.2 Daily to one month: short-term reversal, and when it fails

- **The classic finding.** Lehmann (1990, *Quarterly Journal of Economics*): last week's winners tend to lose next
  week and losers gain; he argued the profits survived bid-ask spreads and plausible costs and reflected
  inefficiency in liquidity provision around big moves [S4]. Jegadeesh (1990, *JF*) documented predictable monthly
  returns (negative first-month serial correlation, positive at 12 months) [S5; the detailed autocorrelation
  pattern is from memory and secondary pages, *unverified*]. The scanner's own notes already rely on these two.
- **Disagreement: is it real or a measurement artefact?** Conrad, Gultekin & Kaul (1997, *JBES*): using bid prices
  removes all reversal profits for Nasdaq-NMS stocks and most for NYSE/AMEX stocks; the rest disappear at trivial
  costs [S6]. Lo & MacKinlay (1990, *Review of Financial Studies*): contrarian profits arise largely from
  *cross*-autocorrelation (large stocks lead small ones), not from overreaction [S3]. So the two camps agree that
  a reversal exists in quoted prices, and disagree on whether it is tradable; the deciding factors are the stock's
  spread and the cost of trading.
- **When it pays.** Nagel (2012, *RFS*): reversal returns are the returns to supplying liquidity, they are strongly
  predictable with the VIX, and they rise sharply in turmoil such as 2007-09 [S9]; a follow-up confirmed this with
  large stocks only, 2001-2020 [S9, secondary]. Da, Liu & Schaumburg (2014, *Management Science*): reversal is
  much stronger once returns explained by news (analyst revisions, industry moves) are removed [S10].
- **Large, high-turnover stocks can show short-term momentum instead.** Medhat & Schmeling (2022, *RFS*): sorting on
  last month's return and turnover shows reversal in low-turnover stocks and *momentum* in high-turnover stocks,
  strongest in the largest, most liquid names [S8]. That describes most of the Nasdaq-100. (Already cited in
  `trend-and-charts.md`; here it matters because it means the daily-horizon reversal is *conditional*.)
- **Weaker since 2001.** Chordia, Subrahmanyam & Tong (2014, *Journal of Accounting and Economics*): most anomalies
  roughly halved after decimalization as liquidity and arbitrage grew [S41]; whether short-term reversal is among
  them specifically was not visible in the abstract.

**Cross-check of the key claim** ("short-term reversal in large liquid stocks is weak and conditional"): Conrad et
al. [S6], Medhat & Schmeling [S8] and Nagel [S9] agree from three different angles (spread, turnover, VIX).
Lehmann [S4] is the main dissent, on older and broader data.

### 2.3 Weekly: variance ratios, positive index autocorrelation, and the FOMC cycle

- **Lo & MacKinlay (1988, *RFS*)** built the variance-ratio test: if prices are a random walk, the variance of
  q-week returns is q times the variance of 1-week returns. Weekly returns 1962-1985 rejected the random walk,
  with **positive** serial correlation in weekly and monthly *index and portfolio* returns, mostly from small
  stocks, not fully explained by infrequent trading or changing volatility [S1]. Note the apparent contradiction
  with 2.2: portfolios trend over a week while single stocks slightly reverse. Lo & MacKinlay (1990) explain it with
  cross-autocorrelation between stocks [S3].
- **The test is noisy in small windows.** Lo & MacKinlay's (1989) Monte Carlo study found the variance-ratio test
  reliable under changing volatility [S2]; later work (Tse & Ng, seen only via a summary) reports serious
  under-rejection in the left tail in small samples [S2, *unverified*]. The textbook formula for the standard error
  of the overlapping variance ratio under a random walk is `sqrt(2(2q-1)(q-1) / (3qT))` (Campbell, Lo & MacKinlay,
  ch. 2 [T1]; the formula is from my knowledge of the book, not read in this session). For the lab's settings
  (q = 5, T = 100 bars) that is about **0.22**. *(Our simulation)* on 200 pure random walks using the lab's own
  `variance_ratio` definition: mean 0.96 (biased low), standard deviation 0.216, the 5th-95th percentile range
  0.64-1.35, and the lab's thresholds were crossed by pure noise **42% of the time (< 0.9) and 24% (> 1.1)**. So
  the lab's "mean-reverting" and "trending" regime filters are mostly noise. See R1.
- **The FOMC cycle.** Cieslak, Morse & Vissing-Jorgensen (2019, *JF*): since 1994 the US equity premium was earned
  entirely in even weeks of the FOMC cycle (weeks 0, 2, 4, 6 after a meeting), linked to Fed communication [S35].
  This is a market-wide weekly rhythm; for single stocks it is background risk, not a stock signal.

### 2.4 Monthly to yearly: momentum, then long-term reversal

- Momentum over 3-12 months (Jegadeesh & Titman 1993, cited in `setups-statistics.md`) is followed by **no
  significant reversal in years 2-3 and significant reversal in years 4-5** (Jegadeesh & Titman 2001, *JF*) [S7].
- Combining horizons helps in the cross-section: Han, Zhou & Zhu (2016, *JFE*) build one "trend factor" from
  moving averages of many lengths (short, intermediate, long) and report more than double the Sharpe ratio of the
  separate short-term reversal, momentum and long-term reversal factors [S46]. This is the closest academic
  evidence for "multi-time-frame" analysis: **information from several horizons adds up, but as one combined
  score, not as a chain of yes/no filters.**
- *Disagreement on time-series momentum:* Huang, Li, Wang & Zhou (2020, *JFE*) find little asset-by-asset
  predictability; the pooled t-statistic does not survive bootstrap critical values, and the profits match a simple
  sample-mean strategy [S45]. Defenders (an AQR-affiliated blog, secondary) say replication supports it. The
  disagreement is about **how pooled test statistics are computed** (see 2.9), which is exactly the scanner's
  issue too.
- **Multi-time-frame alignment (weekly trend, daily entry, hourly trigger) as practised by Elder and others has no
  direct academic test that I found.** Its pieces are supported indirectly (momentum at the long horizon,
  reversal at the short one, per 2.2-2.4), as `trend-and-charts.md` also concluded.

### 2.5 Volatility at every horizon: clustering, realized volatility, scaling

- **Clustering.** Engle (1982, *Econometrica*, ARCH) and Bollerslev (1986, *Journal of Econometrics*, GARCH): large
  and small shocks come in clusters; today's variance depends on recent squared shocks and recent variance [S17].
  Tsay (ch. 3) and Hamilton (ch. 21) are the textbook treatments [T2][T3].
- **Realized volatility.** Andersen, Bollerslev, Diebold & Labys (2003, *Econometrica*): summing squared intraday
  returns measures daily volatility well, and a simple long-memory model of log realized volatility forecasts well
  [S18]. Corsi (2009, *Journal of Financial Econometrics*) shows a simple sum of daily, weekly and monthly volatility
  components (the HAR model) mimics long memory and forecasts about as well as complex models [S20]. The lesson for
  us: **recent volatility at several horizons predicts the next period's volatility; one ATR at the trade's own bar
  size is a sensible, simple stand-in.** Nothing needs adding.
- **Square-root-of-time fails.** Diebold, Hickman, Inoue & Schuermann (Penn working paper 97-34): scaling 1-day
  volatility by sqrt(h) is inappropriate under GARCH-type dynamics and overstates the variability of long-horizon
  volatility; fit a model at the horizon you care about [S21]. Lo (2002, *Financial Analysts Journal*): Sharpe
  ratios do not scale by sqrt(time) when returns are serially correlated; overstatement can exceed 65% [S22].
  *Check of our code:* the scanner computes ATR on each time frame's own bars and uses no sqrt-of-time conversion
  (only `sessionsPerBar` for counting calendar days), which matches this advice.

### 2.6 Stationarity and regime shifts

- Hamilton (1989, *Econometrica*): a hidden Markov "regime" switches the parameters of a time series; the model
  infers which regime the data are in [S23]. Its fragility is also documented: re-estimates on revised data
  reproduced the original result only for a particular sample and starting values [S23, secondary].
- Bai & Perron (1998, *Econometrica*; 2003, *Journal of Applied Econometrics*): tests for an unknown number of
  structural breaks at unknown dates, with confidence intervals for the break dates [S24].
- Ang & Timmermann (2012, *Annual Review of Financial Economics*): regime models capture abrupt, persistent shifts
  in mean, volatility and correlation, often matching policy and regulatory changes [S25].
- **Practical meaning:** regimes are persistent (months to years), so a back-test window of a few months
  usually sits in one regime. Detecting a regime well needs long data; a 100-bar variance ratio cannot do it
  (2.3). Nagel's VIX finding (2.2) is a simple, observable regime variable for reversal trades, already loosely
  covered by the lab's market filter and the stats note's regime split.

### 2.7 Calendar effects, by horizon

| Effect | Original evidence | Later evidence | Status |
|---|---|---|---|
| **Turn of the month** (last trading day + first 3 trading days) | Lakonishok & Smidt (1988, *RFS*), 90 years of the Dow: anomalous returns around the turn of the week, month, year and holidays [S26, secondary]. McConnell & Xu (2008, *FAJ*), 1926-2005: investors on average earned the market premium **only** at turns of the month; in 31 of 35 countries; not explained by risk, volume or fund flows [S27] | Maberly & Waggoner (2000, Atlanta Fed): it disappeared in S&P 500 futures and spot after 1990 [S28]. Etula et al. (2020, *RFS*): a month-end payment cycle drives it, with a **reversal (falling prices) a few days before month-end** (T-3/T-4 in versions of the paper) [S29]. Practitioner data to 2024 say it persists [S28, *unverified*] | Real, disputed since 1990; definition matters (trading days, not calendar days) |
| **Pre-holiday** | Ariel (1990, *JF*), 1963-1982: the day before a holiday averaged many times a normal day's return [S30] | Ko & Yang (2024, *Critical Finance Review*), 1983-2019: now only in small firms [S30] | Faded for large stocks |
| **Day of week (Monday)** | French (1980) and Gibbons & Hess (1981), via later papers [S31] | Mehdian & Perry (2001, *JBFA*): negative Monday before 1987, *positive* for large-cap indexes after; Boston Fed (Fortune 1998): weekend drift gone after 1987 [S31] | Gone or reversed for large stocks |
| **Data-snooping check** | - | Sullivan, Timmermann & White (2001, *Journal of Econometrics*): calendar rules that look highly significant alone lose significance once the whole universe of calendar rules searched is accounted for [S32] | The warning that applies to all of the above |

### 2.8 News: macro announcements, the Fed, earnings

- **Macro announcement days.** Savor & Wilson (2013, *JFQA*), 1958-2009: average excess returns and Sharpe ratios
  are much higher on days with scheduled inflation, unemployment or rate news (about 11 bp vs 1 bp per day, over
  60% of the annual equity premium) [S36]. A later NBER survey reports a similar pattern through 2023 [S36,
  secondary].
- **Pre-FOMC drift.** Lucca & Moench (2015, *JF*; NY Fed Staff Report 512): large average equity returns in the 24
  hours before scheduled FOMC decisions, 1994-2011, not seen before other macro releases [S33]. *Disagreement
  with Savor & Wilson:* they put the premium on announcement days in general; Lucca & Moench find it specific to
  the hours before the Fed. **Decay:** Kurov, Wolfe & Gilbert (2021, *Finance Research Letters*) extend to 2019 and
  find the drift essentially disappeared after 2015 [S34].
- **Earnings.** Lamont & Frazzini (2007, NBER w13090 / AQR): stocks earn a premium around scheduled earnings
  announcements, tied to the spike in volume and small-investor buying [S37]. **Post-earnings drift**: Bernard &
  Thomas (1989, *Journal of Accounting Research*) report prices keep drifting in the direction of the surprise for
  about 60 trading days [S38, secondary only, *unverified*]. *Disagreement:* Martineau (2022, *Critical Finance
  Review*) finds the drift **non-existent for large stocks since 2006** [S39]; two 2025 papers argue it is alive,
  and a UCLA paper says the dispute comes from research design choices [S39, secondary].
- **For each horizon:** an hourly trade (1-3 days) can be dominated by one news day; a daily swing trade (about a
  week) has a good chance of spanning a macro release and, four times a year, earnings; a weekly position trade (2-8
  weeks) almost always spans several. The scanner's live grade already refuses Tier A when earnings fall inside the
  hold. Its *historical* record does not exclude such trades (`trades_for` takes every signal). See R4.

### 2.9 How sampling frequency and overlap change the statistics

- **Overlapping returns.** When 5-day returns are computed every day, consecutive observations share 4 days. Newey &
  West (1987, *Econometrica*) give the standard autocorrelation-robust standard error [S42]. Boudoukh, Israel &
  Richardson (2019, *FAJ*) show overlap adds little real information (5-year forecasts from 50 years of data:
  about 10 independent observations become about 12, not 600) and that the usual corrections still overstate
  t-statistics [S44]; with Whitelaw (2008, *RFS*) they show estimates at different horizons are almost perfectly
  correlated under the null [S44]. Cochrane (2008, *RFS*) argues the other side for persistent predictors:
  long-horizon tests can have more power [T4]. *Disagreement noted*; it concerns slow valuation signals, not our
  short holds.
- **Same-date clustering across stocks.** Petersen (2009, *RFS*) shows that residuals correlated across firms in the
  same period (a "time effect") bias ordinary standard errors, and compares clustering by firm, by time and both;
  Thompson (2011) argues clustering by time removes most of the bias when there are many more firms than periods
  [S43]. The pooled scanner record is exactly such a panel: ~100 stocks, trades on the same dates.
- *(Our simulation, confirming `backtest-statistics.md` R1):* 60 simulated universes of 40 stocks with a common
  market factor and **no predictability at all**, a signal that fires on market-wide dips (so trades cluster on the
  same dates), scored with the scanner's own `random_entry_test`. The test reported p <= 0.10 in **37%** of
  universes instead of the expected 10%. Drawing one random date per real signal date (so the random trades
  cluster like the real ones) gave **7%**, close to the expected rate. This independently supports the sister
  note's recommendation to cluster by date; it is not repeated as a recommendation here.
- **Effective sample size per horizon.** An hourly history of about 6 months (`hourly_history` asks Schwab for 180
  calendar days) is about 124 sessions; after the 210-bar warm-up (`trades_for` starts at bar 210, about 30
  sessions of hourly bars) roughly **95 sessions (4-5 months) are tradable**. Over 1-3 day holds and with
  market-wide clustering, the number of independent market episodes in that sample is in the tens, not
  thousands. The lab's three unseen windows (15% of history each) are about **three weeks each** on hourly data.
  See R5.

### 2.10 How fast does a signal's information decay?

| Signal | Horizon over which it works | Decay / reversal | Sources |
|---|---|---|---|
| Bid-ask bounce, intraday order flow | minutes to the next half hours | reverses within the day | [S11][T2][S6] |
| Same-time-of-day pattern | daily lags, at least 40 days | slow | [S11][S14] |
| First half hour -> last half hour (market) | same day | reverses over following days | [S12][S13] |
| Pre-FOMC | 24 hours | faded after 2015 | [S33][S34] |
| Turn of month | 4 trading days | disputed after 1990 | [S27][S28][S29] |
| Short-term reversal (single stocks) | 1 week to 1 month | weak in large high-turnover stocks; strong when VIX high | [S4][S5][S8][S9] |
| Post-earnings drift | up to ~60 trading days (*unverified*) | possibly gone for large stocks since 2006 | [S38][S39] |
| Momentum | 3-12 months | no reversal years 2-3, reversal years 4-5 | [S7] |
| Any published anomaly | - | about 58% lower after publication (26% lower out of sample) | McLean & Pontiff 2016 [S40] |

**A simple way to measure decay in our own data** (used in R3-R5): for a strategy's signals, compare the average
forward return at holds of 1, 2, 4 ... up to 2x `maxHold` bars against random entries on the *same dates*. The hold
where the gap peaks is the signal's horizon; a gap that keeps growing means the hold is too short, one that
shrinks after a bar or two means it is too long.

---

## 3. What this means for our scanner (five recommendations)

Simplicity first: three remove or fix, two are checks that decide whether something stays. All are testable with
the existing tools. The clustering fix to `random_entry_test` from `backtest-statistics.md` R1 should be done
**first**, because every test below uses that p-value, and section 2.9 shows that without it a no-edge strategy
"passes" far too often.

### R1. Remove the lab's variance-ratio regime filters (`reverting`, `trending`)

- **Why:** with q = 5 over 100 bars the variance ratio's sampling noise (standard deviation about 0.22) is larger
  than the gap between the thresholds (0.9 / 1.1) and 1.0. On pure random walks the filters switch on 42% and 24%
  of the time *(our simulation)*. They make up 21 of the 67 filter combinations tried per trigger and side (about 30% of the lab's ~1,474
  candidates, including the impossible pair of both), which means more tries, a higher luck bar and a worse PBO,
  without measuring a regime. Regimes are persistent and need long data to detect
  [S1][S2][S23][S25][T1].
- **What changes:** delete the two entries from the lab's filter list (`FILTERS` and `_filter` in `lab.py`; `variance_ratio` can then go too
  unless something else uses it). No replacement; the market filter (QQQ vs its 50-day average) is a cleaner,
  observable regime variable.
- **Test:** run the lab on each time frame with and without the two filters. Pass if (a) the number of survivors
  that use them is zero or their unseen-period random-entry p (clustered) is no better than the median survivor,
  and (b) PBO does not get worse after removing them. Also add a synthetic test in `helper/tests`: on random walks,
  a "regime" defined by these filters must not validate.

### R2. Fix the turn-of-the-month filter to trading days, as published; drop it on weekly bars

- **Why:** the published window is the **last trading day plus the first three trading days** [S26][S27]. The lab's
  `tom` filter is described as "last 2 / first 3 days" but uses calendar days (`day >= 28 or day <= 3`), so in a 31-day month it can include days 28-30, which are
  the T-3/T-4 pre-month-end days where Etula et al. found prices *falling* [S29]; after a weekend it can also miss
  first trading days (e.g. the 4th). On **weekly** bars the filter tests the date of the bar's first day, which has
  no meaning. Calendar effects are also the textbook case of data snooping [S32], and this one is disputed after
  1990 [S28].
- **What changes:** compute the trading-day position within the month from the bar dates (last session of the month
  = -1, first sessions = 1, 2, 3); filter = -1 or 1-3. Apply on daily and hourly bars only.
- **Test:** pooled random-entry test (clustered) for each trigger with the fixed filter vs the old one vs no filter,
  on the swing time frame. Keep the fixed filter in the lab only if the lab still finds it in 2+ walk-forward windows;
  if no survivor uses it after six months of lab runs, remove it altogether.

### R3. Hourly time frame: check, and if needed stop, signals that fire on the opening bar

- **Why:** the 9:30 bar holds the overnight gap and the most volatile half hour [S15][S16][S19]; overnight and
  intraday returns follow different rules [S15], intraday moves partly reverse the overnight move in smaller stocks
  but not in S&P 500 names [S16b], and same-time-of-day effects exist [S11]. A per-stock percentile of hourly
  z-scores or RSI(2) will therefore treat ordinary opening gaps as "stretched" and fire mostly at the open.
- **What changes (only if the test says so):** on the short time frame, a signal on the first bar of the session is
  ignored (the trade can still trigger on a later bar). Nothing is added.
- **Test:** split the pooled hourly trades of each strategy and side by the hour of the signal bar (9:30, 10:30 ...
  15:30). Report the share of signals per hour and the clustered random-entry p per group. Act if the opening bar
  carries more than its 1/7 share of signals **and** its trades do worse than random entries while the other hours
  together do not. Re-run the lab's short time frame with the change and confirm the survivors' unseen results do
  not get worse.

### R4. Grade on the trades the live rules allow: tag earnings (and FOMC) days in the historical record

- **Why:** live Tier A requires no earnings inside the hold, but the historical record that earns the grade includes
  trades through earnings. Earnings days have their own premium and volatility [S37][S38][S39], and macro and Fed
  days carry outsized returns [S33][S36]. If a strategy's edge comes from the earnings-spanning trades, live A
  setups (which exclude them) will not have it; if those trades are its worst, the record understates it.
- **What changes:** nothing in the rules at first. Tag each historical trade "spans earnings" using past earnings
  dates. (Check first whether the Nasdaq calendar endpoint the scanner already uses returns past dates; if not, SEC
  8-K item 2.02 filing dates from EDGAR, which the engine already reads, are a free proxy. A new data source is
  a cost: use it only if the test is decisive.) Tag "spans FOMC" from the helper's hard-coded FOMC dates (past years
  would need to be added; the list currently holds 2026 only).
- **Test:** pooled clustered random-entry test on (a) all trades, (b) trades not spanning earnings. If (b) differs
  from (a) by more than its own standard error, grade live setups on (b). Same for FOMC, reported only; do **not**
  add an FOMC filter, because the pre-FOMC drift has decayed [S34] and a calendar filter would be one more snooped
  rule [S32].

### R5. Hourly grades need more history, or a lower ceiling

- **Why:** about 95 tradable sessions (4-5 months) of hourly data is one market regime [S23][S25]; trades across
  ~100 stocks cluster on the same few dozen market episodes [S43]; the lab's unseen windows are about three weeks
  each. A Tier A built on that is weaker evidence than the same label on 15 years of daily data, but the page
  shows them alike.
- **What changes (pick one, by test):** (a) ask Schwab for the longest 30-minute history it serves (to be checked;
  `_history` currently asks for 180 days) and cache it so later scans only add new bars; or, if no more is
  available, (b) cap hourly setups at grade B unless the daily (swing) record of the same strategy and side also
  passes. Option (b) removes rather than adds.
- **Test:** on the swing time frame, where long history exists, simulate the problem: grade each strategy using
  only its last 95 sessions of trades, repeatedly over rolling 95-session windows, and count how often that short
  window's verdict (clustered random-entry p <= 0.10) agrees with the full-history verdict. If agreement is poor
  (say below 70%), option (a) or (b) is needed for hourly. For (a), re-run the lab's short time frame on the longer
  history and check PBO and the number of survivors.

---

## 4. Limits and disagreements

- **Nothing was read in full.** All findings rest on abstracts and summaries. Exact figures (11 bp, 58%, 40 days,
  31 of 35 countries) are those abstracts' figures; anything from third parties is marked *(unverified)*.
- **Most evidence is about portfolios, factors or the whole market, not 100 single mega-caps traded with stops.**
  Transfer to our setting is an inference, which is why every recommendation is a test, not a rule.
- **Most studies end before 2020**, and several effects decayed after publication [S40][S41][S34][S39].
- **Disagreements kept open in this note:** reversal real vs bid-ask artefact [S4] vs [S6]; announcement days in
  general vs pre-Fed only [S36] vs [S33]; post-earnings drift dead vs alive [S39]; time-series momentum real vs
  a pooled-statistics artefact [S45]; turn of month gone vs persisting [S28] vs [S27][S29]; overlapping-data
  corrections adequate vs overstated [S42] vs [S44] (and Cochrane's defence [T4]); Hamilton's model robust vs
  fragile [S23].
- **Our two simulations** (variance-ratio noise; random-entry false positives under clustering) use simple
  Gaussian data with a common market factor and a 5-day hold; real data have fat tails and changing volatility,
  which usually make the problems worse, not better. The script: 200 random walks of 1,200 bars for the
  variance ratio; 60 universes x 40 stocks x 1,200 bars, market sd 1.1% and stock sd 1.5% a day, 300 random-entry
  runs each, calling `strategies.random_entry_test` directly. Sixty universes give a rejection-rate standard error
  of about 4 points, enough to tell 37% from 10%, not 7% from 10%.
- No multi-time-frame alignment study was found; that conclusion may reflect search limits.

---

## 5. Sources

Access codes: **abstract** = abstract or landing page seen through search summaries (full text not opened, page
fetches blocked); **secondary** = only third-party descriptions were found; **biblio** = only the citation was
confirmed. No paywalled or pirated copies were used.

| # | Source | Type | Archive / publisher where seen | Access | What it contributed |
|---|---|---|---|---|---|
| S1 | Lo & MacKinlay (1988), "Stock Market Prices Do Not Follow Random Walks", *RFS* 1 | Journal | MIT (author page); RePEc/IDEAS; NBER w2168 | abstract | Variance ratio; positive weekly/monthly portfolio autocorrelation |
| S2 | Lo & MacKinlay (1989), "The Size and Power of the Variance Ratio Test in Finite Samples", *J. Econometrics* 40 | Journal | NBER t0066; MIT | abstract | VR reliability; small-sample caveat (Tse & Ng via summary, unverified) |
| S3 | Lo & MacKinlay (1990), "When Are Contrarian Profits Due to Stock Market Overreaction?", *RFS* 3 | Journal | NBER w2977; MIT | abstract | Cross-autocorrelation, large lead small |
| S4 | Lehmann (1990), "Fads, Martingales, and Market Efficiency", *QJE* 105 | Journal | NBER w2533; RePEc/IDEAS | abstract | Weekly reversal, survives costs (his claim) |
| S5 | Jegadeesh (1990), "Evidence of Predictable Behavior of Security Returns", *JF* 45(3) | Journal | RePEc/IDEAS; Emory interview | biblio + secondary | Monthly predictability; details unverified |
| S6 | Conrad, Gultekin & Kaul (1997), "Profitability of Short-Term Contrarian Strategies", *JBES* 15(3) | Journal | RePEc/IDEAS | abstract | Reversal mostly bid-ask bounce |
| S7 | Jegadeesh & Titman (2001), "Profitability of Momentum Strategies: An Evaluation of Alternative Explanations", *JF* 56(2) | Journal | NBER w7159; RePEc | abstract | Reversal only in years 4-5 |
| S8 | Medhat & Schmeling (2022), "Short-term Momentum", *RFS* 35(3) | Journal | City Research Online (accepted manuscript) | abstract | High-turnover large stocks: short-term momentum |
| S9 | Nagel (2012), "Evaporating Liquidity", *RFS* 25(7) | Journal | NBER w17653 | abstract | Reversal = liquidity provision, predictable with VIX |
| S10 | Da, Liu & Schaumburg (2014), "A Closer Look at the Short-Term Return Reversal", *Management Science* 60(3) | Journal | NY Fed Staff Report 513; RePEc; INFORMS | abstract | Reversal stronger net of news |
| S11 | Heston, Korajczyk & Sadka (2010), "Intraday Patterns in the Cross-Section of Stock Returns", *JF* 65(4) | Journal | arXiv 1005.3535; Kellogg; NBER conference | abstract | Same-half-hour continuation for 40+ days |
| S11b | Chen et al., investor clientele and intraday patterns (UK, China, Brazil) | Journal | Aston University repository | abstract (via summary) | Replication outside the US |
| S12 | Gao, Han, Li & Zhou (2018), "Market Intraday Momentum", *JFE* | Journal | Washington Univ. profile; SUFE listing | abstract | First half hour predicts last |
| S13 | Baltussen, Da, Lammers & Martens (2021), "Hedging Demand and Market Intraday Momentum", *JFE* | Journal | Erasmus repository; Notre Dame PDF listing | abstract | 60+ futures, gamma hedging, reverses later |
| S14 | Bogousslavsky (2016), "Infrequent Rebalancing, Return Autocorrelation, and Seasonality", *JF* 71 | Journal | EPFL Infoscience | abstract | Mechanism for periodicity |
| S15 | Lou, Polk & Skouras (2019), "A Tug of War: Overnight versus Intraday Expected Returns", *JFE* 134 | Journal | LSE Research Online; FMG DP744 | abstract | Overnight vs intraday split of strategy profits |
| S15b | Alpha Architect summary of S15 | Practitioner | alphaarchitect.com | secondary | Dissent on intraday momentum (unverified) |
| S16 | Kelly & Clark (2011), "Returns in Trading versus Non-Trading Hours", *J. Asset Management* 12(2); Cliff, Cooper & Gulen (2008 WP) | Journal / WP | RePEc/IDEAS; LuxAlgo summary | abstract / secondary | Returns earned overnight |
| S16b | Branch & Ma, overnight vs intraday returns (and 2018 retrospective) | WP | CXO Advisory summaries | secondary | Intraday reverses overnight; absent in S&P 500 names (unverified) |
| S17 | Engle (1982), ARCH, *Econometrica* 50(4); Bollerslev (1986), GARCH, *J. Econometrics* 31(3) | Journal | Econometric Society; Duke Scholars | abstract | Volatility clustering |
| S18 | Andersen, Bollerslev, Diebold & Labys (2003), "Modeling and Forecasting Realized Volatility", *Econometrica* 71(2) | Journal | Econometric Society; Kellogg | abstract | Realized volatility |
| S19 | Andersen & Bollerslev (1997), "Intraday Periodicity and Volatility Persistence", *J. Empirical Finance* 4 | Journal | RePEc/IDEAS; NBER w5752; Duke | abstract | Intraday volatility pattern |
| S20 | Corsi (2009), "A Simple Approximate Long-Memory Model of Realized Volatility", *J. Financial Econometrics* 7(2) | Journal | OUP; SSRN 1365738 | abstract | HAR: daily + weekly + monthly volatility |
| S21 | Diebold, Hickman, Inoue & Schuermann (1997), "Converting 1-Day Volatility to h-Day Volatility" | WP | RePEc (Penn 97-34); Penn economics | abstract | Sqrt-of-time scaling fails |
| S22 | Lo (2002), "The Statistics of Sharpe Ratios", *FAJ* 58(4) | Journal | CFA Institute; RePEc/IDEAS | abstract | Sharpe ratios don't scale by sqrt(time) |
| S23 | Hamilton (1989), "A New Approach to the Economic Analysis of Nonstationary Time Series", *Econometrica* 57(2) | Journal | Econometric Society; RePEc; Virginia Tech (Boldin robustness note) | abstract | Regime switching and its fragility |
| S24 | Bai & Perron (1998) *Econometrica* 66(1); (2003) *J. Applied Econometrics* 18(1) | Journal | RePEc/IDEAS; Econometric Society | abstract | Multiple structural breaks |
| S25 | Ang & Timmermann (2012), "Regime Changes and Financial Markets", *Annual Rev. Fin. Econ.* 4 | Journal | NBER w17182; RePEc | abstract | Regimes are persistent and policy-linked |
| S26 | Lakonishok & Smidt (1988), "Are Seasonal Anomalies Real? A Ninety-Year Perspective", *RFS* 1 | Journal | SUFE listing; later papers | abstract + secondary | Turn of month, holidays, weekdays |
| S27 | McConnell & Xu (2008), "Equity Returns at the Turn of the Month", *FAJ* 64(2) | Journal | CFA Institute; RePEc; Purdue | abstract | Exact TOM window; 31 of 35 countries |
| S28 | Maberly & Waggoner (2000), Atlanta Fed WP 2000-11 | WP | Federal Reserve Bank of Atlanta; RePEc | abstract | TOM gone after 1990 (S&P 500) |
| S29 | Etula, Rinne, Suominen & Vaittinen (2020), "Dash for Cash", *RFS* 33(1) | Journal | OUP; Aalto repository; RePEc | abstract (+ WP/slides via summary) | Month-end payment cycle; pre-month-end reversal |
| S30 | Ariel (1990), "High Stock Returns before Holidays", *JF* 45(5); Ko & Yang (2024), *Critical Finance Review* | Journal | RePEc/IDEAS; now publishers / CFR | abstract | Pre-holiday effect and its fading |
| S31 | Mehdian & Perry (2001), *JBFA* 28(7-8); Fortune (1998), Boston Fed WP 98-6 | Journal / WP | RePEc/IDEAS; Federal Reserve Bank of Boston | abstract | Monday effect reversed / gone after 1987 |
| S32 | Sullivan, Timmermann & White (2001), "Dangers of Data Mining: The Case of Calendar Effects", *J. Econometrics* 105 | Journal | LSE Research Online; FMG DP304; RePEc | abstract | Calendar effects vs data snooping |
| S33 | Lucca & Moench (2015), "The Pre-FOMC Announcement Drift", *JF* 70 | Journal | NY Fed Staff Report 512 (RePEc); VoxEU | abstract | 24-hour pre-Fed drift |
| S34 | Kurov, Wolfe & Gilbert (2021), "The Disappearing Pre-FOMC Announcement Drift", *Finance Research Letters* 40 | Journal | Skidmore (author copy); RePEc | abstract | Drift gone after 2015 |
| S35 | Cieslak, Morse & Vissing-Jorgensen (2019), "Stock Returns over the FOMC Cycle", *JF* 74(5) | Journal | SSRN 2687614; NYU Stern; BIS | abstract | Even-week FOMC cycle |
| S36 | Savor & Wilson (2013), "How Much Do Investors Care About Macroeconomic Risk?", *JFQA* 48(2) | Journal | RePEc/IDEAS; Wharton draft | abstract | Announcement-day premium |
| S37 | Lamont & Frazzini (2007), "The Earnings Announcement Premium and Trading Volume", NBER w13090 | WP | NBER; AQR | abstract | Earnings-day premium |
| S38 | Bernard & Thomas (1989), "Post-Earnings-Announcement Drift", *J. Accounting Research* 27 | Journal | Secondary (Wikipedia, theses) | secondary | ~60-day drift (unverified) |
| S39 | Martineau (2022), "Rest in Peace Post-Earnings Announcement Drift", *Critical Finance Review* 11; UCLA Anderson brief | Journal | CFR (ivo-welch.info); RePEc; UCLA | abstract | PEAD gone for large stocks; the dispute |
| S40 | McLean & Pontiff (2016), "Does Academic Research Destroy Stock Return Predictability?", *JF* 71 | Journal | Ivey (author copy); CXO summary | abstract | Post-publication decay 58% / 26% |
| S41 | Chordia, Subrahmanyam & Tong (2014), *J. Accounting and Economics* 58(1) | Journal | SMU repository; Emory; CESifo (Auer & Rottmann challenge) | abstract | Anomalies halved after decimalization |
| S42 | Newey & West (1987), *Econometrica* 55(3) | Journal | NBER t0055; SSRN; Econometric Society | abstract | Autocorrelation-robust standard errors |
| S43 | Petersen (2009), "Estimating Standard Errors in Finance Panel Data Sets", *RFS* 22; Thompson (2011) | Journal | Ohio State-hosted copy; Kellogg; Statalist discussion | abstract + secondary | Time-clustered errors in panels |
| S44 | Boudoukh, Israel & Richardson (2019), "Long-Horizon Predictability: A Cautionary Tale", *FAJ* 75(1); Boudoukh, Richardson & Whitelaw (2008), *RFS* 21 | Journal | RePEc; CFA Institute; NBER w11841 | abstract | Overlap adds little information |
| S45 | Huang, Li, Wang & Zhou (2020), "Time Series Momentum: Is It There?", *JFE* | Journal | Washington Univ.; SMU; HKBU | abstract | Pooled t-stats vs bootstrap |
| S46 | Han, Zhou & Zhu (2016), "A Trend Factor", *JFE* 122(2) | Journal | RePEc/IDEAS | abstract | Combining horizons as one score |
| T1 | Campbell, Lo & MacKinlay (1997), *The Econometrics of Financial Markets*, Princeton UP | Textbook | Project MUSE / library catalogs | biblio (TOC) | Random-walk tests, VR standard error (formula from memory) |
| T2 | Tsay (2010), *Analysis of Financial Time Series*, 3rd ed., Wiley | Textbook | Chicago Booth (author page); O'Reilly | biblio (TOC) | GARCH (ch. 3), microstructure (ch. 5) |
| T3 | Hamilton (1994), *Time Series Analysis*, Princeton UP | Textbook | Estima; Project MUSE | biblio (TOC) | Heteroskedasticity (ch. 21), regimes (ch. 22) |
| T4 | Cochrane (2008), "The Dog That Did Not Bark: A Defense of Return Predictability", *RFS* 21(4) (in place of his *Asset Pricing* textbook, whose contents could not be found) | Journal | johnhcochrane.com | abstract | Counterpoint on long-horizon tests |

**Count:** 53 rows: S1-S46, three supplementary rows (S11b, S15b, S16b) and four textbook rows (T1-T4). Of these,
S15b is a practitioner summary and S5, S16b and S38 are bibliographic or secondary only, so **at least 45 primary
sources were seen at abstract level** (more if the paired rows S16, S17, S24, S30, S31, S43 and S44 are counted
twice). They come from more than six distinct archives and publishers:
NBER, RePEc/IDEAS, SSRN, arXiv, the Econometric Society, CFA Institute, the Federal Reserve (New York, Atlanta,
Boston), OUP, Wiley, Princeton UP, AQR, LSE Research Online, City Research Online, EPFL, Aalto, Erasmus, and author
pages at MIT, Kellogg, Washington University, Skidmore and Ivey.
