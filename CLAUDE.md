# Notes for Claude

The owner is a beginner. Explain changes in plain language, keep steps small, and prefer free services.

## Stack

- Vite + TypeScript, no UI framework (plain DOM via the `h()` helper in `src/ui/dom.ts`).
- Charts: `lightweight-charts` v5 (panes API: `chart.addSeries(def, opts, paneIndex)`, `pane.addSeries`).
- Static site, deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.
- No server backend. The chart layout lives in localStorage (`src/storage.ts`). Market data: Coinbase (crypto,
  public, no key) and Schwab (stocks, via the helper). Secrets never go in the repo or the browser.
- `helper/schwab_helper.py` runs on the owner's computer (schwab-py). It talks to `src/data/schwab.ts`
  over `ws://127.0.0.1:8765`. Requests: history {symbol, resolution (1m/5m/10m/15m/30m/1D/1W), days},
  news {symbols, query}, summary {links, title}, calendar, subscribe/unsubscribe {symbol}. Pushes: status (with version), trade,
  quote {last, prevClose}. HELPER_VERSION in the helper must match REQUIRED_HELPER_VERSION in schwab.ts.
  Replies carry the request id; failures come back as error. Keys/token live in `~/.trading-platform/`.
  News comes from Google News RSS and CNBC RSS (Google Finance has no feed); `rank_news` groups
  duplicate stories, assigns a section and scores market impact with keyword weights (free, no AI).
  Calendar: Forex Factory this-week JSON only (there is no next-week feed) plus hard-coded FOMC dates.
  Summaries: the helper fetches the article (decoding Google News links via batchexecute) and
  extracts key sentences (`summarize_text`); no paid AI.
  Changing the protocol means the owner must re-download the helper; say so.
  Engine (helper/engine/): `@handler('name')` registers request types (flow.*, research.company, macro.*,
  portfolio.analyze/optimize, store.*); the browser calls them with `engineRequest()` and replies come back as
  type engine. Uses numpy/scipy, SEC EDGAR (contact email asked once), FRED CSV, CFTC, Yahoo dividends (total
  return). Clients, portfolios and branding live in SQLite ~/.trading-platform/platform.db, never the browser.
  Client firm branding (logo etc.) is imported from a file; never commit a real firm's branding to the repo.
  It is market-data only: never add order placement to it (the Schwab app's order limit is 0).
  Trading is planned through Webull.

## Conventions

- Indicators are data-driven: one `IndicatorDef` per entry in `src/indicators/library.ts`.
  `compute()` returns arrays aligned with the bars, `NaN` for warm-up.
- Data providers implement `DataProvider` (`src/data/provider.ts`): `loadHistory` returns bars,
  `subscribe` streams trades; `applyTrade` in `src/types.ts` folds trades into bars.
- Bar `time` is UTC unix seconds. Timeframes are defined in `src/types.ts`; providers fetch a native
  bar size and `regroupBars` builds the rest. Second timeframes have no history (built from trades).
- App state (watchlist, favourites, chart type, indicators) is in `src/state.ts`; call `persist()`
  after changing it. Drawings are stored per `provider:symbol`.
- Drawings are a Lightweight Charts series primitive (`src/chart/drawings.ts`), stored as time+price.
- User scripts: `src/script/interpreter.ts` is a vectorised Pine v5 subset (no if/for blocks). Scripts are
  stored in localStorage and registered as indicators with id `script:<id>` before state loads.
  Add new ta.* functions to FUNCS there and document them in `src/script/reference.ts`.
- Check UI changes in a browser (Playwright with `executablePath: '/opt/pw-browsers/chromium'`).

## Commands

- `npm test` runs vitest (indicator maths against reference values).
- `npm run build` type-checks and builds to `dist/`.

## Planned

The full plan (a personal Bloomberg, including client reporting) is in ROADMAP.md. Follow its stage
order and architecture rules; update its Status table when a stage is done.

Later stages (trading via Webull, AI agents) will need a small backend so secrets are
not exposed in the browser. Real-money trading must stay behind explicit confirmation, and
paper trading comes first.
