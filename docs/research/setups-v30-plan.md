# Setups v30: full Nasdaq, more indicator setups, settings fitted to how each stock moves, AI research notes

Owner's request (2026-11-13): widen the scanner from the Nasdaq-100 to the full Nasdaq; backtest and random-walk test
many more popular indicator pairings; fit indicator settings to the kind of stock ("every stock moves different"); use
AI in the scanner to work out the best set-ups; keep running backtests and Monte Carlo; say when to enter and exit,
with research behind each set-up and why it is A, B or C.

The rules that keep this honest (docs/research/setups-statistics.md) stay: walk-forward, random-entry tests corrected
for every combination tried (Holm), probability of backtest overfitting, costs, no look-ahead, forward-only grading of
new strategies. More combinations make each one *harder* to pass, not easier: that is the point.

## Stage 1: full Nasdaq universe (helper)
- Source: Nasdaq Trader symbol directory `nasdaqlisted.txt` (free, daily): common stocks only (no ETFs, test issues,
  warrants, units, rights, preferreds), normal financial status.
- Liquidity gate: price >= $5 and 20-day average dollar volume >= $10M, recomputed weekly from Schwab daily bars. Thin
  stocks are left out on purpose: their backtests are fiction (gaps, wide spreads). Expect about 1,000-1,400 names.
- Daily history (15 years) once a day per symbol, paced as now (one Schwab request every 0.7 s: about 15 minutes in
  the background for the first load, then a day's worth). Live quotes every 5 minutes in batches of 100.
- Hourly (short) time frame stays on the most liquid ~200 (hourly history for 1,000+ names is too heavy); daily and
  weekly cover everything. Heavy maths in the existing worker processes; the page lists A and B first.

## Stage 2: more indicator set-ups in the lab
New triggers from published or widely used rules, each with the exit its theory implies: MACD signal-line cross,
Bollinger %B extreme and re-entry, Bollinger/Keltner squeeze release (TTM-style), RSI(14) 30/70 turns, Stochastic
%K/%D cross from extremes, CCI(20) ±100 turns, 55-day Donchian (turtle), Supertrend flip, Connors RSI(2)+200-day,
OBV breakout ahead of price, MFI extremes, inside-bar breakout. New filters: rising 50-day average, relative
strength vs QQQ (3-month), sector ETF trend. Pairs = trigger + up to two filters, both sides, as now.

## Stage 3: settings fitted to the kind of stock (not to each stock)
Fitting every stock's own settings is the classic way to manufacture fake backtests (with 1,000 stocks something
always "works"). Instead:
1. Each stock gets a behaviour profile from its own past (bars up to the date only): volatility level (ATR %),
   trendiness (variance ratio, efficiency ratio), mean-reversion half-life, beta to QQQ, gap frequency.
2. Stocks are grouped into a handful of behaviour clusters (k-means on the standardised profile, refit monthly).
3. Each indicator's settings (e.g. RSI length 2/5/14, z-score window 10/20/50, ATR stop 1.5/2/3) are chosen per
   cluster on walk-forward training windows using the cluster's pooled trades, and judged on the unseen windows. A
   cluster setting is used only when it beats the default on unseen data after the multiple-testing correction.

## Stage 4: AI in the scanner (proposes; statistics decides)
- Weekly, the AI (owner's Anthropic key) reads each cluster's profile and the lab's results (winners, graveyard) and
  proposes a few new hypotheses (trigger, filters, settings, exit) with the market theory behind each.
- Every proposal goes through the same walk-forward + random-entry + PBO tests and joins the Holm family; a proposal
  that fails goes to the graveyard with the reason. The AI never sets grades and never trades.
- For every A/B setup the AI writes the research note: what the set-up is, the theory and sources, why this grade
  (each check passed or failed, in plain words, from the computed numbers only), when to enter, where the stop goes,
  when to take profit or leave, and what would invalidate it.

## Stage 5: page
Universe filter (Nasdaq-100 / all Nasdaq / my watchlist), cluster shown on each stock, the research note in the trade
guide, the lab's leaderboard of indicator set-ups with their unseen-data record, Monte Carlo of the next 20 trades as
now.
