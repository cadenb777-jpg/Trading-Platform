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
