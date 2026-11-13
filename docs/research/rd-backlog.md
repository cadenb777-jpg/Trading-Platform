# Research and development backlog

The owner's brief (2026-11-12): don't wait to be told. Study what professional platforms (Bloomberg, FactSet, Refinitiv,
Koyfin, TradingView, thinkorswim, options and rates desks) show, find a free way to get the same information, use maths
that checks itself (and new maths where it gives an edge), and build it here in our own design. Arbitrage and market edge
first. Copy capabilities, never code, names, logos, help text or look-alike screens.

How the scheduled runs use this file:
1. Each run builds the **highest unbuilt item** (or the next stage of a partly built one) as one big, complete pull
   request: data source tested live, maths tested on hand-worked values, a visible home on a screen the owner opens,
   design / accessibility / copy checks, release audit, independent code review.
2. Each run **adds at least two newly researched items** (what a professional platform shows that we lack, the free
   source, the maths, the edge) and re-ranks the list when evidence changes. Research is part of the job, not optional.
3. Mark an item `built (#PR)` when merged, `rejected (reason)` when an experiment fails (and log it in LESSONS.md).
4. Every figure: source and time on screen; missing data says so; no paid data unless the owner decides.
5. A trading signal is research until it passes the platform's statistics (random entry, Holm, walk-forward, costs).

Effort: S (a run), M (1-2 runs), L (3+ runs, build in stages). Edge: how much better informed the owner is than a
typical retail trader. "Verify" = the free source must be confirmed live before building.

## A. Companies, deeper than the standard statements

| # | Capability (what pros show) | Free source | Maths / method | Home in the app | Effort | Edge |
|---|---|---|---|---|---|---|
| A1 | built (main, helper 57) — **Revenue breakdown**: by product (iPhone, Mac, iPad, Wearables, Services), business segment and region, with growth and share, year and quarter | SEC filing XBRL instance (`*_htm.xml`) + label linkbase (`*_lab.xml`) from the filing index: dimension axes `ProductOrServiceAxis`, `StatementBusinessSegmentsAxis`, `StatementGeographicalAxis` (the SEC's companyfacts API leaves dimensional facts out) | parse contexts with exactly one axis; pick the revenue concept with most facts; detect subtotal members (subset sums) so nothing is counted twice; growth vs the same period a year earlier | Research overview + security view DES/FA | M | High |
| A2 | built (main, helper 58) — **Statements as filed, every line** (the company's own line items and order, not a standardized 20 lines), with "as reported" vs "standardized" toggle | XBRL instance + presentation linkbase (`*_pre.xml`) | walk the presentation tree; values per period; calculation linkbase (`*_cal.xml`) to check that children add up (self-check shown as a tick) | Research > Financials | M | High |
| A3 | **Operating metrics** the company reports (units, subscribers, stores, backlog, ARPU) | XBRL custom concepts (company prefix, non-monetary units) | list non-USD-unit facts per period; trend and growth | Research > Metrics | S | Medium |
| A4 | built (main, helper 59) — **Customer and supplier concentration** ("customer A = 14% of revenue") | XBRL `ConcentrationRiskPercentage1` with `ConcentrationRiskByBenchmarkAxis` / `MajorCustomersAxis`; 10-K text | parse dims; link named customers to tickers via the SEC ticker list | Research overview "Who it depends on" | S | Medium |
| A5 | **Debt maturity ladder and interest cost** | XBRL `LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths` … `AfterYearFive`, `InterestExpense` | ladder chart; interest coverage; refinancing wall vs current rates (FRED) | Research > Balance sheet | S | Medium |
| A6 | **Share count, buybacks, dilution** over 10 years | XBRL `dei:EntityCommonStockSharesOutstanding`, `PaymentsForRepurchaseOfCommonStock`, SBC | buyback yield, net dilution, SBC as % of revenue | Research overview | S | Medium |
| A7 | partly built (main, helper 59: implied move vs past reactions; surprises still to do) — **Earnings: surprise history, estimates, implied move** | Finnhub free key (estimates, surprises); SEC 8-K Item 2.02 dates; option chain | implied earnings move from the straddle around the date vs the stock's own historical earnings moves (percentile) | Calendar + security view | M | High |
| A8 | **Short interest and days to cover** | FINRA equity short interest files (twice monthly) — verify free access | days to cover = SI / 20-day volume; change; vs FINRA daily short volume already in the app | Flow + security view | S | Medium |
| A9 | **Management and board changes, 8-K events timeline** | EDGAR filing index (8-K items 5.02, 1.01, 2.01, 7.01) | event timeline under the price chart | Chart overlay + Research | S | Medium |
| A10 | **Peer comps with the as-filed segment detail** (compare iPhone vs a peer's handset segment) | A1 output across SIC peers (quant.comps exists) | segment-level growth/margin table | Research > Valuation | M | High |

## B. Economy and trade

| # | Capability | Free source | Maths / method | Home | Effort | Edge |
|---|---|---|---|---|---|---|
| B1 | **US imports and exports by country and product** (net trade balance, top partners, fastest changes) | Census International Trade API `api.census.gov/data/timeseries/intltrade/{exports,imports}/hs` (free; key optional) + FRED `BOPGSTB` | monthly balance, 12-month sums, YoY by HS chapter and partner; seasonally compare same month | Macro > Trade (new tab) | M | Medium |
| B2 | **A company's exposure to trade and tariffs**: its region revenue (A1) × trade flows with those regions | A1 + B1 + tariff schedule news | exposure score = share of revenue from each region × that region's trade change; shown as a reading, not a signal | Research overview "Exposed to" | M | High (new) |
| B3 | **Economic surprise index** (data beating or missing forecasts) | Forex Factory forecasts (already in the Calendar) vs actuals from FRED (already) | standardized surprise (actual − forecast) / historical SD per series, exponentially decayed sum (same idea as published surprise indexes, our own construction) | Macro + Home | M | High |
| B4 | built (main, helper 59, Macro → Fed rate odds) — **Rate path the market expects** (probability of a cut or hike at each Fed meeting) | Schwab 30-day fed funds futures (/ZQ) — verify quotes; FOMC dates (in app) | per-meeting implied rate from consecutive contract months (standard fed-funds-futures arithmetic), probabilities of 25 bp moves | Macro + Calendar FOMC rows | M | High |
| B5 | built (#14, helper 61, Investments → Bonds → What the curve says) — **Fitted yield curve, forwards, rich/cheap tenors** | Treasury par yield curve (home.treasury.gov, already used) | Nelson-Siegel-Svensson fit (least squares); residual per tenor = rich/cheap in bp; 1y1y, 5y5y forwards; recession probability from the 10y-3m spread (Estrella-Mishkin probit, the published NY Fed model's form) | Bonds | M | High |
| B6 | built with B5 (breakevens from Treasury's real curve) — **Real yields and inflation expectations** | FRED TIPS (DFII10), breakevens (T10YIE, T5YIFR) | breakeven decomposition; trend | Bonds | S | Medium |
| B7 | **Global PMI/leading indicators heat map** | OECD CLI (already), World Bank | z-scores by country, momentum | Macro > World | S | Medium |
| B8 | built (#15, helper 64, Bonds → What the curve says) — **Term premium: how much of a long yield is pay for lending long** (rates desks split forwards into expected rates + premium) | FRED `THREEFYTP10` (Kim-Wright 10-year term premium, Federal Reserve Board; daily, verified live 2026-11-12: 0.87% on 2026-11-06) | Kim and Wright (2005, FEDS 2005-33) three-factor affine model, published daily; expected-rate part = 10-year yield − premium; show beside B5's 5y5y forward | Bonds → What the curve says | S | High |
| B9 | built (#15, helper 64, Bonds → Treasury auctions; the tail proxy was rejected by experiment, see LESSONS) — **Treasury auction scorecard: did the auction go well?** (dealer takedown, indirect demand, a tail proxy) | Fiscal Data `auctions_query` fields `primary_dealer_accepted`, `direct_bidder_accepted`, `indirect_bidder_accepted`, `bid_to_cover_ratio`, `high_yield` (verified live 2026-11-12: 10-year reopening Oct 7, bid-to-cover 2.77, dealers 2.5%) | dealer share = dealer accepted / total; each vs the last 6 auctions of the same term (z-score); "tail vs curve" = high yield − B5's fitted par yield at that maturity on the auction day (closing curve vs 1 pm auction: stated). The when-issued yield that desks use for the true tail is not free | Bonds → Treasury auctions | S | Medium |
| B10 | built (#15, helper 64, Bonds → Bond market) — **Credit curve by rating and its percentile** (credit desks' spread monitor) | FRED ICE BofA option-adjusted spreads `BAMLC0A1CAAA` … `BAMLC0A4CBBB`, `BAMLH0A1HYBB` … `BAMLH0A3HYC` (verified live 2026-11-12: AAA 0.46, BBB 1.12, BB 1.93, CCC 13.30) | spread per rating step; each spread's percentile over 10 years; BBB−BB "crossover" gap; compare with the excess bond premium idea (Gilchrist and Zakrajšek, AER 2012) — the Fed's EBP file on federalreserve.gov was blocked from the research environment, so verify before using | Bonds → Bond market | S | Medium |
| B11 | built (this run's PR, helper 66, Bonds → Bond market) — **Funding stress monitor** (repo desks: is overnight money getting scarce? Sept 2019 and March 2020 showed up here first) | FRED `SOFR`, `SOFR1`, `SOFR99` (1st/99th percentile of the day's repo trades), `IORB`, `RRPONTSYAWARD` (verified live 2026-11-12: SOFR 3.89, SOFR99 3.97, SOFR1 3.83, IORB 3.90, RRP 3.75) | SOFR − IORB (repo trading above what banks earn at the Fed = reserves getting scarce) and the 99th − 1st percentile spread, each against its own history (percentile); Anbil, Anderson and Senyuz (2020), "What Happened in Money Markets in September 2019?", FEDS Notes | Bonds → Bond market + a Home Edge line when unusual | S | High |
| B12 | built (this run's PR, helper 66, Bonds → Bond market) — **Mortgage spread** (MBS desks: how much homebuyers pay over Treasuries) | FRED `MORTGAGE30US` (Freddie Mac weekly) and `DGS10` (verified live 2026-11-12: 7.11% vs 5.10% = 201 bp); Optimal Blue daily rates were not reachable from FRED here | spread = mortgage rate − 10-year yield, percentile since 1971; split into "what lenders and the MBS market charge" vs the long-run norm (~170 bp); Fuster, Lo and Willen (2024), "The Time-Varying Price of Financial Intermediation in Mortgage Markets", J. Finance | Bonds → Bond market | S | Medium |
| B13 | built (this run's PR, helper 66, Bonds → What the curve says) — **Treasury supply pace** (how fast the government is borrowing; supply moves the term premium) | Fiscal Data `debt_to_penny` (verified live 2026-11-12: $40.58 trillion total, $32.80 trillion held by the public on 2026-11-10) plus auction sizes already in the helper | net new debt held by the public over 1/3/12 months, share issued as bills vs coupons; Greenwood and Vayanos (2014), "Bond Supply and Excess Bond Returns", Rev. Financial Studies 27(3) | Bonds → What the curve says, beside the term premium | S | Medium |
| B14 | **Are bank reserves still "ample"?** (the level the Fed watches to decide when to stop shrinking its balance sheet) | FRED `WRESBAL` (reserve balances, weekly; verified live 2026-11-12: $2.96 trillion on 2026-11-11) with `GDP` ($33.0 trillion, Q3 2026) | reserves / GDP and its distance from the level where funding spreads started rising in 2019 (~8%); the reserve demand curve: Lopez-Salido and Vissing-Jorgensen (2023), "Reserve Demand, Interest Rate Control, and Quantitative Tightening", FEDS 2023-012 — estimate the curve from SOFR - IORB vs reserves/GDP, tested out of sample | Bonds → Money and housing | M | High |
| B15 | **Short-term credit stress: commercial paper vs T-bills** (the money-market cousin of credit spreads; it spiked first in 2008 and March 2020) | FRED `RIFSPPFAAD90NB` (90-day AA financial commercial paper) and `DTB3` (verified live 2026-11-12: 4.03% vs 4.12%, both discount basis) | spread on the same basis, percentile since 1997; Kacperczyk and Schnabl (2010), "When Safe Proved Risky: Commercial Paper during the Financial Crisis of 2007-2009", J. Econ. Perspectives 24(1) | Bonds → Money and housing | S | Medium |
| B16 | **Banks' lending standards** (the Fed's Senior Loan Officer Survey; tightening has led credit spreads and defaults) | FRED `DRTSCILM` (net % of banks tightening for large and mid firms, quarterly; verified live 2026-11-12: 1.7% for Oct 2026) | level and change vs history; Bassett, Chosak, Driscoll and Zakrajšek (2014), "Changes in Bank Lending Standards and the Macroeconomy", J. Monetary Economics 62 — show as a reading beside B10 credit spreads | Bonds → Bond market | S | Medium |

## C. Options and volatility (new maths that checks itself)

| # | Capability | Free source | Maths / method | Home | Effort | Edge |
|---|---|---|---|---|---|---|
| C1 | **What the options market thinks will happen**: probability of the price being above/below any level by a date, as a curve | Schwab option chains (any stock/index) | risk-neutral density by Breeden-Litzenberger (second derivative of call prices in strike) on an arbitrage-free smile (SVI fit, Gatheral 2004); self-check: density integrates to 1 and reprices the input options within the bid-ask | Security view OMON + Flow | L | High (new for retail) |
| C2 | **Implied borrow cost and dividend from put-call parity** per stock: spots hard-to-borrow stocks and mispriced conversions | Schwab chains + quotes | implied forward from C − P = PV(F − K) across strikes (robust regression); implied borrow = r − q − ln(F/S)/T; conversion/reversal edge after costs | Flow "Arbitrage" panel | M | High |
| C3 | partly built (main, helper 59: IV30 vs RV, VIX record; VIX futures basis still to do) — **Volatility risk premium**: implied vs realised, term structure, VIX futures basis | Schwab chains, /VX futures, daily closes | IV30 vs RV20/60, percentile ranks; VIX futures roll yield | Flow + Futures | M | High |
| C4 | built (main, helper 59) — **Earnings implied move vs history** (see A7) | chains + 8-K dates | straddle / spot; historical earnings-day moves distribution | Calendar | S | High |
| C5 | **Skew and smile monitor** across the watchlist | chains | 25-delta risk reversal, butterfly; z-score vs own history (collected going forward) | Flow | M | Medium |

## D. Arbitrage and relative value

| # | Capability | Free source | Maths / method | Home | Effort | Edge |
|---|---|---|---|---|---|---|
| D1 | Index futures fair value and implied open | built (#10) | | Futures, Home | | |
| D2 | Box-spread rates vs T-bills | built (#11) | | Futures, Home | | |
| D3 | partly built (main, helper 59: today's premium; history still to collect) — **ETF and closed-end fund premium/discount to NAV** with history and z-score | Schwab quote `nAV` (daily; collect history going forward), fund NAV filings (alts already) | premium = price / NAV − 1; z-score vs own history; creation/redemption arbitrage band from spread and fees | Investments + Home Edge | M | High |
| D4 | **Futures carry and roll yield across all 39 markets** (who pays to hold, who is paid) | futures curve quotes (already) | annualised roll yield between first two contracts; carry ranking; vs history | Futures | S | Medium |
| D5 | **Merger arbitrage monitor**: announced deals, spread, implied deal probability, days to close | EDGAR full-text (efts) for DEFM14A/S-4/8-K 1.01; quotes | spread = offer value − price; annualised return; implied probability with a fall-back price (pre-deal price) | new Arbitrage page | L | High |
| D6 | **Pairs and cointegration** inside sectors | daily closes | Engle-Granger / Johansen, half-life (Ornstein-Uhlenbeck), entry z; must pass random-entry + Holm + walk-forward before showing as more than research | Setups lab | L | Medium (often fails tests) |
| D7 | **Index changes**: Nasdaq-100 annual reconstitution and S&P quarterly adds/deletes | exchange/index announcements (news feeds already) | event-study of past adds (abnormal returns) shown with its statistics | Calendar | M | Medium |
| D8 | **Cross-listed / share-class spreads** (GOOG vs GOOGL, BRK.A vs BRK.B ×1500) | quotes | ratio spread vs history, costs | Arbitrage page | S | Medium |

## E. Product, launch readiness and speed

| # | Item | Method | Effort |
|---|---|---|---|
| E1 | First-run onboarding: helper install, Schwab login, what each page is for, glossary tour | click-count measured (docs/workflows.md) | M |
| E2 | Empty and error states everywhere say what happened and what to do (audit every page) | release audit + copy review | M |
| E3 | Accessibility pass (WCAG 2.2 AA): contrast, keyboard, 24 px targets, screen-reader names on charts | automated checks + manual | M |
| E4 | Speed: profile helper hot paths and the scanner; move a hot path to a compiled language only when a measurement shows it pays (Rust/WASM in the browser, a compiled worker for the helper) | timings before/after | M |
| E5 | Live-data health: every panel's as-of stamp turns amber when stale (some panels still hand-format times) | grep + fix | S |

## Tools and skills

- In the repo: `fin-*` (comps, DCF, LBO, earnings, catalysts, sector) to check research features follow institutional
  practice; `eng-*`; `frontend-design`, `webapp-testing`, `unslop`. Scheduled sessions use them.
- Anthropic **Design** plugin (critique, accessibility, copy): enabled on the owner's account; it loads in sessions the
  owner starts, not in automated ones, so runs use the repo's design skills and say so.
- Network: the "Trading-Platform research" cloud environment allows SEC, FRED, Census, BLS, BEA, Treasury, CFTC and
  World Bank so sources are tested live before building. Ask the owner before adding hosts or any paid source.

## Next up (re-ranked 2026-11-13, second pass)

1. B14 reserves vs "ample" + B15 commercial paper spread + B16 lending standards as one "credit and reserves" pack (verified).
2. C2 implied borrow and dividends from put-call parity (M; needs Schwab chains, which only the owner's helper can test live).
3. C1 risk-neutral probability curve (L; same chains).
4. B3 economic surprise index (M; Forex Factory forecasts + FRED actuals already in the helper).

## Log

- 2026-11-12 · backlog written from a gap review against professional platforms (owner's request).
- 2026-11-12 · B5 + B6 built (fitted curve, rich/cheap, forwards, breakevens, recession probit; helper 61). Added B8, B9, B10 with live-verified free sources; marked the items built straight on main (helper 57-59).
- 2026-11-13 · B8, B9, B10 built (rates desk pack, helper 64). Added B11 funding stress, B12 mortgage spread, B13 Treasury supply pace (sources verified live); ticdata.treasury.gov (foreign holders, TIC) was blocked from the research environment.
- 2026-11-13 · B11-B13 built (money and supply, helper 66). Added B14 reserves vs ample, B15 commercial paper spread, B16 bank lending standards (sources verified live).
