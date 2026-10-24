# Testing trading strategies without fooling yourself (research notes)

Written 2026-10-24 for the Setups scanner and strategy lab (helper v20). The question: what do statisticians and
professional quants consider a sound backtest, and how close does our code come? This builds on
`docs/research/setups-statistics.md` (why 1,000 simulations, which simulations, BH, the lab's safeguards) and the
trend research on branch `conductor/1b-trend` (`docs/research/trend-and-charts.md`); it does not repeat them.

How to read this:

- **Access.** Page fetches failed in this session (the fetch tool could not resolve publisher and university hosts),
  so **every source below was read through its abstract, its publisher/archive landing page or search-result
  summaries, not the full text.** The source table (section 6) says so for each one. Books were not read; they
  are described from publisher pages and reviews. Pirate PDF mirrors that turned up in searches were ignored.
- **Numbers.** No number or quote is invented. A number whose only source is a secondary summary is marked
  *(unverified)*. Worked examples that are my own arithmetic are marked *(illustration)*.
- **Code references** are `file:line` on commit a958295 (helper v20).

---

## 1. Ten things a beginner must know

1. **A p-value is not "the chance the strategy is luck".** It says how surprising the result would be *if* there
   were no edge. It does not measure the size of the edge, and a decision should never rest on p < 0.05 alone
   (ASA statement 2016; Harvey 2017).
2. **Every rule you try is a lottery ticket.** Try enough rules and one will look brilliant by chance. Try 7 rule
   settings and you should *expect* one 2-year backtest with an annual Sharpe ratio above 1 even when the true
   Sharpe is 0 (Bailey, Borwein, López de Prado & Zhu 2014). The bar must rise with the number of tries.
3. **In finance the usual bar is too low.** After decades of data mining, a new finding needs a t-statistic above
   about 3, not 2 (Harvey, Liu & Zhu 2016). With a stricter multiple-testing hurdle (t ≈ 2.78), 82% of 452
   published anomalies fail (Hou, Xue & Zhang 2020).
4. **Published edges shrink.** Anomaly returns are 26% lower out of sample and 58% lower after publication
   (McLean & Pontiff 2016). Expect live results to be worse than the backtest, and plan for it.
5. **Count trades honestly.** 30 trades taken on the same day across 30 tech stocks are closer to *one* bet on the
   Nasdaq than to 30 independent bets. Statistics that treat them as independent are too confident.
6. **You need far more trades than you think.** To show an average trade of 0.5% when trades vary by 5% takes
   hundreds of independent trades, not 8 or 30 *(illustration, section 2.5)*.
7. **Out-of-sample data stops being out-of-sample once you use it to choose.** A hold-out that decides which rule
   survives is now part of the selection, and its numbers are biased upward (Bailey et al. on hold-out; Witzany 2021).
8. **A real edge sits on a plateau.** If a rule only works at a 20-day lookback and fails at 18 or 22, it is
   probably noise. Professionals test the neighbourhood of every parameter (Pardo; Chan).
9. **Data you can't see biases you.** Testing today's Nasdaq-100 members over 15 years only tests the winners
   (survivorship bias: Brown, Goetzmann, Ibbotson & Ross 1992). Using any information before it was known is
   look-ahead bias. Both inflate backtests (Chan).
10. **Costs decide whether a fast strategy works at all.** Many anomalies with high turnover stop being
    profitable after costs (Novy-Marx & Velikov 2016). Test at double your estimated costs.

---

## 2. Findings

### 2.1 Hypothesis tests and p-values, and how they are misused

- The American Statistical Association's 2016 statement (Wasserstein & Lazar, *The American Statistician*) gives
  six principles: p-values measure incompatibility of the data with a stated model; they are **not** the
  probability that the hypothesis is true or that the data came from chance alone; decisions should not rest only
  on a threshold; inference needs full reporting; a p-value does not measure effect size or importance; and by
  itself it is a weak measure of evidence. (Wording from secondary summaries of the paper.)
- Harvey's 2017 American Finance Association presidential address applies this to finance: unreported tests,
  unadjusted multiple testing and p-hacking mean many findings won't hold, and **even t > 3 can give many false
  positives when real effects are rare**. He proposes reporting a minimum Bayes factor / "Bayesianized p-value"
  next to the usual p-value. A reviewer notes the proposal is conceptual, not empirically tested.
- *Agreement:* both sources say the same thing about p-values: report the effect size and the number of things
  tried, not just "significant".
- **For us:** every grade should show the effect size (average trade, profit factor) and how many things were
  tried, not just a p-value. The scanner already shows effect sizes; it does not show the number of tries outside
  the lab.

### 2.2 Multiple testing and data snooping

| Method | What it controls | Key idea | Sources |
|---|---|---|---|
| Bonferroni / **Holm** (1979) | Family-wise error (any false positive) | Step-down: sort p-values, compare the k-th smallest with α/(m−k+1). Always at least as powerful as Bonferroni, no assumptions on dependence | Holm 1979 (JSTOR) |
| **Benjamini-Hochberg** (1995) | False discovery rate (share of false positives among discoveries) | Step-up on sorted p-values. Valid for independent tests and, per Benjamini & Yekutieli (2001), under *positive regression dependence* (PRDS); a conservative variant (divide by Σ1/i) is valid under any dependence | BH 1995; BY 2001 (Project Euclid) |
| **White's Reality Check** (2000) | Is the *best* of many rules better than a benchmark, allowing for the search? | Bootstraps the whole universe of rules jointly, so the correlation between rules is kept | White 2000 (Econometrica); applied to 26-rule technical universe on ~100 years of the Dow by Sullivan, Timmermann & White 1999 |
| **Hansen's SPA** (2005) | Same question, more power | Hansen shows the Reality Check loses power when poor rules are included; SPA fixes this. (Studentisation details not confirmed in this session.) | Hansen 2005 (JBES) |
| **Romano-Wolf stepdown** (2005) | Family-wise error, identifies *which* rules beat the benchmark | Stepwise version of the Reality Check that uses the joint dependence of the test statistics; more powerful than single-step methods | Romano & Wolf 2005 (Econometrica) |
| **Harvey-Liu-Zhu** (2016), Harvey & Liu (2015) | Industry-wide data mining | New factors need t > 3.0; Sharpe ratios need a *non-linear* haircut: marginal Sharpe ratios are cut hard, high ones only a little; "halve the Sharpe" is called a serious mistake | HLZ 2016 (SSRN, NBER, RFS); Harvey & Liu 2015 (JPM, Duke) |

- Lo & MacKinlay (1990) show the same problem from another angle: choosing how to group the data *after* looking
  at it can make a 5% test reject with probability approaching one under the null (NBER working-paper version).
- Aronson's *Evidence-Based Technical Analysis* (2006) tests more than 6,400 rules on the S&P 500 with a
  Reality-Check-style test and Monte Carlo permutation; reviews report that the best rules' profits were explained
  by data-mining bias *(details unverified: from a CXO Advisory review)*. Masters' Apress books cover the same
  permutation approach for trading systems.
- **Disagreement.** Jensen, Kelly & Pedersen (2023, *Journal of Finance*) use a Bayesian model and conclude most
  factors **do** replicate, out of sample and across 93 countries, and that evidence gets *stronger* as more
  factors are tested together. Hou, Xue & Zhang (2020) and Harvey, Liu & Zhu (2016) are far more pessimistic.
  Part of the gap is method (Bayesian shrinkage across related factors vs. per-factor hurdles) and part is that
  Hou et al.'s failures are concentrated in microcaps (a point made by academics quoted by Alpha Architect).
  For a beginner the safe reading: **a single strategy found by search needs a high bar; a family of related,
  theory-backed rules that all point the same way deserves more trust.**

### 2.3 Backtest overfitting: PBO, deflated Sharpe, minimum backtest length

- **PBO / CSCV** (Bailey, Borwein, López de Prado & Zhu, *Journal of Computational Finance*). The abstract says
  hold-out tends to be "unreliable and inaccurate" for investment backtests, and proposes combinatorially
  symmetric cross-validation: cut the history into S blocks, and for every way of choosing half the blocks as
  in-sample, see where the in-sample best strategy ranks out of sample. PBO = share of splits where it lands below
  the median. An R package (`pbo`) implements it. (CSCV mechanics are from the literature as summarised by
  secondary pages; full text not read.)
- **Deflated Sharpe ratio** (Bailey & López de Prado 2014, *JPM*). The probabilistic Sharpe ratio evaluated
  against the Sharpe ratio you would expect from the best of N tries:
  `SR0 = sqrt(V[SR]) · ((1−γ)·Φ⁻¹(1−1/N) + γ·Φ⁻¹(1−1/(N·e)))`, γ = Euler's constant, and
  `DSR = Φ((SR − SR0)·sqrt(T−1) / sqrt(1 − skew·SR + (kurt−1)/4·SR²))`, with raw (not excess) kurtosis and
  Sharpe ratios at the data's own frequency. Formula cross-checked across two independent secondary
  implementations (Quantt; endgame-ml docs) and the Wikipedia article; the original PDF could not be fetched.
- **Effective number of trials.** López de Prado & Lewis (2019, *Quantitative Finance*) estimate the number of
  *effectively uncorrelated* trials by clustering the backtests, because near-duplicate rules overstate N.
- **Minimum backtest length** (Bailey et al. 2014, "Pseudo-mathematics and financial charlatanism"). For a fixed
  history, enough tries can always fit any target performance, so the required history must grow with the number
  of tries. Their headline example: 7 configurations are enough to expect one 2-year backtest with annual Sharpe > 1
  when the true out-of-sample Sharpe is 0 (from the authors' talk abstract).
- **Bayesian alternative.** Witzany (2021, *Risks*) argues standard out-of-sample backtesting becomes unreliable when
  selection uses too many models tested on the hold-out sample, and offers an MCMC Bayesian estimate instead.
  Koshiyama & Firoozye (2019, arXiv) correct a performance metric for the number of parameters and data used
  ("covariance penalties"), tested on 1,300+ assets.
- *Agreement:* PBO, DSR, MinBTL, Witzany and the covariance-penalty paper all say the same thing in different
  maths: **the more you searched, the more you must discount what you found, and a single hold-out is not enough
  protection if you keep choosing on it.**

### 2.4 Bootstrap and permutation for dependent data

- Plain resampling assumes observations are independent. Returns are not (volatility clusters, trades overlap).
  Künsch (1989, *Annals of Statistics*) introduced the **moving block bootstrap** (resample overlapping blocks);
  Politis & Romano (1994, *JASA*) the **stationary bootstrap** (blocks of random, geometric length with mean 1/p,
  so the resampled series is itself stationary). Blocks too short break the dependence; too long leave too few
  blocks.
- **Block length.** Politis & White (2004, *Econometric Reviews*) give an automatic, data-driven choice, corrected by
  Patton, Politis & White (2009) after an error in an earlier variance formula was found. Use the corrected version.
- **How many replications.** Davidson & MacKinnon (2000): finite B makes the test depend on the random draws and
  costs a little power; they give a pretest for choosing B. Efron & Tibshirani (1993) suggest ~25-200 for standard
  errors and ~1,000 for confidence intervals *(second-hand, from two citing papers)*. Our 1,000 is fine for
  p-values near 0.05-0.10 (see setups-statistics.md §1).
- **Permutation tests** are exact only if the labels are exchangeable under the null. If observations come in
  correlated groups (same date, same COT week), you must permute **whole groups**, or the null distribution is too
  narrow and p-values are too small. This is the standard condition for permutation tests; it matters for two of
  our tests (section 3).

### 2.5 Sample size, power and the Sharpe ratio's standard error

- **Lo (2002, *Financial Analysts Journal*)** derives the sampling distribution of the Sharpe ratio for iid,
  stationary and time-aggregated returns. Monthly Sharpe ratios cannot be annualised by ×√12 except in special
  cases; serial correlation can overstate an annual Sharpe ratio by as much as 65% (his hedge-fund example).
- **Non-normal returns.** Mertens (2002) adds skewness and kurtosis to the iid variance:
  `Var(SR) ≈ (1 − skew·SR + (kurt−1)/4·SR²) / T` *(Mertens known here only through a 2018 citing paper and the
  DSR formula above, which uses the same term)*. Opdyke (2007, *Journal of Asset Management*) extends this to
  stationary, serially correlated returns; Ledoit & Wolf (2008, *Journal of Empirical Finance*) argue the
  Jobson-Korkie test fails with fat tails or time-series data and use a studentised time-series bootstrap, and they
  dispute Opdyke's serial-dependence formula. Ho (2006, arXiv) studies the estimation error for long-memory
  stochastic volatility models. *Disagreement noted: the exact SE under dependence is contested; the iid +
  skew/kurtosis form is agreed.*
- **Minimum track record length** (Bailey & López de Prado 2012, *Journal of Risk*): the track record needed to
  reject "true Sharpe ≤ threshold" grows with negative skew and fat tails.
- **Per-trade arithmetic** *(illustration)*. With per-trade Sharpe `s = mean/sd`, the t-statistic is about
  `s·sqrt(n)`. To have an 80% chance of detecting a real edge at a one-sided 5% level you need
  `n ≈ ((1.645 + 0.842)/s)² ≈ 6.2/s²` *independent* trades. Average trade 0.5%, sd 5% → s = 0.1 → about 620
  trades. At the Harvey-Liu-Zhu hurdle (t = 3, 80% power): `((3 + 0.842)/s)² ≈ 14.8/s²` ≈ 1,480 trades. Carver's
  *Systematic Trading* makes the practitioner version of the point: realistic Sharpe ratios rarely exceed 1, so
  telling rules apart takes many years of data *(Sharpe figure from a CXO review; unverified)*.
- **"Independent" is the catch.** Pooled trades on 100 correlated stocks entered in the same week share one market
  move. The honest n is closer to the number of distinct signal weeks than to the number of trades. A t-statistic
  computed on weekly averages (a cluster-robust t) is the simple fix.

### 2.6 Walk-forward, purging and embargo

- López de Prado's *Advances in Financial Machine Learning* (Wiley 2018) describes **purging** (drop training
  observations whose outcome window overlaps the test window) and an **embargo** (drop a buffer after each test
  block), and **combinatorial purged cross-validation** (CPCV), which gives many test paths instead of the single
  path of walk-forward. Secondary descriptions agree on these mechanics; the chapter numbering differs between
  secondary sources (7 for purged CV; CPCV attributed to ch. 7 or 12).
- Single-path walk-forward is easy and realistic but has high variance (one path, few windows). CPCV / CSCV give a
  distribution. *No peer-reviewed head-to-head comparison could be confirmed in this session.*
- Pardo's *Evaluation and Optimization of Trading Strategies* (Wiley 2008) has a chapter on "Robustness and
  Walk-Forward Efficiency". Practitioner pages define walk-forward efficiency as out-of-sample profit ÷ in-sample
  profit *(definition and thresholds from a practitioner site, not the book; unverified)*.

### 2.7 Robustness: plateaus, regimes, decay, shrinkage

- **Parameter neighbourhood.** Pardo (via a podcast summary *(unverified)*) and Chan (via a book summary
  *(unverified)*) both recommend sensitivity analysis: parameters should sit on a plateau where nearby values work
  similarly. Two practitioner sources, agreed, but both second-hand.
- **Regime splits.** Testing up/down markets, high/low volatility and early/late halves separately is standard
  practice in the same books; the trend research (branch 1b) already found short-horizon edges have weakened over
  time while long ones have not, which is exactly what a first-half/second-half split detects.
- **Out-of-sample decay.** McLean & Pontiff (2016): 97 predictors, returns 26% lower out of sample (an upper bound
  on data-mining effects) and 58% lower after publication. The 2013 working paper had different numbers (≈10% and
  ≈35%); use the published ones. Hou, Xue & Zhang (2020) agree that most anomalies are weaker than reported;
  Jensen, Kelly & Pedersen (2023) disagree on how much.
- **Shrinkage.** The Bayesian answer to all of this is to pull a backtest's estimate toward zero by an amount that
  depends on how noisy it is (Jensen et al. 2023; Harvey 2017). A simple empirical-Bayes version for one estimate
  *(standard maths, my derivation)*: with prior edge ~ N(0, τ²) and estimate ~ N(μ̂, se²), the posterior mean is
  `μ̂·τ²/(τ² + se²)`; estimating τ² by `μ̂² − se²` gives the factor `max(0, 1 − 1/t²)`. At t = 2 the edge is cut by
  25%, at t = 1.2 by about 70%. This is the same direction and roughly the size of the McLean-Pontiff decay.

### 2.8 Survivorship and look-ahead bias

- Brown, Goetzmann, Ibbotson & Ross (1992, *RFS*): a sample truncated by survival creates the appearance of
  predictability and persistence, large enough to explain earlier fund-persistence findings. Chan's
  *Quantitative Trading* makes the same point for stock universes: a backtest is only trustworthy on the index
  members **as they were at the start**; look-ahead (using tomorrow's information today), survivorship and
  data-snooping all inflate backtests.
- For a Nasdaq-100 scanner using today's list, survivorship flatters **long** trades (the stocks that fell out of
  the index are missing) and penalises **short** trades. The size of the bias for this universe was not measured
  in any source found.

### 2.9 Transaction costs and slippage

- Frazzini, Israel & Moskowitz (AQR; ~$1.7 trillion of live institutional trades, 1998-2016 in the later version
  *(figures from secondary coverage)*) find real costs for a large, patient trader are far lower than academic
  estimates (the 2012 abstract: less than a tenth).
- Novy-Marx & Velikov (2016, *RFS*): most anomalies with less than 50% monthly (one-sided) turnover survive costs;
  few with higher turnover do. A buy/hold spread (harder to enter than to stay) is the best cost-mitigation trick.
- *Disagreement in tone, not substance:* AQR's costs are for algorithmic institutional execution; Novy-Marx &
  Velikov use effective-spread estimates. Our trades turn over every few days (far above 50% a month), so the
  Novy-Marx & Velikov warning applies, while for liquid Nasdaq-100 names a retail spread is small. The risk for us
  is less the commission than **stop slippage in fast markets and gaps**, which a flat 0.1% does not model.

---

## 3. Audit: our code against best practice

Legend: ✅ matches best practice · ⚠️ partly / approximation · ❌ missing or wrong.

| # | What | Where | Verdict | Notes |
|---|---|---|---|---|
| 1 | p-value formula `(k+1)/(B+1)`, 1,000 seeded runs | strategies.py:552, 575, 663 | ✅ | Matches Davidson & MacKinnon; reproducible. |
| 2 | Random-entry test: same stocks, side, hold; random dates | strategies.py:556-576 | ⚠️ | Good null for *timing* (keeps drift, removes signal). **But each random trade gets its own independent date (line 571), while real trades cluster in time** (many stocks signal in the same sell-off). The null spread is too narrow, so **p-values are too small** for pooled strategies. Also: random trades exit at the close after the matched hold, ignoring stops (line 572), and the hold is copied from the real outcome (stopped-out trades are short) – an approximation, not wrong. For lab strategies the scanner passes full-history closes while trades are only from the unseen period (scanner.py:600 vs 594), so random dates come from a different period than the trades. |
| 3 | Random-walk test: shuffled daily moves | strategies.py:524-553 | ⚠️ | Valid null of "no pattern". iid shuffling also destroys volatility clustering, so strategies that work *because* of calm/volatile regimes can look significant; a block shuffle (blocks of ~5-20 days) is the stricter null. The statistic is total return, which mixes edge with number of trades; mean trade is the cleaner statistic. 1,000 runs per stock is costly for what is a secondary check. |
| 4 | Monte Carlo of next 20 trades, stationary bootstrap | strategies.py:579-609 | ⚠️ | Correct Politis-Romano mechanics (geometric blocks, circular wrap at 597). Mean block 4 is fixed, not chosen by Politis-White. **The pooled list is ordered stock by stock (scanner.py:576), not by date**, so "consecutive" trades are consecutive within a stock, and cross-stock streaks (all longs losing in one sell-off) are not reproduced; drawdowns are understated. It resamples the in-sample record with no shrinkage, so the median outcome is optimistic (§2.7). |
| 5 | `summarise`: grade thresholds | strategies.py:502-508 | ❌ | "Proven" needs only 8 trades and PF ≥ 1.2. With typical trade noise 8 trades cannot tell an edge from luck (§2.5). |
| 6 | `summarise`: t-statistic | strategies.py:511-512 | ⚠️ | Correct iid t of the mean trade (= per-trade Sharpe × √n). Not adjusted for non-normality (skew/kurtosis, §2.5) or for clustering of pooled trades in time (§2.5); overstates certainty for pooled records. |
| 7 | `summarise`: trades needed | strategies.py:513 | ⚠️ | `(2·sd/mean)²` = trades for t = 2. That is only a **50% chance** of detecting a real edge of this size; 80% power needs ≈ `6.2·(sd/mean)²` (one-sided 5%). Uses raw, not effective, trade count. |
| 8 | No Sharpe ratio or its standard error | strategies.py:485-519 | ❌ | No per-trade Sharpe with a Lo/Mertens SE; the deflated Sharpe exists only in the lab. |
| 9 | Recent-history check (last 30%) | scanner.py:582-583 | ⚠️ | Good idea (a regime/decay split). Not a true out-of-sample test for the three core strategies, because the rules were designed after seeing the data's behaviour; there is no first-half vs second-half comparison or a pass/fail rule. |
| 10 | `bh_qvalues` | strategies.py:612-620 | ✅/⚠️ | Correct step-up BH. Valid under positive dependence (BY 2001), which is the likely case for correlated stocks. But the family is "stocks that currently show a setup" (scanner.py:965), not all stocks tested, so the family size changes from scan to scan; the family should be every stock × strategy tested. |
| 11 | No correction across the scanner's own strategies | scanner.py:622 | ❌ | Tier A needs random-entry p ≤ 0.10, but each time frame tests 3 strategies × 2 sides (18 tests over 3 frames), plus the lab strategies. No Holm/BH across these. At p ≤ 0.10 with 18 independent-ish tries, ~1.8 false "edges" are expected by luck alone *(illustration)*. |
| 12 | `cot_z_events` / `edge_summary` permutation | strategies.py:623-666 | ❌ | One event per stretch per stock (642) is good. **But COT is one market-wide reading per week; all stocks share it.** The test permutes individual events (659) as if each had an independent COT label, so the effective n is the number of distinct COT weeks, not events, and the p-value is far too small. Must permute at the week level. |
| 13 | Costs | strategies.py:21, 463 | ⚠️ | Flat 0.1% round trip. Stops fill exactly at the stop unless gapped through (444), the same-bar stop-before-target rule is conservative (442-447). No slippage on stop fills, no cost-sensitivity test. |
| 14 | Survivorship | scanner.py:31 (today's NASDAQ_100), docs | ⚠️ | Acknowledged in setups-statistics.md §7, not measured or shown on the cards. Biases longs up, shorts down. |
| 15 | Look-ahead | strategies.py (causal indicators, tests), lab `market_trend_by_date` previous day | ✅ | Every calculation at bar i uses bars ≤ i, checked by tests; COT used from the Friday after its date. |
| 16 | Lab folds and embargo | lab.py:57, 322, 329, 340 | ✅ | Expanding walk-forward, three windows, training ends `embargo` = longest hold + 1 bars before each window, so no trade straddles the line – this is purging in López de Prado's sense. |
| 17 | Lab selection rule | lab.py:338-352, 389-397 | ✅ | Chosen in ≥ 2 of 3 windows, positive and ≥ 30 trades on unseen data – a sensible stability rule. |
| 18 | Lab `holm` | lab.py:281-288, 383 | ✅/⚠️ | Correct Holm step-down. Applying it only to the ≤ 18 forwarded candidates is legitimate because they were chosen on separate (training) data. But its input p-values come from the random-entry test, with the clustering problem of row 2. |
| 19 | Lab `pbo` | lab.py:347-351, 358, 384 | ⚠️ | Not CSCV. It is a rank check over at most 3 walk-forward windows, so PBO can only be 0, ⅓, ½, ⅔ or 1, and "> 0.5" means "the in-sample winner was in the bottom half in 2 of 3 windows". Directionally right, statistically very coarse. Bailey et al. use many combinatorial splits for exactly this reason. |
| 20 | Lab `deflated_sharpe` | lab.py:291-310, 362-367, 380 | ✅/⚠️ | Formula matches Bailey & López de Prado (both SR0 terms, raw kurtosis, √(T−1)). Clustering by (trigger, side) family follows López de Prado & Lewis in spirit. Two weaknesses: `sr_by_cand` is overwritten each fold (331-337) so V[SR] uses only the last fold, and V[SR] is measured **between family averages**, which shrinks it and makes SR0 (the luck bar) lower than it should be. Reported, not gated – reasonable given the doc's finding that it couldn't separate planted edges. |
| 21 | Lab survivors graded on their "unseen" record | lab.py:416 (`oos_from`), scanner.py:600 | ⚠️ | That record was used to *decide* survival (Holm gate). After selection it is no longer unseen; survivors' unseen stats are biased upward (winner's curse). A true out-of-time record starts the day a strategy is first shown. |
| 22 | Repeated re-runs of the lab | lab.py docstring, scanner `_run_lab` | ⚠️ | Re-running on each new bar is fine, but survivors can flicker in and out as one bar is added; each re-run is another look at nearly the same data. No persistence rule. |
| 23 | Parameter-neighbourhood / plateau check | – | ❌ | None for the core strategies or lab survivors. |
| 24 | Regime split (market up/down, first/second half) | – | ❌ | Only the last-30% check (row 9). |
| 25 | Shrinkage of displayed results | – | ❌ | Cards show raw backtest averages; nothing anticipates out-of-sample decay. |

What the code does well, in fairness: theory-first rule design, causal calculations with tests, the side split,
pooled rather than per-stock grading, an honest walk-forward with purging, Holm on the lab, BH on stocks, seeded
reproducible simulations, and a graveyard of rejects. The main gap is one idea repeated in rows 2, 4, 6, 7, 12:
**pooled trades across correlated stocks are treated as independent.**

---

## 4. Recommendations (at most five; fix what exists, simplest first)

### R1. Make the significance tests respect clustering in time (fixes audit rows 2, 6, 12, 18)

- **Random-entry test** (`random_entry_test`): group the real trades by the calendar week of their signal bar.
  In each simulation, draw **one** random week per real signal week, and re-enter *every* trade of that week on
  its own stock at the same weekday offset in the drawn week (same side, same hold). This keeps "how many trades
  happen together". Draw random weeks only from the same period the trades come from (for lab strategies, the
  unseen period).
- **t-statistic** (`summarise`): add `tStatWeekly` = t-test on the weekly averages of trade returns, and
  `effectiveTrades` = number of distinct signal weeks. Grades use these for pooled records.
- **COT edge study** (`edge_summary`): permute the agree/against labels **by COT week** (all events in a week move
  together), not by event.
- **Acceptance:** a synthetic test with 100 stocks built from one shared market random walk plus stock noise, and
  a no-edge rule that fires on market-wide conditions: over 200 seeds, the share with p ≤ 0.10 must be ≤ 0.14
  (0.10 plus two binomial standard errors). The existing planted-edge tests must still pass. The edge-study
  p-value on the same synthetic data must also be ≤ 0.10 in at most 14% of seeds.

### R2. Honest sample size, power and shrinkage on every record (fixes rows 5, 7, 8, 25)

- `tradesNeeded = ceil(((1.645 + 0.842) · sd / mean)²)` (80% power, one-sided 5%), compared with
  `effectiveTrades` from R1, not raw trades.
- Add per-trade Sharpe `s = mean/sd` and its SE `sqrt((1 − skew·s + (kurt−1)/4·s²)/(n−1))` (Mertens/Lo; raw
  kurtosis), computed on the weekly series for pooled records.
- Show an **expected average trade** = `mean × max(0, 1 − 1/t²)` (empirical-Bayes shrinkage, §2.7) next to the
  backtest average, and use it for the Monte Carlo's centre (shift the resampled returns by the difference).
- Raise the per-stock "proven" grade from 8 to **20 trades and t ≥ 1.5** (a stock record is a secondary check;
  "mixed"/"failed" stay at 4+).
- **Acceptance:** Tier A requires `effectiveTrades ≥ tradesNeeded` and a positive expected (shrunk) average after
  costs. Unit tests: for a known normal sample the SE matches `sqrt((1 + s²/2)/(n−1))` within 1%; shrinkage is 0
  when |t| ≤ 1 and 25% at t = 2.

### R3. Correct for the number of strategies tested in the scanner (fixes rows 10, 11)

- For Tier A, collect the random-entry p-values of every (strategy, side, time frame) record shown (currently
  3 × 2 × 3 = 18, plus lab strategies) and apply the existing `lab.holm`. Tier A needs **Holm-adjusted p ≤ 0.10**;
  Tier B keeps the raw test. Show "adjusted for N tests" on the card.
- Make the BH family for per-stock random-walk q-values **every stock × strategy tested** in that time frame, not
  only those with a current setup.
- **Acceptance:** on a universe of pure drifting random walks (no edge anywhere), the chance that *any* record
  reaches Tier A is ≤ 10% over 100 seeds.

### R4. One robustness report per strategy: neighbourhood, costs, regimes (fixes rows 9, 13, 23, 24)

Computed once a day with the pooled trades, shown as three ticks on the strategy card:

- **Plateau:** move each numeric parameter one step each way (ATR multiples ±0.5, lookbacks ±20%, percentile bands
  ±2 points, hold ±1 bar), one at a time. Pass if expectancy is positive in **≥ 80%** of these neighbours and the
  median neighbour's profit factor is **≥ 1.1**.
- **Costs:** re-run with **double costs (0.2% round trip) plus 0.05% extra slippage on every stop exit**. Pass if
  expectancy stays positive and (with R1) random-entry p ≤ 0.10.
- **Regimes:** split trades into first half / second half of history and QQQ above / below its 200-day average
  (known the previous day). Pass if expectancy is positive in **at least 3 of the 4 parts** and no part has a
  weekly t below −1.
- **Acceptance:** Tier A additionally requires all three ticks; failures add a `whyCodes` entry
  (`fragile_params`, `cost_sensitive`, `regime_dependent`).

### R5. Replace the 3-window PBO with real CSCV (fixes rows 19, 20)

- After the walk-forward loop, build a matrix: rows = **S = 10** equal time blocks of the history (by signal date,
  pooled over stocks), columns = every candidate with ≥ 40 training trades, cell = average trade return of that
  candidate in that block. Purge trades whose exit falls in a different block. For each of the C(10,5) = **252**
  ways to pick 5 blocks as in-sample, find the in-sample best column (by t-statistic), take its out-of-sample rank
  r among N columns, ω = r/(N+1), λ = ln(ω/(1−ω)). **PBO = share of splits with λ ≤ 0.** Keep the existing gate
  (PBO > 0.5 → nothing passes).
- While there: keep each candidate's Sharpe from the full training record rather than the last fold, and compute
  V[SR] across all candidates (or family representatives' own trade series) rather than family averages.
- **Acceptance:** on the existing synthetic tests, mean PBO over the 4 pure random-walk sets ≥ 0.4, and ≤ 0.3 on
  the 4 planted-edge sets; runtime increase under 20% of the current lab run.

Not a code recommendation but the most important test of all: the owner's **paper trading in Webull is the only
truly unseen data**. Log every Tier A/B setup the day it is shown and compare the live results with the backtest
after 50+ trades; McLean & Pontiff suggest expecting them to be noticeably worse.

---

## 5. Limits of this research

- No full texts were read (fetches failed; see top). Formulas for DSR and the Sharpe SE were cross-checked against
  independent secondary implementations, not the original PDFs. CSCV details, Hansen's studentisation and the
  Romano-Wolf algorithm are described at abstract level only.
- Mertens (2002) and Efron & Tibshirani's replication counts are known only through citing works.
- Books (Aronson, Pardo, Chan, Carver, Masters, López de Prado) are described from publisher pages, the authors'
  slides and reviews.
- The size of survivorship bias in a Nasdaq-100 backtest, and the actual cost/slippage of a retail Webull trade in
  these stocks, were not found in any source.
- Acceptance thresholds in section 4 are proposed engineering targets (based on binomial error and the sources'
  logic), not values from a paper.

---

## 6. Sources

Access: **abstract** = abstract / landing page / search summary only; **secondary** = known only through other
works or reviews. None were read in full in this session.

| # | Source | Type | Archive / publisher | Access | What it contributed |
|---|---|---|---|---|---|
| 1 | Wasserstein & Lazar (2016), "The ASA's Statement on p-Values", *The American Statistician* 70(2) | Journal | Taylor & Francis (summaries: ScienceDaily, INSPQ) | abstract + secondary | Six principles on p-values (§2.1) |
| 2 | Harvey (2017), "Presidential Address: The Scientific Outlook in Financial Economics", *J. Finance* 72(4) | Journal | Duke author page; Wiley | abstract | p-hacking in finance, minimum Bayes factor, t>3 not sufficient |
| 3 | White (2000), "A Reality Check for Data Snooping", *Econometrica* 68(5) | Journal | Econometric Society / JSTOR | abstract | Testing the best of many rules (§2.2) |
| 4 | Hansen (2005), "A Test for Superior Predictive Ability", *JBES* 23 | Journal | RePEc-cited; Cambridge reference lists | secondary | SPA: more power than Reality Check |
| 5 | Romano & Wolf (2005), "Stepwise Multiple Testing as Formalized Data Snooping", *Econometrica* 73(4) | Journal | Econometric Society; UPF working paper | abstract | Stepdown FWER control using joint dependence |
| 6 | Sullivan, Timmermann & White (1999), "Data-Snooping, Technical Trading Rule Performance, and the Bootstrap", *J. Finance* 54(5) | Journal | RePEc / LSE FMG DP 303 | abstract | Reality Check applied to technical rules on ~100 years of the Dow |
| 7 | Harvey, Liu & Zhu (2016), "…and the Cross-Section of Expected Returns", *RFS* 29(1) | Journal | SSRN 2513152; NBER w20592 | abstract | t > 3.0 hurdle |
| 8 | Harvey & Liu (2015), "Backtesting", *JPM* 41(1) | Journal | Duke author page | abstract | Non-linear Sharpe haircut; 50% rule criticised |
| 9 | Hou, Xue & Zhang (2020), "Replicating Anomalies", *RFS* | Journal | NBER w23394 | abstract | 65% of 452 anomalies fail t=1.96; 82% fail t=2.78 |
| 10 | Jensen, Kelly & Pedersen (2023), "Is There a Replication Crisis in Finance?", *J. Finance* 78(5) | Journal | NBER w28432; CBS | abstract | Bayesian counterpoint: most factors replicate (disagreement) |
| 11 | McLean & Pontiff (2016), "Does Academic Research Destroy Stock Return Predictability?", *J. Finance* 71(1) | Journal | Ivey (author copy) / search | abstract | 26% OOS, 58% post-publication decay |
| 12 | Lo & MacKinlay (1990), "Data-Snooping Biases in Tests of Financial Asset Pricing Models", *RFS* 3(3) | Journal | NBER w3001; MIT | abstract | Data-driven grouping can make 5% tests reject almost surely |
| 13 | Holm (1979), "A Simple Sequentially Rejective Multiple Test Procedure", *Scand. J. Statistics* 6(2) | Journal | JSTOR 4615733 | abstract | Holm step-down |
| 14 | Benjamini & Hochberg (1995), "Controlling the False Discovery Rate", *JRSS B* 57 | Journal | cited via Project Euclid / arXiv papers | secondary | FDR step-up |
| 15 | Benjamini & Yekutieli (2001), "The Control of the FDR in Multiple Testing under Dependency", *Ann. Statist.* 29(4) | Journal | Project Euclid (open access) | abstract | BH valid under PRDS; BY variant for any dependence |
| 16 | Bailey, Borwein, López de Prado & Zhu, "The Probability of Backtest Overfitting", *J. Computational Finance* 20(4) | Journal | SSRN 2326253; Risk.net; eScholarship; RePEc | abstract | PBO, CSCV, hold-out unreliable |
| 17 | Bailey, Borwein, López de Prado & Zhu (2014), "Pseudo-Mathematics and Financial Charlatanism", *Notices AMS* | Journal | WMU ScholarWorks; IAQF talk abstract | abstract | Minimum backtest length; 7-tries example |
| 18 | Bailey & López de Prado (2014), "The Deflated Sharpe Ratio", *JPM* 40(5) | Journal | SSRN 2460551; eScholarship | abstract (+ formula via secondary implementations) | DSR formula |
| 19 | Bailey & López de Prado (2012), "The Sharpe Ratio Efficient Frontier", *J. Risk* 15(2) | Journal | Risk.net; RePEc | abstract | PSR, minimum track record length |
| 20 | López de Prado & Lewis (2019), "Detection of False Investment Strategies Using Unsupervised Learning Methods", *Quant. Finance* 19(9) | Journal | RePEc; SSRN 3167017 | abstract | Effective number of trials by clustering |
| 21 | López de Prado (2018), *Advances in Financial Machine Learning* | Book | Wiley | secondary | Purging, embargo, CPCV |
| 22 | Witzany (2021), "A Bayesian Approach to Measurement of Backtest Overfitting", *Risks* 9(1) | Journal | DOAJ; RePEc; IES WP 2017/18 | abstract | Hold-out unreliable when reused; Bayesian MCMC alternative |
| 23 | Koshiyama & Firoozye (2019), "Avoiding Backtesting Overfitting by Covariance-Penalties" | Working paper | arXiv 1905.05023 | abstract | Penalising metrics by parameters/data, 1,300+ assets |
| 24 | Künsch (1989), "The Jackknife and the Bootstrap for General Stationary Observations", *Ann. Statist.* 17(3) | Journal | Project Euclid (open access) | abstract | Moving block bootstrap |
| 25 | Politis & Romano (1994), "The Stationary Bootstrap", *JASA* 89(428) | Journal | Univ. of Cyprus repository | abstract | Geometric-block bootstrap |
| 26 | Politis & White (2004), *Econometric Reviews* 23(1); Patton, Politis & White (2009) correction, 28(4) | Journal | RePEc; Duke (author copy) | abstract | Automatic block length, corrected |
| 27 | Davidson & MacKinnon (2000), "Bootstrap Tests: How Many Bootstraps?", *Econometric Reviews* 19(1) | Journal | RePEc; Queen's QED WP 1036 | abstract | Number of replications, pretest |
| 28 | Efron & Tibshirani (1993), *An Introduction to the Bootstrap* | Book | Chapman & Hall | secondary (via arXiv 1411.5279, 1603.04929) | Replication rules of thumb |
| 29 | Lo (2002), "The Statistics of Sharpe Ratios", *Financial Analysts Journal* 58(4) | Journal | CFA Institute; RePEc | abstract | Sharpe SE; √12 annualisation error; up to 65% overstatement |
| 30 | Opdyke (2007), "Comparing Sharpe Ratios: So Where Are the p-Values?", *J. Asset Management* 8(5) | Journal | RePEc | abstract | Sharpe SE for stationary, non-normal returns |
| 31 | Mertens (2002), Sharpe-ratio variance with skew/kurtosis | Working paper | via a 2018 *Risks* paper | secondary | Non-normal Sharpe SE |
| 32 | Ledoit & Wolf (2008), "Robust Performance Hypothesis Testing with the Sharpe Ratio", *J. Empirical Finance* 15(5) | Journal | RePEc; Univ. Zurich | abstract | Studentised time-series bootstrap; disputes Opdyke |
| 33 | Ho (2006), "Estimation errors of the Sharpe ratio for long-memory stochastic volatility models" | Working paper | arXiv math/0702812 | abstract (via citing summary) | SE under dependence |
| 34 | Brown, Goetzmann, Ibbotson & Ross (1992), "Survivorship Bias in Performance Studies", *RFS* 5(4) | Journal | RePEc | abstract | Survivorship creates spurious predictability |
| 35 | Frazzini, Israel & Moskowitz, "Trading Costs of Asset Pricing Anomalies" / "Trading Costs" | Working paper | AQR; NBER conference paper | abstract + secondary | Real institutional costs far below estimates |
| 36 | Novy-Marx & Velikov (2016), "A Taxonomy of Anomalies and Their Trading Costs", *RFS* 29(1) | Journal | NBER w20721; RePEc | abstract | 50% monthly turnover line; buy/hold spread |
| 37 | Aronson (2006), *Evidence-Based Technical Analysis* | Book | Wiley (StockCharts listing; CXO review) | secondary | 6,400 rules, data-mining bias, permutation tests |
| 38 | Pardo (2008), *The Evaluation and Optimization of Trading Strategies*, 2nd ed. | Book | Wiley (table of contents) | secondary | Walk-forward efficiency, robustness, plateaus |
| 39 | Chan (2008/2021), *Quantitative Trading* | Book | Wiley; author's CMT slides | secondary | Look-ahead, survivorship, data-snooping pitfalls |
| 40 | Carver (2015), *Systematic Trading* | Book | Harriman House; CXO review | secondary | Realistic Sharpe ratios; fitting and data needs |
| 41 | Masters, *Permutation and Randomization Tests for Trading System Development* | Book | Apress (Goodreads listing) | secondary | Selection bias when screening many indicators |

Count: 41 sources, of which 33 are papers/working papers and 8 books, from more than six archives and publishers
(JSTOR / Econometric Society, RePEc/IDEAS, NBER, SSRN, arXiv, Project Euclid, CFA Institute, AQR, Risk.net,
DOAJ, university repositories, Wiley / Harriman House / Apress).
