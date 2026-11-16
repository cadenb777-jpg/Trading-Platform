# Revamp tracker (launch-quality overhaul)

Goal: launch-ready, on comparable terms with Bloomberg and Fincept Terminal, keeping the mantra (simplicity scales:
remove before adding) and the finance-ui skill (.claude/skills/finance-ui). Keep the Home ticker tape and the
"Good morning, <name>" greeting (polish allowed). Colours stay: amber labels, white figures, green/red only for
good/bad. One pull request per item group; every item is tested (vitest / helper unittest) and browser-checked at
1280 and 375 px in dark and light before it is ticked.

Resume rule: on "continue" or "go", read this file and do the first unticked item.

## Phase 1: audit (done 2026-11-16)

Measured on every page (20 routes x 2 widths, stand-in helper; scratchpad audit):
- No JavaScript errors on any page; scrolling 60 fps everywhere (worst frame 17 ms); no page-wide horizontal scroll.
- Layout jumps while loading (CLS, 0.1+ is poor): Macro 0.41 (desktop) / 0.23 (phone), Chart 0.15, Futures 0.09.
- Macro blocks the page for 273 ms while drawing; Setups 60 ms.
- Text under 11 px on most pages (up to 17 elements on Macro, 15 on Trade): too small for a launch.
- Density gap: pages use big cards with one number each and a lot of empty space (Research overview: 12 large
  boxes; Home index cards ~250 px tall each). Fincept/Bloomberg show 3-4x more information per screen with
  label-value lists, compact tables and multi-panel layouts.
- Empty states: "—" boxes with no explanation when data is missing (Research cards, Home indexes before data).

Feature gaps vs Bloomberg / Fincept (what they have that this platform lacks or shows weakly):
- Security tear sheet in one screen (Fincept Equity Research; Bloomberg DES/FA): today's trading, valuation, share
  stats, analyst targets, 52-week range, profitability, growth, chart with periods, company info.
- Rates & money-markets board (Bloomberg BTMM): Fed funds, bills, Treasuries bid/ask, swaps/SOFR, funding, FX,
  crude, gold and today's economic releases in one dense grid.
- Market monitor / heat maps (Bloomberg Launchpad, IMAP): sectors and watchlist as a colour grid.
- Peers and relative value (Fincept Peers, Bloomberg RV), sentiment tab, news per security.
- Relationship / supply-chain map (Fincept relationship map, Bloomberg SPLC) and trade-flow visual.
- Report builder and notes (Fincept), richer CRM for prospects (Twenty-style pipeline board).
- Command bar with function codes exists (BRF, GP, ...); add more codes and "<code> <ticker>" jumps.

## Phase 2: foundation (shared design system)

- [ ] 1. Terminal density layer: compact type scale (12-13 px body, 11 px minimum), tabular mono numerals for
      figures, panel header style (small uppercase amber, thin rule), `kv` label-value list component, compact
      table style, tighter grid gaps; a Comfortable / Compact density switch (default Compact). Fix all text < 11 px.
- [ ] 2. Page header: smaller title row (title + one-line purpose + actions on one line), freeing ~120 px per page.
- [ ] 3. Empty and loading states: skeletons sized like the final content (fixes the layout jumps), and every "—"
      explains why (needs the helper, no data for this company, market closed...).
- [ ] 4. Chart component review: one shared mini-chart (sparkline/area/candles) with fixed height, no layout shift.

## Phase 3: pages (one PR each)

- [ ] 5. Home: keep greeting + ticker tape (typography polish only); compact index strip with sparklines instead of
      three tall cards; market monitor heat map (sectors, watchlist); denser Edge today, accounts, setups, news.
- [ ] 6. Research: Fincept-style tear sheet (left: trading, valuation, share stats; centre: chart with
      1M/3M/6M/1Y/5Y; right: analyst targets, 52-week range, profitability, growth; bottom: overview, info) with
      tabs Overview / Financials / Valuation / Peers / Filings / News; AI read of the company on top.
- [ ] 7. Macro: fix layout shift and the 273 ms block; BTMM-style rates & money-markets board as the hero;
      Fed odds and liquidity kept; compact series grid.
- [ ] 8. Investments: compact boards (tables with sparklines), heat-map view, fund cards to kv lists.
- [ ] 9. Flow: dense options/dark-pool panels, live flow tape.
- [ ] 10. Futures: fix layout shift; curve and COT panels compact.
- [ ] 11. Calendar: Bloomberg ECO-style table (time, event, period, survey, actual, prior, surprise colour).
- [ ] 12. Chart: fix layout shift; GP-style header (range, period, upper/lower studies) compacted.
- [ ] 13. Setups and Backtest: compact cards to table + detail pane.
- [ ] 14. Account, Portfolios, Trade, Journal: kv lists, compact tables, consistent panels.
- [ ] 15. Prospects (advisers + companies): CRM pipeline board (not contacted / contacted / meeting / client),
      relationship map, notes; company tear sheet.
- [ ] 16. Clients and reports.
- [ ] 17. Strategy Lab and Scripts.

## Phase 4: AI everywhere

- [ ] 18. AI actions per page: filter/sort lists, open a security's tab, save a search, build a watchlist,
      build a screen; every action with Undo; never trading.
- [ ] 19. Page suggestions refreshed for the new layouts.

## Phase 5: launch checks

- [ ] 20. Full re-audit (same measurements): no errors, CLS < 0.1 everywhere, no long tasks > 100 ms, no text
      < 11 px, both themes, phone width; accessibility pass (contrast, focus, labels).
- [ ] 21. Docs: CLAUDE.md, README, ROADMAP status.

Next: item 1 (terminal density layer).
