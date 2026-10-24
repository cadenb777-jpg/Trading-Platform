# Conductor: review, polish and simplify the platform (UI, speed, Setups + Williams COT/z-score)

| id | item | depends_on | status | session | branch | attempts | notes |
|----|------|-----------|--------|---------|--------|----------|-------|
| 1 | Research Larry Williams COT + flow of money, pairing with z-score -> docs/research/williams-cot.md | - | passed | - | conductor/1-williams | 3 | bc659e8; video section verified against owner transcript |
| 1b | Research professional trend-following and chart tactics with evidence -> docs/research/trend-and-charts.md | - | passed | - | conductor/1b-trend | 2 | 08441cc; 9 corrections applied (doc only); 77 URLs, abstracts only |
| 1c | Deep research pass (3 parallel researchers): time-frame/time-series econometrics; statistics of backtesting; investment analysis + short-term reversal + positioning breadth. Each >=20 primary sources, key claims cross-checked by 2 | - | running | - | conductor/1c-* | 0 | owner: be diligent, not one book; stats 890b9f7 (41 sources) reviewing; invest 23defe6 (58 sources) reviewing; timeframes running |
| 2 | UI polish of every page except Setups (design system, spacing, typography, tables, consistency) | - | reviewing | - | conductor/2-ui | 1 | dd1da98 style.css only; screenshots ui-before/ui-after |
| 3 | Code efficiency pass outside setups/scanner/strategies/lab (front end + other engine modules) | - | passed | - | conductor/3-perf | 1 | b27a26e f3694b9 76ff816; 10 fixes; scanner notes for item 4 (GIL stalls -> processes, atomic graveyard write, cache wipe); review PASS (randomized highest/lowest check, 145+74 tests) |
| 4 | Setups simplification: Williams COT + z-score core, fewer indicators, scanner speed, page in the new design | 1, 1b, 1c, 2 | pending | - | conductor/4-setups | 0 | helper protocol bump -> v21 |
| 6 | Production-readiness audit (read-only scorecard /100, code fixes vs owner decisions) | - | running | - | - | 0 | owner: friend's skill scored 40/100; target 100 |
| 7 | Apply research platform-wide (Backtest, Flow, Macro, Portfolios, Investments, Home: correct stats, horizons, sizing, labels) | 1, 1b, 1c, 2, 3 | pending | - | conductor/7-wide | 0 | owner: apply knowledge everywhere |
| 8 | Production fixes from audit to sale-ready standard (security, CI, installer/setup wizard, legal page templates, licenses, provider abstraction, a11y) | 6, 2, 3 | pending | - | conductor/8-prod | 0 | owner-decision items reported separately |
| 5 | Merge, full checks, browser check, push to main | 1-4, 7, 8 | pending | - | - | 0 | force_approval: push to main |

## Owner principles for item 4 (2026-10-24)
- Simplicity scales: few rules, no indicator stacking; every rule must earn its place in the tests or go.
- Thorough back-testing: much longer daily history (swing loads only 1,100 days today; aim for ~15 years, as
  position already has), costs included, walk-forward / out-of-sample, pooled random-entry test, parameter
  neighbourhood check (nearby settings must also work, not just one magic number), results split by period and side.
- KEEP helper/splash.py start screen as is: CADEN name + random intro art (owner loves it). Items 3/8 (installer,
  setup wizard) must reuse it, not replace it; a sale build may make the name configurable (TP_NAME already exists).
