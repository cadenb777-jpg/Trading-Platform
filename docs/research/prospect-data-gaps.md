# Prospecting data: gaps, causes and fixes

The owner reported that "Download everything" on the Prospecting Data tab never reached 100% and that data seemed to
be missing. This note lists each gap, why it happened, what was changed, and what public data can never show.
Code: `helper/engine/prospect.py` (core ingest) and `helper/engine/prospect_iapd.py` (IAPD PDFs and state advisers).
Tests: `helper/tests/test_prospect_complete.py`.

## Reliability (why it never reached 100%)

| Gap | Cause | Fix |
| --- | --- | --- |
| R1. One failure stopped everything | `run_ingest('all')` only caught a layout change (`HeaderError`). A download that failed after 5 tries, an SEC 403/404 or a worker crash aborted the run, so the later sources (13F, Form D, map locations) never ran | Every source's error is caught and kept (meta `result:<source>`: ok, reason, what to do, when). The rest carry on; the run ends "Done with problems". `prospect.ingest {source: 'failed'}` and the "Retry failed sources" button run only the failed ones |
| R2. Retries started over | Only a half-finished download resumed. A finished download was deleted even when loading it failed, and nothing remembered which files were loaded, so a retry fetched multi-GB files again | Each file loaded is remembered (meta `files:<source>`) and skipped next time. A file that downloaded but didn't load stays on disk and is reused. The `.part` resume is kept |
| R3. No overall progress | Only the current stage's text was shown | `job.overall` (0-100), weighted by stage (`STAGES`): finished stages count in full, the current one by files done plus how far into the file (download about 70%, reading about 30%). It reaches 100 at the end. Each source shows Done / Failed / Not downloaded / Out of date |
| R4. Map locations failed silently | A Census batch that failed 3 times was skipped with no record | Failed batches are saved as `failed:N` in `geocache` and retried on the next 3 runs, then left on their ZIP centre. The tab reports "x of y located by address, z by ZIP only, w no usable US address (foreign or missing)". It never blocks the other sources |
| R5. No way to see what was dropped | Loaders returned only a count | Each loader returns a check: rows in the source file, rows loaded, rows skipped by reason (no CRD, duplicate, older filing, owner is a company, not a fund or family office, replaced by a later report). Shown as "Loaded 15,312 of 15,340 advisers; 28 skipped: no CRD" |

## Coverage

| Gap | Cause | Fix |
| --- | --- | --- |
| C1. Funds missing from Form D | Only the newest quarterly data set was loaded, so a fund whose last Form D or amendment came in an earlier quarter was missing | The last 12 quarters (3 years) are loaded, oldest first. One offering per issuer CIK is kept: the newest filing wins, in any load order (`dedupe_formd`) |
| C2. No AUM trend; notice filers unclear | 13F kept 2 quarters of everything | Filer-level facts (manager, total value, positions, quarter) are kept for 8 quarters (`filer_history_13f`), full positions for 2 only (about 3 million rows a quarter). 13F-NT filers are kept, and the managers named in their `OTHERMANAGER` table are shown as "holdings reported by ..." |
| C3. People and private funds stuck at Dec 2024 | The SEC's bulk Form ADV data (Schedule A/B and 7.B.(1)) ended in Dec 2024 | For each SEC-registered adviser whose roster filing is newer than its bulk filing (or missing from it), the public Form ADV Part 1 PDF on IAPD is read (pypdf): Schedule A (name, title, date acquired, ownership code, CRD) and Section 7.B.(1) (fund name, 805- ID, type, gross asset value, beneficial owners). Source "Form ADV Part 1 (IAPD PDF)" with the filing date. Background, 1 request every 2 seconds, honest User-Agent with the SEC contact; saved firms first, then firms opened, then by AUM. Firms it can't read are listed ("couldn't read Schedule A"). A later bulk load never overwrites newer PDF facts |
| C4. State-registered advisers missing | The SEC rosters list only SEC-registered and exempt advisers; about 15,000 smaller RIAs register with their state | Source `state`: the IAPD firm search (api.adviserinfo.sec.gov/search/firm), page by page per state, 1 request every 2 seconds, pages cached a week, resumable per state. Active advisers with no 801-/802- number and not in the SEC lists become "State-registered RIA" (name, CRD, main office). **Beta**: the endpoint has no public documentation |
| C5. No brochure link | - | The profile's Sources list links the IAPD brochure page (Form ADV Part 2) and the Form ADV Part 1 PDF (links only) |
| C6. Limits not stated | - | The Data tab lists, in plain words, what public data can't show (below) |

## Not verified live

The build sandbox could not reach adviserinfo.sec.gov, so two adapters are written from the documented Form ADV
layout and how IAPD behaves, and tested on hand-made fixtures only:

- **Form ADV PDF parser.** Assumes pypdf text with Schedule A rows as "NAME DE/FE/I TITLE MM/YYYY CODE Y/N Y/N CRD"
  (rows the PDF wraps over several lines are joined), Section 7.B.(1) labels from the form ("Name of the private
  fund", "Current gross asset value of the private fund", "Approximate number of the private fund's beneficial
  owners") and IAPD's checked-box glyphs (`nmlkji`, `gfedcb`) for the fund type. The self-check reports each firm it
  can't read, never silently. Check a few profiles against IAPD after the first run.
- **State-adviser search.** Parameters (`query`, `state`, `filter=active=true,ia=true`, `nrows`, `start`) and reply
  fields (`hits.hits[]._source.firm_source_id`, `firm_name`, `firm_ia_scope`, `firm_ia_full_sec_number`,
  `firm_address_details`) were not confirmed. The first page's shape is checked, and so is the state filter (if most
  firms on a state's page are from other states, it stops). A different shape fails only this source, with a clear
  message; everything else still downloads.

## What stays impossible (doesn't file = not in public data)

- Single-family offices are exempt from adviser registration (Rule 202(a)(11)(G)-1), so they file no Form ADV. They
  show up only if they file 13F ($100M+ in listed US securities) or Form D (a private offering).
- Firms below 13F's $100M threshold don't file 13F, so they have no holdings or 13F trend.
- Emails, direct lines, biographies, net worth and investment preferences are not in any filing.
- State-registered advisers' AUM and client mix sit inside each firm's own Form ADV (on IAPD), not in the search
  results; this build shows name, CRD and main office for them.
- Data only changes when a firm files: an adviser that hasn't filed since its last annual amendment shows that filing.
