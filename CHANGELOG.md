# Changelog

Versions follow the helper (`HELPER_VERSION` in `helper/schwab_helper.py`). When the helper changes, download the
project ZIP again and restart it.

## Unreleased

- v44 (helper not yet bumped; the site asks for it): the Strategy Lab (Analyse > Strategy, #strategy). A payoff-matrix
  editor (2-4 players, textbook presets) solved exactly by the helper's game engine (dominance, pure and mixed Nash
  equilibria, best replies, Pareto, price of anarchy, grim-trigger patience), a game-tree editor (backward induction,
  empty threats) and coalitions (Shapley value, core, Nash bargaining), each explained in plain words. The AI gains an
  Equilibrium-Prime mode (Strategy Lab panel and the assistant's mode menu) that uses uploaded documents as sources
  and computes every equilibrium with the engine (listed under each answer); maths is typeset with KaTeX. Optional
  `nashpy` cross-checks mixed equilibria. Download the helper again to use it.
- Quant pack (needs helper v44: download the helper again): Research > Valuation adds Comparables (SEC industry
  peers, median/mean multiples, implied value range, football field), an LBO model (debt tranches, cash sweep,
  IRR/MoIC, sensitivity) and a merger model (accretion/dilution, breakeven synergies, sensitivity); a risk tear sheet
  on Account, Portfolios and the client report (VaR/CVaR, correlation heat map, rolling beta and Sharpe, drawdown
  table, monthly returns, block-bootstrap Monte Carlo, risk contribution); options analytics on Flow and OMON (own
  Black-Scholes IV, greeks, smile, term structure, expected-move band, skew); bond portfolio duration and key-rate
  durations in the bond calculator.
- v31: a read-only Futures page: the main US futures by sector (heat tiles, what's moving in % and in standard
  deviations, specs and roll dates), term structure when Schwab prices single contracts, and COT positioning per market.
- Charts show the TradingView attribution again (required by the Lightweight Charts licence).
- The helper refuses article links that point to your own computer or home network.
- The helper knows NYSE holidays and early-close days for 2026-2027 (no protocol change, but download the helper
  again to get it).
- Settings has an About section: not investment advice, data may be delayed, links to draft legal pages.
- Content Security Policy on the site; `LICENSE`, `THIRD_PARTY_NOTICES.md`; CI runs the helper tests.

## v21 (2026-10-24)

- Optional free Alpaca price history (Settings): about 3 years of 30-minute to 4-hour charts, and hourly history back
  to 2016 for the AI assistant. Market data only, never trading.
- Steadier helper: replies are no longer lost, the disk cache is saved off the main loop and memory use is capped.
- New look: one design system (spacing, type, tables, controls, light and dark), nothing clipped on phones.
- Faster indicators and fewer chart rebuilds.

## v20 (2026-10-23)

- Buys and sells have separate records; each setup is graded on its own side.
- Strategy lab: about 1,500 rule combinations tested walk-forward on data they were not chosen on; only ones that
  keep working (random-entry and overfitting checks) become "Lab:" strategies.

## v19 (2026-10-23)

- New Setups page with three time frames: short swing (hourly), swing (daily) and position (weekly).
- Each stock is judged against its own normal range; COT + z-score edge study; live entry alerts; out-of-sample
  check. The first scan after starting takes a few minutes longer while hourly and weekly history downloads.
