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
  main.ts                 App shell and navigation (Home / Chart)
  state.ts                Everything remembered between visits
  pages/homePage.ts       Greeting, index cards, news, watchlist
  pages/chartPage.ts      Chart toolbar, drawing bar, legend, live updates
  pages/calendarPage.ts   Economic calendar (list and month views)
  pages/scriptsPage.ts    Script editor for your own indicators
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
```

### Adding an indicator

Add an entry to `INDICATORS` in `src/indicators/library.ts` with its inputs, plots and a
`compute` function that returns one array of numbers per plot (use `NaN` where there is no
value yet). It then appears in the Indicators menu automatically.
