# Revamp tracker (launch-quality overhaul)

Look: Fincept Terminal (black, monospace, uppercase amber headings, hairline panels, underlined tabs); Bloomberg
only as the feature checklist (owner, 2026-11-16). Keep the platform's own signature with it: orange/amber accents and
the blue glow (greeting banner, background, panel hover). Use Fincept's code (github.com/Fincept-Corporation/
FinceptTerminal, AGPL, see docs/research/fincept-plan.md) wherever it does a page better; keep its notices.

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

## Phase 1b: information architecture (owner, 2026-11-16: "too many tabs; think of it like a website")

Today there are four navigation layers: the rail (17 pages), a top row repeating the section's pages, a numbered
function bar on each page and the page's own tabs. New shape: two layers only (rail = where, top row = which view),
everything two clicks away, and a ticker typed anywhere opens one Security page.

| Rail | Views (top row) | Replaces |
|---|---|---|
| Today | one page: greeting, ticker tape, market mood gauge, heat map, movers, today's calendar, news, setups, alerts | Home (+ calendar/macro teasers) |
| Markets | Overview · Macro & rates · Calendar · Futures · Crypto | Investments, Macro, Calendar, Futures |
| Security (any ticker) | Overview (tear sheet) · Chart · Financials · Valuation · Flow · Filings · News | Research, Chart, Flow (per stock), Security view |
| Ideas | Setups · Backtest · Strategy Lab · Workspace & scripts | Setups, Backtest, Strategy Lab, Chart modes |
| My money | Account · Portfolios · Trade · Journal | same |
| Business | Prospects · Clients | same |

- The numbered function bar goes (its actions move into each view's header; codes stay in the command bar).
- Command bar is the front door: a ticker opens Security, a code or page name opens that view.
- Old links redirect (src/routes.ts REDIRECTS), so bookmarks keep working.
- Attention order on every view: one hero picture top-left, the key numbers beside it, detail below, AI read in
  the header.

- [x] 1b-1. Navigation: left rail = six destinations only (Today, Markets, Security, Ideas, Money, Business) + AI;
      top row = that destination's views (hidden when there is one); the numbered function row is one "Actions" header
      menu (keys 1-9 still work); the rail's lower half is a live Market pulse + watchlist (src/ui/railPulse.ts);
      phone bottom bar = destinations + AI. Old routes still work (same routes, regrouped).
- [x] 1b-1b. AI summaries write themselves when a page with data shows (src/ai/insight.ts: once per page + symbol,
      the same read reused for 30 minutes, only with an AI key; the button writes a fresh one; closing keeps it closed).
- [x] 1b-2. Security hub: Research, Chart and Flow already share one ticker (blue link group); the top row now shows
      that ticker with its live price (click to change it). Merging the three into one page is not needed.
- [x] 1b-2b. Section accents: one quiet colour per destination (sky, teal, violet, gold, cobalt, rose) on its icon,
      the active menu item, panel edges and hover glow; amber stays the brand for headings.
- [ ] 1b-3. Markets hub: Overview (boards + heat map) / Macro & rates / Calendar / Futures / Crypto.
- [~] 1b-4. Today: Market mood widget added under the greeting (VIX fear gauge + 11-sector heat map, live, plain-word
      lines; tiles open the sector). Still to do: compact index strip instead of three tall cards, movers.

## Phase 2: foundation (shared design system)

- [x] 1. Terminal look layer (end of src/style.css): near-black tokens, JetBrains Mono everywhere, uppercase amber
      panel headings with a rule, underlined tabs, compact stat tiles with hairlines, dense tables, square controls,
      `.kv` label-value list; nothing under 11 px (was up to 99 elements). No density switch (mantra: fewer settings).
- [ ] 2. Page header: title row now compact (done in 1); still to do: put purpose + actions on the title line on wide
      screens and move the function bar into it.
- [ ] 3. Empty and loading states: skeletons sized like the final content (fixes the layout jumps), and every "—"
      explains why (needs the helper, no data for this company, market closed...).
- [ ] 4. Chart component review: one shared mini-chart (sparkline/area/candles) with fixed height, no layout shift.

- [x] 4b. Visual building blocks (src/ui/viz.ts): speed gauge, progress ring, range track, flower (flows from one
      centre), heat grid; each with a plain-words caption. Owner: pictures first, text boxes of good information around
      them, little descriptors everywhere (rule-made words cost nothing; AI summary one click away).

- [x] QA click-through (owner: "click through everything, no overlaps"): every page and every visible tab at 1280 and
      375 px, Actions menus, command bar, adding and removing a chart indicator; checks overlapping boxes, clipped text,
      slow clicks and console errors. Result 2026-11-16: 0 problems, 0 errors. Fixed on the way: one Escape now closes
      the command bar; only a panel's first heading spans the panel (later ones overlapped the content above).

## Phase 3: pages (one PR each)

- [ ] 5. Home: keep greeting + ticker tape (typography polish only); compact index strip with sparklines instead of
      three tall cards; market monitor heat map (sectors, watchlist); denser Edge today, accounts, setups, news.
- [~] 6. Research: revenue by product and region as a flower beside the rows (done). Done earlier: company description on open (Wikipedia via SEC CIK, helper 81), tear sheet with
      valuation / share stats lists, 52-week range track, F-score gauge, margin rings, growth / returns / balance lists,
      plain-words lines. Still to do: chart with periods in the centre, analyst targets, peers and segments as a flower.
      Original plan: Fincept-style tear sheet (left: trading, valuation, share stats; centre: chart with
      1M/3M/6M/1Y/5Y; right: analyst targets, 52-week range, profitability, growth; bottom: overview, info) with
      tabs Overview / Financials / Valuation / Peers / Filings / News; AI read of the company on top.
- [~] 7. Macro: Rates & markets board added under Today's read (four rows: Rates, Credit & inflation, Markets, Jobs
      & growth; value, 1-month change, 1-year sparkline, rank since 2006; tiles open the history). Original plan: fix layout shift and the 273 ms block; BTMM-style rates & money-markets board as the hero;
      Fed odds and liquidity kept; compact series grid.
- [ ] 8. Investments: compact boards (tables with sparklines), heat-map view, fund cards to kv lists.
- [~] 9. Flow: options walls (call wall / put wall with a track and plain words, marked on the open-interest ladder).
      Original plan: dense options/dark-pool panels, live flow tape.
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

Next: finish 1b-4 (compact index strip, movers), then 6 (Research chart + segments flower), then 7 (Macro).
