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
| Click / Enter | The full view: the security view (`openSecurity` from src/security/open.ts; the symbol window if it fails). Coins open their chart, yields the FRED window, funds the fund page. |
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

## 2b. "Go to": each row leads into the rest of the platform

Owner's feedback: he likes the chart on click and wants each row to lead on, "go to the financials or research page,
so it's more interactive with the site". Options weighed:

| Option | Verdict |
|---|---|
| A column of action icons on every row | Rejected: 8+ icons x 40 rows is the clutter the principles forbid, and it fights the one focal point. |
| Only a right-click menu | Rejected alone: invisible on touch and to people who don't know to right-click. |
| A few links in the popover only | Not enough: keyboard and touch users live in the expanded row. |
| **One list, shown three ways (chosen)** | The same ordered list (src/invest/goTo.ts) appears as up to 5 labelled icon buttons + "More" in the popover and the expanded row, and in full in the right-click / Menu-key / Shift+F10 / ⋯ menu. One mental model; nothing extra on the rows themselves. |

What the list holds, best first (the first five become buttons, the rest go under More). Security items open the
security view (`openSecurity(symbol, code)`, imported from src/security/open.ts); if that fails they fall back to the
page that already does that job:

| Kind | Buttons | More | Fallback if the security view fails |
|---|---|---|---|
| Stock | Overview (DES), Chart (GP, key C), Financials (FA, key F), News (CN, key N), Research (key R) | Holders (HDS), Options (OMON), Dividends (DVD), Chart page, Compare, Watchlist, Alert, Trade (ticket pre-fill), Ask AI, Journal (when that route exists) | DES and DVD = the symbol window; GP = Chart page; FA = Research > Financials; CN = Google News; HDS = Flow > Insiders; OMON = Flow > Options |
| ETF / fund | Overview, Chart, News, Dividends, Compare | Holders, Options, Chart page, Watchlist, Alert, Trade, Ask AI, Journal | as above |
| Index | Overview, Chart, News, Compare, Ask AI | Chart page, Watchlist, Alert | as above |
| Future | Chart, Futures page, Ask AI | | |
| Coin | Chart, Compare, Watchlist, Alert, Ask AI | | |
| Rate (FRED) | Full history, Yield curve, Auctions, Compare, Ask AI | Macro page | |
| Private fund | Fund detail, NAV history (chart window), SEC filings (EDGAR), Compare, Ask AI | Manager's stock, fund website | |

Schwab reports ETFs as "EQUITY"; its assetSubType (or the catalog's ETF groups) tells funds from stocks.
Shortcuts (F financials, N news, R research, C chart) work on a focused row and while its popover is open; each button
shows its Bloomberg code as a small hint and its key in the tooltip (`aria-keyshortcuts`). Watchlist and Alert reuse the
platform's own state and alert dialog; Ask AI prefills the assistant; nothing here trades.

## Review fixes (independent review)

- **One source of truth for the headline.** The popover's value and change use the row's live price (change = live
  price over the range's base close, as the board columns do), so row and popover always agree; the daily closes only
  draw the line.
- **52-week range.** Schwab's 52-week high/low from the quote when the row has them; otherwise the range of daily closes,
  labelled "52-week closing range". Positions read as words ("at the top of its 1-year range"), never a bare "100%".
- **ETF or stock.** Name matching (TRUST, FUND ...) misfiled stocks such as Northern Trust and Digital Realty Trust. The
  helper's invest.board now passes Schwab's `assetSubType` ('ETF', 'COE' ...); it ships with the next helper (no
  version bump: older helpers just don't send it) and until then the catalog's ETF groups (`CATALOG_ETFS`) decide.
- **What the ticker card gave, kept.** "You hold N sh · $X" (your own accounts) in the popover and expanded row when
  held, and Trade (order-ticket pre-fill only) under More.
- **Layout.** The expanded row is sized to the table's visible width (it was clipped at 390 px). Compare is now a
  collapsible sheet along the bottom of the content column, and the page keeps that height free at its end, so it no
  longer covers columns or blocks clicks.
- The popover is `role="dialog"` (it holds buttons); the Investments keys are in the ? shortcut sheet.

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

Playwright against `vite preview` and the fake helper (pretend Schwab, SEC, FRED), dark and light, 1440 and 390:

- Sweep: the largest section (Stocks, 39 rows) crossed down and back up (78 row crossings, 2 mouse steps each):
  **0 history requests**, worst frame 33 ms, median 16.7 ms, no frame over 34 ms. Resting on one row: 1 request,
  layout shift 0; coming back to it: 0 requests (cache).
- Popover, 1M-5Y switch, Esc, focus-follows (`aria-describedby` set), ← / → range, Space expands, one expanded row at
  a time, the expanded row stays under its row when sorted, Compare capped at 4 with a toast, click opens the full
  view, touch: first tap popover / second tap opens; no horizontal page scroll at 390.
- Go to: F and R from the popover / a focused row go to Research; right-click and Shift+F10 open the menu with focus
  inside, Esc returns focus to the row; rates, funds, coins and futures show their own lists.
- Fake data caveats: index history in the fake helper is scaled differently from its quote, so board %s for indexes are
  huge there (not in real data); its ETF names are placeholders, so sector ETFs show the stock list in the test (real
  Schwab descriptions say SPDR/ETF); Coinbase is unreachable from the test sandbox, so coin popovers show the error
  state.
