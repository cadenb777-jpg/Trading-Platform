# Conductor: review, polish and simplify the platform (UI, speed, Setups + Williams COT/z-score)

| id | item | depends_on | status | session | branch | attempts | notes |
|----|------|-----------|--------|---------|--------|----------|-------|
| 1 | Research Larry Williams COT + flow of money, pairing with z-score -> docs/research/williams-cot.md | - | passed | - | conductor/1-williams | 3 | bc659e8; video section verified against owner transcript |
| 1b | Research professional trend-following and chart tactics with evidence -> docs/research/trend-and-charts.md | - | passed | - | conductor/1b-trend | 2 | 08441cc; 9 corrections applied (doc only); 77 URLs, abstracts only |
| 1c | Deep research pass (3 parallel researchers): time-frame/time-series econometrics; statistics of backtesting; investment analysis + short-term reversal + positioning breadth. Each >=20 primary sources, key claims cross-checked by 2 | - | passed | - | conductor/1c-* | 2 | owner: be diligent, not one book; stats 1382f9b PASSED (corrections verified); invest be3f15a PASSED (corrections verified); timeframes eb0e777 PASSED (corrections verified) |
| 4a | Alpaca free history provider: settings keys + Test connection, history fallback merge, AI tool access, market data only | - | passed | - | conductor/4a-alpaca | 2 | owner will paste keys; scanner wiring done in item 4; 2efdae2 4530661 027bc13; 89 helper tests; review FAIL: extended-hours mix in AI, Alpaca failure sinks AI tool, unbounded 5m download, wording, dead code; fix c89ac94 (97 tests); re-review PASS |
| 2 | UI polish of every page except Setups (design system, spacing, typography, tables, consistency) | - | passed | - | conductor/2-ui | 2 | dd1da98 style.css only; screenshots ui-before/ui-after; review FAIL: clipping (invest board, clients list, phone nav, calendar values) + 7 polish items sent; fixes 6bf2e12 e9ea306; re-review PASS at e9ea306 |
| 2b | Column filters + sorting on every data table: one shared helper (click header to sort; small filter row: text contains, number min/max, pick-list for few values; clear-all; remembers per table), applied to all tables; Setups reuses it | 2 | passed | - | conductor/2b-tables | 2 | owner request; one shared component, not per-page code; 94368e5 f8faedf 9d3eb6d 2ee28e0; 159 tests; review FAIL: unsorted reorder, shared ids, a11y popover, alignment, phone holdings; fix 9134821; re-review PASS |
| 3 | Code efficiency pass outside setups/scanner/strategies/lab (front end + other engine modules) | - | passed | - | conductor/3-perf | 1 | b27a26e f3694b9 76ff816; 10 fixes; scanner notes for item 4 (GIL stalls -> processes, atomic graveyard write, cache wipe); review PASS (randomized highest/lowest check, 145+74 tests) |
| 4 | Setups simplification: Williams COT + z-score core, fewer indicators, scanner speed, page in the new design | 1, 1b, 1c, 2, 4a (2b wired at merge) | passed | - | conductor/4-setups | 3 | helper protocol bump -> v21; based on conductor/integration f8e2045; v22, 126 helper tests, results doc setups-v21-results.md; review FAIL: z-check C-grades pullbacks, lab never A, stall, cache.db growth, pools, routine text; fixes f3c3c82 0db9fe0 15efac2 417b143 verified |
| 6 | Production-readiness audit (read-only scorecard /100, code fixes vs owner decisions) | - | passed | - | - | 1 | owner: friend's skill scored 40/100; target 100; 43/100, code fixes cap ~70-75, report production-audit.md |
| 7 | Apply research platform-wide (Backtest, Flow, Macro, Portfolios, Investments, Home: correct stats, horizons, sizing, labels) | 1, 1b, 1c, 2, 3 | pending | - | conductor/7-wide | 0 | owner: apply knowledge everywhere |
| 8 | Production fixes from audit to sale-ready standard (security, CI, installer/setup wizard, legal page templates, licenses, provider abstraction, a11y) | 6, 2, 3 | passed | - | conductor/8-prod | 1 | owner-decision items reported separately; quick wins only: 7 commits, 107 helper tests; review PASS; fixes 8d635fe |
| 9 | Re-score /100 after merge, then LOOP: fix the code-side gaps, re-score, until every code-fixable area is maxed (target: highest reachable without owner legal/commercial actions) | 5 | pending | - | - | 0 | owner request |
| 10 | Design round 2 (fintech-grade): after 4/7/8 merge, a design-lead review of every page incl. Setups against pro terminals (Koyfin/TradingView/Bloomberg-style density, hierarchy, typography, motion), fix, re-shoot, re-review until PASS | 4, 7, 8 | pending | - | conductor/10-design | 0 | owner: cannot stress enough |
| 5 | Merge, full checks, browser check, push to main | 1-4, 7, 8 | pending | - | - | 0 | force_approval: push to main |

## Owner principles for item 4 (2026-10-24)
- Simplicity scales: few rules, no indicator stacking; every rule must earn its place in the tests or go.
- Thorough back-testing: much longer daily history (swing loads only 1,100 days today; aim for ~15 years, as
  position already has), costs included, walk-forward / out-of-sample, pooled random-entry test, parameter
  neighbourhood check (nearby settings must also work, not just one magic number), results split by period and side.
- KEEP helper/splash.py start screen as is: CADEN name + random intro art (owner loves it). Items 3/8 (installer,
  setup wizard) must reuse it, not replace it; a sale build may make the name configurable (TP_NAME already exists).

## Paused 18:33 UTC: account usage limit (resets 22:10 UTC)
- Interrupted: review of 2-ui, review of 1c-stats, review of 1c-invest, 1c-timeframes research (no draft saved; restart).
- All finished branches backed up to GitHub (conductor/*, plus conductor/ledger with this file and the audit).
- Resumed 18:4x UTC after owner bought credits: 3 reviewers + timeframes research restarted. Scheduled resume cancelled.
- Hourly history plan (owner asked, item 4): (1) ask Schwab for its maximum 30m history (no 180-day cap) and
  (2) keep every 30m bar permanently in cache.db so history grows each day; (3) optional free Alpaca source
  (owner creates a free Alpaca account; keys saved by the helper like the other keys; SIP bars since 2016, delayed
  15 min, used only for history, live bar stays Schwab). Hourly stays capped at grade B until it has >= 2 years.

## MANTRA (owner, 2026-10-24): SIMPLICITY SCALES
- Every agent brief from now on starts with it. Fewer rules, fewer indicators, fewer settings; remove before adding;
  a feature must earn its place in tests or go. Add it to the top of CLAUDE.md in the merge step (item 5).
- Item 4 note: Alpaca 1h bars start on the hour (9:00 bar holds 9:00-9:30 pre-market); 30m is clean but capped at 3y. Scanner must pick: 3y clean 30m->hourly, or 10y 1h with the first bar caveat; decide by disk size + test.
- conductor/integration f8e2045 = 1,1b,1c*,2,3,4a merged; all tests pass (145 vitest, 101 helper); Alpaca save-timing test bound relaxed to 0.2 s (C json encoder holds GIL).
- PUBLISHED v21 (7fc8a1e) to main at 19:36 UTC with owner's go: items 1,1b,1c,2,3,4a + mantra. Setups agent told to bump to 22 and rebase onto 7fc8a1e.

## SCOPE CUT 3:05 PM CT: owner has ~$35 credit left
- Finish: item 4 (lean), item 2b (fix blockers only), one light review of 4, merge, publish v22 (ask first).
- Deferred to backlog (written into docs, not done now): 7 (research everywhere), 8 (production fixes), 10 (design round 2), 9 loop. Optional: one read-only re-score if budget allows.
- integration now 4411b3c = v21 + 2b-tables + 8-prod; 164 vitest + helper tests pass.
- Release candidate v22: conductor/integration 80eb4d1 (v21 + tables + prod + setups + setups list filters). 165 vitest, 135+ helper tests, build, smoke OK. Waiting for owner's go.
