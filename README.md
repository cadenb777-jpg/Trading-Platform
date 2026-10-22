# Trading Platform

A personal, customizable charting and trading platform, like your own TradingView.

**Stage 1 (done):** live candlestick charts with an indicator library.

- Real-time crypto prices from Coinbase (free, no account)
- Real-time US stock prices from **every exchange** via your Schwab account and the
  [Schwab helper](helper/README.md) (free)
- 14 built-in indicators: Volume, SMA, EMA, WMA, VWAP, Bollinger Bands, Donchian Channels,
  RSI, MACD, Stochastic, CCI, Williams %R, ATR, OBV
- Add, configure, recolour, hide and remove indicators; your layout is remembered
- Timeframes: 1m, 5m, 15m, 1h, 1D

## Roadmap

| Stage | Feature | Status |
|---|---|---|
| 1 | Charts, live data, indicator library | ✅ |
| 2 | Drawing tools, more indicators, custom indicators, multiple saved layouts | |
| 3 | Watchlist and multi-chart layouts | |
| 4 | Trading through Webull: account, positions and orders, with confirmations | |
| 5 | News feed and AI agents for strategies and backtesting | |
| 6 | Login and hosting so it works from anywhere | |

## Using it

### Stock data from Schwab (free, all exchanges)

Follow the [Schwab helper setup guide](helper/README.md). The helper runs on your computer
and feeds live data to the charts.

### Adding indicators

Click **ƒx Indicators**, then pick any indicator. Hover over an indicator's name on the chart
to show buttons to hide it (👁), change its settings (⚙) or remove it (✕).

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
  main.ts                 App startup, toolbar, legend, live-update loop
  chart/ChartView.ts      Draws candles and indicators (TradingView Lightweight Charts)
  indicators/library.ts   The indicator library — add new indicators here
  indicators/math.ts      Shared maths (SMA, EMA, RSI, …)
  data/                   Market data sources (Coinbase, Schwab)
  ui/                     Dialogs (indicator picker, indicator settings)
  storage.ts              Saves your chart layout in the browser
helper/
  schwab_helper.py        Runs on your computer; streams Schwab data to the charts
```

### Adding an indicator

Add an entry to `INDICATORS` in `src/indicators/library.ts` with its inputs, plots and a
`compute` function that returns one array of numbers per plot (use `NaN` where there is no
value yet). It then appears in the Indicators menu automatically.
