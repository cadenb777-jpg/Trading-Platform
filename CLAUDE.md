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
  quote {last, prevClose}, alert {title, message}. HELPER_VERSION in the helper must match LATEST_HELPER_VERSION in schwab.ts. Older helpers
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
  Send diagnostics (v34; Settings and the Data popover, src/ui/diagnostics.ts): `diagnostics.collect` (engine/diagnostics.py,
  stdlib) returns ring buffers of the last 300 requests (type, ms, ok/error, reply size; never payloads) and outside calls
  (httpx hooks: host, path, status, latency), feature notes (`diagnostics.note`: futures quotes keys/matched, Webull
  endpoint/status), settings flags, feed health and the helper.log tail. Everything goes through one `redact` (saved
  secrets by value, token/key patterns, accounts last 2 via `diagnostics.account`, emails, home paths, long hex/base64);
  the browser adds page/console/engine errors (src/diagnostics.ts, same rules) and only saves a file, never uploads.
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
  Futures page (v31, read-only; src/pages/futuresPage.ts, #futures, engine/futures_market.py): futures.board = 39 markets in
  8 sectors from the static SPECS table (CME/ICE/Cboe contract specs, cited there: multiplier, tick value, month cycle,
  expiry rule, CFTC code; micros use the parent's COT), Schwab quotes for root symbols ("/ES"), 1w/1m/YTD and the σ move
  (today / SD of 60 daily moves) from invest.closes, estimated expiry/first-notice/roll dates, sector averages, movers, and
  the latest COT for all markets in one CFTC request. futures.curve quotes the next 6 contracts ("/ESZ26"); no prices =
  no curve. futures.detail adds a year of closes and 156 weeks of COT indexes. Missing data shows "unavailable".
  Backtest (src/pages/backtestPage.ts, src/backtest/research.ts): "My chart's indicators" builds rules (operand
  operator operand, ALL/ANY) from state.indicators via suggestRules(); the chart's Backtest button fires
  `tp:backtest-chart`. Research tabs: Monte Carlo (trade bootstrap), random-walk test (shuffled daily moves, p-value),
  parameter sweep (overrides keyed `uid.inputKey`), monthly returns, deep stats. Seeded RNG so results repeat.
  Dividends (v24, engine/dividends.py `dividends.portfolio`, src/portfolio/dividendsView.ts): shares-mode portfolio ->
  yields, yield on cost, income, 5y growth, 12-month calendar; forward = last regular payment x frequency (1-2x a year:
  last 12 months summed); special = > 1.5x the 4 before and the next drops back (newest: off-schedule or > 3x); ex/pay dates are estimates (pay = ex + 21 days; Yahoo has no pay dates). Statement import
  (src/portfolio/statement.ts) matches CSV/Excel columns; a PDF goes through ai.chat when the AI key is set.
  Total return (v28, dividends.total_return_stats/total_returns: dividends reinvested on the ex-date, 3y/5y annualised, None when
  history is short, cached per symbol per day): per holding + value-weighted 1y in dividends.portfolio (Account card and column),
  invest.board tr1y for dividend payers, research.company totalReturn; glossary term `totalreturn`.
  Optimizer (v29, quant.optimize/run_optimizer): Ledoit-Wolf covariance. Goals (v34, quant.GOALS, one dropdown; names,
  one-liners and helpers in src/portfolio/goals.ts; sources cited at GOALS): growth (resampled max-Sharpe), risk_parity
  (Even risk, default), min_var, max_div, hrp, min_cvar (Rockafellar-Uryasev linprog on 21-day scenarios), target_vol,
  income (forward_yields via dividends.analyse, under volCap), track (max return within teBudget vs SPY / 60/40 / a saved
  portfolio; benchmark rides as the returns' last column, o['bench']). Old method black_litterman = growth + estimate
  'views'. Advanced fold: per-holding min/max (limits), maxWeight, maxChange, maxTurnover (project() at the end), minCash
  (cash floor or raised fixed cash), maxHoldings (drop smallest, refit), sectorCap (risk.sector; funds "Fund"; loosened to
  1/sectors when impossible, noted), lookback 1/3/5/10y (fit window = test window), estimate shrunk/equilibrium/views,
  testRebalance, cost per trade (walk_forward cost). Every goal runs goal_job (weights, ranges, walk-forward row, random-walk
  p; seeded per goal) in a spawn process pool (USE_PROCESSES, quant.shutdown) streaming "Tested n of 9 goals"; assemble adds
  frontier, figures (exp. return, vol, yield, max DD, 1-month CVaR, TE) and risk contributions. UI: frontier + risk bars
  (src/portfolio/optimiserCharts.ts, --viz-1/--viz-2), compare-goals table (goal order, Even risk first; identical weights merged via sameAs and counted once; "Vs Even risk" = Sharpe diff ± paired block-bootstrap SE, verdict at 2 SE; "Needs real timing? (p)" = Holm-adjusted random-walk p, 0.10). Defaults: max weight clamp(2/n, 25%, 50%), max change off (the test never applies change caps). Every fallback adds a note (_note, per goal). Walk-forward
  and random-walk check (100 block-shuffled histories) per goal. Only the owner's own symbols; cash shows as "Cash" (holdingLabel), not BIL.
  Short history (v33): weights are fit on real shared history only. For the tests, a young holding (starts 90+ days after
  the oldest) gets stand-in history (extend_history: best-correlated ETF, CORE_STAND_INS first then STAND_INS, never an
  owned holding; >= 1y overlap and corr >= 0.7; beta x stand-in + block-bootstrapped centred overlap residuals before its
  real start, real data untouched, <= 10 years; none = left out, reply leftOut). Stand-in histories cached on disk
  (stand_in_series, 10y); progress via engine_event status. Reply estimatedShare (look-ahead disclosure) and realOnly
  (real-prices-only table when >= 2.5y). Toggle payload `standIns`. test_window: 4y+ full test, 2.5-4y short 1y fit/
  monthly hold ("low confidence"), less none. weight_stability: 200 block-bootstrap refits -> 10th-90th percentile bars,
  `pinned` = held by the owner's limit. Texts in src/portfolio/optimiserText.ts.
  Cross-check (v34, engine/crosscheck.py `crosscheck.value` {field last/prevClose/nav/divYield/expenseRatio, symbol, cik}):
  free sources only (Schwab, SEC XBRL + NAV filings, Nasdaq.com, Yahoo chart/quoteSummary; Google Finance and Stooq left
  out), paced per site, answers cached per source+symbol+field in cache.db, failures remembered 10 min. Every source is
  returned with value, time, link and basis (yield forward/trailing, expense net/gross, NAV share class; only the main
  basis is compared). Rubric in the module docstring: reliability x freshness (unknown time 0.4), one family (SEC, Yahoo)
  = one confirmation, a fresh filing wins over disagreeing market data, one source capped at 60%. Best estimate = the
  most trusted agreeing source's value (never an average). Expense ratio is "aggregator only". Glossary `confidence`.
  UI: src/ui/sourcesChip.ts (chip + panel + meter; formatting in src/ui/confidence.ts): fund NAV (auto, only funds that
  publish NAVs) and ticker card (only on click, never on hover). Parsers tested on fixtures (helper/tests/fixtures/crosscheck).
  Account page (src/pages/accountPage.ts, #account): portfolios with Portfolio.mine (set by Import statement; unset = live
  Webull sync) merged by src/portfolio/account.ts, figures from dividends.portfolio + dividendsView; read-only (orders on Trade).
  Structure (docs/structure.md: every number has one home): Account = real money only (all accounts + switcher, totals,
  Import statement, Sync Webull, cards link "Order in Trade" / "Analyse in Portfolios"); Trade = the selected account's
  ordering figures ("<account> value (for ordering)") + link to Account; Portfolios = models/what-ifs (mine accounts left
  its list; opened from Account they show "Save as a what-if copy"); Chart has modes Chart | Workspace | Scripts
  (src/pages/chartWorkspace.ts, #chart/multi, #chart/scripts); COT's home is Futures (board table + "COT: any market or
  stock", src/futures/cot.ts), Flow/Research/Home show cotSummary() with "See all on Futures". Old hashes redirect via
  src/routes.ts (resolveHash, REDIRECTS: #multi, #scripts, #portfolio/webull, #flow/cot...); pages get start(sub).
  Linked panels (browser only): src/ui/linkGroups.ts is the link bus (colours none/red/green/blue/yellow, default blue;
  panel colour + group symbol in localStorage 'tp-link-groups', memory fallback). Pages call linkPanel({id, accepts,
  apply, active}) and publish() only on user changes; wanted() on start() picks up changes made while hidden. Panels:
  chart, ws1-6, research, flow, futures (detail window), setups (detail), trade (pre-fills only), news (Home tab),
  watchlist (source). Chart > Workspace (src/pages/workspacePage.ts, #chart/multi; replaced Multi) = grid 1/2/4/1+2/6
  of chart/quote/news/facts/position panels; layouts in src/ui/workspaceLayouts.ts ('tp-workspace'; presets Morning,
  Trade, Research). Keys (command.ts dispatchKey): Ctrl+[ ] (not Cmd: Mac Back/Forward) or F6 cycle panels, Alt+1-6 jump
  (only with panels on screen); a letter on a panel opens the command bar scoped to its group (g/n chords still win;
  Shift+Enter runs globally); data-link-keys="own" opts out (Chart, Trade). Trade starts Not linked (PANEL_DEFAULTS).
  Gains (v33, src/portfolio/returns.ts): price gain (value − cost), dividends received, total return per account part,
  holding, account and overall (totals/% only over holdings with a cost basis); View menu = day / gain as %, $ or both
  (localStorage tp-account-display); holdings table has a Columns chooser and totals row; a symbol opens the detail.
  Dividends received: dividends.portfolio `received` [{key portfolioId:SYMBOL, seen, purchaseDate, dividends...}] ->
  method entered | statement (statement "Dividends received" column) | purchase | tracked | none, always labelled.
  store.track_holdings keeps one `seen` log per symbol per portfolio [{date, shares}] (total over lots, on the first
  holding; from the store, never the browser; removed symbols wait in `seenArchive`) and carries/validates owner fields
  (purchaseDate, dividends*, rocPct, rocYear; null clears; a statement never replaces typed dividends). Logged shares
  are converted with Yahoo splits (ctx.splits; Yahoo dividends are per today's share). Webull's OpenAPI has
  a US-only /trading/activities/cash-activities/list but no documented types or fields, so it is not used.
  Yield check (src/portfolio/yieldQuality.ts, yield > 6%): paid = total − price return; from the price falling =
  min(paid, −price return), 0 when the price held or rose (market price, not NAV); `dividends.history` (5y closes + dividends) feeds payoutCharts.ts (per-year earned vs paid-from-price
  bars, $10,000 invested lines, src/portfolio/payoutSplit.ts). ROC is only what the owner enters (never estimated).
  Account risk/sectors/taxes (v30, follow the account switcher): engine/risk.py `risk.account` {holdings: symbol, value, kind}
  = 1y volatility, beta vs SPY, 1-day 95% historical VaR, max drawdown, per-holding vol/beta/riskShare from invest.closes
  (cash = zero risk; alts, <1y and stale histories left out) + sectors (SEC SIC -> 11 sectors, cached 30 days; only
  "not in the SEC list" (sec.NotListed) is cached as Other, other SEC errors go to sectorNote;
  funds by name: Fund + broad market/sector/bond; unknown = Other). engine/tax.py `tax.account`: Roth / tax-deferred /
  taxable (Portfolio.taxType, else Webull class saved at sync as webullClass, else whole words in the name; one rule
  in tax.auto_type, returned per account), taxable gains, harvest (> $100 loss), wash-sale = a Webull fill of the
  symbol in any account in 31 days (webull.recent_buys); no purchase lots, so holding periods are mostly "unknown".
  Browser maths src/portfolio/risk.ts (live weights, warnings > 20% stock / > 35% sector, VaR dollars), UI riskView.ts.
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
  Self-update (helper/updater.py, standard library; downloads via the helper's httpx): reads HELPER_VERSION from raw
  GitHub main at start and every 10 min (status.update); request `update` (Update now) downloads the codeload main ZIP
  (only raw.githubusercontent.com/codeload.github.com, https, redirects checked), verifies it, unpacks only helper/,
  backs up to ../helper_backup_v<old> (keeps 1), copies changed files in (splash.copy_files; dot files untouched),
  writes update-pending.json and exits 75. splash.py then pips changed requirements and starts the new copy; a pip
  failure or a helper crash before updater.confirm_started (first line of main(), so not login/port errors) rolls back (splash.roll_back). Setting auto_update
  (default off) only installs when no tab is connected; the banner uses update.latest from the helper.
  Alerts (v32, engine/alerts.py, store collection `alerts`, saved only via alerts.save): price above/below, day move %,
  a watched setup's entry zone (entry_zone = port of src/home/entryZone.ts) and `setups_ab` (every A/B setup, once each).
  Checked in send_quotes from the quotes the helper already has; alert symbols join `watched()` (stream + 30 s poll), no
  extra Schwab calls. Fire once; `repeat` re-arms after price crosses back; 30-min cool-down. Delivery: ntfy, Telegram
  (topic/token in settings.json, never sent back), plus an `alert` push to open tabs; failures logged and kept on the
  alert (lastDelivery). Alerts never touch orders (a test checks). Browser: Alerts window (rail bell, chart bell;
  src/ui/alerts.ts), crypto/old helpers keep browser-only alerts. Home/Account show news on the owner's holdings.
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
  reasons, statistics, readings and levels. Terms have an "i" tooltip (src/ui/glossary.ts TERMS / infoTip).
  src/home/setupsPanel.ts only provides types, takeProfit and sideRecord.
  Workflows (docs/workflows.md, with before/after click counts): Home opens on the morning brief (src/home/morningBrief.ts,
  maths src/home/brief.ts: overnight futures strip, my accounts value/today/movers, Needs attention = fired/near alerts,
  A/B setups at entry, today's high-impact events; j/k + Enter). Setups "Trade this" (key t; tradeSetup in tradeGuide.ts)
  pre-fills the ticket with the stop, Size by Risk and a SetupPlan; Trade shows the Plan card (src/trade/planCard.ts,
  maths src/trade/plan.ts: entry/stop/target/R/size/$ and % at risk, the read, post-order checklist: entry, stop sell
  via "Fill stop order", alerts). Clients open on a review (src/reports/clientReview.ts, maths src/reports/review.ts:
  net/gross, risk vs Client.riskTolerance bands, drift vs Client.targetId, income, Client.notes, Report (PDF));
  command bar `CLIENT <name>`. None of these adds an order path.
  AI summary buttons (`insightButton`) are on Home, Flow, Research, Macro, Bonds, Investments boards, fund detail
  and Backtest; not on the Chart page or Portfolios (owner's choice).
  Theme: light/dark via CSS variables (`:root[data-theme='light']`) and src/ui/theme.ts (THEME object updated in place,
  `followTheme(chart)` repaints canvases). Use variables, not hard-coded colours, in new CSS.
  Chart legend (chartPage renderLegend) is rebuilt only when its layout changes; values update in place. Indicator
  instances can hide single plots (`hiddenPlots`) and levels (`hideLevels`); the manager is openIndicatorManager.
  Browser reply cache: engineRequest reuses read-only replies for ENGINE_CACHE_MS (20 s quotes .. 60 min catalogs),
  joins identical in-flight requests, never caches store/settings/ai/scanner or failures; Refresh buttons call
  clearEngineCache. Investments prefetches sections on hover and in the background; fund cards prefetch alts.fund.
  Ticker card (v32, src/ui/tickerCard.ts): any element with `data-ticker` (spread `tickerAttr(symbol)` into h()) shows a
  card on hover (300 ms), tap or keyboard focus: invest.board quote + 3-month line, your position across your own
  portfolios, Open chart / Trade (pre-fills #trade only) / Research / Ask AI. One delegated listener set (main.ts);
  a click pins it unless the ticker sits in a button, link, focusable row or anything given an onclick by h()
  (`clickTargets`); touch: long press. Esc closes; Tab steps into it; Ask AI only pre-fills the assistant.
  As-of stamps: `asOfStamp(feed, {reply})` (src/ui/dataHealth.ts; that reply's own fetch time) in panel heads, amber after 2x the feed's
  refresh (src/data/health.ts FEEDS); engineRequest/history/quote/trade record each feed's last success, listed by
  the rail's Data button. Risk drill-downs: risk.account replies `series` {dates, account, spy} (daily returns);
  src/portfolio/riskCharts.ts opens the P/L histogram, beta scatter and drawdown curve from the risk card.
  Line-chart indicators: chart windows have an Indicators menu (src/ui/windowIndicators.ts, LINE_INDICATORS run on
  the first line as flat bars); page charts have an fx button that opens it.
  Command bar (src/ui/command.ts, browser only): / or Ctrl/Cmd+K opens a palette over symbols (watchlist, holdings,
  NASDAQ_100 copy checked against the scanner's by a test, futures roots, invest.search), pages, accounts, clients,
  portfolios and actions; Bloomberg codes (CODES: "AAPL GP/DES/FA/CN/OMON/TRADE/ALRT/WL", WEI, ECO, FUT/CTM, PORT, ACCT,
  BTST, SET, MACRO, BONDS/WB, INV, HELP) call pages' open() methods. Ranking: exact ticker > exact code > prefixes >
  fuzzy name. Global chords (CHORDS: g h/c/s/a/t/f/p, n a), ? sheet (SHORTCUT_SHEET lists every page's keys; keep it
  in step), Ctrl/Cmd+I = AI assistant; never inside fields or dialogs. TRADE only pre-fills. Recents in localStorage.
  Pop-out charts: `openChartWindow` (src/ui/chartWindow.ts); `createLineChart` adds hover values and an expand button;
  `openFredWindow` opens a FRED series' full history.
  Downloaded data is cached in ~/.trading-platform/cache.db (`ctx.cached(..., persist=True, stale_ok=True)`).
  Alpaca (engine/alpaca.py, optional free keys in Settings): market-data-only history back to 2016 via
  `alpaca.bars(ctx, symbol, tf, start, end)` (intraday only, saved in cache.db, extended incrementally). With keys set,
  30m-4h charts ask for 3 years and the helper fills what Schwab lacks (Schwab wins); the AI reads regular-session
  hourly bars back to 2016. Only data.alpaca.markets; never trading (test scans every helper module).
  Indicators can load outside data via `IndicatorDef.external` (COT for the related futures market, FINRA short volume).
  Schwab stays market-data only (its app's order limit is 0). Order placement exists only in engine/webull.py (Webull
  OpenAPI, hand-written HMAC-SHA256 signing matching the official SDK; hosts: Test us-openapi-alb.uat.webullbroker.com,
  Live api.webull.com) behind one-time 60 s preview tokens (webull.preview_order -> webull.place_order {token}), max
  order value / orders per day, Test-by-default and a typed LIVE opt-in in Settings; US stocks only, no sells beyond
  the position minus open sells (stock positions only), every attempt logged to ~/.trading-platform/orders.log and
  counted toward the daily limit (unreadable log = refuse). A timeout/5xx on place is "unknown": looked up once by
  client_order_id, never reported as not placed. Reply fields are the documented names; missing ones fail closed.
  Futures (v31): only in the FUTURES account (account_class FUTURES; stock accounts take only stocks), requests carry
  asset 'futures' (snapshot, preview, cancel), webull.futures_contracts lists a root's contracts (size = multiplier,
  min_tick, last_trading_date/first_notice_date). Guards: separate typed FUTURES opt-in (plus LIVE for real money), max
  contracts per order (1, cap 20) / per day (3, cap 50, counted from orders.log `contracts`; closing orders exempt),
  switching Test/Live turns futures off, contracts read with status OC and CO. Opening/adding: longs only (no shorts),
  not within 2 trading days of the cutoff ("roll"), OC only, buying power > 0 (Webull's preview judges margin).
  Closing (reduce-only, <= position minus open orders and closing attempts logged in the last 2 minutes that Webull
  doesn't show yet) is allowed for CO and up to the last trading day, and isn't held back by the daily order/contract
  counts; one futures place per account at a time (lock from the position re-read to Webull's answer); a side-like position field that disagrees with the quantity sign refuses. Prices on the tick
  and within 25% of Schwab's; margin is never guessed; no stop order is placed. Sources are cited in webull.py.
  Rate limits (v27): every Webull call goes one at a time through `_call`'s gate, spaced per endpoint from Webull's
  documented limits (SPACING); reads are cached (account list 10 min, balances/positions/orders 20 s; place/cancel
  clear the account, sync reads fresh); a GET that gets 429 waits and retries twice, orders/previews never retry, and
  429 on place is logged 'failed' (Webull doesn't process rejected requests). One lock makes the access token.
  Nobody sleeps holding the gate (wait, release, re-queue); place must be sent within PLACE_DEADLINE (10 s) or it is
  refused as not placed (logged, counted). The browser waits 90 s for place; no answer = "couldn't confirm".
  forget() bumps a generation so reads begun before an order aren't cached; snapshot.asOf = Webull fetch time.
  `webull.snapshot` = status + balances + positions (Schwab prices, dayGain) + open/recent orders in one request.
  The AI never trades (a test scans ai.py; another checks no other helper file places orders).
  UI: Trade page (src/pages/tradePage.ts, #trade: watchlist, chart with avg cost/open orders, ticket, positions/
  orders/fills, snapshot every 30 s while visible). Ticket = src/trade/ticket.ts (shares/dollars/risk sizing, maths in
  src/trade/sizing.ts); preview -> confirm window = src/trade/webull.ts (the only copy). Keys: B/S side, Enter
  previews; nothing places without the confirm button. Account's Webull cards (webullView.ts) show balances and Sync
  (the old Portfolios > Webull view is gone; #portfolio/webull -> #trade); the trade guide's "Open in order ticket" only pre-fills #trade (BUY, plus its stop for "Protect").
  Accounts: labels from account_class (webull.account_info: "Roth IRA ••1234"; futures/crypto/unknown = listed, never
  read/synced/traded); sync = one portfolio per stock account (empty ones only when chosen), updated by account id;
  Account page switcher = all combined or one (pickAccounts); Trade page picks one account, sent with preview/cancel.
  Prospecting (v35, engine/prospect.py, docs/prospecting.md; requests in src/data/prospect.ts): RIAs,
  ERAs, family offices and 13F managers from free SEC bulk files (monthly adviser lists, Form ADV data Schedule A/B +
  7.B.(1), 13F and Form D data sets) and the Census geocoder, in a separate ~/.trading-platform/prospect.db. Big files
  download with resume/backoff (0.2 s between SEC requests) and parse in the 'prospect' spawn worker; firms are rebuilt
  after each ingest (exact CRD/SEC file no./CIK, then name + address scores). Family-office types are guesses with
  reasons and a confidence word, never certain. 13F VALUE is thousands before 2023-01-03 filings, dollars after.
  prospect.firm takes `firmId`. The schedule only refreshes sources the owner downloaded once. Every file's columns are
  checked against `EXPECTED` before saving (missing required = that source fails, nothing saved; results in
  prospect.status `headers` and the diagnostics `prospect` section). Name-only merges also need the same ZIP or city.
  Prospecting page (src/pages/prospectPage.ts, #prospect, rail group Business; codes PROS / FO / RIA, "FO smith" searches):
  Search (filters -> request in src/prospect/logic.ts, tested; search rows carry topPeople), Map (#prospect/map: Leaflet
  1.9.4 bundled, OSM tiles with attribution, CSP img-src allows tile.openstreetmap.org, own grid clusters, click = radius
  search; no tiles = plain grid + note), profile drawer (#prospect/firm/<id>, src/prospect/profile.ts, AI topic 'prospect'),
  Compare (src/prospect/compare.ts: CSV + print via report.css), Data (per-source freshness, header checks, ingest with
  streamed progress, 1-2 GB confirm before the first download). Address radius uses prospect.geocode (Census one-line).
  Saved searches / notes + outreach status = store collections prospect_searches / prospect_notes (doc id = firm id).
  Complete downloads (docs/research/prospect-data-gaps.md): 'all' isolates each source's error (meta result:<source>,
  'failed' retries them), files loaded are remembered (meta files:<source>) so retries skip them, job.overall is one
  0-100 figure weighted by STAGES, loaders return checks (in file / loaded / skipped by reason). Form D = 12 quarters,
  newest filing per issuer CIK; 13F = totals for 8 quarters (filer_history_13f), positions for 2; 13F-NT keeps "reported
  by". engine/prospect_iapd.py: Form ADV Part 1 PDFs from IAPD (pypdf, 1 per 2 s) for firms that filed after the bulk
  data: saved and opened firms automatically, all firms by AUM only when turned on in the Data tab (prospect.adv_pdf_reader
  start/pause/resume); failed fetches back off 1h/6h/24h (reset on a new filing), 403/429 pauses 30 min. State-registered
  RIAs from the IAPD firm search (source 'state', beta). Both unverified live. Browser gate PROSPECT_COMPLETE_HELPER_VERSION 38.

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

Secrets (including the Webull keys) stay in the helper on the owner's computer, never in the browser; a cloud
engine (stage 11) would need the same rule. Real-money trading stays behind explicit confirmation (preview token +
confirm window, typed LIVE opt-in), and Test (paper) comes first.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for cadenb777-jpg/trading-platform (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The seven default labels: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root and ADRs in `docs/adr/` (created when first needed). See `docs/agents/domain.md`.

### External peers

Host-only: code review and jury use Claude reviewers only, with no external CLI. See `docs/agents/cross-model.json`.
