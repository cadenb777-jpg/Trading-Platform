# Fincept Terminal: what to take, and how

Fincept Terminal (github.com/Fincept-Corporation/FinceptTerminal, studied at 7716ee8, Oct 2026) is a desktop app in
C++20/Qt6 with ~1,150 Python scripts: ~200 data connectors (FRED, World Bank, IMF, OECD, BLS, BEA, EIA, Treasury,
ECB/BoE/BoJ and other central banks, SEC/XBRL, CFTC, CBOE, Polymarket/Kalshi, CoinGecko, many paid APIs with keys)
and analytics wrappers (corporate finance: DCF, LBO, merger models, startup valuation; fixed income; options pricing;
portfolio optimisation (PyPortfolioOpt, skfolio); QuantStats tear sheets and Monte Carlo; statsmodels; backtesting
(vectorbt, backtesting.py, zipline, bt); ~400 strategy scripts; AI agents).

## Decision update (owner, 2026-11-16): use Fincept's code and interface

The owner reversed the earlier "ideas only" choice: we may now use Fincept Terminal's code (C++/Qt and its ~1,150
Python scripts), its layout and its way of organising screens, for a full relook of the platform. Remember this
project: github.com/Fincept-Corporation/FinceptTerminal (AGPL-3.0, studied again at its 2026-11-13 commit).

What that means (AGPL-3.0, plain words; not legal advice):
- **Private use is fine.** Copying its code into this platform and using it yourself needs nothing published.
- **Our whole platform becomes AGPL-3.0** once its code is in it: LICENSE changes to AGPL-3.0, Fincept's copyright
  notices stay on every copied file, and THIRD_PARTY_NOTICES lists what came from it.
- **Anyone else who gets it, or uses it over the internet, must be offered the full source code** (ours included).
  So: keep the GitHub repository private, run it in private mode (the site served from the owner's computer), and
  turn off the public website (GitHub Pages) and the public .exe download, or publish the source if that changes.
- Client reports (PDFs, numbers) are output, not the program: sending them to clients is not covered.

Relook order (small, reviewed steps; Prospects first, the owner's priority):
1. Prospects/CRM: Fincept's relationship map, notes, report builder and screener patterns for advisers and
   companies; its government data connectors (scripts/*_data.py, GOVERNMENT_DATA_SOURCES.md) for company sources.
2. Layout: its launchpad, dashboard and screen organisation applied to our pages (our colours: amber labels, white
   figures, green/red only for good/bad).
3. Analytics and data connectors page by page, replacing ours only where its version is better and tested.
Also studied for the CRM side: Twenty (github.com/twentyhq/twenty, AGPL-3.0, the CRM interface model) and Comp AI
CRM (github.com/trycompai/crm, MIT, an evidence-citing enrichment agent).

## Earlier decision (2026-10, superseded above)


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

## Second pass (Fincept README at eec7ff7, 2026-11-09)

Same rule as the first pass, and the owner's own: **its code is never copied, translated or "re-engineered"** (the
AGPL-3.0 would then oblige publishing this whole platform). Only its published feature list was read; each capability
below is built from public documentation, free sources and published maths in our own code. Bloomberg likewise: its
capabilities, never its look, names or screens.

Its open build lists: analytics (DCF, optimisation, VaR, derivatives, fixed income, an 18-module QuantLib suite), 37 AI
agents, 100+ data connectors, crypto feeds (Kraken, Hyperliquid), paper trading and 16 brokers, a visual node editor,
and "global intelligence" (maritime tracking, geopolitics from HDX/ACLED, relationship mapping), news clustering and
deviation monitors. Most analytics are already here (first pass, institutional-edge.md, rd-backlog.md). The gaps:

| # | Capability | Free source | Method | Home | Effort | Edge |
|---|---|---|---|---|---|---|
| F1 | **News surge monitor** (a stock's headlines far above its normal pace, Bloomberg-style "unusual news") | the news the helper already fetches (Google News / CNBC RSS) | daily headline count per symbol vs its own 30-day mean and SD (z-score), grouped stories counted once | Home Edge + Live flow alerts | S | Medium |
| F2 | **Geopolitical risk** by country and over time | Caldara and Iacoviello Geopolitical Risk index (free download, daily and monthly; AER 2022) and the GDELT 2.0 DOC API (no key: article volume and tone by query) | GPR level and percentile; GDELT conflict-coverage volume by country vs its own baseline | Macro → World | M | Medium |
| F3 | **Supply chain and relationship map** (who a company sells to, buys from, competes with) | 10-K concentration (built, A4), segments (A1), SEC full-text search for "customer"/"supplier" mentions, the SEC ticker list to link names | named counterparties as a graph; each linked company opens its own page; exposure % where disclosed | Research → "Who it depends on" | M | High |
| F4 | **Crypto positioning**: perpetual-futures funding rates, open interest and basis for BTC/ETH/SOL | Hyperliquid public info API and Kraken Futures public tickers (no key) | annualised funding, OI change, perp − spot basis; percentile vs own history (collected going forward) | Investments → Crypto | S | High |
| F5 | **Supply-chain stress** (Fincept's maritime tracking, done with free indexes instead of ship-by-ship AIS) | NY Fed Global Supply Chain Pressure Index (free monthly), FRED freight series (TSIFRGHT, transport services) | level and percentile, 3-month change | Macro | S | Medium |
| F6 | **AI desks**: the assistant answering as a named role (macro strategist, value analyst, risk manager, options trader) with that desk's tools and checklist | existing AI engine and tools | one prompt and tool list per desk; never trades | AI panel | S | Medium |

Left out on purpose: ship-by-ship maritime tracking (needs a per-user AIS key and a heavy live map; F5 gives the
signal), the node editor (alerts, schedules and the improvement runs already automate), a second paper-trading engine
(Webull Test is paper trading), and 37 agent personas (F6 covers the useful desks; simplicity scales).
