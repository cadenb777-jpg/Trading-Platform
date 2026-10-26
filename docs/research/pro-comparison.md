# How the platform compares with professional systems

*Written 26 October 2026. Research only, no code changed. It covers the current `claude/schwab-market-data` branch and
the work about to ship: an account switcher (combined / Roth IRA / Traditional IRA / Cash / Margin), a live risk card,
sectors from SEC SIC codes, a tax view, one-click helper updates, and the optimizer with walk-forward.*

**In short:** for a one-person RIA who also trades, the platform already covers most of what Bloomberg, Koyfin and
TradingView offer, it costs nothing, and its statistics are more honest than theirs. The real gaps are not more data.
They are (1) **workflow glue**: a command bar, linked symbols, drill-down everywhere and alerts that run when the site is
closed; (2) **adviser records**: an audit trail, report archive, billing invoices and suitability; and (3) **trust in
the data**: a visible "as of" time and source on every number. Pros win on paid data (real-time depth, estimates,
Reuters-grade news, bond pricing). That should not be copied.

---

## 1. What the pros are (one line each)

| System | What it is known for | Source |
|---|---|---|
| Bloomberg Terminal | Mnemonic function codes (WEI, ECO, FA, DES, GP), Launchpad multi-panel layouts with linked security groups, PORT (portfolio risk, attribution, optimisation), MARS (multi-asset risk), BQL (query language), Instant Bloomberg chat | [Villanova](https://www.villanova.edu/university/business/vsb-experience/lab-for-financial-markets/bloomberg.html), [UDel Launchpad guide](https://my.lerner.udel.edu/wp-content/uploads/BB-Getting-Started-in-Launchpad.pdf), [MARS](https://professional.bloomberg.com/products/risk/mars/), [PORT](https://professional.content.cirrus.bloomberg.com/professional2023/products/bloomberg-terminal/portfolio-analytics/) |
| LSEG Workspace | Reuters news plus 10,000 sources, AI summaries of earnings and transcripts with a citation on every claim | [LSEG AI](https://www.lseg.com/en/data-analytics/products/workspace/workspace-ai-capabilities), [G2 reviews](https://www.g2.com/products/lseg-workspace/reviews_and_filters) |
| FactSet | Over 800 data sources, filings search, AI chat | [TrustRadius comparison](https://tr-web.dev.trustradius.com/compare-products/factset-vs-lseg-eikon) |
| Koyfin | "Bloomberg-lite" dashboards with 7 colour link groups, screeners, a free tier | [Koyfin MYD](https://www.koyfin.com/help/mydashboards-myd/), [groups](https://www.koyfin.com/help/my-dashboards-groups/), [Software Advice](https://www.softwareadvice.com/financial-services/koyfin-profile/) |
| TradingView | Charts, Pine Script, Pine Screener, server-side alerts (up to 1,000; watchlist alerts; webhooks) | [Pricing](https://www.tradingview.com/pricing/), [alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/), [Pine Screener](https://www.tradingview.com/support/solutions/43000742436-tradingview-pine-screener-key-features-and-requirements/) |
| thinkorswim | thinkScript, Stock Hacker, Analyze tab risk profile with beta weighting | [Schwab risk profile](https://www.schwab.com/learn/story/analyze-trades-using-risk-profile-on-thinkorswim) |
| Orion / Black Diamond / Addepar | Portfolio accounting, billing, household rebalancing, client portal, alternatives reporting (Addepar) | [Kubera comparison](https://kubera.com/blog/addepar-vs-black-diamond), [Orion](https://tour.orion.com/answers/portfolio-accounting-software) |
| Morningstar Direct Advisory Suite | X-Ray (allocation, sectors, regions, overlap), Portfolio Risk Score, FINRA-reviewed reports | [Morningstar](https://www.morningstar.com/try/direct-advisory-suite-research) |
| YCharts | Fundamental Charts, model portfolios, branded Report Builder, side-by-side proposals from uploaded statements | [WealthManagement](https://www.wealthmanagement.com/financial-technology/ycharts-adds-new-report-capabilities), [YCharts](https://get.ycharts.com/resources/blog/how-to-use-ycharts-to-win-new-business-and-grow-aum/) |
| Nitrogen (Riskalyze) | Risk Number questionnaire, 95% historical range, proposal compared with current portfolio, suitability records | [Nitrogen](https://nitrogenwealth.com/riskalyze/) |

The rules that matter for an RIA: SEC books and records rule 204-2 (generally five years, the first two easy to reach;
[Smarsh](https://www.smarsh.com/regulations/investment-advisers-act-of-1940-rule-204-2/),
[Comply](https://www.comply.com/blog/books-and-records-requirements-for-rias/)), and the Marketing Rule, which requires
net performance wherever gross performance is shown
([SEC adopting release](https://www.sec.gov/files/rules/final/2020/ia-5653.pdf),
[2024 risk alert](https://www.sec.gov/files/exams-risk-alert-marketing-observation-2024.pdf)). A small state-registered
adviser follows its state's version of these rules.

---

## 2. Area by area

Gap ranks: **H** = would change daily work or a compliance duty, **M** = nice and cheap, **L** = small benefit.

### Markets overview (Bloomberg WEI, Koyfin dashboards)
- **The pros have:** world indices on one screen with FX and futures beside them, heat maps, and dashboards you can arrange yourself.
- **Gaps:** a single "world" grid with clickable rows that open charts (**M**, Home and Investments boards are close already); a sector heat map from the new SIC sectors (**M**, it reuses data that is already there).
- **Not worth copying:** real-time global futures and FX feeds, which are paid.
- **Already matches or beats:** Investments boards (stocks, ETFs, bonds, alternatives, crypto, commodities) with 1m/3m/YTD/1y and total return, candlestick index cards, AI summaries, prefetching.

### Charts and technicals (TradingView, thinkorswim, Bloomberg GP)
- **The pros have:** server-side alerts on any indicator, many more drawing tools, chart templates, symbol comparison overlays.
- **Gaps:** saved chart templates, i.e. named indicator sets (**M**); a "compare symbol" overlay as % change (**M**); more drawings (**L**).
- **Not worth copying:** TradingView's 100+ indicators. The mantra says fewer, and 41 is already plenty.
- **Already matches or beats:** lightweight-charts with panes, 19 timeframes, a Pine v5 subset, volume profile, per-indicator timeframe, hidden plots, pop-out charts, and indicators on any line chart. For one person this is TradingView-class.

### Screening and scanning (TradingView Screener, Stock Hacker, Koyfin)
- **The pros have:** a general screener over thousands of symbols on fundamentals and technicals, saved screens, and alerts on screens.
- **Gaps:** a simple **fundamental screener** over the S&P 500 + Nasdaq-100 using SEC XBRL frames (free) and daily closes (**H** for an RIA picking holdings; the data is already fetched for Research); saved screens (**M**).
- **Not worth copying:** whole-market real-time scanning. Schwab pacing (0.7 s per request) makes it impossible, and the honest-statistics design would drown in multiple testing.
- **Already beats:** the Setups scanner. Holm-adjusted random-entry tests, robustness checks, forward records for lab strategies and grades that explain themselves go beyond anything retail screeners offer. TradingView and thinkorswim show signals with no proof of an edge.

### Research and fundamentals (Bloomberg FA/DES, FactSet, Koyfin)
- **The pros have:** analyst estimates and consensus, earnings call transcripts, peer comparison tables, segment data, ownership.
- **Gaps:** a **peer comparison table** (same SIC code; P/E, margins, growth, total return) (**H**, free from SEC + prices and the most-used FA view); an earnings history with dates and surprise (**M**; actual EPS is free from XBRL, consensus is not); 13F ownership changes on the company page (**L**, Flow has parts of this).
- **Not worth copying:** consensus estimates and transcripts (licensed data); BQL as a language (the AI covers ad-hoc questions).
- **Already matches:** SEC financials, ratios, DCF, filings, total return, AI summaries. Roughly Koyfin's free tier.

### Macro and economics (Bloomberg ECO, Koyfin macro)
- **The pros have:** a calendar with consensus and actuals in real time, history for each release, surprise indices.
- **Gaps:** click a calendar row to see that release's history chart from FRED (**M**, cheap); next-week events (**L**, there is no free feed).
- **Not worth copying:** real-time consensus and surprise indices (paid).
- **Already matches:** FRED charts, yield curve, FOMC dates, US actuals from FRED, full-history pop-outs.

### Fixed income (Bloomberg YAS/BondScreener, TradingView bond screener)
- **The pros have:** evaluated prices for individual bonds, munis and corporates, screening on yield, rating and maturity.
- **Gaps:** a ladder that shows cash flows by month for client accounts (**M**; the ladder exists, so check it links to holdings); muni and corporate quotes (**L**, no free source).
- **Not worth copying:** evaluated pricing (ICE/BVAL, expensive).
- **Already matches:** Treasury yields and spreads, auctions, CUSIP lookup, calculator, ladder. Good for an RIA.

### News (Bloomberg, LSEG Reuters)
- **The pros have:** exclusive real-time wires, news tied to holdings, alerts on keywords.
- **Gaps:** a "news on my holdings" filter (Account and client holdings) (**H**, a one-line filter with daily value); keyword news alerts (**M**).
- **Not worth copying:** paid wires. FactSet users themselves complain the news repeats all day.
- **Already matches:** grouping of duplicate stories, impact scores, sections and free extractive summaries. An honest free version of a wire.

### Portfolio and risk (Bloomberg PORT/MARS, thinkorswim Analyze, Morningstar X-Ray, Nitrogen)
- **The pros have:** performance attribution (allocation versus selection), factor exposure, scenario analysis, holdings overlap (X-Ray), a risk score compared with the client's tolerance.
- **Gaps:** **attribution versus a benchmark** (Brinson by sector, from SIC sectors and daily prices) (**M**, clients ask "why did I lag?"); **ETF look-through overlap** (**M**; N-PORT holdings are free from SEC); a risk tolerance questionnaire stored per client, compared with the portfolio's volatility (**H**, suitability evidence for exams); beta-weighted exposure to SPY/QQQ (**M**, the risk card has beta, so show it in dollars).
- **Not worth copying:** factor models like MAC3 and multi-asset derivatives risk. Too complex and needs licensed factor data.
- **Already matches or beats:** total-return analytics, stress tests, Monte Carlo, optimisation with walk-forward (out-of-sample testing is rare even at PORT level for small firms), the live risk card, dividends, account switcher.

### Tax (Orion tax-aware trading, Addepar)
- **The pros have:** tax-lot accounting (FIFO, specific ID), realised gain reports, tax-aware rebalancing, asset location.
- **Gaps:** **tax lots and a realised gains report** (**H**, needed for harvesting to be correct; import lots from the custodian CSV); asset location hints, e.g. bonds in the IRA (**M**, the tax view already knows account types); wash-sale checks across all of a household's accounts (**H**, IRS rules apply across the household's accounts including IRAs; check the shipped warning does this).
- **Not worth copying:** automatic tax-loss harvesting execution. It is risky and the AI must never trade.
- **Already matches:** a Roth/Traditional/taxable view, unrealised gains, harvest candidates and wash-sale warnings are more than Koyfin or TradingView offer.

### Trading and execution (thinkorswim, Bloomberg EMSX)
- **The pros have:** brackets/OCO, options chains with order entry, level 2, block allocation across client accounts.
- **Gaps:** bracket orders, i.e. a stop and target attached to the entry (**H** for risk control; the trade guide already computes them); **block trades with allocation** across clients (**M**, only needed once several client accounts are traded at Webull).
- **Not worth copying:** level 2 and depth (paid), algorithmic routing, options order entry (complexity and risk for a beginner).
- **Already beats:** preview tokens, a confirm window, a typed LIVE opt-in, daily limits, an order log, "unknown" never reported as "not placed". Safer than most retail platforms.

### Alerts (TradingView, Bloomberg ALRT)
- **The pros have:** server-side alerts that fire with the app closed, sent by email, phone or webhook; alerts on indicators and watchlists.
- **Gaps:** **alerts run by the helper**, not the browser tab, with free delivery by email (SMTP), ntfy.sh or Telegram (**H**; today alerts only work while the page is open); alerts on scanner grade changes and economic releases (**M**).
- **Not worth copying:** 1,000-alert scale and webhook marketplaces.
- **Already matches:** price alerts, setup alerts with sound, AI-created alerts.

### Adviser, client reporting and compliance (Orion, Black Diamond, Addepar, YCharts)
- **The pros have:** billing with invoices and custodian fee files, a client portal, a document vault, an audit trail, proposals, household grouping, a CRM link.
- **Gaps:** an **archive of every report sent** (PDF + date + data snapshot, stored by the helper) (**H**, rule 204-2); an **audit log** of advice and trades per client (**H**, same rule; the order log is a start); **fee invoices** generated from the fee schedule that already exists (**H**, billing is the RIA's revenue and a common exam topic); a check that gross is never shown without net (**H**, the Marketing Rule; reports already show both, so add a test); proposals as current versus recommended side by side (**M**); households, i.e. several accounts per client (**M**).
- **Not worth copying:** a client portal (needs the cloud stage and security work), a CRM (use a free one), GIPS composites.
- **Already beats:** white-label PDF reports with alternatives, SEC fund facts, tiered and prorated fees and net/gross figures, built by one person for free. Black Diamond-class output without the five-figure bill.

### Workspace, navigation and UX (Bloomberg Launchpad, Koyfin)
- **The pros have:** a command line, saved multi-panel layouts, linked symbol groups, keyboard everything, a consistent right-click menu.
- **Gaps:** see section 3. A **command bar** (**H**), **linked symbols** (**H**), **right-click and hover drill-down everywhere** (**H**), saved layouts (**M**).
- **Not worth copying:** the Bloomberg keyboard and 30,000 functions. Fifteen pages is right.
- **Already matches:** tableTools (sort, filter, remembered state), glossary tooltips, themes, pop-outs, a responsive rail.

### Data quality and latency (all)
- **The pros have:** licensed real-time data, corporate actions applied, a timestamp and source on every field.
- **Gaps:** an **"as of / source / delayed" stamp** on every card and value (**H**, the cheapest way to earn trust); a data health panel showing helper version, Schwab login age, last scan and cache age (**M**); a split/dividend check on history (**M**).
- **Not worth copying:** consolidated tape fees, tick data.
- **Already matches:** Schwab real-time for stocks, REST-polled official prevClose, cache.db, Alpaca fill-in, honest failure states ("unavailable", never "none").

### AI (LSEG Workspace AI, FactSet, Morningstar Mo, Bloomberg)
- **The pros have:** citations on every claim, transcript search, AI across filings.
- **Gaps:** **source links on AI answers** (which tool and data, with as-of time) (**M**, LSEG makes this its selling point); a morning brief already on the roadmap (**M**).
- **Not worth copying:** in-house LLMs and transcript licences.
- **Already beats:** screen-aware chat, tools over live engine data, UI actions (open chart, add indicator, create alert), never trades. Ahead of Koyfin and TradingView, comparable to the paid terminals.

---

## 3. Organisation and navigation patterns the pros use

| Pattern | Who | Suggestion for this app |
|---|---|---|
| **Command line / function codes** | Bloomberg (`AAPL US Equity DES <GO>`), Koyfin (MYD, MYW codes) | A `/` or Ctrl+P **command bar**: type `AAPL` for the chart, `AAPL fa` for Research, `AAPL news`, `macro cpi`, `client smith`, `trade AAPL`. Short codes map to existing routes. Keep Ctrl+K for AI and let the bar pass free text to the AI. |
| **Launchpad layouts** | Bloomberg, Koyfin dashboards | One **"Workspace" page** with 4 to 6 tiles chosen from existing widgets (chart, watchlist, news, risk card, setups list), saved as named layouts in localStorage. Reuse the page components, no new data. |
| **Linked symbol groups** | Bloomberg groups, Koyfin's 7 colours | A small coloured dot on the watchlist, multi-chart, Research and Trade panels. Same colour means the same symbol: click AAPL in one and all of that colour follow. Start with one group ("linked / unlinked"). |
| **Keyboard first** | Bloomberg, thinkorswim | `?` shows shortcuts; `g h` Home, `g c` Chart, `g s` Setups; arrow keys in every table; Enter opens a row; Esc closes pop-ups (Trade already has B/S/Enter). |
| **Drill-down everywhere** | Koyfin, Bloomberg | One shared **symbol menu**: hover a ticker anywhere for a mini card; click for a menu (Chart, Research, News, Add to watchlist, Alert, Trade). |
| **Consistent table tools** | Koyfin, Excel-like terminals | tableTools already gives sort and filter. Add column chooser, CSV export, and "click row = detail" on every table. |

**Drill-down patterns to apply (hover for meaning, click for detail):**
1. **Any ticker text:** hover shows price, day %, a 1y sparkline and sector; click opens the symbol menu.
2. **Any number with a term** (VaR, beta, yield to worst, PF, p-value): hover shows the glossary definition *plus how this value was computed* (inputs, window, as-of); click opens the method note.
3. **Any % change:** hover shows the reference price and time ("vs prev close 189.20, 4:00 pm").
4. **Risk card values:** click VaR for the return histogram with the cut-off line; beta for the scatter versus SPY; drawdown for the underwater chart; concentration for a holdings bar list.
5. **Sector slices and bars:** click to filter the holdings table to that sector.
6. **Tax view rows:** click a gain for its lots; click a harvest candidate for the replacement idea and the wash-sale window dates.
7. **Calendar rows:** click for the release's FRED history with past surprises marked.
8. **News headlines:** hover for the extractive summary; click a ticker chip to filter news to it.
9. **Chart points:** click a bar for the news, earnings and dividends on that date.
10. **Report preview sections:** click a figure to open the data behind it (the table and source).
11. **Setups cards:** hover a grade letter for its "why" codes in plain words (already partly done).
12. **Client list:** hover a client for AUM, YTD net, fee due and last report date.

---

## 4. Top 15, in priority order

Free data only. Impact for a one-person RIA plus active trader, against the effort in this codebase.

| # | Item | Impact | Effort | Why |
|---|---|---|---|---|
| 1 | Alerts run by the helper, delivered free (email/ntfy/Telegram) | High | Med | Alerts that need an open tab are not alerts |
| 2 | Report archive + audit log in platform.db | High | Low-Med | Rule 204-2; cheap insurance for exams |
| 3 | Fee invoices from the existing fee schedules | High | Low | Revenue; the maths already exists |
| 4 | Shared symbol hover card + click menu everywhere | High | Med | Biggest UX upgrade; delivers the "interactive everywhere" goal |
| 5 | "As of / source" stamps + data health panel | High | Low | Trust; prevents acting on stale numbers |
| 6 | Command bar (`/` codes for symbols, pages, clients) | High | Low-Med | Bloomberg's core idea, cheap with hash routes |
| 7 | Tax lots + realised gains, household-wide wash-sale check | High | Med | Makes the shipped tax view correct |
| 8 | Risk questionnaire per client vs portfolio risk | High | Low-Med | Suitability evidence, as in Nitrogen |
| 9 | Bracket orders (stop + target) from the trade guide | High | Med | Risk control for a beginner |
| 10 | News filtered to holdings | Med-High | Low | Daily value, one filter |
| 11 | Peer comparison table (SIC peers) | Med | Low-Med | The most-used fundamentals view, free from SEC |
| 12 | Linked symbol groups (one group first) | Med | Med | Workflow speed across panels |
| 13 | Fundamental screener (S&P 500 + NDX, XBRL frames) | Med | Med | Finding holdings for clients |
| 14 | Risk card drill-downs (VaR histogram, beta scatter, underwater) | Med | Low | Explains numbers to clients and to the owner |
| 15 | Marketing Rule test (no gross without net) + proposal side by side | Med | Low | Compliance plus winning clients |

**To remove or hold back (simplicity scales):** do not add more indicators, a client portal, options order entry,
level 2, a factor risk model or paid feeds. Consider folding Multi-chart into the Workspace page (#4/#12) so there is
one place for layouts. Keep the page count at or below today's.

---

## 5. Scores versus a "sellable product" bar

100 = what a paying RIA or active trader would expect from a commercial tool in that area. Scores judge this
platform's current branch plus the shipping work.

| Area | Score | Comment |
|---|---|---|
| Markets overview | 75 | Broad boards; needs a heat map and drill-down |
| Charts / technicals | 80 | TradingView-class for one person; templates and compare missing |
| Screening / scanning | 60 | Scanner is excellent but narrow; no general screener |
| Research / fundamentals | 65 | Solid SEC data; no peers, estimates or transcripts |
| Macro / economics | 70 | Good free coverage; calendar drill-down missing |
| Fixed income | 65 | Treasuries strong; no corporate/muni pricing (fine) |
| News | 60 | Smart free ranking; no holdings filter or alerts |
| Portfolio / risk | 75 | Strong maths and walk-forward; no attribution or look-through |
| Tax | 55 | Good view; no lots or realised report yet |
| Trading / execution | 60 | Very safe; no brackets or allocation |
| Alerts | 35 | Browser-only is the biggest functional gap |
| Adviser reporting / compliance | 55 | Excellent reports; no archive, audit log, invoices or suitability |
| Workspace / navigation / UX | 55 | Clean, but no command bar, linking or layouts |
| Data quality / latency | 65 | Good sources and honest failures; stamps missing |
| AI | 80 | Screen-aware with actions; add citations |
| **Overall** | **63** | A strong personal tool. To be sellable it needs alerts, records and navigation, not more data. |

*Note: "sellable" here also assumes the cloud stage (11), which changes the security and data-licence picture.
Schwab and SEC terms allow personal use; redistributing Schwab data to paying users would not be allowed without a
licence. That alone argues for keeping this as the owner's own tool.*
