# Free data keys

Every key below is free (except the Anthropic AI key, which is pay-as-you-go). Paste each one into
**Settings > Data connections**. The helper saves it in `~/.trading-platform/settings.json` on your computer; it is
never stored in the browser, never sent back to the page, and only goes to its own website. As soon as a key is
saved, the matching features switch on: no restart, no other steps. Each row has a **Test** button that makes one
small real request and shows ✓ connected or ✗ the reason.

Limits were taken from each provider's own documentation (November 2026); providers can change them.

| Connection | Where to sign up | Free-tier limit | What it unlocks | Needed? |
| --- | --- | --- | --- | --- |
| FRED (St. Louis Fed) | https://fredaccount.stlouisfed.org/apikeys | 120 requests a minute | Faster, more reliable Macro dashboard and bond data (it already works without a key through FRED's CSV download) | Optional |
| BEA (Bureau of Economic Analysis) | https://apps.bea.gov/API/signup/ (the key, called a UserID, arrives by email) | 100 requests, 100 MB and 30 errors a minute | Macro > World: US GDP by component (contributions to growth) and the PCE price index (headline and core) | Required for those panels |
| BLS (Bureau of Labor Statistics) | https://data.bls.gov/registrationEngine/ | With key (API v2): 500 requests a day, 50 series per request, 20 years. Without (v1): 25 requests a day, 25 series, 10 years | Macro > World works without it (CPI components, wages, JOLTS, payrolls). The key adds more series (medical care, apparel, hours, hires, layoffs, construction, leisure) and the higher limit | Optional |
| EIA (Energy Information Administration) | https://www.eia.gov/opendata/register.php | Free; EIA may slow down very heavy use (no fixed daily cap published) | Macro > World: weekly crude and gasoline inventories, WTI spot and US pump prices | Required for that panel |
| Census (US Census Bureau) | https://api.census.gov/data/key_signup.html | Without key: 500 requests a day per computer. With key: no daily cap for normal use | Macro > World: retail sales (total and ex autos). Works without a key; the key lifts the daily limit | Optional |
| Finnhub | https://finnhub.io/register | 60 requests a minute (free plan) | Analyst buy/hold/sell trends on a stock's overview (DES tab) and an earnings calendar on the Calendar page; fills the next-earnings date for stocks the scanner does not cover | Required for those |
| Alpaca | https://app.alpaca.markets/signup (then Home > API Keys > Generate) | 200 requests a minute (free Basic plan) | Intraday price history back to 2016 for charts, the hourly Setups scanner and the AI. Market data only; the platform never trades through Alpaca | Optional |
| Anthropic (AI) | https://console.anthropic.com/settings/keys | Not free: pay as you go (add a little credit under Billing) | The AI assistant, AI summary buttons and PDF statement reading | Needed for AI only |
| SEC EDGAR | No key. https://www.sec.gov/os/accessing-edgar-data | Up to 10 requests a second; the SEC asks for a contact email | Company financials, insider trades, 13F holders, fund filings (enter your email in the same section) | Email needed |

## Already working, no key needed

- **World Bank** indicators API: GDP growth, inflation, unemployment and government debt for 14 major economies.
- **IMF DataMapper**: World Economic Outlook forecasts of GDP growth and inflation (this year and next).
- **OECD** SDMX: composite leading indicators (CLI) and their cycle phase. The OECD asks for few requests (about 20 an
  hour per address), so the helper keeps a day's copy.
- **ECB** Data Portal: deposit and main refinancing rates, euro-area HICP (headline and core) and the EUR/USD
  reference rate.
- **US Treasury** Fiscal Data: debt to the penny, the Treasury General Account cash balance and auction results.
- **SEC** EDGAR (with the contact email above).
- **Polymarket** (public Gamma API) and **Kalshi** (public market data): prediction-market odds for Fed decisions,
  macro releases and politics. Read only: the platform never places bets or trades.

## How it fits together

- Helper modules: `helper/engine/worldmacro.py` (World Bank, IMF, OECD, BLS, BEA, Census, Treasury, ECB, EIA),
  `helper/engine/predictions.py` (Polymarket, Kalshi), `helper/engine/finnhub.py` and
  `helper/engine/connections.py` (the Test buttons). Every download is cached in `~/.trading-platform/cache.db`.
- Requests: `world.table`, `world.panel {panel}`, `world.sources`, `predictions.markets`, `finnhub.recommendations`,
  `finnhub.earnings`, `connections.test {connection}`. They need helper version 44 (`WORLD_HELPER_VERSION`); older
  helpers keep everything else working and show an update note on these panels.
- Libraries: plain `httpx` requests written from each provider's public API documentation. No code was taken from
  Fincept Terminal (AGPL); its connector list only suggested which free sources exist.
