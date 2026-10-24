# Roadmap: a personal Bloomberg

The goal is an institutional-grade workstation for one person: live charts and analytics,
smart-money flow, fundamentals and valuation, portfolio and risk tools, client reporting, an AI
market copilot, and trading. It blends two styles: a high-density, AI-assisted market discovery
screen, and a Bloomberg Terminal-style research and portfolio workstation.

Built for free first. Paid data is optional and marked 💲.

## How the system fits together

```
 Browser app (TypeScript, GitHub Pages)            Engine (Python, your PC, later the cloud)
 ─────────────────────────────────────            ─────────────────────────────────────────
 Pages: Home · Chart · Calendar · Scripts          Data layer: Schwab, Coinbase, SEC EDGAR, FRED,
        Flow · Fundamentals · Portfolio ·            FINRA, CFTC, news feeds, Webull (trading)
        Reports · Copilot                         Calculation engine: NumPy / Pandas / SciPy
 Chart engine: TradingView Lightweight Charts        (risk, optimisation, valuation, backtests)
 Indicators + Pine-style scripts (instant,        Storage: SQLite (portfolios, clients, history)
   run in the browser on every tick)              Reports: HTML templates → PDF
                 ▲                                AI: Claude API (key kept in the engine)
                 └──────── WebSocket (JSON) ───────────┘
```

Rules that keep it maintainable:

- **Data → calculation → display stay separate.** Every data source returns the same clean shapes
  (bars, quotes, statements as tables), so adding or swapping a source never breaks a screen.
- **Chart indicators run in the browser** (instant, already built). **Heavy quant runs in Python**
  (vectorised NumPy/Pandas), where those libraries are strongest.
- **Secrets never reach the browser.** API keys live in the engine.
- **Trading is opt-in and confirmed.** Paper trading first; every real order needs a confirmation.

Planned engine layout (the current `helper/` grows into this):

```
helper/
  schwab_helper.py        entry point (start files run this)
  engine/
    server.py             WebSocket requests and pushes
    data/                 schwab.py, coinbase.py, sec.py, fred.py, finra.py, cftc.py, news.py, webull.py
    quant/                returns.py, risk.py, optimize.py, valuation.py, backtest.py, profile.py
    portfolio/            holdings.py, transactions.py, performance.py
    reports/              builder.py, templates/, branding.py
    ai/                   copilot.py (Claude API)
    store.py              SQLite storage
  tests/                  pytest, checked against reference values
```

## Status

| Stage | What | Status |
|---|---|---|
| 1 | Live charts, Schwab + Coinbase data, 19 timeframes, chart types | ✅ |
| 2 | Home page, news with impact ranking and summaries, watchlist, economic calendar, drawing tools (incl. TP/SL) | ✅ |
| 3 | 41 indicators with per-indicator timeframe; Pine-style script editor | ✅ |
| 4 | Quant charting: VWAP bands, Z-score, signal markers, volume profile, price alerts, multi-chart | ✅ |
| 5 | Flow: options activity, max pain, gamma, insider trades, COT (dark pool on hold) | ✅ |
| 6 | Research (SEC financials, ratios, DCF, filings) and Macro (FRED, yield curve) | ✅ |
| 7 | Portfolios: total-return analytics, risk, stress tests, Monte Carlo, optimisation; backtester | ✅ |
| 8 | Clients and white-label PDF reports (branding, batch printing) | ✅ |
| 9 | AI assistant: chat with live data and actions, pop-out, file uploads, AI analysis buttons | ✅ (morning brief and agents later) |
| 9b | Investments: market boards (stocks, ETFs, bonds, alts, crypto, commodities), bond suite (yields, Treasury auctions, CUSIP lookup, calculator, ladder), private funds from SEC filings (NAV, N-PORT, Form D), own alternatives tracker with iCapital import | ✅ |
| 9c | Backtest research (chart-linked rules, Monte Carlo, random-walk test, parameter sweep), Williams COT/WAD, portfolios by shares/dollars with cash and alternatives, in-depth client reports with alternatives | ✅ |
| 9d | Interactive pop-out charts (hover values, ranges, % / log scale, CSV), clickable yield curve and rates, accurate index changes, in-depth options put/call, AI summaries per page, background market scanner with backtested setups on Home | ✅ |
| 9e | Nasdaq-100 swing scanner every 5 min (weekly swing: COT + z-score + Williams; mean reversion; breakout) with backtests, random-entry and random-walk tests; light/dark mode; candlestick index cards; indicator manager with per-line editing; RIA fee schedules in client reports | ✅ |
| 9f | Setups page: short-swing / swing / position time frames, per-stock adaptive bounds, COT + z-score edge study, 1,000-run tests with block bootstrap and false-discovery control, out-of-sample check, live entry alerts; indicators on every line chart; faster loading | ✅ |
| 9g | Setups v22: honest tests (clustered random entry, after-cost R, Holm across strategies, robustness), 15-year daily and kept hourly history (Alpaca optional), simpler rules, lab forward records, weekly rule tests on your data | ✅ |
| 10 | Trading through Webull (paper first) & alerts | ⏸ on hold |
| 11 | Cloud engine, login, phone access | ⏸ on hold (last, by choice) |

## Stage 4: Quant charting upgrades (Module 1, finishing)

- VWAP with ±1/2/3 standard-deviation bands; anchored VWAP from a clicked bar
- Z-score channels, volatility-adjusted SuperTrend, regression channels
- **Volume profile / market profile** (point of control, value area) drawn beside the price axis
- Buy/sell **signal markers** on the chart from indicators and scripts
- Script engine: bar-by-bar mode so `if` blocks, `var` and loops work; `plotshape`, `fill`, `bgcolor`
- Multi-chart layouts (2 or 4 charts, linked symbols/timeframes)
- Price and indicator **alerts**

Data: all from existing feeds. Free.

## Stage 5: Smart money & flow (Module 2)

| Feature | Source | Cost |
|---|---|---|
| Unusual options activity: volume vs open interest, put/call ratio, max pain, gamma exposure estimate | Schwab option chains | Free |
| Short volume (daily) and off-exchange (dark pool / ATS) volume (weekly, 2–4 weeks delayed) | FINRA | Free |
| Commitment of Traders (futures positioning) | CFTC | Free |
| Insider buys and sells | SEC Form 4 | Free |
| Fund holdings (13F) and changes | SEC 13F | Free |
| Congress trades | Public disclosures | Free |
| Volume delta and buy/sell pressure (estimated from bars) | Our own data | Free |
| Real-time options sweeps/blocks, live dark pool prints | Paid flow feed | 💲 optional |

Screens: a **Flow** page (market-wide), a flow panel on each chart, and sentiment flags in the watchlist.

## Stage 6: Fundamentals, filings & valuation (Module 3)

- Income statement, balance sheet and cash flow (annual and quarterly), charted over time: SEC EDGAR XBRL (free)
- Key ratios (margins, growth, ROE, debt, valuation multiples), peer comparison tables
- Filings feed (10-K, 10-Q, 8-K) with summaries
- Earnings calendar with estimates vs actuals
- Valuation: DCF builder with WACC, relative-multiple valuation, scenario sliders
- Macro dashboard: rates, inflation, jobs, GDP, yield curve: FRED (free key)

## Stage 7: Portfolio analytics, risk & optimisation (Module 4)

- Portfolios from manual entry, CSV import, or read-only Schwab/Webull account sync
- Performance: time-weighted and money-weighted returns, vs a benchmark
- Risk: drawdowns, volatility, Sharpe, Sortino, beta, correlation, Value at Risk and CVaR
- Stress tests and scenarios (e.g. 2008, 2020, rate +1%)
- Optimisation: mean-variance (efficient frontier), risk parity, Black-Litterman, Monte Carlo
- **Backtesting**: test strategies (including `strategy()` scripts) on history with costs and slippage

## Stage 8: Client portfolios & white-label reporting (new)

- **Clients and accounts**: clients, households and their portfolios, model portfolios, target allocations
- **Performance reporting**: 1, 3, 5 and 10-year and since-inception returns (annualised),
  year-to-date, calendar-year returns, vs benchmark; growth of $10,000 chart
- Allocation by asset class/sector, top holdings, risk statistics, income/dividends, fees
- **White-label PDF reports**: your logo, colours, firm name and contact details, custom cover
  page and commentary, standard disclosures
- One-click generation, batch quarterly reports for all clients, report history
- Client data stays in the engine's database, not the browser

Note: sending performance reports to paying clients is regulated (e.g. investment-adviser rules
and performance-advertising standards). The reports will include disclosures, but check what
applies to you before using them commercially.

## Stage 9: AI market copilot (Module 5)

- Morning brief: what's moving, why it matters, what to research next
- "Why is this stock moving?" on any chart, combining price action, news and flow
- Earnings call and filing summaries; macro release explanations
- Research assistant that can query your data (fundamentals, flow, portfolio)
- Uses the Claude API (💲, usually a few dollars a month for personal use); the key stays in the engine

## Stage 10: Trading & alerts

- Webull account, balances and positions in the platform
- Order ticket on the chart (market, limit, stop, bracket orders from the TP/SL tool), paper first
- Confirmations on every order; daily loss limits
- Alerts by phone (e.g. Telegram or email) for prices, indicators, flow and news

## Stage 11: Cloud, login & phone

- Move the engine to a free cloud server so it runs 24/7 without your PC
- Secure login; the platform works on your iPhone anywhere
