# Bloomberg parity map (owner's spec, 2026-11-18)

Source: the owner's "Bloomberg Terminal — Full Feature & Function Spec" (professional.bloomberg.com product pages,
university Getting Started guides and cheat sheets). The goal is Bloomberg's **organisation** (a function code per
screen, the same frame on every screen, dense titled tables tiled on one screen, numbered rows, a header that opens
the full function) in this platform's own look (its amber headings, blue glow, Inter, section accents). Not copied:
Bloomberg's name, logo, amber-on-black brand palette or screen wording (spec 6.0).

Out of scope (owner): ESG and climate, compliance (Vault, surveillance), IB chat / MSG, Bloomberg TV, education,
enterprise trading (EMSX, TSOX, FXGO: execution stays the Webull ticket with preview + confirm).

Status: **have** = exists and matches the layout; **upgrade** = data exists, the screen needs the spec's layout;
**new** = to build; **no free data** = shown honestly as unavailable (never invented).

## Frame and navigation (spec 1.1, 1.3, 7.0, 7.22, 7.23)

| Bloomberg | What it is | Here today | Gap | Phase |
|---|---|---|---|---|
| Command line, `TICKER <KEY> FN <GO>` | type a mnemonic | Command bar parses "AAPL US Equity DES", "GP AAPL" | have | — |
| Autocomplete grouped (functions, securities, news, people) | discoverability | Command results grouped (recent, codes, tickers) | have | — |
| Loaded security + function applies to it | one load drives panels | Security view + link groups | have | — |
| Numbered items: type `5 <GO>` | keyboard drill | none | **new**: numbered rows in function tiles, digits + Enter opens one | B1 |
| Header "Price Chart \| GP »" | mini-panel opens full function | panels have plain titles | **new**: tile header with code link | B1 |
| Footer: source, timestamp, page | trust line | status bar (global) | **new**: per-tile source · as-of | B1 |
| MENU (numbered 2-3 column directory by asset class) | discovery | Launchpad grid (by section) | **upgrade**: numbered, grouped by asset class, mnemonic + title | B4 |
| LAST (recent screens) | history | recent list in command bar, Back/Forward | have | — |
| Launchpad (tiled windows, saved views) | workspace | Chart Workspace (linked charts) | **upgrade**: tiles of any function (monitor, chart, news, calendar), saved views | B4 |
| ALRT | alerts | Alerts (price, sound, Telegram) | have | — |
| Export on every screen | CSV/Excel | tables have Copy/CSV (tableTools) | have (extend to new tiles) | B1+ |

## Market overview (spec 3.2, 7.5, 7.20)

| Bloomberg | Here today | Gap | Free source | Phase |
|---|---|---|---|---|
| WEI world equity indices by region | Home index cards (US only) | **new**: Americas / EMEA / Asia-Pacific grid | Schwab quotes: US indexes + country ETFs (EWJ, EWU, EWG, FXI...) labelled "via ETF" | B1 |
| IMAP heat map / sector monitor (sunburst in owner's image) | Home sector heat grid (11 SPDR ETFs) | **new**: sector → stock sunburst, coloured by % change | Schwab quotes, Nasdaq-100 + scanner `SECTORS` (equal weight, said so) | B1 |
| MOST / MOV / GMM movers | Investments movers board | **upgrade**: movers tiles in the monitor | `invest.movers` (Schwab) | B1 |
| BTMM rates & money markets | Macro Rates & markets board | have (monitor links to it) | FRED, NY Fed | — |
| WIRP rate probabilities | Macro Fed odds | **upgrade**: meeting table + implied-path bars | `macro.fedodds` | B3 |
| WB world bonds | Bonds (US curve, credit) | partial; world 10y yields | FRED (IRLTLT01 series for 10y by country, monthly) | B3 |
| FXC / WCRS currencies | none as a monitor | **new**: FX tile | Schwab/ETFs (UUP, FXE, FXY, FXB) now; ECB reference rates (free, daily) later | B1 |
| GLCO / CMDTY commodities | Futures page | **new**: commodities tile in the monitor | Schwab futures quotes / ETFs (GLD, USO, UNG, DBA, CPER) | B1 |
| World clocks + market open/closed | market clock (NY only) | **new**: NY, London, Hong Kong, Tokyo | computed (exchange hours) | B1 |

## Single security (spec 3.3, 7.1-7.4, 7.8, 7.9, 7.16, 7.17)

| Bloomberg | Here today | Gap | Free source | Phase |
|---|---|---|---|---|
| DES | Security Overview: tear sheet, description (Wikipedia), kv lists, range, rings | have; add "Title \| CODE »" tile headers | SEC XBRL, Schwab, Wikidata | B2 |
| GP / GIP / G | full chart | have | Schwab, Alpaca | — |
| HP historical prices | none (HP aliased to Risk) | **new**: 3-block date/close/volume table, daily/weekly/monthly, high/avg/low with dates, CSV | Schwab `history` | B2 |
| FA | Financials tab, as-reported | **upgrade**: line items × periods grid, LTM, per-row chart icon, bar-chart mode | SEC XBRL companyfacts | B3 |
| EE / ERN / SURP earnings estimates & surprises | none | **new** where the free key allows: last 4 quarters actual vs estimate, next date | Finnhub free key (`finnhub.earnings`); without a key: "add a free Finnhub key" | B2 |
| ANR analyst recommendations | none | **new**: consensus box, buy/hold/sell bars over time | Finnhub free `recommendation` (counts by month; no broker names or targets free) | B2 |
| RV / EQRV comps | `quant.comps` used in Research | **upgrade**: subject row first, peer mean/median rows, scatter (growth vs multiple) | SEC XBRL + Schwab | B2 |
| HDS holders | 13F counts + insiders | have; named holders later | SEC 13F, Form 4 | — |
| GPTR / INS insiders | Flow insiders | have | SEC Form 4 | — |
| DVD | Dividends tab | have | Yahoo | — |
| CN | News tab | have | Google News, CNBC RSS | — |
| CF filings | Filings links | have | SEC EDGAR | — |
| OMON | Options tab (summary, walls, ladder) | **upgrade**: mirrored chain calls \| strike \| puts, ITM shading, expiry bars | `flow.options` (Schwab chain) | B3 |
| SPLC supply chain | customer concentration (10-K) | partial: customers only | SEC 10-K text | later |
| CRPR ratings, BI research, CAST | — | no free data | — | — |

## Fixed income, FX, economics, news (spec 3.6-3.10, 7.7, 7.13, 7.6)

| Bloomberg | Here today | Gap | Free source | Phase |
|---|---|---|---|---|
| GC curves | Bonds curve | **upgrade**: curve-on-dates multi-line + tenor table with bp change | Treasury / FRED | B3 |
| YAS bond calculator | bond maths (`src/invest/bonds.ts`), CUSIP lookup | **upgrade**: calculator layout (inputs left, spreads middle, risk right) | maths in browser | B3 |
| ECO calendar | Calendar (week strip, surprise bars) | **upgrade**: table columns time · country · event · period · survey · actual · prior, beat/miss colour | Forex Factory + FRED actuals | B3 |
| FED / FOMC | FOMC dates, Fed odds | have | — | — |
| TOP / N news river | Home news, News | **upgrade**: numbered, sectioned river in the monitor | Google News, CNBC RSS | B1 |

## Screening and portfolio (spec 3.4, 3.11, 7.10, 7.18)

| Bloomberg | Here today | Gap | Free source | Phase |
|---|---|---|---|---|
| EQS screener | Investments search, Setups scanner | **new**: universe + criteria rows (field, operator, value, running count) → results grid | Nasdaq-100 / S&P quotes + SEC XBRL fundamentals cached by the helper | B4 |
| PORT | Account (hero, holdings, risk, dividends, tax) + Portfolios (analyse, optimise, factors) | **upgrade**: KPI strip + grouped holdings + donut/attribution layout | existing engine | B4 |

## Build order

B1 frame + Markets Monitor · B2 security functions (HP, ANR, EE, RV) · B3 template upgrades (FA, OMON, ECO, GC,
WIRP, YAS) · B4 EQS, MENU, Launchpad views, PORT layout. Each batch: tests, browser check at 1280 and 375 in both
themes, the click-through QA, one pull request.
