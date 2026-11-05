# Data aggregation audit (helper v44, data hub)

Caden asked whether we aggregate our free data "properly", quoting Fincept Terminal ("it connects to publicly
available data sources … that almost nobody aggregates properly"). This audit checks every source the platform reads
against nine questions, lists the defects found (file:line on `main` at b5412eb, before this change), and says what the
new data hub (`helper/engine/datahub.py`, `symbols.py`, `datacheck.py`) fixes.

Fincept's data layer (`fincept-qt/src/datahub`, `src/network`) was read for ideas only (it is AGPL; no code copied).
Ideas taken: one policy per topic (TTL, minimum refresh interval, a refresh timeout so a hung fetch can't pin a topic),
a per-producer request-rate cap, last-known-good values kept when a refresh fails, and an inspector that shows each
topic's last publish, last error and in-flight state.

Libraries considered (the owner allows MIT/BSD/Apache-2.0): tenacity (retries, Apache-2.0), requests-cache / hishel
(HTTP caching, BSD), aiolimiter (MIT). None was added. Retries, pacing and coalescing have to share one gate, one
health record and one fake clock for tests; written together they come to about 150 lines with no new install step for
the owner. `ctx.cached` + cache.db already does what an HTTP cache would, keyed on parsed data, not raw responses.
Nothing new goes into requirements files, so there was nothing to vet.

## Summary answer

Before: partly. Each module had its own pacing (four separate Schwab/SEC/Yahoo/Alpaca gates), and most sources had none.
There was no shared retry policy, no de-duplication in the helper, three different spellings of share-class tickers,
a dividend-adjusted series spliced onto a split-only one, and no way to see a source failing except in the log. The
browser showed "as of now" on data the helper had served from a week-old saved copy.

After: every outside call goes through one gate per source (pacing, per-minute budget, retries with backoff,
in-flight coalescing, one error type), every cache lookup and call feeds a per-source health record shown in the Data
window and the diagnostics file, every engine reply says which sources and how old its cached inputs were, and three
cross-source checks fill the gaps below.

## Per source

| Source | Caching (before) | Dedup | Pacing / limits | Retries | Normalisation | Provenance / failures |
|---|---|---|---|---|---|---|
| Schwab quotes (REST) | none (polled 30 s) | browser only | **none outside the scanner**; scanner 0.7 s + crosscheck 0.7 s were separate gates, so charts + pages + scanner + crosscheck could exceed the app's 120/min | none | prevClose = last - netChange (good) | errors logged at debug only |
| Schwab history | `daily` 6 h memory; scanner per day in cache.db | browser only | as above | none | split-adjusted, not dividend-adjusted; UTC ms -> s | 401 message good |
| Schwab instruments (CUSIP) | none | none | none | none | – | – |
| Alpaca bars | cache.db, incremental | per symbol lock | own 0.33 s gate | one 429 retry | **`adjustment=all` (splits + dividends) spliced onto Schwab's split-only bars**; saved bars never re-checked after a split | log only |
| Coinbase (browser) | none | – | public, unauthenticated | browser reconnect | BTC-USD | feed health in browser |
| SEC EDGAR (JSON, Form 4, XBRL, Form D, N-PORT, 13F, ADV) | cache.db, day / hour / year, stale_ok | **none in the helper** | shared 0.125 s pacer (good) + 5 at once | none in sec_get (prospect has its own) | share classes via `.`->`-` only (BRK/B missed) | 403/404 messages good |
| FRED | cache.db 1 h, stale_ok | none | 8 at once | CSV 2 tries, API none | dates as text, % values as published | message hides the key (good) |
| CFTC COT | cache.db 6 h, stale_ok | none | none | none | – | – |
| Yahoo dividends / splits | **memory only, two requests per symbol (div, split)**, lost on restart | none | **none** (crosscheck's Yahoo gate was separate) | none | split-adjusted amounts (consistent with Schwab) | **failure returned None silently** |
| Yahoo / Nasdaq crosscheck | cache.db per field, failures remembered 10 min | none | own gates | none (by design) | `.`->`-` | every reading carries source + asOf (good) |
| Treasury (curve CSV, Fiscal Data) | cache.db 1 h stale_ok | none | none | none | dates m/d/Y -> ISO | – |
| FINRA short volume | cache per day | none | none | none | tried `/` and `.` spellings by hand | – |
| Census geocoder | cache per address | none | none | batch loop 3 tries | – | – |
| News RSS / Forex Factory | memory, evicts oldest (good) | none | none | none | – | failed feeds named in the reply (good) |
| Webull | 10 min / 20 s reads | gate | documented per-endpoint spacing (good) | GET 429 x2 (good) | – | orders.log (good) |

Time zones: bars are stored as UTC seconds everywhere (good). Daily bars arrive at 05:00/06:00 UTC = New York
midnight, so converting with a UTC date is right only by luck of the hour; `datahub.ny_date` makes it explicit.
Yahoo's dividend timestamps fall inside the New York trading day, so their UTC date is the ex-date.

Units: crosscheck stores yields as fractions, FRED gives percent, bond maths uses percent. Nothing mixed them in one
reply (checked), but there was no named helper; `datahub.fraction/percent/bp_to_fraction/from_thousands` now exist.

## Defects (before this change)

1. **Schwab rate limit not shared** — `helper/schwab_helper.py:233` (chart history) and `:930` (official quotes),
   `helper/engine/invest.py:73,94`, `research.py:192`, `positioning.py:54`, `ai.py` called Schwab unpaced, while
   `scanner.py:64` and `crosscheck.py:95,440` each kept a private 0.7 s gate. Together they could pass Schwab's
   120 requests/minute and get the whole app throttled. **Fixed**: `ctx.schwab` is `datahub.Routed`; one budget of
   120/min, of which background work (scanner) may use 90.
2. **Alpaca history dividend-adjusted, Schwab not** — `alpaca.py:165` (`adjustment: 'all'`) merged at `alpaca.py:304`
   onto Schwab's split-only bars: older bars sat below Schwab's by the dividends paid since (1-3% steps on long
   charts, also in the scanner's hourly record). **Fixed**: `ADJUSTMENT = 'split'`, new cache key, plus a seam check:
   Alpaca is fetched `SEAM_OVERLAP_DAYS` (3) past Schwab's first bar, r = median close ratio over the overlap (works
   when Alpaca lacks the boundary bar), and beyond 3% the older bars are rescaled to Schwab (prices / r, volume x r).
   The chart history and the scanner's 30-minute record both do this. One-time cache migrations
   (`datahub.run_migrations`, logged, recorded as ('migration', name) rows) delete the old dividend-adjusted
   ('alpaca', symbol, size) rows and the scanner's 'scan-30m' rows that mixed them in (rebuilt on the next scan).
3. **Saved Alpaca bars never re-checked after a split** — `alpaca.py:223` merged new bars onto saved ones without
   comparing the overlap, so a split after saving produced a 2x/4x/10x cliff. **Fixed**: on every request (also one
   served entirely from the saved range) Yahoo's split dates are compared with the series' `built` time; a split
   after it re-downloads the range. `consistent()` also compares overlaps when extending (2% tolerance).
4. **Yahoo dividends memory-only, two requests per symbol, failures silent** — `core.py:234-270`: `('dividends', s)`
   cached in memory only (every restart re-asked Yahoo for every holding), a second identical request for splits, no
   pacing, `except Exception: return None`. **Fixed**: `ctx.yahoo_events` = one request (`events=div,split`), saved in
   cache.db with stale-while-revalidate, paced by the 'yahoo' gate, failures counted in health.
5. **Stale copies shown as fresh** — `core.py:201` serves values up to 7 days past their age while refreshing, but
   the browser stamped every reply with its arrival time (`src/data/health.ts:76`). **Fixed**: every engine reply
   carries `provenance` (`{fetchedAt, stale, sources}`); `replyTime` uses the saved copy's own time when stale, and the
   stamp adds "saved copy, refreshing".
6. **No in-flight de-duplication in the helper** — two tabs (or the browser's prefetch plus a click) asking for the
   same chart or SEC file sent two requests (`schwab_helper.py:233`, `sec.py:41`). **Fixed**: `datahub.call(key=...)`
   joins identical calls; `get()` keys on URL + params + hashed headers.
7. **No retries anywhere except FRED CSV and Alpaca** — a single 502 from the SEC, CFTC or Treasury failed the panel.
   **Fixed**: 429/5xx/network errors retry with exponential backoff (Retry-After honoured, capped 30 s); a 429 pauses
   the whole source.
8. **Share-class spellings** — `sec.py:66` turned `.` into `-` but not `/`; `crosscheck.py:467` and `core.py:237`
   each had their own conversion; `positioning.py:147` tried variants by hand. **Fixed**: `symbols.py` (normalize,
   to_source, lookup) used by sec, crosscheck, core, positioning.
9. **Unbounded memory cache** — `core.py:198,216` (`ctx._cache`) never dropped anything (15-year histories for 100+
   symbols, every SEC file). **Fixed**: `_remember` keeps 3,000 entries, dropping the oldest (disk copies stay).
10. **Failures invisible** — Schwab quote failures logged at debug (`schwab_helper.py:933`); the Data window only knew
    what the browser saw. **Fixed**: per-source health registry -> `data.health` -> Data window "Sources (helper)"
    table and the diagnostics file (`dataSources`).
11. **SEC streamed downloads used a private semaphore** — `prospect.py:1650` reached into `sec._sec_slots`. **Fixed**:
    `datahub.Turn('sec')` shares the SEC gate and its 5-at-once cap.

Left as they are (noted, not defects): Webull keeps its own documented gate (`webull._call`), and the crosscheck keeps
"no retries, remember the failure 10 minutes" on purpose. `ctx.daily_bars` stays memory-only (6 h) because the scanner
already persists its own 15-year copy.

## Aggregation gaps filled (`helper/engine/datacheck.py`, all free)

- **Split check**: `data.splits` compares Yahoo's split list with Schwab's daily closes; a close-to-close jump of about
  the split ratio means Schwab's history isn't adjusted (noted on the Schwab source).
- **Dividend cross-check**: `data.dividends` compares Yahoo's dividends (what total return uses) per fiscal year with
  the company's own 10-K XBRL figure (`CommonStockDividendsPerShareCashPaid`, else `...Declared`), putting the SEC figure
  on today's split basis (only splits after the filing date, since a filing after a split restates the year). Only the small extracted part is cached (`sec-divfacts`).
- **Identifier map**: `data.identifiers` gives a symbol's spellings per source, SEC CIK and name, the company's other
  share classes (same CIK, from the cached SEC ticker list) and the CUSIP from Schwab's instrument data (cached 30 days).
- **Alpaca/Schwab seam**: see defects 2-3.

## The pattern for new code

See "Data hub" in CLAUDE.md. In short: never call `ctx.http.get` for an outside source directly; use
`datahub.get(ctx.http, '<source>', url, params=...)` (or `datahub.call` for a client method), keep caching in
`ctx.cached(...)` with a key whose first part names the source (`datahub.CACHE_PREFIXES`), and return figures that
need a source and date as `datahub.envelope(value, source, as_of)`.
