# Changelog

Versions follow the helper (`HELPER_VERSION` in `helper/schwab_helper.py`). When the helper changes, download the
project ZIP again and restart it.

## Unreleased

- Charts show the TradingView attribution again (required by the Lightweight Charts licence).
- The helper refuses article links that point to your own computer or home network.
- The helper knows NYSE holidays and early-close days for 2026-2027 (no protocol change, but download the helper
  again to get it).
- Settings has an About section: not investment advice, data may be delayed, links to draft legal pages.
- Content Security Policy on the site; `LICENSE`, `THIRD_PARTY_NOTICES.md`; CI runs the helper tests.

## v21 (2026-10-24)

- Optional free Alpaca price history (Settings): about 3 years of 30-minute to 4-hour charts, and hourly history back
  to 2016 for the AI assistant. Market data only, never trading.
- Steadier helper: replies are no longer lost, the disk cache is saved off the main loop and memory use is capped.
- New look: one design system (spacing, type, tables, controls, light and dark), nothing clipped on phones.
- Faster indicators and fewer chart rebuilds.

## v20 (2026-10-23)

- Buys and sells have separate records; each setup is graded on its own side.
- Strategy lab: about 1,500 rule combinations tested walk-forward on data they were not chosen on; only ones that
  keep working (random-entry and overfitting checks) become "Lab:" strategies.

## v19 (2026-10-23)

- New Setups page with three time frames: short swing (hourly), swing (daily) and position (weekly).
- Each stock is judged against its own normal range; COT + z-score edge study; live entry alerts; out-of-sample
  check. The first scan after starting takes a few minutes longer while hourly and weekly history downloads.
