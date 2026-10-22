# Notes for Claude

The owner is a beginner. Explain changes in plain language, keep steps small, and prefer free services.

## Stack

- Vite + TypeScript, no UI framework (plain DOM via the `h()` helper in `src/ui/dom.ts`).
- Charts: `lightweight-charts` v5 (panes API: `chart.addSeries(def, opts, paneIndex)`, `pane.addSeries`).
- Static site, deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.
- No server backend. The chart layout lives in localStorage (`src/storage.ts`). Market data: Coinbase (crypto,
  public, no key) and Schwab (stocks, via the helper). Secrets never go in the repo or the browser.
- `helper/schwab_helper.py` runs on the owner's computer (schwab-py). It serves history and live
  trades to `src/data/schwab.ts` over `ws://127.0.0.1:8765` (JSON messages: history, subscribe,
  unsubscribe, status, trade, error). Its keys and token live in `~/.trading-platform/`.
  It is market-data only: never add order placement to it (the Schwab app's order limit is 0).
  Trading is planned through Webull.

## Conventions

- Indicators are data-driven: one `IndicatorDef` per entry in `src/indicators/library.ts`.
  `compute()` returns arrays aligned with the bars, `NaN` for warm-up.
- Data providers implement `DataProvider` (`src/data/provider.ts`): `loadHistory` returns bars,
  `subscribe` streams trades; `applyTrade` in `src/types.ts` folds trades into bars.
- Bar `time` is UTC unix seconds.

## Commands

- `npm test` runs vitest (indicator maths against reference values).
- `npm run build` type-checks and builds to `dist/`.

## Planned

Later stages (trading via Webull, AI agents) will need a small backend so secrets are
not exposed in the browser. Real-money trading must stay behind explicit confirmation, and
paper trading comes first.
