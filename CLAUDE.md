# Notes for Claude

**Mantra: simplicity scales.** Fewer rules, indicators and settings; remove before adding; anything that doesn't earn
its place in honest tests goes.

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
  AI screen context (v23): the browser sends the open page's visible text plus any open pop-up (src/ai/screen.ts,
  capped 8,000 chars) as context.screen; ai.py adds it in a <screen> block only when it changed since the last message;
  PAGE_SUGGESTIONS gives per-page example questions.
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
  Dividends (v24, engine/dividends.py `dividends.portfolio`, src/portfolio/dividendsView.ts): shares-mode portfolio ->
  yields, yield on cost, income, 5y growth, 12-month calendar; forward = last regular payment x frequency (specials
  > 1.5x median ignored); ex/pay dates are estimates (pay = ex + 21 days; Yahoo has no pay dates). Statement import
  (src/portfolio/statement.ts) matches CSV/Excel columns; a PDF goes through ai.chat when the AI key is set.
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
  strategies.py is pure and tested (v22 rules, settled in docs/research/setups-v21-results.md): weekly_swing = pullback
  (z-score beyond the stock's own 10th/90th percentile in the last 3 bars and turning, buy-stop above the signal bar,
  stop past the 3-bar swing 0.75-2 ATR, +1 SD target, break-even at +1R, time exit), mean_reversion (z-score beyond its
  5th/95th percentile, exit on a close across the 5-bar average), breakout (close above the 250-session high, buys only,
  2 ATR(20) stop then chandelier trail 3 ATR(22), cap 120 sessions). One trend filter everywhere: `TREND` = price vs its
  200-day average (40-week on weekly bars; hourly bars use the previous close). Removed: %R, A/D vs EMA, ADX, volume,
  RSI2-and-z, 20-bar Donchian, COT in signals. COT (156-week index) is a reading; it enters Tier A only if
  `cot_study` (26/156 weeks x 60/75/80, weeks shuffled, Holm over 6) passes on the owner's data, and a missing reading
  then never passes. R is after costs. Every signal/plan/exit at bar i uses only bars <= i (tests check this).
  Statistics: `random_entry_test` moves same-date trades together to one random date (clustered; tested false-alarm
  rate <= 0.14); `summarise` t-stat counts same-week (hourly: same-day) trades as one bet, tradesNeeded = bets for
  one-sided p 0.10 at 80% power, per-stock "proven" = 20+ trades and t >= 1.5. Tier A = side record PF >= 1.2 and Holm-
  adjusted random-entry p <= 0.10 across every strategy record of all time frames (`holm_family`, untested = p 1) +
  robust (`_robust`: double costs + 0.05% stop slippage, both halves) + stock record not failed + COT gate if active
  + no earnings in the hold (failure = "unavailable", never "none") + R:R >= 1.5 (pullback) + not forming; lab strategies
  need 30 forward trades and hourly setups 2 years of hourly history (or the same strategy passing on daily) or they
  cap at B. B = profitable side and no failed check of its own. `why`/`whyCodes` explain non-A cards.
  Data: daily 15 years; hourly = every regular-session 30m bar kept for good in cache.db (monthly chunks,
  `thirty_minute_bars`), plus ~3 years from Alpaca once when keys are set. Heavy maths runs in spawn worker processes
  (`_offload` pools 'scan', 'research', 'rw'; `USE_PROCESSES = False` in tests); caches evict oldest (`_remember`).
  Rule tests (engine/ruletests.py): weekly per time frame on the owner's data, saved to ~/.trading-platform/
  rule_tests.json and shown on the Setups page; they report, never switch rules.
  Simulations are 1,000 each: pooled random-entry (cached per day), per-stock random walk (RW_RUNS, background worker
  `_run_rw_jobs`, BH q over every stock x strategy tested) and Monte Carlo of the next 20 trades (`monte_carlo`, % and R).
  Clicking a card opens the trade guide (src/home/tradeGuide.ts; default risk 0.5%). Each strategy shows its newest
  signal within its entry window + hold whose trade is still waiting or open; `new`, `conflict` as before.
  Statuses: forming, ready, waiting, in trade. Schwab requests are paced (one at a time, 0.7 s apart); unknown symbols
  are skipped for a day, only an expired login stops a scan. Time frames (strategies.HORIZONS): short (1-hour bars),
  swing (daily), position (weekly, 15 years). Results: `horizons[h]` = {strategies (sides.long/short with stats,
  randomEntry incl. pAdjusted, robust, monteCarlo/monteCarloR; lab ones carry forward.since), setups, edge (COT
  study), lab, ruleTests, historyDays}; the top level keeps swing for older pages. Universe: Nasdaq-100 only (owner);
  `SECTORS` feeds the page's open-risk-per-sector line (display only).
  Strategy lab (engine/lab.py): 11 triggers x up to 2 of 8 filters (trend, above200, adiv = A/D divergence, adx, volume,
  lowvol, tom = last trading day + first 3, market = QQQ vs 200-day; no tom on weekly) x side (814 combos), walk-forward
  3 windows with embargo, chosen in 2+, profitable on unseen (30+), Holm p <= 0.10, PBO <= 50%. Runs weekly; survivors
  are saved with their first-shown time (lab_survivors.json, atomic writes) and judged only on later trades; they leave
  when that forward record fails (30+ trades losing, or t < -1). Rejects go to lab_graveyard.json (atomic write).
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
  Alpaca (engine/alpaca.py, optional free keys in Settings): market-data-only history back to 2016 via
  `alpaca.bars(ctx, symbol, tf, start, end)` (intraday only, saved in cache.db, extended incrementally). With keys set,
  30m-4h charts ask for 3 years and the helper fills what Schwab lacks (Schwab wins); the AI reads regular-session
  hourly bars back to 2016. Only data.alpaca.markets; never trading (test scans every helper module).
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
