# Trading Platform

A personal, customizable charting and trading platform, like your own TradingView.

- **Home page:** greeting, live S&P 500 / Dow / Nasdaq cards, market news (Google News and
  CNBC) in sections (Top stories, Economy, Markets, Companies, Crypto, My watchlist) with
  market-impact ratings, upcoming economic events, and your watchlist
- **Smart summaries:** click any headline for its key takeaways inside the app
- **Economic calendar:** list and month views; Fed decisions, CPI, jobs reports and more, with
  impact, forecast, previous and actual, a plain-English note and related news for each event
- **Scripts:** write your own indicators in a Pine Script v5-style language, with a built-in
  reference and examples; they appear in the Indicators menu
- Real-time US stock prices from **every exchange** via your Schwab account and the
  [Schwab helper](helper/README.md) (free); real-time crypto from Coinbase (free)
- 19 timeframes from 5 seconds to 1 month; star your favourites
- Chart types: candles, hollow candles, Heikin Ashi, OHLC bars, line, area
- Drawing tools: trend line, ray, horizontal and vertical lines, rectangle, Fibonacci
  retracement, and long/short positions with take profit, stop loss and risk/reward
- 41 indicators, including Ichimoku, SuperTrend, Parabolic SAR, Pivot Points, ADX/DMI, Keltner,
  Hull MA, Stochastic RSI, MFI and more, each with its own settings, timeframe, colours, line
  thickness and placement (on the chart or in a pane below)
- Watchlist with live prices; your layout and drawings are remembered
- **Quant charting:** VWAP bands, Z-score channels, buy/sell signal markers, volume profile,
  price alerts and a 2- or 4-chart layout
- **Flow:** unusual options activity, put/call ratios, max pain and gamma exposure; insider
  trades from SEC Form 4; futures positioning from the CFTC's Commitment of Traders report
- **Research:** financial statements from SEC filings, key ratios, a DCF valuation calculator
  and the filings list. **Macro:** rates, inflation, jobs, growth and the yield curve from FRED
- **Portfolios:** total-return history (dividends included), risk statistics, stress tests,
  Monte Carlo and weight optimisation (max Sharpe, minimum risk, risk parity, Black-Litterman)
- **Backtest:** try strategies on history with commissions, slippage, stops and targets
- **AI assistant (✦ in the left menu, or Ctrl+K):** ask about any stock or the market and it answers with live
  data; it can build and save portfolios, open charts, add indicators and set alerts; attach Excel, CSV, PDF or
  image files; pop it out into its own window. "AI analysis" buttons on Flow, Research and every indicator's ⓘ.
  Needs your own Anthropic API key (Settings, gear icon)
- **Stock positioning:** short-sale volume (FINRA), the related futures market's COT, options and insiders for any
  stock, plus COT and short-volume indicators for charts
- **Clients & reports:** client accounts and white-label PDF performance reports with your
  logo, colours and disclosures (1, 3, 5, 10-year and since-inception returns)

## Roadmap

See [ROADMAP.md](ROADMAP.md): the plan for a personal Bloomberg-style workstation, from smart-money
flow and fundamentals to portfolio risk, client reporting, an AI copilot and trading.

## Using it

### Stock data from Schwab (free, all exchanges)

Follow the [Schwab helper setup guide](helper/README.md). The helper runs on your computer
and feeds live data to the charts.

### Adding indicators

Click **ƒx Indicators**, then pick any indicator. Hover over an indicator's name on the chart
to show buttons to hide it (👁), change its settings (⚙) or remove it (✕).

### Drawing

Pick a tool on the left of the chart and click on the chart (two clicks for lines). Click a
drawing to select it, drag it or its handles to move it, and press **Delete** to remove it.
The magnet snaps points to candle prices. For take profit and stop loss, use the **Long** or
**Short position** tool and drag the green and red edges.

## For developers

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install     # install dependencies
npm run dev     # start a local server at http://localhost:5173
npm test        # run the indicator tests
npm run build   # build the site into dist/
```

### How the code is organised

```
src/
  main.ts                 App shell and navigation (one entry per page)
  state.ts                Everything remembered between visits
  pages/homePage.ts       Greeting, index cards, news, watchlist
  pages/chartPage.ts      Chart toolbar, drawing bar, legend, live updates
  pages/calendarPage.ts   Economic calendar (list and month views)
  pages/scriptsPage.ts    Script editor for your own indicators
  pages/                  Also multi-chart, flow, research, macro, portfolio, backtest, clients
  backtest/               Backtesting engine and ready-made strategies
  research/dcf.ts         DCF and WACC maths
  reports/                White-label client report builder (print to PDF)
  script/interpreter.ts   The Pine-style script language
  chart/ChartView.ts      Draws price and indicators (TradingView Lightweight Charts)
  chart/drawings.ts       Drawing tools
  indicators/library.ts   Core indicators; indicators/more.ts has the extended library
  indicators/math.ts      Shared maths (SMA, EMA, RSI, …)
  data/                   Market data (Coinbase, Schwab), live quotes, news
  ui/                     Watchlist, timeframe picker, dialogs, icons
  storage.ts              Saves to the browser
helper/
  schwab_helper.py        Runs on your computer; streams Schwab data to the charts
  engine/                 Analysis engine in the helper: flow, SEC, FRED, portfolio maths,
                          and a small database (~/.trading-platform/platform.db) for clients
```

### Adding an indicator

Add an entry to `INDICATORS` in `src/indicators/library.ts` with its inputs, plots and a
`compute` function that returns one array of numbers per plot (use `NaN` where there is no
value yet). It then appears in the Indicators menu automatically.
