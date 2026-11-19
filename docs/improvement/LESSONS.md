# Lessons log

One line per proposal or finding: date · what · outcome (proposed / approved / turned down / rejected by experiment) ·
why. Newest at the bottom. Improvement sessions read this first and don't repeat a turned-down idea without new
evidence.

## The owner's standing requests (read first, every run)

Things the owner has asked for, sometimes more than once. Apply them without being asked again; add to this list
whenever the owner repeats or adds one.

- **Big, finished changes each run**, not one small tweak (2026-11-11): a whole feature, page or roadmap stage, fully
  checked, as one pull request. Runs every 3 hours.
- **The three mantras (owner's words, 2026-11-11):** 1. simplicity scales; 2. innovation (new, intuitive ways to use
  maths that works and checks itself, with cool design that is intuitive to people); 3. arbitrage and fundamental
  market edge (financial arbitrage with self-checks; the resources, tools, data and maths at the highest professional
  level, laid out beautifully and always improving). The platform finds and verifies; the owner decides and trades.
- **Build it wide and deep, launch-ready** (2026-11-11): product-launch quality every run; install the plugins and
  skills the work needs (and say which); weave in other languages where they make it better, easier or faster.
- **Copy capabilities, not identities:** anything another platform does that is fundamentally better or gives edge is
  built here and improved on; never its code, name, logo, help text or a look-alike screen (legal risk when selling).
- **No corner cutting:** professional, Bloomberg-grade quality; easy for an older person, yet sleek. Every feature goes
  through the full CLAUDE.md process (options -> build -> design, accessibility and copy checks -> click-through QA and
  release audit -> independent review).
- **Keep the owner's look:** amber labels, white figures, green/red only for good/bad, the navy flowing background,
  Bull the dog, the ticker tape, the 12-hour clock, light and dark themes. Improve within it, never restyle it.
- **Every screen instant once warmed up**, and the program never slow: measure speed before and after a change
  (2026-11-11: hidden pages polling every 5 s made everything slow; fixed in #9).
- **Use other languages where they are measurably better** (2026-11-11), e.g. Rust/WebAssembly for heavy browser maths
  or a compiled worker for the scanner, with before/after timings. It must install by itself on the owner's PC.
- **Proactive R&D, not just the example given** (2026-11-12, asked more than once): study what professional
  platforms show (Bloomberg's revenue by product/segment/region, trade flows, statements as filed, options-implied
  views, rates and relative value), find the free source, research the papers and the maths (new maths where it gives
  edge), and build it without being told. Work from docs/research/rd-backlog.md: build the top item each run and add
  at least two newly researched items. Install whatever skills/plugins the work needs and say which.
- **Every figure shows its source and time;** never invented; missing data says "unavailable" and why.
- **Every entity links onward** (a stock to its overview, chart, financials, options, research, trade ticket): no dead
  ends.
- **Explain in plain language;** the owner is a beginner. Say what changed, why, and what (if anything) to do.
- **Free data first;** paid data only when the owner decides.
- **Owner's choices already made:** the helper checks for updates every 2 minutes and installs by itself; the scanner
  runs every 5 minutes over the Nasdaq-100 only; no AI summary buttons on the Chart page or Portfolios; Bull stays.
- **Do the R&D without being asked** (2026-11-12): research how institutions get edge (papers, GitHub, practitioner
  talks), get the maths right from primary sources, see how Bloomberg and the pro tools display it, build it nicely,
  test it. Work down docs/research/institutional-edge.md, one complete item per run.
- **Safety, always:** never trade, never weaken security, never merge; real-money orders only behind preview + confirm.

## Log

- 2026-11-11 · Flowing background moved to one small canvas · approved (owner asked) · five window-sized animated
  layers measured ~10 fps scrolling in the desktop app; one canvas measured 60 fps on five pages.
- 2026-11-11 · Charts never wait on Alpaca for older history · approved (owner asked) · diagnostics showed the 1-hour
  chart waiting behind the scanner's Alpaca queue at helper start.
- 2026-11-11 · Self-check every 30 minutes (security, data, accuracy, speed) · approved (owner asked) · first finding
  on the owner's PC: api.nasdaq.com answered 403 to every request (12 of 12) in the 2026-11-10 diagnostics.
- 2026-11-11 · Hidden pages stop hammering the helper (Setups' 5 s re-check only on screen; background warm-up one page
  at a time) · proposed · owner's diagnostics: scanner.results (362 KB) + alerts.list every 5 s from the hidden Setups
  page (91 each in 7 min), speed check failing (slowest 5% = 21.6 s); measured 25 -> 4 requests in 2 min on Home.
  Also seen, not yet fixed: self-check "SPY daily history: days out of order or repeated".
- 2026-11-11 · #9 hidden pages stop hammering the helper · approved (merged by the owner).
- 2026-11-11 · Daily closes one per New York day (fixes self-check "SPY daily history: days out of order or repeated") ·
  proposed · found by the self-check on the owner's PC.
- 2026-11-11 · Index futures fair value: implied open, futures vs fair value, implied financing rate vs SOFR and the
  roll for ES/NQ/YM/RTY (Futures page panel + S&P open chip in the morning brief; helper 55) · proposed · the overnight
  read every professional desk uses; cost-of-carry maths (Hull ch. 5) tested on hand-worked values; free data only.
- 2026-11-11 · #10 fair value, daily-history fix, standing requests · approved (merged by the owner).
- 2026-11-11 · WebAssembly for the backtester · rejected by measurement · 15 years of daily bars: one backtest 13 ms,
  200-run random-walk test 0.6 s, 49-cell sweep 0.08 s, Monte Carlo 2,000 runs < 1 ms: nothing a person waits on.
  Revisit for the scanner or optimiser if they become the slow part.
- 2026-11-11 · Fast start: self-started cache refreshes use the background budget; stock closes valid until the next
  close · proposed · owner's diagnostics: clicks waited 45-54 s after start; simulation on the real gate: 45.2 s -> 0.24 s.
- 2026-11-11 · Home AI market read opens full width under the function bar; empty AI summaries say why · proposed ·
  owner: "the AI summary is placed weird".
- 2026-11-11 · SPX box-spread rates vs T-bills and SOFR ("What money costs", helper 56) · proposed · arbitrage tool:
  box rates above Treasury yields (van Binsbergen, Diamond, Grotteria JFE 2022); after costs, asks-vs-mid shown.
- 2026-11-11 · #11 fast start, box-spread rates, Home AI read, mantras · approved (merged by the owner).
- 2026-11-11 · Jitter browsing indicators: no full-screen backdrop blur behind pop-ups; the indicator window scrolls
  only its lists · proposed · owner saw jitter; measured scrolling the list at 20 fps with the 3 px blur, 60 fps
  without (68 -> 0 slow frames); the window also had nested scroll areas that moved the whole column. Lesson: never put
  backdrop-filter over animated content (flowing background, live charts); measure scroll fps on every pop-up change.
- 2026-11-11 · Home "Edge today" card (implied open, futures vs fair value, box lending vs T-bill), and new Home cards
  join saved layouts once (Layout.seen) · proposed · owner: "I notice no new changes": the edge tools sat low on Futures.
  Lesson: every new capability gets a visible home on the first screen, not only a page section.
- 2026-11-11 · #12 jitter fix and Edge today · approved (merged by the owner).
- 2026-11-12 · Account table no longer jumps to the top on live refresh (keepScroll); desktop black screen after the
  screen sleeps or long runs (GPU crash limit off + black-window watchdog that reloads) · proposed · owner reports.
  Lesson: any live redraw must keep scroll positions; the desktop app must recover by itself from GPU/driver resets.
- 2026-11-12 · Research → Where the money comes from: revenue by product/service, business segment and region (with
  share, growth and segment margin) read from the 10-K's own XBRL dimensional facts and label file (helper 57) ·
  approved (owner asked) · the SEC company-facts API omits dimensional data, so "product revenue" was all the platform
  had; tested on Apple FY2025 figures (parts add up to $416.161B). Lesson: the owner's example was one of many: research
  and build the whole class (docs/research/institutional-edge.md).
- 2026-11-12 · Research → Financials → As reported, for any ticker: each statement and every note's detail table
  in the company's own lines, order and words, with the parts it reports under a line (net sales → products / services)
  (helper 58) · approved (owner asked: "a thing setup for every company that i choose", "it looks like you just did
  apple") · Lesson: say plainly that a feature works for every ticker and show it on a second company; the Apple
  numbers in a test read to the owner as "Apple only".
- 2026-11-12 · Ten edge tools at once (helper 59): Fed rate odds, net liquidity, gamma flip, implied vs realized
  volatility with the VIX premium, earnings move vs past reactions, dark-pool share, fund premium to NAV, factor
  exposures, hidden bets, segment history and biggest customers · approved (owner asked: "do everything that they
  have") · each checked against a hand-worked or synthetic example; the PCA test exposed that equal-volatility
  independent holdings have no unique components (documented). Lesson: give every new panel class names of its own
  (xe-*): the Home card's .edge-body turned the new panels into columns until a browser check caught it.
- 2026-11-12 · Macro page redesigned: regime read and key numbers first, then the edge panels, the curve and one compact
  monitor table instead of 18 chart cards · approved (owner: "looks outdated and random, make it cleaner but still
  showing good stuff for that extra edge") · Lesson: lead with the answer (the regime), keep detail in one scannable
  table; every series' place in its own history is the cheap extra edge.
- 2026-11-12 · #13 Account table keeps its place; desktop black-screen recovery · approved (merged by the owner).
- 2026-11-12 · #14 Fitted Treasury curve "What the curve says" (helper 61): rich/cheap maturities against each one's own
  year, forwards, breakevens and yield-curve recession odds with the model's record; Home Edge today line · proposed ·
  backlog B5+B6 (top unbuilt item with free data verifiable from the research environment). Lessons: a coupon par curve
  drawn between coupon dates zig-zags (draw it on half-years); NSS has several local fits (each of 6 starting shapes won
  on some days of 2025-26), so fit from all of them and save past fits instead of warm-starting (warm starts were 18x
  faster but 30% worse); with 14 maturities a 2 SD "unusual" fires by chance about half of all days, so 2.5 SD.
  newyorkfed.org is blocked from the research environment: the recession probit is fitted here from FRED instead
  (a = -0.75, b = -0.56 on 790 months), which is reproducible and shown on screen.
- 2026-11-12 · Live flow (helper 62): dark-pool block prints from Alpaca's full-market tape (venue D) and big options
  trades from 2-minute Schwab chain checks, with phone/desktop alerts · approved (owner: "theres got to be some way to
  set it up so its not all based on 3 week old data") · Webull left out (its trading API has no tape). Lesson: the
  weekly FINRA file is the slow, labelled version; the same off-exchange trades are on the tape in (near) real time.
- 2026-11-12 · Triangulated prices (helper 63): newest trade wins across Schwab stream/quote, option chains, Alpaca and
  Yahoo (backups only for quiet symbols), stray backup prints refused · approved (owner asked) · the first design held
  back a real >1.5% jump from Schwab for up to 30 s; the guard now applies to backups only. Scroll check on Macro and
  every Flow tab: 0 slow frames (max 17 ms). Live flow redraws only when the feed changes and never rebuilds a
  focused form. Lesson: a guard against bad data must not delay the move you care about most.
- 2026-11-12 · #14 Fitted Treasury curve "What the curve says" · approved (merged by the owner).
- 2026-11-13 · #15 Rates desk pack (helper 64): credit spreads by rating with what each notch pays, Treasury auction demand
  scorecard, Kim-Wright term premium · proposed · backlog B8-B10. Rejected by experiment: an auction "tail" against
  that day's fitted closing curve (76 auctions 2024-26: SD 3.7 bp, median 2.6 bp vs real tails of 1-2 bp: noise, so
  left out). Measured: a 2 SD strong/weak bar labelled a third of auctions; 3 SD labels ~1 in 10 each way. Lessons:
  measure how often a label fires before choosing its threshold; keep optional slow sources off a page's critical path
  (own request); a chart label must come from the data's real span ("since Nov 2023"), not a hard-coded "3 years".
- 2026-11-13 · #15 Rates desk pack · approved (merged by the owner).
- 2026-11-13 · #16 Money and supply (helper 66): overnight funding stress (SOFR vs IORB), mortgage spread, Treasury borrowing
  pace and bill share; Home warns only when funding is tight outside month-ends · approved (merged) · backlog B11-B13. Changed by
  measurement: bills' share of gross auction sales was 87% (short bills roll over every few weeks, so gross always looks
  bill-heavy); the honest figure is the net change in debt by type (MSPD): 57% of new marketable debt in 3 months, 23% of
  all. Lessons: share of a flow needs the net flow, not gross sales; a percentile gate ranked against a mostly-negative
  history still fires on routine month-end bumps, so name the calendar effect; don't cache a combined reply whose parts
  can fail (cache each source instead).
- 2026-11-13 · #17 Credit and reserves (helper 67): bank reserves vs GDP against the September 2019 breaking point, commercial
  paper vs T-bills, banks' lending standards · approved (merged) · backlog B14-B16. Review caught a mixed basis:
  dividing today's reserves by last quarter's GDP but a year ago by its own quarter's made the year-on-year trend wrong by
  about as much as the change itself; every week now uses its own quarter (unpublished = estimated, flagged). Lessons:
  compare like with like before quoting a change; label thresholds symmetrically (easing at any negative but tightening
  only at +20 was lopsided); a Home line that is almost never shown isn't worth five downloads on every Home refresh.
- 2026-11-13 · #18 Debt and dilution (helper 68): the 10-K debt maturity ladder, interest cover, share count change and
  buybacks after stock pay on the Research overview · approved (merged) · backlog A5-A6. B17 (defaults vs spreads) was put on hold
  rather than built with guessed default and recovery rates, because their source (spglobal.com) couldn't be reached.
  Lessons: a share count series can jump at a split (Apple's FY2017 figure is pre-split, 5.25B vs 20.0B), so never
  compound across a jump of over a third; read every bucket of a table from one filing and date (Coca-Cola's 10-K has no
  "after year five" tag, so the total is called partial instead of borrowing last year's); say when a line stops being
  reported (Apple last tagged interest expense in FY2023) instead of showing an old ratio as current.
- 2026-11-13 · #19 Beyond the debt line (helper 69, stacked on #18): what borrowing the debt due within 2 years again
  would cost at today's investment-grade and high-yield averages, lease payments by year with the part that is interest
  and lease-adjusted debt, purchase commitments and uncertain tax positions against cash · approved (merged) · backlog A11-A12.
  No credit rating is guessed: both market averages are shown and labelled as averages. Review removed "versus the
  company's own average cost" (interest expense / year-end principal mixes in commercial paper, leases and fees and
  could say "cheaper" when it is dearer) and moved the FRED yields off the Research page's critical path. Lessons: a
  ratio built from two lines that don't measure the same thing is worse than no ratio; never add figures from
  different year-ends (lease-adjusted debt checks the dates match).
- 2026-11-13 · #20 Earnings quality: Piotroski F-score checklist (each check with both years' numbers) and accruals by year
  on the Research overview, from the statements research.company already returns (no helper change) · approved (merged) ·
  backlog A13-A14. Both are labelled readings, not signals, until tested on the owner's stocks. A check without its
  figures is "no data" and the score says "of 8" rather than counting it as a fail.
- 2026-11-13 · #21 Health scores (helper 71): Beneish M-score (all 8 ratios or no score; never a guessed 1.0) and Altman
  Z-score (manufacturers with a live price get the 1968 Z; manufacturers without one get Z' on book values; others get
  Z''; banks and insurers aren't scored) on Earnings quality · approved (merged) · backlog A15-A16. Review caught a reason
  sentence that could say the opposite of the truth: ratios with negative weights raise the score by falling, so only
  positive-weight ratios are named. Lessons: a filer that omits a total (Coca-Cola has no total liabilities tag) gets a
  derived figure only with a label; never set today's market value against an older year's accounts; check glossary
  keys for clashes (the price z-score already used `zscore`).
- 2026-11-13 · #22 Cash health (helper 74): dividend cover by free cash flow (newest year and 5 years, with and without
  buybacks) and the cash conversion cycle, on the Research overview · approved (merged) · backlog A17-A18. Coca-Cola's FY2025 free
  cash flow paid only 60% of its dividend (5 years: 1.0x). Lessons: read payables only from their own line (a combined
  payables-and-accrued line would inflate days to pay, so Coca-Cola gets "not worked out" rather than a wrong number);
  "no inventory ever reported" is zero, but one missing year is left out, never zero.
- 2026-11-14 · #23 Balance-sheet quality (helper 75, stacked on #22): deferred revenue against sales (Microsoft's grew 13.0%
  while sales grew 17.8%) and goodwill with its write-downs (Coca-Cola: 48% of equity; $13M of goodwill and $2.05B of trademarks and other intangibles written down in 5 years) ·
  approved (merged) · backlog A19-A20. Lessons: Apple stopped tagging goodwill after FY2017, so the panel says so instead of
  showing an old figure; a reported zero write-down isn't a write-down and a missing tag isn't zero; tangible book was
  dropped because intangibles are tagged too unevenly between companies to subtract honestly. Review caught the share
  "written off" mixing trademark write-downs into a goodwill percentage (12% shown, 0.1% true): keep each figure to
  its own base.
- 2026-11-16 · #34 Building and stock pay (helper 82; merged by the owner, who moved it from 81): capital spending against depreciation (Microsoft 3.4x, up from
  1.9x in FY2022; Apple 1.0x) and free cash flow after stock pay (Microsoft 19% of free cash flow; Amazon FY2025 253%) on
  the Research overview · approved (merged) · backlog A21-A22. Lessons: compare capex with depreciation alone, not D&A (Apple
  read 0.67x on D&A, 1.04x on depreciation: amortization of bought intangibles isn't what capex buys); a 330-400-day fact
  in a 10-Q is a trailing twelve months, not a fiscal year (Amazon's Research figures had been built on quarter-end
  "years"). The independent /code-review couldn't run (weekly usage limit until 2026-11-18): self-reviewed, to be re-run.
- 2026-11-17 · #39 Return on capital (helper 83): ROIC by year against Moody's Baa yield (Microsoft 27.6%, 21.0 points
  above the 6.59% Baa yield, below its own median of 36.5%) and R&D counted as an investment (Microsoft 24.3%; Apple
  137% -> 74%) on the Research overview · approved (merged) · backlog A23-A24. Lessons: measure invested capital on operating
  assets (equity plus debt makes buybacks look like better returns); current debt is tagged as a total (DebtCurrent) or
  as parts, and short-term borrowings usually already include commercial paper (never add both); a line a company
  drops (NVIDIA's marketable securities in FY2026 under its own tag) is named on the page, not silently zero. Review
  caught: borrowings + commercial paper double count, the words using a stale yield, a missing-Baa reply showing
  nothing, a CSS class clash (rc-) with the risk charts, empty bars for loss years, years compared across gaps.
- 2026-11-17 · #41 Profitability and asset growth (no helper change, stacked on #39): gross profit per dollar of assets
  on the company's own range (Microsoft $0.30, middle third since FY2017; NVIDIA $0.74, upper third) and total-asset
  growth against sales growth (Microsoft +22.5% vs +17.8%) on the Research overview · approved (merged) · backlog A25-A26.
  Lessons: say "above/below sales growth", never "faster" next to "shrank"; one shared year rule (src/research/years.ts:
  newest year, whole fiscal years apart, newest run) so panels on one page pick the same years. Review caught: a
  stale note naming the wrong missing line, "$-0.05" for a gross loss, a dead red class on a reading where shrinking
  isn't bad, two float tests of one line that could disagree, duplicated helpers.
- 2026-11-18 · #49 Taxes and operating leverage (helper 84, merged as 85): cash tax rate against the book and federal rates (Microsoft
  FY2026 12.8% in cash vs 19.4% charged; 19.7% vs 17.8% over 5 years) and operating leverage as the slope of log
  operating profit on log sales (Microsoft 1.4 over 10 years, Amazon 1.6), in the More fold of the Research overview ·
  approved (merged 2026-11-18) · backlog A27-A28. Also fixed a failing release audit on main: the bond curve's .cf-range rule (height 14px)
  squashed the Chart page's range buttons (same class) into the toolbar on phones; rules are now scoped to their cell.
  Lessons: never mix net and gross taxes-paid tags in one sum; a long-run rate is meaningless when losses cancel most of
  the profit; words must follow the rounded figure the page shows; generic class names collide across pages.
- 2026-11-18 · #50 Against bonds (helper 85, merged as 86): the stock's earnings yield (1 / P/E) beside the 10-year
  real Treasury yield (FRED DFII10, 2.92% on 2026-11-16, higher than on 99% of days since 2003), with the gap as the
  headline, in the More fold · approved (merged 2026-11-18) · backlog A29. Lessons: macro.fred starts in 2006, so a "since 2003" history needs
  ratesdesk._full; use the platform's one percentile rule (ratesdesk.percentile_rank) and never say "higher than on
  100% of days"; round the gap before choosing its sign and words; a reply's provenance.fetchedAt is its oldest source,
  not the price time, so the page says when the figures were loaded instead of inventing a time. Review also caught: the
  P/E differing from the tear sheet's, a negative real yield worded as "above inflation", a pre-update cached reply
  shown as a FRED failure, duplicated bar code (now panelBlock.rateBars).
- 2026-11-18 · #58 Among US companies + inventory against sales (helper 88): seven Research readings ranked against
  every US SEC filer with $100M+ of assets from the SEC's free XBRL frames (Coca-Cola's gross profit per dollar of assets
  $0.28 = 54.7th percentile of 1,474; Microsoft's operating margin 45.6% higher than 96% of 2,539), and inventory growth
  against sales growth on Cash health (Apple FY2026 +154.3% vs +15.1%) · approved (merged 2026-11-18) · backlog A31-A32. Lessons: frames
  calendarise fiscal years loosely (Microsoft's July-June year sits in CY2025), so balances are read from the quarter frame
  nearest each company's own year-end and must be dated within 10 days of it; growth only when both years use the same
  revenue tag; a frame still filling up (CY2026: 353 companies in November) is skipped for the year before. Also fixed on
  main: the Taxes and Against bonds gates still said helper 84/85 after #49/#50 were renumbered 85/86, so a helper 84 or
  85 was told to refresh instead of update.
- 2026-11-19 · #61 Share count change + R&D per $ of sales ranked among US filers (helper 90) and the Sahm rule on Macro:
  two more rows of Among US companies from SEC frames (diluted shares, else basic, 3,619 filers: Apple -2.6% after buybacks, 16th
  percentile; R&D, 1,327 filers: Microsoft 11.5%, the middle) and Macro → Recession check from FRED SAHMREALTIME + USREC
  (0.00 for October 2026; since 1959 it fired 11 times, 9 within 3 months of a recession's start, all 9 recessions caught,
  false alarms Nov 1976 and Jul 2024) · proposed · backlog A33-A35. Lessons: a "12 quiet months" rule for a new Sahm
  signal hid the Aug 1981 recession's own signal (Nov 1981, six months after the 1980 one ended): six months separates
  episodes; a red-to-green track is wrong where low is good; the ranking field saved by helper 88 is removed by a datahub
  migration (filerrank-v1) rather than left to show seven rows for a day; a reading an older helper doesn't send says
  "arrives with the update" (or "saved before your update" on helper 90+), never "not tagged". Review: the SEC frames take
  last year's share count from the newest filing (already split-restated), so a whole-multiple split filter wrongly
  dropped ~590 real issuers; it now applies only when the two years come from different filings, and only to the usual
  split ratios within 3% (an 8.3x de-SPAC jump is issuance). R&D prefers the line without acquired in-process R&D.
- 2026-11-19 · #62 Growth this quarter + Financial conditions on Macro (no helper change, stacked on #61): the Atlanta
  Fed's GDPNow (3.2% for Q4 2026; median miss 1.2 points against today's official figures over 61 quarters) and the
  Chicago Fed's NFCI (-0.48 in the week to Nov 13, 2026: looser than the 1971 average, yet 42% of weeks were looser, so
  within its usual range; ANFCI -0.50), from FRED via macro.series raw · proposed · backlog A36-A37. Lessons: "below the
  average" and "unusual" are different claims: say both (zero vs the share of weeks); a model's record against revised
  official figures includes revisions it couldn't know, so say so and give the median miss, not a hit rate; the
  comparison series failing must not hide the reading itself. Review: macro.series raw reads FRED from 2006 (macro.fred START),
  so "share of weeks" is since 2006 and must say so; panels built once in skeleton() never refreshed (now rebuilt on
  Refresh, with Retry; the 30-minute timer leaves them alone so nothing jumps); ties count as neither looser nor tighter;
  one rounding rule (rounded()) for figure, sign, side and badge, so -0.005 is -0.01 everywhere.
