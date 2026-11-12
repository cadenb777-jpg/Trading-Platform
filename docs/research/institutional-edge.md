# Institutional edge: research roadmap

How large institutions get an information edge, what of it a free-data terminal can rebuild, the maths behind each,
and how professional tools show it. Improvement runs work down this list (one complete item per run, built,
displayed and tested), mark items done, and add new findings. Every item follows the R&D workflow in
`docs/improvement/PLAYBOOK.md`.

Columns: **what institutions use** · **free data** · **maths (primary source)** · **how pros show it** ·
**how we prove it right** · **status**.

## 1. Company fundamentals, as deep as the filing goes

- **Revenue by product, segment and region; segment margins** (Bloomberg segment and geographic data).
  Free: SEC EDGAR XBRL instance documents (dimensional facts: srt:ProductOrServiceAxis,
  us-gaap:StatementBusinessSegmentsAxis, srt:StatementGeographicalAxis; the SEC company-facts API omits them).
  Shown: ranked bars with share, growth and margin per part. Proof: parts add up to reported total; tested on Apple
  FY2025 10-K figures. **Done (helper 57, Research → Where the money comes from).**
- **Statements as reported, line by line, with every note's detail table** (Bloomberg's "as reported" financials).
  Free: the filing's own presentation linkbase, schema role titles and label linkbase with the XBRL instance. Shown:
  the company's own layout, totals bold, the parts it reports under a line indented (↳), a picker for every note.
  Proof: rows follow the filing's order; drill-down parts add up; negated labels and cash start/end balances tested.
  **Done (helper 58, Research → Financials → As reported).**
- **Customer and supplier concentration** (Bloomberg SPLC). Free: XBRL `ConcentrationRiskPercentage1` with
  `srt:MajorCustomersAxis` / `us-gaap:ConcentrationRiskByBenchmarkAxis`, plus 10-K text ("Customer A accounted for
  ..."). Shown: a relationship list with % of revenue and the counterpart's own page. Proof: matches the filing note. **Done (helper 59, Research → Which businesses are growing).**
- **Segment history and trends** (multi-year segment bars; which business is growing). Free: the same XBRL across the
  last 5 10-Ks. Shown: stacked area of revenue by segment over time.

## 2. Rates and the Fed **Done (helper 59, same panel: years × parts with yearly growth).**

- **Rate-decision odds per FOMC meeting** (Bloomberg WIRP, CME FedWatch). Free: 30-day fed funds futures (/ZQ) quotes
  from Schwab; FOMC dates (already in the calendar). Maths: implied rate = 100 − price; split the month's average
  around the meeting day; probability of a 25 bp move = implied change / 0.25 (CME FedWatch methodology; expanding
  probability tree for later meetings). Shown: a table of meetings × probabilities, implied rate path chart.
  Proof: hand-worked CME example reproduced in a test; compared with the published FedWatch numbers on the same day. **Done (helper 59, Macro → Fed rate odds).**
- **Fitted Treasury curve, rich/cheap maturities, forwards, breakevens, recession odds** (Bloomberg curve and relative
  value screens; the Fed's own GSW curve; the NY Fed's yield-curve model). Free: Treasury daily par and real yield
  curves; FRED GS10, TB3MS, USREC. Maths: Nelson-Siegel-Svensson zero curve fitted to par yields (Gürkaynak, Sack and
  Wright 2006); gap vs each maturity's own year of weekly fits (|z| >= 2.5); forwards from the zero curve; probit on the
  10y-3m spread fitted by maximum likelihood since 1959 (Estrella and Mishkin 1998), shown with its record and false
  alarms. Proof: flat-curve par yields, fit recovers a known curve, probit recovers known coefficients, AUC by hand.
  **Done (helper 61, Investments → Bonds → What the curve says; Home Edge today line).**
- **Net liquidity** (macro desks' liquidity gauge). Free: FRED WALCL − WTREGEN − RRPONTSYD (weekly). Maths: the
  difference, aligned to Wednesday dates. Shown: line with the S&P 500 beside it. Proof and honesty: report the
  correlation of weekly *changes* (not levels, which are spuriously correlated) with its confidence interval.

## 3. Options and positioning **Done (helper 59, Macro → Net liquidity).**

- **Dealer gamma exposure (GEX) and the zero-gamma level** (SpotGamma-style; desks watch where dealer hedging adds or
  dampens moves). Free: Schwab option chains (open interest, implied volatility). Maths: Σ gamma × OI × 100 × S² ×
  0.01, calls +, puts − (naive dealer-sign assumption, stated); zero-gamma by re-pricing gamma (Black-Scholes) over a
  grid of spot prices. Shown: GEX by strike bars, flip level line on the chart. Proof: Black-Scholes gamma against
  reference values; GEX on a hand-built chain. **Done (helper 59, Flow → Options edge).**
- **Volatility risk premium** (implied vs realized). Free: Schwab ATM implied vol; realized vol from daily closes.
  Evidence: NY Fed Staff Report 867 (term structure of variance risk premia). Shown: implied vs realized lines and the
  gap; percentile vs its own history. Proof: realized vol formula tested; IV checked against the chain. **Done (helper 59, Flow → Options edge; IV history isn't free, so IV is ranked against the last year's realized readings, and the market's record is VIX vs next-month S&P realized).**
- **Earnings implied move vs history** (options desks). Free: front straddle price around the report from Schwab;
  past earnings-day moves from daily bars. Maths: implied move ≈ straddle / price; compare with the distribution
  (median, 75th percentile) of the last 8–12 reaction moves. Evidence mixed (large samples show overpricing on average,
  not consistently): show it as information with the history, never as a signal by itself. **Done (helper 59, Flow → Options edge; report times from 8-K Item 2.02, next date needs the free Finnhub key).**
- **Off-exchange ("dark pool") volume share** (institutional flow). Free: FINRA OTC Transparency ATS weekly data
  (api.finra.org; 2-week lag for Tier 1 stocks). Shown: weekly off-exchange share vs its own average. Proof: totals
  match FINRA's published week.

## 4. Portfolio maths (linear algebra) **Done (helper 59, Flow → Positioning).**

- **Factor exposures** (Barra/Axioma-style risk). Free: Kenneth French Data Library daily factors (Mkt-RF, SMB, HML,
  RMW, CMA, Mom). Maths: OLS of portfolio excess returns on factors (β, t-stats, R²), rolling window. Shown: factor
  bars with confidence intervals, "what your portfolio is really betting on". Proof: regression on synthetic data with
  known betas recovers them. **Done (helper 59, Portfolios → What it's really betting on).**
- **Risk decomposition and eigen-portfolios.** Maths: covariance with Ledoit-Wolf shrinkage; marginal and component
  contributions to risk (w ⊙ Σw / σ); principal components of the holdings' returns (what drives the portfolio).
  Shown: contribution bars, PCA "hidden bets". Proof: contributions sum to total volatility; PCA on a known matrix.

## 5. Relative value and arbitrage monitors **Done (helper 59, same panel: hidden bets; risk contributions were already in the analysis).**

- **Index futures vs fair value; box-spread rates vs T-bills.** **Done (helper 55–56, #10/#11).**
- **ETF and closed-end fund premium/discount to NAV.** Free: Schwab price; NAV from issuer/SEC N-PORT. Proof: NAV date
  shown; flagged when stale. **Done (helper 59, Flow → Positioning → Price vs fund value; no free NAV history, so today's reading only).**
- **Put-call parity deviations** (conversion/reversal). Free: Schwab chains. Maths: C − P = S − K·e^(−rT) − PV(div).
  Shown only after bid/ask, borrow and dividends; most "violations" vanish after costs (say so).
- **Pairs and cointegration.** Maths: Engle-Granger / Johansen, half-life of mean reversion; must pass the platform's
  random-entry and walk-forward tests before any signal is shown.

## How professional tools display data (patterns to adapt in our own look)

- One question per panel, the answer first (a number or a ranked bar), detail on demand.
- Every figure with its source and time; a "dated" warning when stale.
- Ranked horizontal bars for compositions (not pies); small multiples for comparisons over time.
- Tables right-aligned numbers, monospace digits, colour only for direction.
- Drill-down: every name links to its own page (stock → overview, chart, filings, options).
