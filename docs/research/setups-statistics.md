# How the setups scanner tests its trades (research notes)

Written 2026-10-23 for the multi-time-frame scanner (helper v19). The aim: every grade rests on tests a
statistician would accept, and the scanner says plainly when the evidence is weak.

## 1. How many simulations

- A simulation test's p-value is itself an estimate. With B simulations its standard error is
  `sqrt(p(1-p)/B)`: about 0.007 at p = 0.05 with B = 1,000, small enough to tell 0.05 from 0.10 reliably.
- Davidson and MacKinnon show a bootstrap / Monte Carlo test is exact when `alpha * (B + 1)` is a whole number,
  which is why 999 (or 1,999) is the textbook choice; with the `(k + 1) / (B + 1)` p-value used here,
  1,000 runs behave the same way at the 5% and 10% levels. More runs mostly reduce randomness in the answer
  and cost power only slightly when B is small (Davidson & MacKinnon, "Bootstrap tests: how many bootstraps?").
  Sources: [Davidson & MacKinnon, How many bootstraps?](https://russell-davidson.research.mcgill.ca/articles/howmany.pdf),
  [Improving the reliability of bootstrap tests](https://www.econ.queensu.ca/sites/econ.queensu.ca/files/qed_wp_995.pdf).
- So: 1,000 runs for the random-entry test, the per-stock random-walk test and the Monte Carlo of future trades.
  All seeded, so the same data gives the same answer.

## 2. Which simulations

- **Random-entry test** (is the strategy better than entering at random?): the same stocks, direction and holding
  time, with entry days drawn at random. Keeps each stock's drift and volatility, removes the signal.
- **Random-walk test** (does the strategy find structure that isn't there?): the stock's own daily moves in a
  shuffled order, which keeps volatility and gaps but destroys any pattern.
- **Monte Carlo of the next 20 trades**: resamples past trades. Plain shuffling treats trades as independent;
  winning and losing streaks cluster, so the scanner uses the **stationary bootstrap** (blocks of random,
  geometric length; Politis & Romano 1994), which keeps short-range dependence and gives more honest drawdowns.
  Sources: [The stationary bootstrap](https://gnosis.library.ucy.ac.cy/handle/7/57533),
  [Don't draw the downs apart (drawdown simulation study)](https://madoc.bib.uni-mannheim.de/72376/).

## 3. Testing many things at once

Scanning ~100 stocks x 3 strategies x 3 time frames means hundreds of tests; at a 5% level some will "pass" by
luck. White's Reality Check, Hansen's SPA test and the work of Harvey, Liu & Zhu, and Bailey & Lopez de Prado on
backtest overfitting all make the same point: the bar must rise with the number of tries.
Source: [The probability of backtest overfitting](https://scholarworks.wmich.edu/math_pubs/42).

What the scanner does about it:

- Grades lean on the **pooled** test (one strategy across all Nasdaq-100 stocks, thousands of trades), not on
  any single stock's lucky history.
- Per-stock random-walk p-values are adjusted with the **Benjamini-Hochberg** false discovery rate (q-values)
  across all the stocks tested in that time frame; a card shows the q-value next to the raw p.
- Rules are fixed in advance (not tuned to the data), and every calculation at bar i uses only bars up to i.

## 4. Does COT positioning add an edge?

- Academic evidence is mixed. Wang (2003, Journal of Futures Markets) found speculators' trades positively and
  hedgers' trades negatively related to later returns, explained by hedging pressure; Larry Williams' COT index
  instead treats commercials at extremes as the informed side. Applying index-futures COT to single stocks is a
  further step (a market-wide read, not stock-specific).
  Sources: [Wang 2003](https://ideas.repec.org/a/wly/jfutmk/v23y2003i1p1-31.html),
  [full text](https://mpra.ub.uni-muenchen.de/36426/1/MPRA_paper_36426.pdf).
- So the scanner **measures** it instead of assuming it: for each time frame, every past z-score "stretch and turn"
  in the trend's direction is split by whether commercials agreed, were neutral or were against, and the forward
  return over the strategy's holding period (after costs) is compared. The difference between "agree" and
  "against" gets a 1,000-run permutation p-value. The Setups page shows this as the **COT + z-score edge study**.

## 5. Why z-score pullbacks inside a trend

Short-horizon returns tend to reverse (Lehmann 1990; Jegadeesh 1990) while 3-12 month returns tend to continue
(Jegadeesh & Titman 1993). Buying a short-term stretch (low z-score) in the direction of the longer trend combines
the two; the strategies encode exactly that.

## 6. Bounds that fit each stock

Fixed thresholds treat a utility and a high-flying chip stock the same. The scanner sizes everything to the stock:

- Stops, targets and "room to target" are in ATR (the stock's own typical range).
- The z-score and RSI(2) "stretched" levels are each stock's **own percentiles** over its last 250 bars
  (10th / 90th for z-score, 5th / 95th for RSI(2)), within sane limits, so a calm stock needs a smaller move and a
  wild one a bigger move to count as stretched.

## 7. What the scanner can't promise

Past results and simulations describe the past. The Nasdaq-100 list is today's (survivorship bias), costs are a
flat 0.1% round trip, and there is no slippage model for fast markets. Treat grades as evidence, not certainty.

## 8. Buys and sells are judged separately (helper v20)

Stocks drift upward over time (the equity risk premium), so a short trade fights the tide that a long trade rides.
In testing on drifting random prices, the same rules made money on buys and lost on sells; lumping them together
made every strategy look weak. Each strategy now has a separate record per side, and a setup is graded on its own
side's record.

## 9. The strategy lab: searching without fooling yourself (helper v20)

The lab (helper/engine/lab.py) searches combinations of rules from 11 published market ideas (short-term reversal,
overreaction, gap fades and gap-and-go, volume climaxes, Williams %R swings, moving-average pullbacks, Donchian /
time-series momentum, 52-week-high momentum, volatility squeezes) and 11 filters (trend, 200-bar average, money
flow, COT hedging pressure, ADX, volume, calm volatility, turn of the month, mean-reverting and trending regimes
from Lo & MacKinlay's variance ratio, and the Nasdaq-100's own trend, known from the previous day).

Safeguards, in the order they apply:

- **Walk-forward with an embargo**: three test windows (55-70%, 70-85%, 85-100% of history). Each combination is
  chosen only on data before a window, with a gap as long as the longest holding period so no trade straddles the
  line (the "purging/embargo" idea of Lopez de Prado).
- **Stability**: a combination must be chosen in at least 2 of the 3 windows.
- **Unseen-data test**: its pooled unseen trades must be profitable, numerous enough (30+) and beat 1,000 random
  entries in those windows, with a Holm correction for everything taken forward.
- **Probability of backtest overfitting (PBO)**: how often the search's in-sample winner lands in the bottom half
  out of sample. Above 50% means the search is mostly finding luck, and nothing passes.
- **Deflated Sharpe ratio** (Bailey & Lopez de Prado), with near-identical combinations clustered into families so
  the number of independent tries isn't overstated. Reported, not used as a gate: in testing it could not tell
  planted edges from luck, while the unseen-data test could.
- **Graveyard**: every rejected combination is saved with its reasons (~/.trading-platform/lab_graveyard.json).

Validation on synthetic data (tests in helper/tests): with a planted reversal edge the lab found it in 4 of 4 data
sets; on pure random walks with upward drift it validated nothing in 4 of 4, even though the best in-sample
combinations had t-statistics around 3.5. The lab re-runs whenever its time frame has a new finished bar (hourly
for short swing, after each close for swing, weekly for position); repeating it more often on the same data would
only repeat the same answer.

What is deliberately not done: the AI does not invent rules or numbers, and the platform never places orders.
FINRA dark-pool data is shown per setup but not searched, because years of daily files would be needed.
