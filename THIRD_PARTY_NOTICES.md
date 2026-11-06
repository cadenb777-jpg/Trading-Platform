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
on a page users can see. The charts turn the library's `attributionLogo` off (the owner wants no watermark on
the charts); the attribution is given instead in Settings → About ("Charts by TradingView Lightweight Charts™",
linking to https://www.tradingview.com/) and in this notice, which Settings → About also links.

## Browser app (npm)

| Package | Version | Licence | Used for |
|---|---|---|---|
| lightweight-charts | 5.2.1 | Apache-2.0 | Charts (shipped in the site) |
| fancy-canvas | 2.1.0 | MIT | Dependency of lightweight-charts (shipped) |
| fflate | 0.8.3 | MIT | Reading Excel/ZIP imports (shipped) |
| katex | 0.19.0 | MIT | Maths (LaTeX) in Equilibrium-Prime answers, loaded only on the Strategy Lab (shipped) |
| commander | 15.0.0 | MIT | Dependency of katex (its command-line tool only; not shipped) |
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
| nashpy (optional) | 0.0.43 | MIT (pulls networkx 3.7 BSD-3-Clause, Deprecated 3.0.1 MIT, wrapt 2.5.2 BSD-2-Clause) |

Their own dependencies (installed by pip) carry their own licences; run `pip-licenses` in the helper's
Python environment for the full list.

## Fonts

Inter and Source Serif 4 are loaded from Google Fonts and are licensed under the SIL Open Font License 1.1.

## Agent skills in .claude/skills (instructions for Claude Code, not shipped on the website)

- `frontend-design`, `webapp-testing`: from github.com/anthropics/skills, Apache License 2.0 (LICENSE.txt in each folder).
- `unslop`: by Damir Sokolovsky (@heydamir, https://heydamir.design/unslop), from github.com/heydamir/unslop,
  licensed CC BY 4.0 (LICENSE in the folder). Unmodified except the `agents/` folder (OpenAI agent config) was left out.
- `fin-*` (comps, DCF, LBO, 3-statement models; earnings analysis/preview, morning note, catalyst calendar, thesis
  tracker, sector overview, idea generation) and `ria-*` (client review, client report, investment proposal): from
  github.com/anthropics/financial-services (Anthropic FSI), Apache License 2.0 (`.claude/skills/_licenses`). Copied
  as written methods only; the plugins' data-vendor connections (`.mcp.json`) were left out (this platform uses free
  data). Folders renamed with a prefix; the `name:` line follows the folder.
- `eng-*` (architecture, code review, testing, secure code, TypeScript, Python, debugging, WebSocket, Playwright):
  from github.com/Jeffallan/claude-skills, MIT (`.claude/skills/_licenses`). Renamed with a prefix.
