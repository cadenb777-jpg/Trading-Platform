# Companies: a free PitchBook / FINTRX / Aidentified-style prospect database

Goal: every US private business worth prospecting (restaurants, contractors, practices, shops), with who owns and runs
it, its size and an estimated revenue, kept as current as free data allows. Paid tools buy or license most of this;
we assemble it from public sources, each fact with its source and date.

Honest limits: no free source has current revenue for private companies (it is estimated); no free source has personal
emails or mobile numbers for employees (only owners/officers in public filings and names on company websites).

## What each free source adds

| Source | What it gives | How current | Stage |
|---|---|---|---|
| SBA PPP loans $150k+ (data.sba.gov) | ~1M businesses: name, address, NAICS, jobs, payroll (from loan), age, franchise | 2020-2021 snapshot | 1 (done) |
| SBA PPP loans under $150k | ~10M more small businesses (most sole owners / small shops) | 2020-2021 | 1b |
| SBA 7(a) / 504 loans (FOIA, quarterly) | new loans: name, address, NAICS, jobs supported, loan size | updated each quarter (newest) | 2 |
| Overture Maps Places (monthly, open licence) | every storefront: category, phone, website, location, chain size | monthly | 2 |
| State business registries (bulk files: FL Sunbiz, CO, NY, WA, others; OpenCorporates links) | legal entity, status (active/dissolved), formation date, **owners / officers / registered agent** | daily-weekly | 3 |
| DOL Form 5500 (retirement plans, yearly) | employee counts, plan assets, sponsor EIN for firms with a 401(k) | yearly, ~1 year lag | 3 |
| Company websites (the existing contacts reader) | team pages: names and titles, generic emails | when read | 4 |
| USAspending (federal contracts, daily) and city building permits | construction and service contractors' recent work and contract values | daily | 4 |
| SEC Form D / 13D / Form 4 (already in Prospects) | private raises, big owners, liquidity events (Aidentified-style triggers) | daily | linked in 4 |

## Stages

1. **Done (helper 79):** Companies tab on the PPP $150k+ list, revenue estimate from payroll, filters, sorting.
2. **Freshness:** SBA 7(a)/504 quarterly loans + Overture Places; each company shows "last seen" per source, and
   businesses not seen in any source since 2022 are flagged as possibly closed.
3. **People:** state registry owners and officers (Florida's free bulk file first, then other free states), Form 5500
   headcounts; one company page joining every source.
4. **Signals:** websites (team, contact), federal contracts, permits, Form D raises; saved searches with new-match alerts.

Matching between sources: cleaned name + ZIP first, then address, with a confidence label (never silently merged).
