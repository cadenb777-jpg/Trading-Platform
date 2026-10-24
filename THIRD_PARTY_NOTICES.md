# Third-party notices

This project uses the open-source components below. Each keeps its own licence. Versions are the ones
installed when this file was written (from `package.json`, `helper/requirements.txt` and
`helper/requirements-extra.txt`); update this file when dependencies change.

## TradingView Lightweight Charts (required attribution)

- Package: `lightweight-charts` 5.2.1 (and its dependency `fancy-canvas` 2.1.0, MIT)
- Licence: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Copyright 2023 TradingView, Inc.

Attribution notice (from the library's NOTICE file):

> TradingView Lightweight Charts™
> Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

The licence requires naming TradingView as the product creator and a link to https://www.tradingview.com/
on a page users can see. The charts keep the library's `attributionLogo` (a small TradingView link on each
chart), and this notice is linked from the site footer.

## Browser app (npm)

| Package | Version | Licence | Used for |
|---|---|---|---|
| lightweight-charts | 5.2.1 | Apache-2.0 | Charts (shipped in the site) |
| fancy-canvas | 2.1.0 | MIT | Dependency of lightweight-charts (shipped) |
| fflate | 0.8.3 | MIT | Reading Excel/ZIP imports (shipped) |
| typescript | 7.0.2 | Apache-2.0 | Build tool only (not shipped) |
| vite | 8.3.5 | MIT | Build tool only (not shipped) |
| vitest | 5.0.5 | MIT | Tests only (not shipped) |

## Helper (Python, runs on the owner's computer)

| Package | Version | Licence |
|---|---|---|
| schwab-py | 1.5.1 | MIT |
| websockets | 17.3 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| tzdata | 2026.5 | Apache-2.0 |
| numpy (optional) | 2.5.4 | BSD-3-Clause (bundles 0BSD, MIT, Zlib, CC0-1.0 parts) |
| scipy (optional) | 1.18.1 | BSD-3-Clause |
| anthropic (optional) | 2.1.0 | Apache-2.0 (as stated in the package metadata) |

Their own dependencies (installed by pip) carry their own licences; run `pip-licenses` in the helper's
Python environment for the full list.

## Fonts

Inter and Source Serif 4 are loaded from Google Fonts and are licensed under the SIL Open Font License 1.1.
