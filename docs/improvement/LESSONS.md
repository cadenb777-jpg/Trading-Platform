# Lessons log

One line per proposal or finding: date · what · outcome (proposed / approved / turned down / rejected by experiment) ·
why. Newest at the bottom. Improvement sessions read this first and don't repeat a turned-down idea without new
evidence.

## The owner's standing requests (read first, every run)

Things the owner has asked for, sometimes more than once. Apply them without being asked again; add to this list
whenever the owner repeats or adds one.

- **Big, finished changes each run**, not one small tweak (2026-11-11): a whole feature, page or roadmap stage, fully
  checked, as one pull request. Runs every 3 hours.
- **The three mantras:** simplicity scales; innovation (proven maths shown in new, intuitive ways, each with a check);
  edge (relative value and arbitrage found, verified across sources, shown with real costs). The platform finds and
  verifies; the owner decides and trades.
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
