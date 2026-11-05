# How Bloomberg is organised, and what this platform maps to

**Security first.** You load one security (`AAPL US <Equity>`; the yellow key names the asset class) and it stays
"loaded" until you load another. Every function you then type (`DES`, `GP`, `FA`...) acts on it, so one load drives
every panel. Monitors (`WEI` world indices, `WB` world bonds, `ECO` calendar, `FXIP` FX) and the portfolio (`PORT`)
have no security. The Launchpad (`BLP`) is a grid of small windows; windows in the same colour link group follow the
same security. Navigation: type a mnemonic on the command line (ticker then function), `<MENU>`/Back returns to the
previous screen, the History key lists recent commands, and each function screen links to related functions.

| Bloomberg | What it is | Here | Data |
|---|---|---|---|
| DES | description, key stats | Security view **DES** tab | `research.company` (SEC XBRL), `invest.board` (quote, 52w, P/E, yield) |
| GP / GIP | price graph (daily / intraday) | **GP** tab: full chart, timeframes, indicators, compare | `history` (Schwab), chart engine |
| FA | financial analysis | **FA** tab: income, balance, cash flow, margins, growth | `research.company` annual/quarterly |
| HDS | holders | **HDS** tab: 13F holder counts (opened/added/reduced/sold), insider buys and sells | `prospect.holders_by_symbol` (needs the Prospecting 13F download), `research.insider_history` (Form 4) |
| CN | company news | **CN** tab | `news` (Google News + CNBC RSS) |
| OMON / OMST | options monitor / most active | **OMON** tab: put/call, max pain, ATM IV, unusual contracts | `flow.options` |
| DVD | dividends | **DVD** tab: yield, history, growth, total return | `dividends.history`, `research.company.totalReturn` |
| BETA, HP | beta; historical prices | **BETA** tab: beta vs SPY, vol, drawdown, Sharpe/Sortino, correlation to my holdings | computed in the browser (`src/security/stats.ts`) from daily `history` |
| RV | relative value vs peers | Related row: Nasdaq-100 sector peers, sector ETF, COT future | `src/security/related.ts` (fixed list) |
| (none) | trading signals | **SETUPS** tab | `scanner.results` |
| PORT | portfolio | Account / Portfolios pages | store `portfolios` |
| WEI / WB / ECO / FXIP | monitors | Home / Invest > Bonds / Calendar / (none) | existing pages |
| Launchpad + link groups | linked windows | Chart > Workspace + coloured link chips (the security view joins them) | `src/ui/linkGroups.ts` |
| History / Back | recent loads | Back/Forward buttons, Alt+←/→, recent list | `src/security/codes.ts` |

**Missing, could be added free later:** a business description (only in the 10-K text; we link the 10-K), an
earnings calendar date (only the last filing date and what the scanner knows), a historical price table (HP),
individual 13F holder names per stock (the 13F download has them; the helper only returns counts today).

**Not possible for free:** analyst ratings and price targets (`ANR`), consensus estimates and surprises (`EE`, `ERN`),
real-time Level 2 and the full option chain history (`OMST` history), credit ratings, supply chain (`SPLC`), and
Bloomberg's own sector classification (BICS). The view says "—" with the reason instead of inventing them.

Sources: [Columbia Bloomberg guide: basic commands](https://guides.library.columbia.edu/bloomberg/basic),
[University of Delaware functions list](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list),
[CFI functions list](https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/),
[UConn: key functions and navigation](https://smf.business.uconn.edu/wp-content/uploads/sites/818/2015/03/Getting-Started-on-Bloomberg-Key-Functions-and-Navigation-1.pdf),
[Bloomberg Terminal (Wikipedia: Launchpad, keyboard)](https://en.wikipedia.org/wiki/Bloomberg_Terminal).
