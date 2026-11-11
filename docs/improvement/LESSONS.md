# Lessons log

One line per proposal or finding: date · what · outcome (proposed / approved / turned down / rejected by experiment) ·
why. Newest at the bottom. Improvement sessions read this first and don't repeat a turned-down idea without new
evidence.

- 2026-11-11 · Flowing background moved to one small canvas · approved (owner asked) · five window-sized animated
  layers measured ~10 fps scrolling in the desktop app; one canvas measured 60 fps on five pages.
- 2026-11-11 · Charts never wait on Alpaca for older history · approved (owner asked) · diagnostics showed the 1-hour
  chart waiting behind the scanner's Alpaca queue at helper start.
- 2026-11-11 · Self-check every 30 minutes (security, data, accuracy, speed) · approved (owner asked) · first finding
  on the owner's PC: api.nasdaq.com answered 403 to every request (12 of 12) in the 2026-11-10 diagnostics.
- 2026-11-11 · Hidden pages stop hammering the helper (Setups' 5 s re-check only on screen; background warm-up one page
  at a time) · proposed · owner's diagnostics: scanner.results (362 KB) + alerts.list every 5 s from the hidden Setups
  page (91 each in 7 min), speed check failing (slowest 5% = 21.6 s); measured 25 -> 4 requests in 2 min on Home.
  Also seen, not yet fixed: self-check "SPY daily history: days out of order or repeated".
