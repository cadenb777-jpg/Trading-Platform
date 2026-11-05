# Fincept Terminal: what to take, and how

Fincept Terminal (github.com/Fincept-Corporation/FinceptTerminal, studied at 7716ee8, Oct 2026) is a desktop app in
C++20/Qt6 with ~1,150 Python scripts: ~200 data connectors (FRED, World Bank, IMF, OECD, BLS, BEA, EIA, Treasury,
ECB/BoE/BoJ and other central banks, SEC/XBRL, CFTC, CBOE, Polymarket/Kalshi, CoinGecko, many paid APIs with keys)
and analytics wrappers (corporate finance: DCF, LBO, merger models, startup valuation; fixed income; options pricing;
portfolio optimisation (PyPortfolioOpt, skfolio); QuantStats tear sheets and Monte Carlo; statsmodels; backtesting
(vectorbt, backtesting.py, zipline, bt); ~400 strategy scripts; AI agents).

## Decision

Treated as a small decision game (our platform vs. Fincept, choices: merge code / run side by side / port ideas):

| | Merge its code into ours | Run it beside ours | Port the ideas into ours |
|---|---|---|---|
| Licence | AGPL-3.0: copying code obliges us to publish the whole platform under AGPL. Not acceptable for an RIA's private tool. | Fine (separate program) | Fine (ideas and public formulas are not copyrighted) |
| Fit | C++/Qt desktop vs. our web site + Python helper: no shared runtime | Two apps, two logins, two watchlists | One place, linked to the owner's accounts, Webull, journal, clients |
| Effort | Very high | Low (an installer) | Medium, done in reviewed steps |

Porting ideas dominates merging on every row; running it beside ours is a free, harmless extra. So: **port the
valuable ideas into this platform (our own code, free sources only), and optionally install Fincept separately.**

## What to port (gaps, ranked for a one-person RIA)

1. Macro world data: World Bank, IMF, OECD, BLS, BEA, US Treasury Fiscal Data, ECB (all free, no key) on the Macro page.
2. Prediction markets: Polymarket and Kalshi public odds for macro/political events next to the calendar.
3. Corporate finance: comparable-company multiples, LBO and merger (accretion/dilution) models beside our DCF.
4. Portfolio tear sheet: VaR/CVaR (historical and parametric), correlation matrix, rolling beta/Sharpe, drawdown
   table, Monte Carlo of the portfolio (QuantStats-style) on Account/Portfolios and in client reports.
5. Options analytics: Black-Scholes greeks, implied volatility smile and term structure from the option chain.
6. Strategy Lab ("Equilibrium-Prime"): the owner's boss's game-theory method as an AI mode
   ([SOLVE] [RED TEAM] [REDESIGN] [TUTOR] [SUMMARY MATRIX]) over uploaded sources, plus an exact solver
   (pure/mixed Nash for 2-player games, iterated dominance, backward induction, Shapley value) so the numbers are
   computed, not guessed.

Not ported: paid-key connectors, the 400 strategy scripts (our Setups/strategy lab already tests strategies with
honest statistics), crypto exchange connectors, the AI agent frameworks (our assistant already acts on the platform).
