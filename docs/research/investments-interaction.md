# Investments page: making it explorable

Owner's ask: "make the investments screen more interactable, with the ability to look at a mini sub-chart; be
methodical." Checked against the design principles in docs/design.md (purposeful, one focal point, motion only where
it explains, remove before adding). Free data only; no helper change.

## 1. Audit (before)

Screenshots of every section in both themes at 1440 and 390 were taken before any change (owner's scratchpad, not in
the repo). What each section answers, and the static numbers a user naturally wants to open up:

| Section | The one question it answers | Static numbers people want to explore |
|---|---|---|
| All markets | How is each kind of investment doing? | Each benchmark's 1M / YTD / 1Y %: only end points, no path |
| Stocks | Which indexes and sectors lead or lag; who moved most today? | Board %s; the 3-month sparkline (no axis, no values, fixed range); movers' % (no context) |
| ETFs | How are core, international, theme and income funds doing? | Same board columns; 52-week position only inside the click-through window |
| Bonds | What are rates and credit saying? | Yield and spread tiles (value, bp change, a sparkline with no range); bond ETF board |
| Alternatives | How are listed stand-ins for private markets doing; what is each evergreen fund worth? | Board %s; fund cards show names only, the NAV trend needs a click into the fund page |
| Fund detail | What does this fund hold and what is its NAV doing? | Already has its NAV line; the manager's stock is a single line of numbers |
| Crypto | Where are coins and crypto stocks trading? | Live coin price and 24-hour %, nothing about the trend |
| Commodities | How are metals, energy and farm goods moving? | Board %s; futures rows have no history at all (Schwab has none) |

Problems found:

- A missing value was a bare "—" with no reason (board % cells, 1Y total), and a rate tile with no month-ago reading
  printed an empty change (" 1m").
- Two hover systems on one row: the small ticker under each name opened the global ticker card after 300 ms, while
  the row itself did nothing on hover.
- Every exploration meant a click into a modal with one fixed 13-month line. No way to see 5 years, to see two things
  side by side, or to look without leaving the list.
- Movers, crypto coins, rate tiles and fund cards each behaved differently (some open a chart, some a window, some a
  page).
- Sorting and per-column filters already existed on every board (tableTools); they were kept, not rebuilt.

## 2. One interaction model

Every row and tile on the page now behaves the same way (src/invest/rowInteract.ts):

| Gesture | Result |
|---|---|
| Hover or keyboard focus, ~150 ms | Mini chart popover anchored to the row: range switch (1M/3M/YTD/1Y/5Y), change over the range, 52-week range bar, source and as-of date. One at a time; flips above near the bottom edge; Esc closes it. |
| Click / Enter | The full view: security view when the build has one (src/security/open.ts, found at build time with `import.meta.glob`), else the existing symbol window. Coins open their chart, yields the FRED window, funds the fund page. |
| Space or the chevron | The row expands in place: larger chart with a hover readout, range high/low, key facts, "Open full view" and "Add to compare". One expanded row at a time; it stays attached to its row when the board is sorted or refreshed. |
| Shift+click / Shift+Enter | Adds to Compare (up to 4): an overlaid % chart in a side panel (bottom sheet on phones). Prices compare with prices, yields with yields (in bp). |
| ↑ / ↓, ← / → | Move between rows across boards; change the range. |
| Touch | First tap shows the popover, second tap opens the full view. |

The range starts on the board's sorted period column (1 month, YTD, 1 year), else 3 months (the sparkline's range);
changing it in a popover sets it for that board.

Data, all already in use elsewhere: invest.history (about 13 months of daily closes, for 1M-1Y), the chart history
request (5 years of daily closes, only when 5Y is picked), FRED through macro.series (yields and spreads), Coinbase
daily candles (coins) and the alts.fund NAV line (navHistory, else XBRL NAV per share).

What was removed: the ticker card on board rows (the popover replaces it there), the fund cards' own hover prefetch
(the popover's request is the same alts.fund reply, so resting on a card still preloads the fund page) and the tile
tooltip "Click for the full history".

## 3. Numbers

Tabular numerals everywhere in the popover, expanded row and compare panel; signed changes (+/−, bp for yields); a
missing value is "—" with its reason (hover title and screen-reader text), and the chart says why when there is no
line ("Schwab has no daily history for futures", "the SEC has no machine-readable NAV history for this fund").
Points that are not finite are dropped before any maths (`cleanPoints`), so nothing prints NaN.

## 4. Accessibility

Rows are focusable; the popover is `role="tooltip"` and the row points at it with `aria-describedby` while it is
open (it carries a screen-reader hint for Space, Shift+Enter and the arrows). The chevron has `aria-expanded` and
`aria-controls`. The compare panel is a labelled region with a polite live line for adds and removes. All motion
(≤ 180 ms fade/rise) is off under reduced motion.

## 5. Performance

- Intent delay (150 ms) before anything is drawn or fetched; leaving a row before the reply arrives aborts that
  request unless the expanded row or Compare still needs it.
- One cache per series (src/invest/miniMath.ts `createSeriesCache`): shared in-flight requests, LRU of 120, failures
  not kept. One 13-month reply serves 1M to 1Y; once a 5-year line is loaded it serves every range.
- The popover is one fixed element reused for every row and the charts are small SVGs, so opening it causes no layout
  shift. Measured with Playwright on the overview (results below).
- Tests: src/invest/miniMath.test.ts (range starts matching the helper's columns, YTD base, partial history, change
  in % and bp, 52-week range, rebasing, intent timer, cache sharing / abort / eviction).

## Results

RESULTS_PLACEHOLDER
