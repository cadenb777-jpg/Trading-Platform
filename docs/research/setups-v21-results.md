# Setups v21/v22: what the tests decided (results, not opinions)

Written 2026-10-24 for helper v22 (branch conductor/4-setups). **Every number below is on synthetic data**: no real
Schwab or Alpaca history was available while this was written, and no real-market result is claimed. The same
comparisons now run automatically on **your real data** once a week per time frame (`helper/engine/ruletests.py`,
saved to `~/.trading-platform/rule_tests.json`, shown on the Setups page as "Rule tests on your real data"). Where your
data disagrees, the page says so; the rules in use never switch by themselves.

## 1. The synthetic data

`helper/tests/synthetic.py`: 100 stocks sharing one market factor (GARCH volatility around 1.1% a day, Student-t
tails), each stock with its own beta (0.7-1.4), volatility (1-2.5% a day) and drift; 3,780 daily bars (15 years),
weekly bars built from them, and 5,292 hourly bars (3 years, 7 a day). Two worlds:

- **No edge**: nothing is predictable. Any "edge" found here is luck or a flaw in the test.
- **Planted edge**: each stock's own moves partly reverse over 3 bars (6%) and its drift wanders slowly (momentum).

Highs and lows are drawn from the exact distribution of a continuous price path's maximum and minimum inside the bar.
This matters: a first version drew them as noise around max(open, close), and a buy-stop entry then had a fake edge
(it filled mostly on bars that closed above the trigger): all-bar plans of the pullback made +0.41% a trade on data
with no edge. With the corrected bars the same plans make +0.08%, i.e. the drift.

## 2. The measuring stick (step A)

| Test | Design | False alarms at p ≤ 0.10 (no-edge data) | Verdict |
|---|---|---|---|
| Random-entry, v20 | each random trade gets its own date | **38.5%** of 200 universes (40 stocks, trades on market dips) | wrong |
| Random-entry, one random date per real signal date | same-date trades move together | **9.5%** of 200 | **kept** (simpler) |
| Random-entry, one random week per signal week, same weekday | | 9.0% of 200 | passes too, more complex |
| Clustered test on strategies with stops, targets, trailing exits | same design, real strategies | **7.2%** of 360 (40 universes x 9 strategy sides) | ok |
| Same, but random trades replay the strategy's own plan from the random date | | 26.9% of 360 | **rejected**: plans made on random bars are a different kind of trade (e.g. mean reversion exits at once) |
| COT edge study, shuffle whole weeks | two-sided | **10.0%** of 120 universes | **kept** |
| COT edge study, circular shift of the COT series | | 11.7% of 120 | not needed |

Unit tests (helper/tests/test_statistics.py) re-check the clustered random-entry test (≤ 0.14 over 200 seeds) and the
week-shuffled edge study (≤ 0.14 over 200 seeds), and that planted edges are still found (16+ of 20 seeds; both COT
directions).

Also changed in step A: `tStat` counts trades in the same week (same day on hourly bars) as one bet, with
cluster-robust errors; `tradesNeeded` = independent bets needed for one-sided p 0.10 at 80% power (1.282 + 0.842);
Tier A uses the random-entry p **Holm-corrected across every strategy record of all three time frames** (records not
yet tested count as p = 1); R is after costs (test_engine `test_target`: 4/3 - 0.001 x 101 / 3); a per-stock record is
"proven" only with 20+ trades and t ≥ 1.5; robustness ticks (double costs + 0.05% stop slippage; both halves) are
required for A.

## 3. The rule conflicts (step D)

Decision rule (from trend-and-charts.md 6.6): a version **survives** if it makes money after costs and beats random
entries (clustered, p ≤ 0.10). The simplest survivor wins. When nothing survives, the simplest version whose excess
over random entries is within one standard error of the best one wins (so a rule that loses money even on random data,
or one that only rides drift by holding longer, doesn't win). Questions were asked in order, each answer feeding the
next. Buy side shown (Nasdaq-100 sells mostly fight the drift); `ex` = average trade minus the average random entry.

### Swing (daily), planted edge, seed 1 / seed 2

| Question | Versions (simplest first): avg after costs, ex, p | Winner seed 1 / 2 |
|---|---|---|
| Pullback turn (all with the v20 10-week trend) | buy-stop only -0.20%, ex -0.37, p 1.0 · **z-turn -0.09%, ex -0.28** · %R -0.05%, ex -0.25 · v20 stack -0.06%, ex -0.23 | buy-stop / buy-stop (zturn on 5 of 8 data sets) |
| Mean reversion stretch | **z only +0.76%, p 0.005** · z and RSI(2) +0.81%, p 0.005 | z / z (all 8 sets) |
| Breakout | **52-week high -0.03%, ex -1.68** · 50-day +0.27%, ex -1.36 · v20 stack +0.09%, ex -0.98 | none survives anywhere (p ≥ 0.98) |
| Pullback exit | **+1 SD target -0.20%, ex -0.39** · trail after +1R +0.39%, ex -1.01 | target / target (7 of 8 sets) |
| COT, 26 vs 156 weeks x 60/40, 75/25, 80/20 (Holm over 6) | smallest corrected p 0.89 (no edge planted) | no version passes on any set |

### Across all 8 data sets (no edge / planted edge; swing seeds 1-2, position, hourly)

| Question | Result | Decision |
|---|---|---|
| Turn trigger | z-turn won 5 of 8 (both worlds); buy-stop-only won 3 but lost the most on random data (e.g. no-edge swing ex -0.35 vs -0.11) | **z-stretch + z-turn**; %R, A/D vs its average and COT leave the signal |
| Trend filter (pullback, mean reversion, breakout) | "no filter" won most questions; 200-day, 10-week and 10-week ± 0.5 ATR were within noise of it; for breakouts "none" and 200-day give the **same trades** (a 52-week high is always above its 200-day average); 150/250 days behave like 200 (plateau) | synthetic data has no real long-term trend structure, so it can't justify dropping the filter: **one 200-day filter everywhere** (replaces 4 different trend rules). Your data's weekly rule tests decide whether "none" beats it there |
| Pullback exit | +1 SD target won 6 of 8; the trail "won" only on weekly bars, by riding drift (higher average, lower excess) | **keep the target** |
| Mean reversion | z-score only won 7 of 8 and was always within noise of z + RSI(2) | **z-score only** (RSI2 removed) |
| Breakout | no version beat random entries on any set; the 52-week rule is the simplest (2 conditions, buys only); the v20 shorts lost on every set (-0.8% to -6.5% a trade) | **52-week high + chandelier trail, buys only** (Donchian, ADX, volume, 50-bar average removed) |
| COT | no variant passed on any set (smallest Holm p 0.89) | **COT is a displayed reading**; it enters Tier A only if the study passes on your data; removed from the lab |
| A/D divergence (lab filter `adiv`) | no lab survivor used it in the synthetic runs | stays a lab filter only; not in the pullback |
| Lab filters `reverting` / `trending` | removed (time-frames.md R1: on random walks they switched on 42% / 24% of the time) | removed; lab now 814 combinations (638 on weekly bars, no turn-of-month) |

### Robustness and regimes of the production rules (report only)

On the planted-edge swing data, mean-reversion buys passed both ticks (double costs: +0.30% a trade; both halves
profitable); pullback buys passed on seed 1 (+0.03% at double costs) and sells failed everywhere; breakout buys failed
on the planted-edge sets and passed on the no-edge ones (drift). The regime split (QQQ above/below its 200-day; QQQ
volatility above/below its median) was mostly not significant at p ≤ 0.10, and nothing passed on two time frames with
the signs theory predicts (investment-analysis.md 7.3), so **no regime filter was added**.

## 4. What this does not show

- Synthetic data decides only questions about the tests and the trade mechanics. Whether a trend filter or COT helps
  on real Nasdaq-100 stocks is for the weekly rule tests on your data.
- The random-entry test copies each real trade's holding time; for path-dependent exits this is an approximation (the
  false-alarm rate measured above, 7.2%, says it is an acceptable one on this data).
- Hourly results on synthetic data lose money after 0.1% costs for every strategy: small hourly moves rarely cover
  costs. Hourly grades are capped at B until 2 years of hourly history exist.

Scripts used (not in the repo): fp_designs.py, fp_cot.py, fp_exits.py and run_rules.py in the session scratchpad;
they call the same functions as the helper (`strategies.random_entry_test`, `edge_summary`, `ruletests.run`).
