# Structure: every number has one home

The owner approved this restructure (design review section 1, findings O2, O3, O5 and O7; the organisation section
of docs/research/pro-comparison.md). The goal is a platform that feels deep, not wide. There are fewer rail items
and each figure has one page it belongs to. Other pages show a short line that links to that page.

## Rail (before → after)

| Group | Before (16 pages) | After (14 pages) |
|---|---|---|
| Markets | Home, Invest, Futures, Macro, Calendar | same |
| Analyse | Chart, **Multi**, Setups, Research, Flow, Backtest, **Scripts** | Chart (modes Chart, Multi, Scripts), Setups, Research, Flow, Backtest |
| My money | Account, Portfolios, Trade, Clients | same, with each page's job made clear (below) |

The bottom of the rail is unchanged: AI, Alerts, Data, Settings.

## Routes and redirects (src/routes.ts, tested in src/routes.test.ts)

| Old hash | Now | Why |
|---|---|---|
| `#multi` | `#chart/multi` | Multi-chart is a mode of Chart |
| `#scripts` | `#chart/scripts` | The script editor is a mode of Chart |
| `#portfolio/webull`, `#webull` | `#trade` | The Portfolios > Webull view was removed: ordering info is on Trade, totals are on Account |
| `#flow/cot`, `#cot` | `#futures/cot` | The full COT table lives on Futures |
| `#portfolios`, `#accounts` | `#portfolio`, `#account` | Short names someone might type |

Every other hash is unchanged. An unknown hash still shows Home and the address is left as it is. A redirect
replaces the address (`history.replaceState`), so Back doesn't bounce. Code that used to call
`openPortfolio('webull')` now goes to Trade.

## Inventory: each number, where it was shown, and its home now

### Money figures

| Number | Shown before | Home now | Elsewhere (link or short line) |
|---|---|---|---|
| Total value of all accounts | Account ("Total value") | **Account**: "Total value (all accounts)", or "<account> value" when one account is picked in the switcher | Trade: "All accounts & totals → Account" |
| Today's change, all accounts | Account ("Today") | **Account**: "Today (all accounts)" | none |
| Price gain, dividends received, total return, yield, yield on cost, yearly income | Account (overview, cards, holdings table, holding detail) | **Account** | none |
| Value, today, gain and cash for one account | Account cards; Portfolios > Webull ("Account value") | **Account** cards | Trade shows the ordering figures for the selected account only |
| Webull value, cash and buying power for an account that isn't synced | Account Webull cards ("Account value"); Portfolios > Webull | **Account** Webull cards: "Value (as Webull reports it)", with a note that it isn't in the totals | "Order in Trade" button |
| Buying power (stock account) | Trade, Account cards, Portfolios > Webull | **Trade**: "Buying power", for the selected account | Account cards still show it per account (read-only) |
| Selected account's value for ordering | Trade ("Account value") | **Trade**: "<Roth IRA ••1234> value (for ordering)" | none |
| Today's change, selected account | Trade ("Today") | **Trade**: "Today (this account)" | none |
| Orders today and limits | Trade; Portfolios > Webull ("Limits") | **Trade**: "Orders today x / max", with max order value in the tooltip | none |
| Positions, open orders (with Cancel), recent fills | Trade; Portfolios > Webull | **Trade** (one account) | Account holdings table (all accounts, read-only) |
| Futures account: net liquidation, open P/L, margin, contracts today | Trade (Futures switch); Account futures card | **Trade**: "<account> net liquidation" | Account futures card (read-only) and its "Open Trade page" link |
| Risk (VaR, beta, drawdown, sectors), taxes, allocation, holdings news | Account | **Account** | none |
| Dividend calendar for my accounts | Account | **Account** | none |
| Model or what-if: CAGR, volatility, Sharpe, drawdown, stress tests, Monte Carlo, optimised weights, dividends | Portfolios | **Portfolios** | Account cards: "Analyse in Portfolios" opens an account here as a what-if |
| Backtest equity, Monte Carlo fan | Backtest ("Account value by trade number") | **Backtest**: renamed "Backtest account value by trade number", so it can't be mistaken for real money | none |
| Client AUM, fees, report figures | Clients & Reports | **Clients** | none |

### Positioning (COT)

| Number | Shown before | Home now | Elsewhere |
|---|---|---|---|
| COT table for every board market (commercials, large and small specs, indexes, reading) | Futures | **Futures** (Positioning section, `#futures/cot`) | none |
| Any CFTC market's net-position history (the list from `flow.cot_markets`) | Flow > Futures positioning (COT) tab | **Futures**: new "COT: any market or stock" panel, with its own AI summary | none |
| A stock's related futures market: COT index and net positions | Flow > COT tab; Flow > Stock positioning (stat card and a 2-year chart) | **Futures**: the same panel, by typing the stock | **Flow** (Stock positioning), **Research** (Overview) and **Home**: one line, "COT Nasdaq-100 futures: hedgers 72 / 100, speculators 31 / 100 · CFTC date", with "See all on Futures →" |
| Nasdaq-100 commercials index | Setups regime line | Setups keeps it, because it feeds the grades | "See all on Futures →" link |

### Chart tools

| Feature | Before | Now |
|---|---|---|
| Chart with indicators, drawings, alerts, backtest button | `#chart` | Chart mode (`#chart`) |
| Multi-chart (2 side by side, 2 stacked, 4 grid) | `#multi` page | Multi mode (`#chart/multi`); the tabs sit in its toolbar |
| Script editor (Pine subset, examples, reference, Add to chart) | `#scripts` page | Scripts mode (`#chart/scripts`); "Write your own indicator" in the Indicators window goes there |

### My money pages: each page's job

- **Account = real money only.** Every account (imported statements, synced Webull accounts, portfolios ticked
  "This is my account"), shown combined or one at a time with the switcher. **Import statement** and **Sync Webull**
  moved here, into the page header. Account cards now have "Order in Trade" (Webull accounts) and "Analyse in
  Portfolios".
- **Trade = one account's ordering info.** The selected account's value (for ordering), buying power, today, orders
  today, plus positions, orders, fills and the ticket. It links to Account for totals. `open(accountId)` picks the
  account (used by the Account cards).
- **Portfolios = models and what-ifs.** The saved list shows models and client portfolios only. Real accounts left
  the list, with a line saying how many there are and a link to Account. When an account is opened from Account, a
  note says it is a real account and offers **Save as a what-if copy**. The "This is my account (real money)" tick box
  stays, so a hand-typed account can become real money. The Webull button and the Import statement button left
  (Import now lives on Account). The optimizer, Dividends, templates and alternatives are unchanged.
- **Clients & Reports**: unchanged.

## Feature checklist (nothing lost)

| Feature that moved | Where it is now |
|---|---|
| Portfolios > Webull: balances | Trade header (selected account); Account Webull cards (all accounts) |
| Portfolios > Webull: positions | Trade > Positions |
| Portfolios > Webull: open and recent orders with Cancel | Trade > Open orders and Recent fills (Cancel on open orders) |
| Portfolios > Webull: Sync this account | Account card "Sync" and Account Webull card "Sync now" |
| Portfolios > Webull: Sync all accounts | Account header "Sync Webull"; the command bar's "Sync accounts" action |
| Portfolios > Webull: Test/Live banner and limits | Trade (environment badge, LIVE warning, orders today with limits) |
| Portfolios > Webull: account picker | Trade account picker; Account switcher |
| Portfolios: Import statement | Account header (and the empty state) |
| Portfolios: "Mine" badge and real accounts in the list | Account; Portfolios shows a count and a link |
| Flow: COT tab (any market) | Futures "COT: any market or stock" |
| Flow: COT for the stock's market | Futures panel (type the stock); Flow keeps the one-line summary |
| Flow: COT AI read (topic `cot`) | The AI summary button in the Futures COT panel |
| Command bar `OMON` with the old cot tab | Opens Futures with the stock |
| Multi page | Chart > Multi |
| Scripts page | Chart > Scripts |

## Command bar and shortcuts

- New codes: `MULTI` (Chart > Multi), `SCRIPT` and `PINE` (Chart > Scripts), `COT` (Futures positioning).
- Clearer labels: `PORT` is "Portfolios (models, what-ifs, optimizer)"; `ACCT` is "Account (my real money, all
  accounts)".
- The Pages group lists Multi-chart and Scripts as Chart modes.
- The Accounts group has "All accounts (total value)", which goes to Account; "Webull ordering account", which goes
  to Trade; and each real account, which opens Account on that account (`ac:` ids). Models are listed under
  Portfolios.
- New shortcut: `g m` goes to Multi-chart. The existing `g` shortcuts are unchanged.

## Workspace and linked panels (later item)

Multi mode became **Workspace** (still `#chart/multi`, code `MULTI` or `WS`, `g m`): up to six panels (chart, quote,
news, research facts, my position) in 1, 2, 4, 1+2 or 6 layouts, with ready-made and saved layouts. Every panel that
shows one symbol has a colour link chip (src/ui/linkGroups.ts); panels of the same colour follow each other across
pages. Ctrl/Cmd+[ ] or F6 move between panels, Alt+1-6 jumps, typing a ticker on a panel opens the command bar for its
group.

## Deliberately not moved

- **Treasury yields** stay on both Macro and Invest > Bonds. This was design review finding O6, and they are
  different views. It isn't part of this item.
- **The Setups COT reading** stays on Setups, because it is an input to the grades. It now links to Futures.
- **One watchlist everywhere** (finding O4) is a separate item.
- **Helper**: no change. AI `open_page` values `multi` and `scripts` still work through the redirects, so
  HELPER_VERSION stays at 34.
