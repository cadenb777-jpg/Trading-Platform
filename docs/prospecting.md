# Prospecting data (RIAs and family offices)

An in-house prospecting database, built by the helper (`helper/engine/prospect.py`) from free public data only.
It lives in its own file, `~/.trading-platform/prospect.db`, so the main database stays small. Nothing is invented:
a figure that is not in a filing stays empty. The Prospecting page (`#prospect`, Business > Prospects) searches, maps
and compares it.

## Sources

| Source | What it gives | File | Refresh |
| --- | --- | --- | --- |
| SEC monthly adviser lists ("Information about Registered Investment Advisers and Exempt Reporting Advisers") | Every SEC-registered adviser (RIA) and exempt reporting adviser (ERA): CRD, SEC number, legal and business name, main office address, phone, website, latest Form ADV date; for RIAs Item 5: employees, regulatory AUM (discretionary / non-discretionary / total), accounts, clients and assets by client type (5.D), how they are paid (5.E) | `ia{MMDDYY}.zip` and `ia{MMDDYY}-exempt.zip` (CSV or a workbook, Windows-1252) | Monthly. The first download also loads up to 4 older lists about a quarter apart, for the AUM history |
| SEC Form ADV data (the fuller FOIA files) | Schedule A (direct owners and executive officers, with title) and Schedule B (indirect owners); Schedule D 7.B.(1) private funds: name, 805- ID, type, gross asset value, beneficial owners. Only each adviser's latest filing is kept | Large zip (about 1 GB), tables `IA_ADV_Base_A`, `IA_Schedule_A_B`, `IA_Schedule_D_7B1` (and `ERA_` versions) joined by `FilingID` | Checked monthly. Every release from the 12 months up to the newest is loaded (each quarterly release holds only that quarter's filings) and the latest filing per CRD across them is kept. The bulk data ended at 31 Dec 2024 when this was built, so `prospect.status` shows "People and private funds as of <date>" (`peopleAsOf`, `peopleNote`) |
| SEC Form 13F data sets | Every manager with $100M+ in 13(f) securities: cover page (name, address, CRD and SEC file number since 2023), signature (name, title, phone), other included managers, and every position (CUSIP, issuer, class, value, shares, put/call, discretion) | Zips of TSV files: `SUBMISSION`, `COVERPAGE`, `SUMMARYPAGE`, `INFOTABLE`, `SIGNATURE`, `OTHERMANAGER` (managers that report for a 13F-NT filer), `OTHERMANAGER2` (managers included in a report) | Quarterly (looked for monthly). The 8 newest data sets are loaded: filer-level facts (manager, total value, positions count, quarter) for all 8 (`filer_history_13f`, the AUM trend), full positions for the newest 2 only. Notice filers (13F-NT) are kept and labelled "holdings reported by <other manager>" |
| SEC Form D data sets | Private offerings of pooled investment funds (and any other issuer only when its name clearly says family office): amounts, investors, minimum; related persons (executive officers, directors, promoters) with the filer's own description | Zips of TSV files: `FORMDSUBMISSION`, `ISSUERS`, `OFFERING`, `RELATEDPERSONS` | Quarterly (looked for monthly). The last 12 quarters (3 years) are loaded oldest first; one offering per issuer CIK, the newest filing or amendment wins (`dedupe_formd`) |
| IAPD Form ADV Part 1 PDFs (`reports.adviserinfo.sec.gov/reports/ADV/{crd}/PDF/{crd}.pdf`) | For SEC-registered advisers whose roster filing is newer than their bulk Form ADV filing (or missing from it): Schedule A (name, title, date acquired, ownership code, CRD) and Section 7.B.(1) funds. Facts carry the source "Form ADV Part 1 (IAPD PDF)" and the filing date | One PDF per firm, read with `pypdf` (requirements-extra.txt) | Background task (`prospect_iapd.pdf_loop`), 1 request every 2 s. Saved firms and firms you open are read automatically; every other firm (by AUM, about 8 hours) only after you press "Read current Form ADV for all firms" (Pause / Resume). A failed fetch is retried after 1 h, 6 h and 24 h (count reset when the firm files again); 403/429 or a whole failed batch pauses the reader 30 minutes. Unverified live |
| IAPD firm search (`api.adviserinfo.sec.gov/search/firm`) | State-registered advisers (registered with a state, not the SEC): name, CRD, main office | JSON pages, per state | Monthly, source `state` (beta: undocumented endpoint; shape and state filter are checked on the first page) |
| US Census Bureau | Batch geocoder (address -> latitude/longitude; free, no key) and ZIP (ZCTA) centre points | `geocoder/locations/addressbatch`, Gazetteer ZCTA file | After each adviser download (only new addresses) |

Single Form D filings shown elsewhere in the platform still come from `alts.py` (`alts.form_d`), which now also keeps
each related person's own description as `title`.

### 13F value units

Filings submitted from 3 January 2023 report `VALUE` to the nearest dollar; earlier filings reported thousands of
dollars. Every value is stored in dollars: older filings are multiplied by 1,000 (`value_multiplier`, by filing date).

### Amendments

For each filer and quarter: an original 13F-HR or a "RESTATEMENT" amendment replaces what came before; a
"NEW HOLDINGS" amendment adds to it. A 13F-NT (notice) has no positions of its own.

## Tables (prospect.db) and expected sizes

| Table | Rows (roughly) |
| --- | --- |
| `adv_firms` | ~15,000 RIAs + ~6,000 ERAs |
| `adv_history` | one row per RIA per loaded monthly list (~75,000 after the first download) |
| `people` | Schedule A/B individuals (~150,000), 13F signatures (~10,000), Form D related persons (~10,000 a quarter) |
| `private_funds` | ~60,000 funds |
| `filers_13f` | ~10,000 managers |
| `filer_history_13f` | one row per manager per quarter, 8 quarters (total value, positions) |
| `adv_filings` | per adviser: bulk Form ADV filing date and what the IAPD PDF reader found (`ok`, `unreadable`, `failed`) |
| `holdings_13f` | ~3 million a quarter, two quarters kept (the database grows to roughly 1-2 GB) |
| `formd_offerings` | ~5,000 fund offerings a quarter |
| `firms`, `links` | one firm per organization (~30,000) and one link per source record |
| `cusip_map` | CUSIP -> ticker/CIK for issuers whose 13F name exactly matches one company in the SEC ticker list |
| `geocache`, `zcta` | one row per address; ~33,000 ZIP centres |

Downloads go to `~/.trading-platform/prospect-downloads/` and are deleted after loading. A partly downloaded file is
resumed (HTTP Range) next time; a fully downloaded file that hasn't loaded yet stays and is reused; every file loaded is
remembered (meta `files:<source>`), so a retry skips it.

## Reliability: every source finishes or says why

- `prospect.ingest {source: 'all'}` runs adviser lists, Form ADV data, 13F, Form D, state advisers, matching and map
  locations. Each source's error is caught and kept (meta `result:<source>` = ok, reason, what to do, when); the
  others carry on, and the run ends "Done" or "Done with problems". `{source: 'failed'}` retries only the failed ones
  (then matching and map locations).
- One overall figure (`prospect.status` `job.overall`, 0-100) weighted by stage (`STAGES`), plus the stage in hand.
- Completeness per source (`checks`): rows in the source file vs rows loaded vs rows skipped with the reason (no CRD,
  duplicate, older filing, owner is a company, not a fund...), e.g. "Loaded 15,312 of 15,340 advisers; 28 skipped: no CRD".
- Map locations: a Census batch that fails is remembered (`geocache.status = failed:N`) and retried on the next 3 runs;
  `geo` reports "x of y located by address, z by ZIP only, w no usable US address (foreign or missing)".
- The Data tab shows each source as Done / Failed (why, what to do) / Not downloaded / Out of date, a "Retry failed
  sources" button and the limits of public data. Gaps and what can't be fixed: docs/research/prospect-data-gaps.md.

## Matching the same organization across sources

1. Exact identifiers: the 13F cover page's CRD number or SEC file number (801-) against Form ADV; CIK between 13F and
   Form D. Score 1.0.
2. A Form D fund whose name equals one adviser's Schedule D 7.B.(1) fund name is linked to that adviser (0.9).
3. Otherwise normalized name (suffixes like LLC/LP/Inc and EDGAR's "/DE/" removed) plus address: half character
   similarity, half shared words, +0.05 for the same ZIP, +0.03 for the same city, -0.15 for a different state.
   0.92 or more merges the records only when they also share a ZIP, or a city and state; anything else from 0.80 up
   is shown as a "possible" match and not merged.

Every link is stored with its method and score and shown on the firm profile.

## Classifier

Each firm gets one type, a confidence word and the reasons. Facts from a filing say "from filing"; family-office labels
are never more than "strong signals".

- **Registered RIA**: files Form ADV as an SEC-registered adviser.
- **Exempt reporting adviser**: files Form ADV as an ERA (private fund or venture capital advisers).
- **Multi-family office**: an RIA whose name says "multi-family" or "family office" (strong with a family-like client
  mix, otherwise moderate), or whose name has another family word plus a family-like client mix (moderate), or two
  client-mix signals without a name hint (weak). Client-mix signals (Item 5.D): at least half of clients are
  high-net-worth individuals; 150 clients or fewer averaging $20M+ each.
- **Likely family office**: a 13F filer with no matching Form ADV whose name says family office (or similar: family
  capital/investments/holdings/partners/ventures/trust...), strong; a weaker hint (Holdings, Investments, Ventures,
  "& Sons", "family"), weak. Single-family offices are excluded from adviser registration by Rule 202(a)(11)(G)-1 but
  must still file 13F once they hold $100M+ in 13(f) securities. A Form D issuer named "family office" with no ADV or
  13F is also listed here (moderate).
- **Other 13F filer**: a 13F filer with no Form ADV that looks like a bank, insurer, pension, university, foundation or
  government body by name (moderate), or has no signals at all (unknown: could be any of those, a corporation, a
  foreign manager, a state-registered adviser or a family office).

## Requests (helper protocol, engine type)

- `prospect.status`: row counts, firm types, each source's last download and file date, any running job and progress.
- `prospect.ingest {source: adv|adv_full|13f|formd|state|geo|all|failed, wait?}`: runs in the background (watch
  `prospect.status`), or with `wait` streams progress as `engine_event`s and replies at the end. The firm list is
  rebuilt after the sources. Needs the SEC email in Settings.
- `prospect.adv_pdf {firmId}`: reads that adviser's Form ADV Part 1 PDF from IAPD now -> `{status, note, people, funds}`.
- `prospect.status` also has `results`, `checks`, `geo`, `advPdf` (PDF reader progress and firms it couldn't read).
- `prospect.search {text, types[] (not `type`: reserved), state, city, zip, near:{lat,lon,miles} | {zip,miles}, aumMin, aumMax, clientTypes[],
  holds:{symbol|cusip}, minPosition, has13f, hasPrivateFunds, sort, limit, offset}`: `text` also matches people's
  names, CRD and CIK; radius search uses a bounding box then exact great-circle distance.
- `prospect.firm {firmId}` (`id` is reserved in helper messages): identifiers and links, AUM history, people (with
  titles, source and a flag for CIO / portfolio manager titles), private funds, latest 13F positions with weights and
  quarter-on-quarter changes (new / added / trimmed / exited, by share count, 1% tolerance), sector mix (SEC SIC codes
  for up to 40 mapped issuers, cached), turnover, other included managers, linked Form D offerings, and links to IAPD and
  EDGAR.
- `prospect.compare {ids: 2-5}`: AUM, discretionary AUM, clients and mix, AUM per client, fee types, private funds, 13F
  overlap per pair (sum of the smaller weight of each shared holding), largest weight differences, shared holdings,
  sector mix, turnover (half the sum of absolute weight changes between the two quarters).
- `prospect.export {query}`: the same filters as search, up to 5,000 rows as CSV text.
- `prospect.geocode {address}`: a ZIP (its centre, from the loaded ZIP file) or a US street address (free Census one-line
  geocoder) -> `{lat, lon, label, method}`, for "within N miles of an address".
- Search rows (pages of 500 or fewer) carry `topPeople`: up to 3 names and titles, CIO / portfolio manager titles first.

Saved searches and per-firm notes with outreach status are store collections `prospect_searches` and `prospect_notes`.

## Header self-check

Before anything from a download is saved, its column names are compared with the ones the parser reads
(`EXPECTED` in prospect.py). A missing required column fails that source with a clear message and saves nothing from
the file (with `all`, the other sources still run). Every check (missing required, missing optional and unexpected
columns, per file) is kept in `prospect.status` (`headers`) and in the Send diagnostics file (`prospect` section), so
the first real download says exactly what to change.

## Export

`prospect.export` writes CSV; a cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet
never runs it as a formula.

## Being polite to the SEC

The SEC asks automated tools to send a contact email in the User-Agent (the helper sends "TradingPlatform personal
research <your SEC email>") and to stay under 10 requests a second. This module waits 0.2 s between its SEC requests,
downloads one file at a time uncompressed (`Accept-Encoding: identity`, so resumed byte ranges and progress are
exact), retries 429/5xx and dropped connections with growing waits (2, 4, 8... seconds, honouring
Retry-After), resumes partial files, and stops on a 403 (wrong SEC email, or the SEC's rate limit: wait 10 minutes). The background schedule only refreshes sources you have
downloaded yourself, and only when the SEC page lists a newer file.

## What was not verified live

This sandbox could not reach sec.gov or census.gov. The parsers were built from documented schemas and third-party
descriptions and are tested on small hand-made files (`helper/tests/fixtures/prospect/`). Not yet checked against the
real files:

- the exact file names and links on the four SEC pages (the code reads every `.zip` link and picks by the date in its name);
- the Form ADV FOIA table and column names (`FilingID`, `Full Legal Name`, `Title or Status`, `DE/FE/I`, `Fund Name`,
  `Gross Asset Value`...): column names are matched loosely (case, spaces and punctuation ignored, several aliases);
- the monthly list's address column names other than city/state/postal code/phone/website;
- the Census batch reply layout and the Gazetteer file name;
- the IAPD Form ADV PDF text layout (Schedule A rows, Section 7.B.(1) labels, checked-box glyphs `nmlkji`/`gfedcb`):
  the parser follows the documented form; a firm it can't read is listed as "couldn't read Schedule A";
- the IAPD firm search parameters (`state`, `filter`, `nrows`, `start`) and reply fields (`hits.hits[]._source.firm_source_id`,
  `firm_name`, `firm_ia_scope`, `firm_ia_full_sec_number`, `firm_address_details`), from how the website behaves.

The first real download will show any column the parser couldn't find as empty fields; check `prospect.status` counts
after it.

## What FINTRX has that public SEC data can't provide

- Single-family offices that never file 13F or Form D (most of them: below $100M in listed securities, or holding
  private assets only) are invisible in public data.
- Direct emails, direct phone lines, LinkedIn profiles, biographies and org charts of people; only the names and titles
  in filings are public (Schedule A lists owners and executive officers, not the whole investment team).
- Family wealth origin, net worth estimates, investment preferences (asset classes, ticket sizes, direct deals),
  co-investment history and private-market holdings.
- Researched contact changes and news alerts; public data only changes when a firm files.
- Brochure (Form ADV Part 2) text: it is a PDF per firm, not part of the bulk data, so multi-family-office signals here
  come from names and client mix only. The profile links to the brochure page on IAPD.
- State-registered advisers come from the IAPD firm search (beta): name, CRD and main office only (no AUM or client
  mix: those are in each firm's own Form ADV on IAPD).
