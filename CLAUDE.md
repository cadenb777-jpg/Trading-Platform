# Notes for Claude

**The three mantras (owner):** 1. **Simplicity scales:** fewer rules, indicators and settings; remove before adding;
anything that doesn't earn its place in honest tests goes. 2. **Innovation:** creative, intuitive new uses of proven
maths and new ways to show data, each with a check that proves it right. 3. **Arbitrage and market edge:** better
knowledge and information than other market participants: arbitrage and relative value found, verified by
self-checks and shown with real costs; build any capability another platform has that is fundamentally better (never
its code, name, logo or look); the platform finds and verifies, the owner decides and trades. Details: docs/improvement/PLAYBOOK.md.

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
  Updates (v46): the helper checks GitHub every 2 minutes (owner's choice) and installs by itself unless Settings turns
  auto_update off, only when no request is in flight and no Webull preview waits for Confirm; the page hides the Update
  button then, toasts the new version, and src/ui/autoReload.ts reloads a stale page (new build or newer helper) when idle.
  Engine modules load independently (`engine.LOAD_ERRORS`); optional packages are in requirements-extra.txt and the
  helper logs to ~/.trading-platform/helper.log. Pages are created on first visit (dynamic import) in app.ts (main.ts is only the entry: style + frame guard, then it imports app.ts).
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
  Navigation (revamp): nav.ts SECTIONS today/markets/security/ideas/money/business/ai; the rail shows only them plus
  railPulse (live mini board); the top row is the section's pages; the function bar is an Actions menu in the page
  header (keys 1-9). AI summaries (insightButton) run when clicked (auto-run removed at the owner's request); a recent read is reused
  (RECENT_MS). Calm reading: src/ui/quiet.ts turns long page/panel explanations into hover tips; Inter for words,
  JetBrains Mono for numbers.
  Visuals (revamp): src/ui/viz.ts gauge / ring / rangeTrack / flower / heatGrid (SVG, theme colours, pure geometry
  tested) each with a caption; Research overview = src/research/tearSheet.ts (Fincept layout, rule-made plain words) and
  research.about {cik} (engine/company_about.py: Wikidata P5531 -> Wikipedia summary, cached 30 days; helper 81).
  AI create_portfolio (v80): UI tool that saves a model portfolio (mine false, note "nothing was bought") on Portfolios
  and opens it (tp:portfolios-changed), Undo deletes it; portfolioFromArgs in src/ai/actions.ts.
  AI (engine/ai.py): official `anthropic` SDK, default model claude-opus-5-5 with server-side fallbacks, tools over
  engine data plus `ui_action` (browser carries out open_chart/add_indicator/create_alert). It must never trade.
  AI actions (helper v42, AI_ACTIONS_HELPER_VERSION; browser sends ai.chat `ui_actions: 1`): one tool per action
  (ai.py UI_TOOLS) emitted as engine_event `ui_action {callId,name,args}`; the browser runs it through src/ai/actions.ts
  (typed registry, hand checks, Undo stack; env wiring src/ai/actionsEnv.ts, chart via chartPage.sync()) and answers
  `ai.ui_result {callId,result}`; UI tools run in order, 60 s timeout. find_indicators runs in the browser (live
  library) with recommended settings from src/ai/tuning.ts (rule-of-thumb table per 1m/5m/15m/1h/1D/1W + fallback
  scaling; docs/research/indicator-tuning.md). The chat shows "✓ step · Undo" lines; the pop-out window runs actions
  in the main tab focused last (src/ai/tabs.ts: ACTION_TAB_KEY, undo ids "<tab>.<n>"). Safety: screen/tool text is
  data (DATA_RULE, <tool_data>); UI_CONFIRM actions (remove_from_watchlist, clear_indicators) always ask the owner;
  on timeout the helper sends ui_cancel and the browser checks the deadline after a confirm; Stop sends ai.stop.
  Older helpers keep the one-way ui_action. No action can trade.
  World macro (v44, WORLD_HELPER_VERSION; engine/worldmacro.py, src/pages/macroWorld.ts = Macro > World tab):
  world.table (World Bank, IMF WEO, OECD CLI by country, grouped Americas/Europe/Asia-Pacific in src/macro/world.ts),
  world.panel {panel: bls|bea|census|fiscal|ecb|eia} (fiscal reuses bonds.auctions). predictions.markets
  (engine/predictions.py: Polymarket gamma + Kalshi public, GET only, never bets) feeds the Calendar's Odds column and
  Prediction markets panel (src/macro/odds.ts matchOdds, src/pages/calendarOdds.ts). finnhub.* (analyst trends on
  DES, earnings on Calendar). Settings > Data connections (src/ui/connections.ts) holds every key (bls/bea/eia/census/
  finnhub_key plus the old fields) with connections.test; keys list: docs/research/free-data-keys.md.
  Investments page (src/pages/investmentsPage.ts, src/invest/): boards via invest.board (quotes + 1m/3m/YTD/1y from
  daily closes), invest.history/movers/search; bonds.market (FRED yields/spreads), bonds.auctions (Treasury Fiscal Data),
  bonds.cusip (Schwab get_instrument_by_cusip); alts.fund (SEC: XBRL NAV per share, N-PORT, Form D, NAV sentences from
  424B3/8-K; navHistory = monthly NAV line parsed from the last ~16 NAV filings + 3 10-Qs by alts.nav_points/nav_series, shown
  instead of the XBRL NAV when newer), alts.search_private (EDGAR full-text search of Form D), alts.latest_private (latest Form D feed).
  The private fund directory is src/invest/catalog.ts (names only; data is live from the SEC). src/invest/fundSnapshots.ts
  holds hand-researched latest published figures (dated, sourced, verified flag; shown unless the SEC data is newer). Bond maths is
  src/invest/bonds.ts. The owner's own alternatives are store collection alt_holdings (iCapital has no public API:
  they import a CSV/Excel export, src/invest/holdings.ts).
  Rows and tiles share one interaction model (src/invest/rowInteract.ts, notes in docs/research/investments-interaction.md):
  hover/focus 150 ms = mini chart popover (1M..5Y; a board's range = its sorted period column), click = full view
  (`openSymbol` -> security view `openSecurity`, symbol window if that fails), Space/chevron = expand
  in place (tableTools keeps `tt-follow` rows under their row), Shift+click = Compare (max 4). Maths/cache: miniMath.ts.
  "Go to" (src/invest/goTo.ts): one ordered action list per kind (stock/fund/index/future/coin/rate/private fund), 5
  buttons + More in the popover and expanded row, all of it on right-click/Menu key; security view tabs (DES GP FA CN
  HDS OMON DVD), Trade = ticket pre-fill only; keys F N R C. Popover headline = the row's live price; 52-week = Schwab's
  high/low (else "52-week closing range"); "You hold" from your own portfolios. ETF vs stock: invest.board's assetSubType
  (helper change ships with the next helper, no version bump), else catalog.ts CATALOG_ETFS.
  Futures page (v31, read-only; src/pages/futuresPage.ts, #futures, engine/futures_market.py): futures.board = 39 markets in
  8 sectors from the static SPECS table (CME/ICE/Cboe contract specs, cited there: multiplier, tick value, month cycle,
  expiry rule, CFTC code; micros use the parent's COT), Schwab quotes for root symbols ("/ES"), 1w/1m/YTD and the σ move
  (today / SD of 60 daily moves) from invest.closes, estimated expiry/first-notice/roll dates, sector averages, movers, and
  the latest COT for all markets in one CFTC request. futures.curve quotes the next 6 contracts ("/ESZ26"); no prices =
  no curve. futures.detail adds a year of closes and 156 weeks of COT indexes. Missing data shows "unavailable".
  Fair value (v55, engine/carry.py `futures.carry`, CARRY_HELPER_VERSION; src/futures/fairValue.ts; Futures panel #futures/fair,
  brief "S&P open" chip): ES/NQ/YM/RTY vs $SPX/$NDX/$DJI/$RUT, F = S(1 + SOFR d/360) - S q d/365 (SOFR from FRED, q =
  SPY/QQQ/DIA/IWM forward dividend + fee; Hull ch. 5; carry from the next session while shut). Cash shut: implied open = futures - fair premium;
  cash open: implied financing rate and spread over SOFR. Roll = next contract vs the front carried on. invest.closes
  and ctx.daily_bars keep one Schwab candle per New York day in date order (core.one_candle_per_day; fixes counted in
  core.DAILY_FIXES, reported by the self-check). Yield = ETF forward dividend (dividends.analyse) + its fee (MARKETS).
  Box-spread rates (v56, engine/boxrates.py `rates.box`, BOX_HELPER_VERSION; src/futures/boxRates.ts; Futures panel
  #futures/rates "What money costs"): per monthly SPX expiry (AM-settled SPX root only, never SPXW) the widest box with all four quotes at two
  strikes (flow.chain $SPX, worked out at most every 10 min), lend (asks) / mid / borrow (bids) simple days/365 after FEE_PER_CONTRACT x 4, vs the FRED CMT yield of the same
  length (BILLS on the simple basis: simple_basis restates 1y/2y coupon yields; straight-line) and SOFR (x 365/360). Fast start (v56): datahub.BACKGROUND_WORK (set in core._refresh)
  sends self-started refreshes through the background budget of budgeted sources (Schwab); invest.closes ('board-closes3') keeps finished sessions only and stays
  valid until the next close + 15 min (stocks; futures 3 h; missing_last_close looks again every 30 min); invest.history
  adds today's live price (with_live_point); Sources table waitP95Ms/waitMaxMs = queue wait of your requests.
  Fitted curve (v61, engine/curvefit.py `bonds.curvefit`; src/invest/curveFit.ts + curveView.ts = Investments > Bonds >
  "What the curve says", deep link #invest/bonds/curve, CURVE_HELPER_VERSION): Nelson-Siegel-Svensson zero curve fitted to
  Treasury's daily par curve (bills simple, 1y and coupons semiannual; 6 starting shapes; past fits saved per date in
  cache.db 'nss-fits' and refitted only if Treasury revises), gap per maturity vs its own 52 weekly fits (|z| >= 2.5 =
  unusual), forwards (1y1y, 2y1y, 5y5y, 10y10y), breakevens (nominal − Treasury real curve, same day only), recession probit
  on 10y − 3m (GS10 − TB3MS as bond-equivalent) fitted by MLE on outcomes NBER has had a year to date, with its record.
  Rates desk pack (v64, engine/ratesdesk.py, RATES_DESK_HELPER_VERSION; src/invest/ratesDesk.ts pure + ratesDeskView.ts):
  bonds.credit = ICE BofA OAS by rating AAA..CCC from FRED (FRED keeps ~3 years; percentile over the span returned, steps
  between neighbouring ratings, <= 10th/>= 90th = unusually tight/wide) on Bonds > Bond market; bonds.termpremium =
  Kim-Wright THREEFY10/THREEFYTP10 (expected = yield - premium, percentile since 1990, 260 weeks sent) on What the curve
  says (its own request, never on the curve's critical path); bonds.auctions adds bidder splits (dealers/direct/indirect)
  and `coupons` (notes+bonds, ~2 years; null = that download failed) for the Auction demand scorecard (vs last 6 of the
  same family 2/3/5/7/10/20/30, strong/weak at btc z - dealer-share z >= 3, measured ~1 in 10 each way). No tail proxy
  (closing-curve stand-in was noise: LESSONS).
  Money and supply (v66, engine/moneydesk.py `bonds.money`, MONEY_HELPER_VERSION/moneyReady in schwab.ts; src/invest/
  moneyDesk.ts pure + moneyDeskView.ts): funding = SOFR - IORB and SOFR99 - SOFR1 (FRED, since IORB began July 2021),
  percentile; tight = >= 90th and SOFR above IORB outside month-end days (last 3 / first 2 calendar days = 'month-end',
  never on Home); mortgage = MORTGAGE30US - DGS10 on or before (weekly, since 1971, median); supply = Debt to the Penny
  (held by the public, 30/91/365-day change, pace) + MSPD month-ends (bills' share of marketable debt and of its net
  change; never gross auction sales: bills roll over). No cache of its own (each loader caches its source; FRED history
  via ratesdesk._full). "Money and housing" panel on Bonds > Bond market; "How fast the government is borrowing" on What
  the curve says; Home Edge today adds "Overnight money is tight" only when tight (each Edge line paints on arrival).
  Credit and reserves (v67, engine/creditdesk.py `bonds.system`, SYSTEM_HELPER_VERSION/systemReady in schwab.ts; src/invest/
  systemDesk.ts pure + systemDeskView.ts, panel on Bonds > Bond market): reserves = WRESBAL / GDP of the week's own
  quarter (unpublished quarters grown at the last year's average quarterly growth, flagged gdpEstimated) vs the week of
  2019-09-18 (6.4%, money markets broke) in today's dollars; paper = 90-day AA financial CP - 3-month bill (discount basis,
  since 1997, stressed >= 95th percentile; not on Home: too costly for a rare line); lending = SLOOS DRTSCILM net %
  tightening, tightening/easing at +-10 (symmetric). edgeLines takes one named object {carry, box, curve, money}.
  Home "Edge today" widget (id 'edge', src/home/edge.ts edgeLines, tested): ES/NQ implied open or futures vs fair
  value and the 3-month box vs T-bill, each linking to its Futures panel, plus the curve's recession odds (#invest/bonds/curve). Home layouts keep `seen` (every widget offered):
  a widget released later joins a saved layout once after its first card; removing it sticks.
  Pop-ups: no backdrop-filter on .modal-backdrop (a full-screen blur over animated content dropped scrolling to ~20 fps);
  .modal-body has overscroll-behavior: contain; the indicator window (.mgr) is a fixed 84vh with only its lists scrolling.
  Live redraws keep your place: src/ui/keepScroll.ts keepScroll(root, draw) restores every scrolled box (matched by class
  + index) and the page after a rebuild; Account's 3 s paint and Home's My accounts use it. Desktop 2.16: FAST_FLAGS adds
  --disable-gpu-process-crash-limit, and Window.check_blank (every 20 s and on returning to the front) reloads a page that
  samples solid black twice (policy.looks_blank, tested; the site's darkest colour is navy) after a GPU/driver reset.
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
  Journal (src/pages/journalPage.ts, #journal, code JRNL; docs/research/trading-journal.md): helper engine/journal.py
  keeps fills/trades/days/playbooks/plans/imports in platform.db tables journal_* (screenshots in ~/.trading-platform/
  journal/). Fills -> round trips FIFO per account+symbol (group_fills: scale-ins, partials, shorts need an explicit
  short on stocks, futures multipliers; a stock sell with nothing held = costUnknown; same-second ties by arrival `seq`).
  Fill id = execution id, else order id + qty + price + time, else a row hash; dup_key (account + NY day + symbol +
  side + qty + price, #n in a batch) only matches other sources, never manual entries. Sources: Webull backfill (webull.order_history,
  read-only, ~2 years, paged; pre-history positions at average cost = openedBefore, out of stats), broker CSV/Excel
  presets in src/journal/importers.ts (tested per broker), PDF via ai.chat, manual. Trade page orders: journal.plan
  (stop/target/strategy by order id) + orders.log tagging. Maths in src/journal/stats.ts (tested; < 30 trades = "not
  enough trades yet"). AI coach journal.coach shows the cost first; ai.py tool get_my_journal reads only. The journal
  never sends orders (test). Requests need JOURNAL_HELPER_VERSION 43.
  Quant pack (gated by QUANT_HELPER_VERSION 44 in schwab.ts; ideas from Fincept Terminal; since 2026-11-16 the
  owner allows using its AGPL code, see Fincept below): quant.comps (engine/comps.py: SIC peers via EDGAR browse, ranked by XBRL-frames revenue; display maths
  src/research/comps.ts), LBO/merger maths in src/research/lbo.ts / merger.ts (views valuationTools.ts, Research >
  Valuation), quant.tearsheet (engine/tearsheet.py; src/portfolio/tearSheet.ts on Account, Portfolios and the report
  section 'tearsheet'), quant.options (engine/options_math.py: BSM, IV Newton+bisection from mids >= 5c, smile,
  term structure, 25-delta skew; src/flow/optionsAnalytics.ts on Flow and OMON), bond portfolio and key-rate
  durations in src/invest/bondRisk.ts. Tests: helper/tests/test_quant_pack.py (Hull), src/research/quantPack.test.ts.
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
  Schwab login (v47): a refused saved login (schwab_login_refused: 401/invalid_grant, even when the token is < 6.5 days
  old) makes Market.relogin open the login page in a thread and swap client.session/token_metadata in place (no
  restart; the launcher would treat a failed restart as a bad update). Opens by itself at most every 30 min; the page's
  "Log in to Schwab" (src/ui/schwabLogin.ts, request schwab_login) any time.
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
  study), lab, ruleTests, historyDays}; the top level keeps swing for older pages. Universe (Setups v30 stage 1, engine/universe.py): the 400 most traded Nasdaq common stocks (nasdaqlisted.txt, price >= $5, 10-day dollar volume >= $10M, refreshed weekly) plus the Nasdaq-100 always; outside the Nasdaq-100 5y daily / 8y weekly history (memory); hourly on the top 150, lab and rule tests on the top 250; falls back to the Nasdaq-100. Plan: docs/research/setups-v30-plan.md;
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
  Shell (docs/design.md "Navigation and the shell"): pages register once in src/ui/nav.ts (section, label, unique
  code, keywords) and load via app.ts LOADERS; rail = sections, top row = sub-tabs + command field, launchpad
  (src/ui/launchpad.ts, Ctrl+Shift+L / g l; Ctrl+L outside text fields), numbered function bar (src/ui/functionBar.ts, `pageFrame().functions`), status bar
  (src/ui/statusBar.ts), panelHeader (src/ui/panel.ts). Home is a widget grid (src/home/widgets.ts, saved per device).
  Market sessions: src/market/sessions.ts is the single source for New York sessions, NYSE holidays and early closes
  (2026-2027 table; extend yearly). marketClock, the status bar and quotes use it; src/chart/summary.ts should switch to it.
  Design patterns (Bloomberg organisation, owner 2026-11-18): docs/research/bloomberg-patterns.md is the rulebook (title line,
  view tabs in `.ap-tabrow` under it via pageFrame, flat panels with tinted title bars, kv lists, banded tables, nothing
  twice on a screen). Charts is its own destination (section 'charts').
  Theme: light/dark via CSS variables (`:root[data-theme='light']`) and src/ui/theme.ts (THEME object updated in place,
  `followTheme(chart)` repaints canvases). Use variables, not hard-coded colours, in new CSS. Tokens, type and do/don't: docs/design.md.
  Chart engine (src/chart/): live ticks recompute indicators on the tail only (incremental.ts: last 512 bars, checked
  against stored values, else full recompute; tested equal for every indicator) and indicator lines follow ticks at
  most every 100 ms (the library rebuilds a series per update); heavy built-ins on 2,000+ bars run in a Web Worker
  (workerClient.ts/workerProtocol.ts: PROTOCOL_VERSION, one job per task, setBars cancels the old symbol's queued jobs). frame.ts = rAF batching + easing (respects reduced
  motion; motion <= 200 ms per docs/design.md). LivePrice draws the animated last-price line/label (the main series'
  own are off); HoverCard = crosshair card (OHLC, indicators, signals explained by their guide) + glow, plain DOM in
  ChartView.overlay. ChartView.highlight(uid, dimOthers) (legend hover dims others; resting on a line lifts it),
  fit() glides, setBars cross-fades, MagnetOHLC crosshair, kinetic scroll, dispose(). SessionShading is a pane
  primitive with prev close/today's open guides (today = the last bar's New York day). Settings > Chart > "Chart
  effects" (frame.ts chartEffects, localStorage, default on, reduced motion forces off) gates the crosshair glow,
  selected-drawing glow and last-price flash/pulse (pulse only on a new bar or a 1-tick move >= 1 s after the last). Numbers: docs/research/chart-performance.md.
  Chart look (src/chart/, docs/research/chart-look.md): security header row (securityHeader.ts), range bar
  (rangeBar.ts/range.ts, remembered per timeframe, `loadHistory(..., days)` fetches more), legend box (legendBox.ts),
  our axis labels and year row, last-price tag and session lines (axis.ts, axisChrome.ts ChartChrome primitive),
  volume in its own slim pane, no library logo (attribution in Settings > About). Grid and time labels: our square
  dotted grid primitive (src/chart/grid.ts) on every chart via followTheme; the library grid and time labels stay off.
  Desktop app "Trading Terminal" (desktop/, v2.0, `python -m tp_desktop`): the published website itself in a Qt WebEngine
  window (PySide6-WebEngine, its own package since Qt 6.12), so it is identical to the site by construction; never
  re-implement pages in Python. It uses the website's helper (8765; launch.py starts `splash.py run --no-browser` when
  none answers), so trading works exactly as on the site. tp_desktop/policy.py (tested): the site stays in the app,
  other sites open in the system browser, notifications/clipboard only for the site, offline page only for real network
  failures (never ERR_ABORTED: a link the app sent to the browser). app.py: persistent profile in
  ~/.trading-platform/desktop-browser, downloads ask where to save, notifications via tray, print dialog, zoom keys,
  splash, dark frame, logo (assets/logo.svg -> make_icons.py -> .ico/.icns/.png, committed). shortcut.py makes the
  "Trading Terminal" desktop/Start-menu icon once (marker desktop-shortcut.json; `launch.py --shortcut` again).
  desktop_update.py self-updates desktop/ when APP_VERSION on main is newer and removes .py files a version dropped;
  Start screen (tp_desktop/chooser.py, choice.py tested): Terminal or Web, remembered in ~/.trading-platform/
  desktop-choice.json; Shift or --choose asks again; Web opens the site in the browser and exits (helper keeps running).
  Main window on Windows/Linux is frameless: amber minimise/maximise/close (tp_desktop/titlebar.py CaptionButtons) sit
  over the right end of the site's .shell-top, which DESKTOP_JS pads and makes a drag area (console messages
  __tp_window_drag__/__tp_window_max__ -> startSystemMove); EdgeResizer on the window's QWindow only; colours/height from
  CSS variables every 1.5 s. KEEP_CLEAR_JS moves anything the page opens under the buttons' corner (ticker
  drawer .sv-drawer, Bull, menus) down below the top bar (margin-top, given back when it moves away). Qt's datalist popup swallows Enter: EnterThrough forwards it (SUGGEST_JS, every window).
  Charts never wait on Alpaca: fill_older returns Schwab's bars after FILL_WAIT (3 s) and lets the download finish for
  next time; scanner Alpaca calls are background (alpaca.BACKGROUND) so a chart always has a free slot. Windows app:
  closing the window keeps it in the tray with the helper warm (Quit stops both); a second start hands over through a
  QLocalServer (app.INSTANCE). Account page and Home's My accounts follow live quotes (subscribeQuote), redrawn every
  3 s when something moved, changed rows flash (tick-up/tick-down).
  Flowing background (src/ui/atmosphere.ts): one canvas at 1/8 size, 15 updates a second (five window-sized CSS-animated
  layers dropped scrolling to ~10 fps in the app). Smoothness: ScrollAnimator off, FAST_FLAGS = gpu rasterization + no background throttling only (zero-copy and
  ignore-gpu-blocklist flickered on Intel); KEEP_CLEAR_JS runs on idle after relevant mutations; theme poll 3 s.
  app.ts warmPages(): ~5 s after start, the main pages (WARM_PAGES) are built hidden and started one at a time on idle,
  stopped after WARM_RUN_MS, focus kept; Account keeps its last figures while reloading.
  Speed: policy.FAST_FLAGS; helper workers run at low priority (engine/lowpriority.py); GPU renderer written to
  ~/.trading-platform/desktop-graphics.txt. Windows launcher hides its console (TP_HIDE_CONSOLE, tp_desktop/console.py);
  the helper's splash shows it while it needs you (helper-needs-you marker); the app's tray menu shows it or quits,
  and quitting stops the helper the launcher started.
  No-console start (Windows): the desktop icon runs pythonw launch.py --private; launch.gui_main opens the app at once with
  --starting <progress file> (tp_desktop/progress.py; FileBar writes it), the app's start-up window (chooser.Frame +
  StartPanel) shows the progress, then turns into the ChoicePanel in place; failures show there; an update to desktop/
  restarts the app (state restart, exit 76). The helper runs in its own hidden console (shows itself when it needs you;
  tray Show/Hide helper window writes ~/.trading-platform/helper-window). First start ever (no Qt yet) uses the text screen.
  Windows download: installer/TradingTerminal.iss (Inno Setup, no wizard pages, per-user, bundles signature-checked
  Python) built, silently installed/uninstalled and checked by .github/workflows/installer.yml, published to release
  tag `trading-terminal` as TradingTerminal.exe (same URL every time).
  bump APP_VERSION on every desktop change. Tests: desktop/tests (pure, no Qt). The helper's --desktop mode (8766) is
  no longer used by the app.
  Home hero: ticker tape (src/home/tickerTape.ts, live quotes, CSS loop) replaced the bridge. Market buddy "Bull"
  (src/ui/buddy.ts, owner's request): SPY mood happy/calm/sad, click to pet, drag (localStorage tp-buddy-pos), code PUP
  hides/shows; hidden on the Chart page and still for reduced motion.
  Chart clock (src/chart/clock.ts): 12-hour by default, 12h/24h button on the Chart page (`tp:clock` repaints every chart).
  Session look (src/chart/session.ts sessionPhase, axisChrome.ts): pre-market shaded sky, after-hours copper, overnight
  grey; open (green) and close (red) lines with their times in colour on the time axis' second row. The square grid
  continues past the data at the same spacing. Text roles: --label (amber) for labels/headers, white figures.
  Chart legend (chartPage renderLegend) is rebuilt only when its layout changes; values update in place. Indicator
  instances can hide single plots (`hiddenPlots`) and levels (`hideLevels`); the manager is openIndicatorManager.
  Browser reply cache: engineRequest reuses read-only replies for ENGINE_CACHE_MS (20 s quotes .. 60 min catalogs),
  joins identical in-flight requests, never caches store/settings/ai/scanner or failures; Refresh buttons call
  clearEngineCache. Investments prefetches sections on hover and in the background; fund cards prefetch alts.fund.
  Ticker card (v32, src/ui/tickerCard.ts): any element with `data-ticker` (spread `tickerAttr(symbol)` into h()) shows a
  card on hover (300 ms), tap or keyboard focus: invest.board quote + 3-month line, your position across your own
  portfolios, Open chart / Trade (pre-fills #trade only) / Research / Ask AI. One delegated listener set (app.ts);
  a click pins it unless the ticker sits in a button, link, focusable row or anything given an onclick by h()
  (`clickTargets`); touch: long press. Esc closes; Tab steps into it; Ask AI only pre-fills the assistant.
  As-of stamps: `asOfStamp(feed, {reply})` (src/ui/dataHealth.ts; that reply's own fetch time) in panel heads, amber after 2x the feed's
  refresh (src/data/health.ts FEEDS); engineRequest/history/quote/trade record each feed's last success, listed by
  the rail's Data button. Risk drill-downs: risk.account replies `series` {dates, account, spy} (daily returns);
  src/portfolio/riskCharts.ts opens the P/L histogram, beta scatter and drawdown curve from the risk card.
  Stock news anywhere (src/ui/stockNews.ts): openStockNews window, stockNewsCard (Research overview), newsButton (Chart
  toolbar, Trade chart head), ticker card "News", Research fn key and command code CN all use it.
  Research "Sales and profit, year by year" = src/research/yearBars.ts (one bar chart per measure, own scale, sentence).
  Line-chart indicators: chart windows have an Indicators menu (src/ui/windowIndicators.ts, LINE_INDICATORS run on
  the first line as flat bars); page charts have an fx button (class chart-ind-btn; never chart-fx, the engine's click-through layer) that opens it.
  Command bar (src/ui/command.ts, browser only): / or Ctrl/Cmd+K opens a palette over symbols (watchlist, holdings,
  NASDAQ_100 copy checked against the scanner's by a test, futures roots, invest.search), pages, accounts, clients,
  portfolios and actions; Bloomberg codes (CODES: "AAPL GP/DES/FA/CN/OMON/TRADE/ALRT/WL", WEI, ECO, FUT/CTM, PORT, ACCT,
  BTST, SET, MACRO, BONDS/WB, INV, HELP) call pages' open() methods. Ranking: exact ticker > exact code > prefixes >
  fuzzy name. Global chords (CHORDS: g h/c/s/a/t/f/p, n a), ? sheet (SHORTCUT_SHEET lists every page's keys; keep it
  in step), Ctrl/Cmd+I = AI assistant; never inside fields or dialogs. TRADE only pre-fills. Recents in localStorage.
  Security view (src/security/, v41 helper unchanged; docs/research/bloomberg-structure.md): #sec/SYM[/CODE] page and a
  slide-over (`openSecurity(symbol, tab?)` in open.ts, also the `tp:open-security` event). Clicking any [data-ticker]
  opens it (tickerCard.ts: the ticker text itself, even inside a clickable row; a ticker that is its own button keeps its action; hover keeps the quick card; AI replies are marked by ui/markTickers.ts). Tabs DES GP FA HDS CN OMON DVD BETA(HP) SET; the command bar's
  "AAPL FA" opens a tab, bare "AAPL" opens DES. Shared Back/Forward history (Alt+←/→) and recents (codes.ts). Maths in
  stats.ts (simple daily returns, 252 days, sample SD; tested against numpy), numbers via format.ts ("—" + reason,
  never NaN). Peers come from related.ts (same lists as scanner._SECTOR_LISTS, tested). Account tickers open it; "Records"
  opens the holding's records.
  Pop-out charts: `openChartWindow` (src/ui/chartWindow.ts); `createLineChart` adds hover values and an expand button;
  `openFredWindow` opens a FRED series' full history.
  Downloaded data is cached in ~/.trading-platform/cache.db (`ctx.cached(..., persist=True, stale_ok=True)`).
  Data hub (v44, helper/engine/datahub.py; audit in docs/research/data-aggregation-audit.md): every outside call goes
  through `datahub.get(ctx.http, '<source>', url, params=...)` or `datahub.call('<source>', fn, key=...)`, never a bare
  `ctx.http.get`. One gate per source in `SOURCES` (gap, per-minute budget, requests at once; Schwab 120/min of which
  background work such as the scanner uses at most 90 via `ctx.schwab.background()`), 429/5xx/network retries with
  backoff (only GETs; `retry=False` for POSTs), identical in-flight calls joined, failures raised as `DataError` (an
  EngineError without query strings). `ctx.schwab` is already routed (`datahub.raw(...)` for code doing its own call);
  SEC goes through `sec.sec_get` (streamed downloads: `async with datahub.Turn('sec')`). Name cache keys by source
  (first part in `CACHE_PREFIXES`, e.g. ('fred', id)) so hits count toward that source. Figures needing a source and
  date: `datahub.envelope(value, source, as_of)`; every engine reply gets `provenance` {fetchedAt, stale, sources}
  automatically (engine_reply), and the browser stamps a stale saved copy with its own time (src/data/provenance.ts).
  Symbols: `engine/symbols.py` (`normalize`, `to_source(s, 'sec'|'yahoo'|'alpaca'|...)`, `lookup` for replies keyed
  BRK/B or BRK-B); canonical = BRK.B, $SPX, /ES, BTC-USD. Times are UTC seconds (`datahub.utc_seconds`, `ny_date`,
  `ny_session_close`); units via `fraction`/`percent`/`bp_to_fraction`. Health per source (`data.health`) shows in the
  Data window's Sources table and the diagnostics file. Checks (engine/datacheck.py): data.identifiers (spellings, CIK,
  share classes, CUSIP), data.dividends (Yahoo vs 10-K XBRL), data.splits (Yahoo splits vs Schwab closes). Alpaca bars
  are split-adjusted only (like Schwab), re-downloaded when Yahoo shows a split after they were saved, and rescaled to
  Schwab over a 3-day overlap (charts and the scanner). One-time cache clean-ups go in `datahub.MIGRATIONS` (in order; each backs
  up what it touches to the cache_backup table first; a failure stops the chain; never delete kept 30-minute bars). Browser gate: DATAHUB_HELPER_VERSION = 44 for `data.*`.
  Alpaca (engine/alpaca.py, optional free keys in Settings): market-data-only history back to 2016 via
  `alpaca.bars(ctx, symbol, tf, start, end)` (intraday only, saved in cache.db, extended incrementally). With keys set,
  30m-4h charts ask for 3 years and the helper fills what Schwab lacks (Schwab wins); the AI reads regular-session
  hourly bars back to 2016. Only data.alpaca.markets; never trading (test scans every helper module).
  Indicators can load outside data via `IndicatorDef.external` (COT for the related futures market, FINRA short volume).
  Smart money pack (src/indicators/catalog/smartMoney.ts): Williams Pro Go, VIX Fix, Smash Day/Oops!/outside-day
  markers, insiders (research.insider_history: Form 4 P/S placed on the filing date, engine/smartmoney.py), 13F
  holders/shares (prospect.holders_by_symbol: prospect.db, 2 newest well-reported quarters, changes only among filers
  in both, one share class per CUSIP), put/call (today only, no free history), UMCSENT; needs helper v40
  (SMART_MONEY_HELPER_VERSION). Presets (src/indicators/presets.ts) sit atop the picker: "Larry Williams set".
  Every SEC request goes through sec.sec_get, which spaces them helper-wide (sec.pace, SEC_SPACING 0.125 s = 8/s).
  Schwab stays market-data only (its app's order limit is 0). Order placement exists only in engine/webull.py (Webull
  OpenAPI, hand-written HMAC-SHA256 signing matching the official SDK; hosts: Test us-openapi-alb.uat.webullbroker.com,
  Live api.webull.com) behind one-time 60 s preview tokens (webull.preview_order -> webull.place_order {token}), max
  order value / orders per day, Test-by-default and a typed LIVE opt-in in Settings; US stocks only, no sells beyond
  the position minus open sells (stock positions only), every attempt logged to ~/.trading-platform/orders.log and
  counted toward the daily limit (unreadable log = refuse). A timeout/5xx on place is "unknown": looked up once by
  client_order_id, never reported as not placed. Reply fields are the documented names; missing ones fail closed (and log function/line/field to helper.log). Real
  replies (checked 2026-11): order rows use total_quantity and place_time in ms; balances carry total_net_liquidation_value.
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
  orders/fills, snapshot every 30 s while visible; "All working orders" tab = webull.working_orders (v48): open orders of every
  stock account, plus futures when switched on, read-only with per-row Cancel; the Account page shows them read-only
  (src/portfolio/workingOrders.ts, "Manage in Trade" opens the tab). Ticket = src/trade/ticket.ts (shares/dollars/risk sizing, maths in
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
  engine/prospect_sources.py (docs/prospecting.md "Family offices from other public records"): free collectors
  (13D/13G + Forms 3/4/5 via EDGAR daily index + filing headers, Form 144 / 8-K 2.01 / S-1 sellers, GLEIF parents,
  ProPublica 990-PF, Wikidata founders) cached in cache.db, saved in prospect.db src_* tables; apply() (also run at the
  end of build_firms) groups and links them (same address strong, shared person + city medium, name only possible) into
  `signals` and "Possible single-family office" firms (points, never certain). Requests prospect.sources.refresh/status;
  profile `signals` (Evidence section), search `recentLiquidity`; Data tab panel src/prospect/sourcesPanel.ts. Browser gate
  PROSPECT_SOURCES_HELPER_VERSION 41 (filters hidden below it); sfo- ids = lowest member key; refused while pr.JOB runs.

  engine/prospect_contacts.py (docs/prospecting.md "Contacts"): firm-website crawler (<= 10 pages, robots.txt, 1 req/s/host,
  honest UA, public hosts only) -> people/emails/main+direct phones/focus as contact_facts with source URL + date, pending
  in the Review tab (src/prospect/review.ts) until approved ("reviewed by you on <date>"). Email labels: published /
  pattern + server-checked / pattern + domain accepts mail / guess / catch-all; never "verified". MX via dnspython or DoH;
  SMTP check off by default (settings prospect_smtp_check). prospect.ai_profile drafts cited facts (quote must be in the
  source, else dropped; cost shown first). Weekly watcher via prospect.SCHEDULE_HOOKS; do-not-contact via
  prospect.EXPORT_FILTERS. No LinkedIn, bought lists or people-search sites. UI: src/prospect/contacts.ts in the profile.
  Crawler UA = project URL only (never the owner's email). Browser gate PROSPECT_CONTACTS_HELPER_VERSION 41 hides the
  contacts section, Review tab and SMTP setting on older helpers.

## Security (SECURITY.md)

- XML from outside (SEC, feeds, xlsx) only via helper/engine/safexml.py (fromstring/iterparse; refuses DOCTYPE/entities;
  a test fails if a module parses XML any other way). SQL: values as `?`; column names only from fixed lists.
- Helper data folder is private (schwab_helper.make_private at start: umask 077, folders 700, files 600; Mac/Linux).
- Website: never put outside text into innerHTML (use h()/textContent; AI Markdown goes through renderMarkdown, which
  escapes first; markdownSafety.test.ts). main.ts runs src/frameGuard.ts (stopIfFramed) and only then imports app.ts (no running in frames). Keep
  the CSP in index.html strict (script-src 'self').
- CI: deploy.yml least privilege (only `deploy` has pages:write) and actions pinned to commit SHAs (Dependabot updates
  them); security.yml (scripts/check-secrets.py: detect-secrets, new values vs .secrets.baseline by hash, npm audit, pip-audit, bandit -lll); codeql.yml.
  After adding a fake key to a test, refresh the baseline: `detect-secrets scan ... > .secrets.baseline` (see the
  exclude list in that file's `filters_used`).

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

## Self-check and improvement

- helper/engine/selfcheck.py runs every 30 minutes (security, data, accuracy, speed), keeps ~/.trading-platform/
  selfcheck.json, shows in the status bar (src/ui/selfCheck.ts, helper v53+) and goes into Send diagnostics.
- Research → Where the money comes from: helper/engine/segments.py reads 10-K XBRL dimensional facts (product,
  segment, region, segment margin) + the label file; src/research/segmentsView.ts.
- Research → Debt and dilution (helper 68, DEBT_LADDER_HELPER_VERSION/debtLadderReady; src/research/debtDilution.ts pure +
  debtDilutionView.ts): research.company adds `maturities` (research.maturities: the 10-K LongTermDebtMaturities...
  ladder from one filing and its newest date: newest date, most buckets, then latest filed; missing buckets stay null;
  company_core(with_maturities=True) reads it for a pre-68 'sec-core' copy via 'sec-maturities'); interest cover =
  operating income / interest expense from the newest year with both (an operating loss is said as such; says when the
  line stopped being reported); diluted share change 1/3/5 years, skipping only split-like ratios (looksLikeSplit:
  within 8% of n or 1/n); buybacks (null = unknown, never 0), dividends and stock pay over today's market value.
  Helper 69 (OBLIGATIONS_HELPER_VERSION/obligationsReady; src/research/obligations.ts pure): research.company adds
  `obligations` {leases (operating: LEASE_TAGS ladder + total + presentValue, same one-filing rule), financeLease,
  purchase (PURCHASE_TAGS), uncertainTax (UnrecognizedTaxBenefits)} via research._latest/_ladder ('sec-ladders' for older
  saved copies). research.corpyields (its own request, never on research.company's path) = {ig BAMLC0A0CMEY, hy
  BAMLH0A0HYM2EY} from macro.fred (the Bond market page's cache). Refinancing = debt due in 2 years x today's average
  yields (no rating guessed; no "own average cost": interest expense also covers CP/leases/fees). Lease-adjusted debt
  only from the same year-end as the ladder; the interest split is hidden above 40% of payments.
- Research → Earnings quality (src/research/quality.ts pure + qualityView.ts, browser only): Piotroski F-score (2000
  definitions: ROA/CFO over beginning assets, LTD / average assets, turnover = sales / beginning assets; "issued no
  stock" = diluted count didn't rise; a check without its figures is unjudged, never a fail) and accruals = (net income
  - CFO) / average assets per year (Hribar-Collins 2002, Sloan 1996), own-range percentile from 5 years. Readings only.
  Helper 71 (HEALTH_HELPER_VERSION/healthReady; src/research/health.ts pure): statements add receivables, ppe,
  retainedEarnings and profile.sic (company_core reloads a 'sec-core' copy missing any STATEMENT_KEYS line under the same key with max age 0, keeping the saved copy if the SEC fails); Beneish M-score
  (1999, 8 ratios, D&A for depreciation, cut-off -1.78; newest year pair with every line and finite ratios; only
  positive-weight ratios are named as reasons) and Altman: Z (1968; SIC 2000-3999, live market value, newest year only),
  Z' (1983 book values; manufacturers otherwise), Z'' (1983; everyone else; SIC 6000-6999 not scored); total liabilities
  = assets - equity when the filing has no Liabilities tag, labelled. Glossary keys mscore/altmanZ.
- Research → Cash health (helper 74, CASH_CYCLE_HELPER_VERSION/cashCycleReady; src/research/cashHealth.ts pure +
  cashHealthView.ts): dividend cover = free cash flow / dividends paid, newest year and the last 5 consecutive years (with
  buybacks too), short years named; cash conversion cycle = DSO + DIO - DPO on year-end balances (Richards-Laughlin 1980),
  statements add inventory and payables (own lines only, never a combined payables-and-accrued line; none = "not worked
  out"; no inventory line = cycle of customer and supplier days only, labelled); cover uses only years with capex
  reported and says so when free cash flow is negative. New statement lines go in research.STATEMENT_KEYS.
- Research → Balance-sheet quality (helper 75, BALANCE_HELPER_VERSION/balanceReady; src/research/balanceQuality.ts pure
  + balanceQualityView.ts): statements add deferredRevenue (ContractWithCustomerLiabilityCurrent, else the pre-2018
  DeferredRevenueCurrent), goodwill, goodwillImpairment and intangibleImpairment (INCOME; missing = not reported, never
  0); billed in advance = growth vs sales growth and months of sales; goodwill vs equity/assets with 5 years of
  write-downs (share of the starting goodwill); a goodwill line the newest balance sheet lacks = "not shown since FYxxxx".
- Research → Building and stock pay (helper 82, CAPEX_HELPER_VERSION/capexReady; src/research/buildPay.ts pure +
  buildPayView.ts): statements add `depreciation` (tag Depreciation; Microsoft has no D&A tag); spending vs depreciation
  = capex / depreciation by year (paired bars, 5 consecutive years; D&A only when the newest year has no depreciation
  line, labelled; pace bands ahead >= 1.5, growing > 1.1, replacing 0.9-1.1, shrinking); free cash flow after stock pay
  = FCF - stock-based compensation, share of FCF (null when FCF <= 0), 5-year share, yields on today's market value.
  research._periods reads fiscal years (330-400-day facts) only from ANNUAL_FORMS: 10-Q trailing-twelve-month figures
  (Amazon's cash flows) had been read as fiscal years ending at quarter ends.
- Research → Return on capital (helper 83, ROIC_HELPER_VERSION/roicReady; src/research/roic.ts pure + roicView.ts, classes
  roc-*): statements add currentDebt (DebtCurrent, else current LTD + ShortTermBorrowings or else CommercialPaper, never
  both) and longInvestments; shortInvestments also reads OtherShortTermInvestments. Invested capital = total assets - cash
  - short/long-term investments - (current liabilities - current debt); ROIC = operating income x (1 - effective tax,
  0-50%, else 21% labelled) / average capital of two year-ends a fiscal year apart (yearsBefore); a cash-like line
  tagged before but not this year counts as zero and is named; untagged current debt = none. research.corpyields adds
  baa (FRED BAA, monthly) for the floor line (a floor, not the cost of capital). R&D capitalised over RD_LIFE 5 years
  straight-line (Lev-Sougiannis 1996, Damodaran 1999) needs 6 whole years of R&D; missing = 'history' or 'capital'.
- Research → Profitability and asset growth (no helper change; src/research/assetQuality.ts pure + assetQualityView.ts,
  class aq-panel): gross profit / total assets with the company's own range (viz rangeTrack, lower/middle/upper third
  from 5 years; Novy-Marx 2013) and total-asset growth vs sales growth (amber when more than a point above, one test
  `ahead` for table and words; Cooper-Gulen-Schill 2008). Readings, not signals. Shared year rules for every Research
  reading panel: src/research/years.ts (newestYear, yearsBefore = whole fiscal years apart, lastRun, Stale).
- Research → Taxes and operating leverage (helper 84, TAX_HELPER_VERSION/taxReady; src/research/taxLeverage.ts pure +
  taxLeverageView.ts, class tl-panel, in the More fold; bars via panelBlock.rateBars): statements add taxesPaid (IncomeTaxesPaidNet only); cash rate =
  paid / pre-tax, long run = sums over up to 5 consecutive years (Dyreng-Hanlon-Maydew 2008; none when losses cancel more
  than half the profitable years), against the book rate and 21%; a net refund is said as one. Operating leverage =
  slope of ln operating income on ln sales over up to 10 consecutive profitable years (Mandelker-Rhee 1984; slopeOf from
  c-math), yearly ratio only when sales moved 2%+; words follow the rounded multiple shown.
- Research → Against bonds (helper 85, REAL_YIELD_HELPER_VERSION/realYieldReady; src/research/againstBonds.ts pure +
  againstBondsView.ts, class ab-panel, in the More fold): earnings yield = 1 / P/E (the tear sheet's v.pe ?? quote
  peRatio) vs research.corpyields real10 = FRED DFII10 read in full from 2003 (FULL_FROM, ratesdesk._full) with its
  percentile (ratesdesk.percentile_rank); gap rounded to 0.1 point before words/sign (Asness 2003). Rates side by side
  use panelBlock.rateBars (classes rb-*), shared with Taxes and operating leverage.
- Research → Financials → As reported (default; Standard = the old same-lines-for-everyone view): helper/engine/
  asreported.py reads the filing's own layout (presentation linkbase _pre.xml, schema role titles, every label role,
  instance) and returns each statement and "(Details)" note as rows (heading/line/total/member, depth, values per
  column; negated labels flip the sign; cash start/end balances map to the year columns); src/research/asReportedView.ts.
  Helper 58 (research.asreported {symbol, period, role}).
- Edge tools (helper 59, panels in src/edge/, shared shell edgePanel + EDGE_HELPER_VERSION, classes xe-*): macro.fedodds
  (engine/rates.py: /ZQ futures via Schwab, CME FedWatch tree, FOMC list incl. tentative 2027) and macro.netliquidity
  (WALCL - WDTGAL - RRPONTSYD, change correlation with CI) on Macro; flow.offexchange also has `days` (helper 60: FINRA
  daily CNMSshvol TotalVolume = all off-exchange volume, over Schwab daily volume, out the same evening); quant.optedge (engine/optedge.py: gamma flip by
  re-pricing BS gamma on a +-15% grid, 30d IV vs 20d RV, VIX premium, earnings reactions from 8-K Item 2.02 times,
  implied move needs the Finnhub key) on Flow → Options; flow.offexchange (FINRA weeklySummary ATS/OTC, anonymous
  POST) and invest.navpremium (Schwab nAV else Yahoo navPrice) on Flow → Positioning; portfolio.factors
  (engine/factors.py: Ken French daily FF5 + Mom, OLS Newey-West, PCA hidden bets, Meucci effective bets) on
  Portfolios after an analysis; research.segmenthistory (last 3 10-Ks merged, ConcentrationRiskPercentage1 customers)
  on Research.
- Live flow (helper 62, engine/liveflow.py, Flow → Live flow tab, src/edge/liveFlow.ts): a helper loop (liveflow_schedule)
  reads Alpaca SIP trades (alpaca.trades, data host only; free plan = 15 min behind, detected by itself) every minute
  4am-8pm ET and keeps venue 'D' (reported to FINRA = off-exchange) prints >= blockMin; polls Schwab chains every 2 min in
  the session for contracts whose day volume grew by >= optionMin of premium (first poll only remembers). Alerts go
  through alerts.deliver (phone + tabs), one per symbol and kind per 5 min (later ones summed). Config in store
  collection 'liveflow' (engine-only). Never trades.
- Triangulated prices (helper 63, engine/pricehub.py): every price offer (Schwab stream tick with TRADE_TIME_MILLIS,
  Schwab official quote tradeTime, option-chain underlying, and for symbols quiet > 20 s in 4am-8pm ET Alpaca latest
  trade (feed=iex, free) then Yahoo v7 quote, each at most once a minute) goes through HUB.offer: the newest trade wins;
  backups more than 1.5% from two agreeing recent sources are refused (Schwab's own prices never are). Quotes carry
  src/at; the watchlist price shows them on hover (sourceTitle). prices.sources {symbol} lists every source.
- Crypto backup route (helper 65, engine/crypto.py): when the browser's Coinbase request fails, src/data/coinbase.ts
  asks crypto.candles (Coinbase from the helper, then Alpaca v1beta3 crypto bars (public, no key), then Kraken OHLC,
  all returned in Coinbase candle format) and goes through the helper for 10 minutes; watchlist/Investments crypto
  prices quiet for 20 s are polled via crypto.stats (Alpaca snapshots, then Coinbase stats).
- Prospects revenue (helper 76): engine/prospect_revenue.py estimates yearly revenue from Form ADV (Item 5.D assets by
  Prospects people (v77): prospect.individuals {firmId} reads every registered individual at the firm from the IAPD
  individual search (beta, ShapeError on unknown shape, paced, cached a week, saved as people source 'IAPD registered
  individuals'); src/prospect/people.ts sorts titles into levels (seniority) with chips and search; IAPD rows already
  named in a filing are dropped (mergePeople).
  Private repository (v78): the updater uses the owner's GitHub key (settings github_token, Settings > Data connections >
  GitHub) through api.github.com (key sent only there, never to the codeload redirect); without one a 404 shows
  PRIVATE_HINT as a failed update instead of failing quietly.
  Companies (v79, engine/companies.py, src/prospect/companies.ts, Prospects > Companies): US private businesses from the
  SBA 7(a)/504 loans since 2020 (quarterly) and PPP $150k+ (found via the data.sba.gov CKAN catalog; staged in SQLite,
  combined per cleaned name+ZIP, newest record wins, sources/first/last seen kept), DB ~/.trading-platform/companies.db;
  revenue = PPP payroll (loan x 12 / 2.5, 3.5 NAICS 72 2nd draws) scaled to newest jobs / PAYROLL_SHARE, else jobs x
  REVENUE_PER_EMPLOYEE.
  Plan for fresher data and people: docs/research/companies-plan.md.
  client type x typical fee rates; individuals/HNW by average account on a tiered schedule; performance fees = 20% of
  the year's gain on pooled assets when 5.E says performance-based; headcount cross-check), stored as firms.rev_low/
  rev_likely/rev_high (sort 'revenue', filter revenueMin, CSV). prospect.performance (engine/prospect_perf.py): 13F
  holdings-based quarterly returns vs SPY (top 40 positions at each quarter start), the estimate with that return, and
  reported revenue when the CIK files XBRL. Page: src/prospect/revenue.ts (+ "what it could be worth to you").
- Macro page (US tab), top to bottom: Today's read (regime quadrant from src/macro/monitor.ts regime(): 3-month changes
  of jobs, claims, retail sales, GDP vs CPI, core PCE, breakevens; plus six key numbers), Fed odds + net liquidity,
  yield curve, one Macro monitor table (latest, 1m, 1y, 2-year sparkline, percentile since 2006; row opens history).
  R&D work list:
  docs/research/institutional-edge.md.
- Scheduled improvement sessions follow docs/improvement/PLAYBOOK.md: propose only (branch + pull request with a
  plain-language report), never merge, never trade, never weaken security; the owner approves every change. Lessons
  (approved / turned down / rejected by experiment) go in docs/improvement/LESSONS.md.

## Fincept Terminal (remember this project)

github.com/Fincept-Corporation/FinceptTerminal (AGPL-3.0, C++/Qt + Python scripts). Owner decision 2026-11-16: use its
code, interface and layout for a full relook, Prospects first. Conditions (docs/research/fincept-plan.md): once any of
its code is copied the platform is AGPL-3.0 (LICENSE, keep its notices, list it in THIRD_PARTY_NOTICES.md); the repo
stays private and the platform runs in private mode (no public Pages site or .exe) unless the source is published.

## Planned

The full plan (a personal Bloomberg, including client reporting) is in ROADMAP.md. Follow its stage
order and architecture rules; update its Status table when a stage is done.

Secrets (including the Webull keys) stay in the helper on the owner's computer, never in the browser; a cloud
engine (stage 11) would need the same rule. Real-money trading stays behind explicit confirmation (preview token +
confirm window, typed LIVE opt-in), and Test (paper) comes first.

### Design and QA skills (.claude/skills)

- `frontend-design` and `webapp-testing` (Anthropic, Apache-2.0) and `unslop` (Damir Sokolovsky, CC BY 4.0): use them for
  every UI change and before each release. The owner's brief wins over a skill's taste (amber labels, the flowing
  background and Bull are the owner's choices). Release gate: the audit script (every route x dark/light x 1536/390:
  console errors, overlapping controls, clipped text, sideways overflow) must come back clean.
- Owner's standard: no corner cutting, professional product quality, easy for an older person yet sleek. Every
  feature goes through, in order: `superpowers:brainstorming` (options, then a recommendation) ->
  `supermatt:grilling` on the plan when it is big -> build with `frontend-design` -> `design:design-critique`,
  `design:accessibility-review` (WCAG 2.2: contrast, keyboard, tap targets >= 24px) and `design:ux-copy` on what
  changed -> `supermatt:qa` click-through and `scripts/release-audit.cjs` -> an independent reviewer
  (`supermatt:code-review`) -> publish. Check that every entity links onward (a stock: overview, chart, financials,
  options, research, trade ticket) so the site loops with no dead ends.
- Skills in the repo by prefix: `fin-*` (Anthropic FSI valuation and research methods: use them to check that
  Research valuation, comps, DCF/LBO, earnings and catalyst features follow institutional practice), `ria-*`
  (client review/report/proposal standards for Clients & Reports), `eng-*` (architecture, code review, testing,
  security, TypeScript, Python, debugging, WebSocket, Playwright). Finance rule: every figure shows its source and
  as-of date, maths is pure and tested against hand-worked reference values, no look-ahead in backtests, costs
  included, and paid-data steps in a skill are replaced by the free sources already in the helper.
- Reviewed plugins the owner may enable in their account (Anthropic directory): Design (Anthropic), UX Agent
  Skills (usability and critical-user-journey audits), ux-ui-audit (measured contrast, tap targets, Hick/Fitts),
  VectorLab UI/UX Skills (errors, empty states, loaders, forms), A11y Enforcer. Use them when they are present.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for cadenb777-jpg/trading-platform (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The seven default labels: bug, enhancement, needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root and ADRs in `docs/adr/` (created when first needed). See `docs/agents/domain.md`.

### External peers

Host-only: code review and jury use Claude reviewers only, with no external CLI. See `docs/agents/cross-model.json`.
