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
  quote {last, prevClose}. HELPER_VERSION in the helper must match LATEST_HELPER_VERSION in schwab.ts. Older helpers
  keep working for core requests (charts/quotes/news/calendar); engine requests need ENGINE_HELPER_VERSION, and the
  site shows an update banner instead of blocking. Unknown requests get an error reply (never silence).
  Engine modules load independently (`engine.LOAD_ERRORS`); optional packages are in requirements-extra.txt and the
  helper logs to ~/.trading-platform/helper.log. Pages are created on first visit (dynamic import) in main.ts.
  Replies carry the request id; failures come back as error. Keys/token live in `~/.trading-platform/`.
  News comes from Google News RSS and CNBC RSS (Google Finance has no feed); `rank_news` groups
  duplicate stories, assigns a section and scores market impact with keyword weights (free, no AI).
  Calendar: Forex Factory this-week JSON only (there is no next-week feed) plus hard-coded FOMC dates. The feed has no
  actuals: US actuals come from FRED after release (helper/engine/actuals.py, only when FRED has that exact period;
  earlier readings are looked up by date, and prelim/final GDP are left out because FRED still holds the advance).
  Summaries: the helper fetches the article (decoding Google News links via batchexecute) and
  extracts key sentences (`summarize_text`); no paid AI.
  Changing the protocol means the owner must re-download the helper; say so.
  Engine (helper/engine/): `@handler('name')` registers request types (flow.*, research.company, macro.*,
  portfolio.analyze/optimize, store.*); the browser calls them with `engineRequest()` and replies come back as
  type engine. Uses numpy/scipy, SEC EDGAR (contact email asked once), FRED CSV, CFTC, Yahoo dividends (total
  return). Clients, portfolios and branding live in SQLite ~/.trading-platform/platform.db, never the browser.
  Client firm branding (logo etc.) is imported from a file; never commit a real firm's branding to the repo.
  `id` and `type` are reserved in every helper message (request id / kind): name engine parameters otherwise
  (e.g. `series`, `docId`). Long requests stream `engine_event` messages before the reply (`onEvent`).
  Settings (Anthropic key, model, SEC email, FRED key) are set in the Settings window and saved by the helper in
  ~/.trading-platform/settings.json; keys are never stored in or sent back to the browser.
  AI (engine/ai.py): official `anthropic` SDK, default model claude-opus-5-5 with server-side fallbacks, tools over
  engine data plus `ui_action` (browser carries out open_chart/add_indicator/create_alert). It must never trade.
  Investments page (src/pages/investmentsPage.ts, src/invest/): boards via invest.board (quotes + 1m/3m/YTD/1y from
  daily closes), invest.history/movers/search; bonds.market (FRED yields/spreads), bonds.auctions (Treasury Fiscal Data),
  bonds.cusip (Schwab get_instrument_by_cusip); alts.fund (SEC: XBRL NAV per share, N-PORT, Form D, NAV sentences from
  424B3/8-K; navHistory = monthly NAV line parsed from the last ~16 NAV filings + 3 10-Qs by alts.nav_points/nav_series, shown
  instead of the XBRL NAV when newer), alts.search_private (EDGAR full-text search of Form D), alts.latest_private (latest Form D feed).
  The private fund directory is src/invest/catalog.ts (names only; data is live from the SEC). src/invest/fundSnapshots.ts
  holds hand-researched latest published figures (dated, sourced, verified flag; shown unless the SEC data is newer). Bond maths is
  src/invest/bonds.ts. The owner's own alternatives are store collection alt_holdings (iCapital has no public API:
  they import a CSV/Excel export, src/invest/holdings.ts).
  Backtest (src/pages/backtestPage.ts, src/backtest/research.ts): "My chart's indicators" builds rules (operand
  operator operand, ALL/ANY) from state.indicators via suggestRules(); the chart's Backtest button fires
  `tp:backtest-chart`. Research tabs: Monte Carlo (trade bootstrap), random-walk test (shuffled daily moves, p-value),
  parameter sweep (overrides keyed `uid.inputKey`), monthly returns, deep stats. Seeded RNG so results repeat.
  Portfolios: Holding.kind security/cash/alt, Portfolio.mode weight/shares/dollars; positions()/holdingsPayload()
  in src/portfolio/types.ts value holdings (live prices via src/portfolio/prices.ts) and map cash/alts to listed
  stand-ins (PROXIES) for the maths. holdingsPayload throws when a shares-mode holding has no price.
  Client reports (src/reports/report.ts) are for the owner's own RIA use: sections toggled by Client.sections; include
  linked alt_holdings (Client.altIds), SEC fund facts (alts.fund) and a market overview (invest.board). Long tables
  page-break by chunks. Fees: Client.feeSchedule (flat or tiered brackets, monthly/quarterly/annual, arrears or
  advance) is debited from the account in portfolio.analyze (quant.apply_fees, first period prorated by calendar
  days); the report shows net and gross returns and fees paid per year. Client.fee (flat, daily) is the old fallback.
  Engine modules load on a background thread (engine.start_loading in main; engine.wait_loaded for requests
  that arrive early). After start the helper warms caches (news, headline board, curve, bond market) and opens
  the platform in Chrome (settings open_browser, flag --no-browser) unless a tab connects within 3 s.
  Launcher: start files run `splash.py run`, which shows the start screen, runs pip with hidden output behind one
  0-100% bar and starts the helper with TP_SPLASH (seed) and TP_HANDOFF; the helper then continues the bar
  (splash.HelperScreen), logs only to the file and shows one live status line. Interactive steps (Schwab keys,
  login) pause the screen. Keep splash.py standard-library only.
  Quotes: the helper polls Schwab's REST quotes every 30 s (`refresh_official`); prevClose = lastPrice - netChange.
  The stream's CLOSE_PRICE is only a fallback (after the session it becomes today's close, which read as 0%).
  Scanner (engine/scanner.py + engine/strategies.py): a background task (`market_scanner`) scans the
  Nasdaq-100 (NASDAQ_100 list; update it after each December rebalance) every 5 minutes (owner's request). Daily history is fetched once per day; today's bar comes from the live quotes.
  strategies.py is pure and tested: weekly_swing (primary: weekly trend from finished weeks, Williams COT index for
  commercials >= 60 / <= 40 when available, z-score(20) beyond ±1 and turning, Williams %R crossing out of -80/-20,
  Williams A/D vs its 20-day EMA; buy-stop above the signal day's high, stop past the 3-day swing (0.75-2 ATR),
  target ±1 SD band, exit after 5 sessions, break-even at +1R), mean_reversion (RSI2 + z-score with the 200-day
  trend, exit on a close across the 5-day average or 7 days) and breakout (Donchian 20 + ADX + volume, 10-day
  trailing exit). COT is used from the Friday after its Tuesday data date. Every signal/plan/exit at bar i uses only
  bars <= i (tests check this). Pooled random-entry test per strategy and per-stock random-walk test (shuffled daily
  moves, seeded). Tier A = strategy beats random entries (PF >= 1.2, p <= 0.10) + stock record not failed + COT
  not against + no earnings in the hold (Nasdaq earnings calendar; failure = "unavailable", never "none") + R:R >= 1.5
  (weekly swing). B = profitable strategy and no failed check of its own; non-A cards carry `why` (plain reasons, v13)
  and `whyCodes` (one code per reason, v17; the Home banner counts the main one).
  Simulations are 1,000 each: pooled random-entry (cached per day), per-stock random walk (RW_RUNS, background worker
  `_run_rw_jobs`, card shows pending first) and Monte Carlo of the next 20 trades (`monte_carlo`). Clicking a card opens
  the trade guide pop-up (src/home/tradeGuide.ts: verdict, step-by-step entry/stop/target/exit, size calculator, grade).
  Each strategy shows its newest signal within SIGNAL_LOOKBACK (25) sessions whose trade is still waiting or open
  (a confirmed one beats today's forming one); `new` = signalled at the latest close; `conflict` = another strategy
  points the other way on the same stock (neutral check + warning, v18).
  Statuses: forming (today's bar), ready, waiting (trigger valid 2 days), in trade. Schwab requests
  are paced (one at a time, 0.7 s apart); unknown symbols are skipped for a day, only an expired login stops a scan.
  Time frames (v19, strategies.HORIZONS): short (1-hour bars from 30-minute history, regular session only, refreshed every
  30 min; daily trend filter), swing (daily; weekly trend) and position (weekly bars, 15 years; monthly trend). Each runs
  the three strategies with its own entry window and hold (in bars); the forming bar (hour/day/week) is updated from
  live quotes on every 5-minute scan. Results: `horizons[h]` = {strategies (with `recent` = last 30% of history,
  tStat, tradesNeeded), setups, edge}; the top level keeps swing for older pages. Universe: Nasdaq-100 only (owner).
  Thresholds fit each stock: z-score and RSI(2) bands are the stock's own rolling percentiles (rolling_quantile,
  causal), stops/targets in ATR. Monte Carlo uses the stationary bootstrap; per-stock random-walk p-values get
  Benjamini-Hochberg q-values; `edge` = COT + z-score edge study (cot_z_events/edge_summary, 1,000-run permutation).
  Buys and sells have separate records (`strategies[k].sides.long/short`, v20); setups are graded on their own side.
  Strategy lab (engine/lab.py, v20): 11 theory triggers x up to 2 of 11 filters x side (~1,474 combinations), walk-forward
  over 3 windows with an embargo, kept if chosen in 2+ windows, profitable on unseen trades (30+), Holm-corrected
  random-entry p <= 0.10 and PBO <= 50%; deflated Sharpe reported. Re-runs when the time frame has a new finished bar
  (scanner._run_lab, stamp = newest bar); survivors register as `lab_<horizon>_<n>` strategies judged only on their
  unseen period (`oos_from`); rejects go to ~/.trading-platform/lab_graveyard.json. Market filter = QQQ vs its 50-day
  average as of the previous day (market_trend_by_date).
  Statistics rationale and sources: docs/research/setups-statistics.md.
  Setups page (src/pages/setupsPage.ts, route #setups): time-frame tabs, strategy evidence cards, edge study, sortable
  list, detail with live entry zone (src/home/entryZone.ts: waiting/approaching/entry/extended/target/invalid/expired,
  chase limit 0.25R), chart with entry/stop/target and the trade guide (tradeGuideBody). Watched setups (and A/B when
  "Alert me" is on) follow live quotes and alert with a sound/notification. Layout is basics first: a "Today" summary,
  a folded daily routine and strategy report card (evidence strength label), a simple list; the guide opens with "The
  read" (src/home/tradeRead.ts: for/against factors, conviction capped by grade, what to do) and folds the grade
  reasons, statistics, readings and levels. Terms have an "i" tooltip (src/ui/glossary.ts TERMS / infoTip). Home shows a small teaser
  (src/home/setupsTeaser.ts); src/home/setupsPanel.ts now only provides types and the old card helpers.
  AI summary buttons (`insightButton`) are on Home, Flow, Research, Macro, Bonds, Investments boards, fund detail
  and Backtest; not on the Chart page or Portfolios (owner's choice).
  Theme: light/dark via CSS variables (`:root[data-theme='light']`) and src/ui/theme.ts (THEME object updated in place,
  `followTheme(chart)` repaints canvases). Use variables, not hard-coded colours, in new CSS.
  Chart legend (chartPage renderLegend) is rebuilt only when its layout changes; values update in place. Indicator
  instances can hide single plots (`hiddenPlots`) and levels (`hideLevels`); the manager is openIndicatorManager.
  Browser reply cache: engineRequest reuses read-only replies for ENGINE_CACHE_MS (20 s quotes .. 60 min catalogs),
  joins identical in-flight requests, never caches store/settings/ai/scanner or failures; Refresh buttons call
  clearEngineCache. Investments prefetches sections on hover and in the background; fund cards prefetch alts.fund.
  Line-chart indicators: chart windows have an Indicators menu (src/ui/windowIndicators.ts, LINE_INDICATORS run on
  the first line as flat bars); page charts have an fx button that opens it.
  Pop-out charts: `openChartWindow` (src/ui/chartWindow.ts); `createLineChart` adds hover values and an expand button;
  `openFredWindow` opens a FRED series' full history.
  Downloaded data is cached in ~/.trading-platform/cache.db (`ctx.cached(..., persist=True, stale_ok=True)`).
  Indicators can load outside data via `IndicatorDef.external` (COT for the related futures market, FINRA short volume).
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
- `python -m unittest discover helper/tests` tests the helper's trading maths (standard library only; run it with
  the helper's Python environment so its packages import).

## Planned

The full plan (a personal Bloomberg, including client reporting) is in ROADMAP.md. Follow its stage
order and architecture rules; update its Status table when a stage is done.

Later stages (trading via Webull, AI agents) will need a small backend so secrets are
not exposed in the browser. Real-money trading must stay behind explicit confirmation, and
paper trading comes first.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for cadenb777-jpg/trading-platform (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The seven default labels: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root and ADRs in `docs/adr/` (created when first needed). See `docs/agents/domain.md`.

### External peers

Host-only: code review and jury use Claude reviewers only, with no external CLI. See `docs/agents/cross-model.json`.
