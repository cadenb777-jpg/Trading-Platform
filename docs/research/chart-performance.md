# Chart performance (November 2026)

How fast the Chart page is with a long history, measured before and after the chart engine work
(`src/chart/incremental.ts`, `frame.ts`, `workerClient.ts`, `livePrice.ts`, `hoverCard.ts`).

## How it was measured

Headless Chromium (Playwright, `vite preview` of the production build), 1400×860 window. The helper's WebSocket was
replaced by a fake that answers `history` with **5,000 five-minute bars** and streams trades on request, so the numbers
don't depend on the network. Ten indicators: Volume, SMA, EMA, Bollinger Bands, VWAP, RSI, MACD, ATR, Stochastic,
Bullish/Bearish Engulfing (signals). "Work per frame" is the time spent inside animation-frame callbacks (the app's
and the chart library's), summed per frame. Software rendering, so absolute numbers are higher than on a real GPU;
compare before with after.

| | Before | After |
| --- | --- | --- |
| Symbol switch to first paint (median of 5) | 292 ms | 249 ms |
| Live ticks (one trade every 16 ms for 3 s): work per frame, median | 38.5 ms | 9.7 ms |
| Live ticks: work per frame, mean / p95 | 40.4 / 50.6 ms | 16.5 / 41.4 ms |
| Crosshair move: work per frame, median / p95 | 2.0 / 6.6 ms | 1.3 / 7.4 ms (now also draws the hover card) |
| Pan (drag): median / p95 | 3.5 / 7.7 ms | 0.1 / 6.3 ms (kinetic scrolling adds cheap glide frames) |
| Zoom (wheel): median / p95 | 3.1 / 4.9 ms | 0.1 / 4.4 ms |
| Heap after 20 symbol switches (after GC) | 29.5 → 29.6 MB | 30.1 → 30.0 MB (no growth, 23 canvases before and after) |

Indicator maths alone (Node, same 10 indicators, 5,000 bars): full recompute 6.6 ms per tick, tail recompute 1.15 ms
per tick (1,997 of 2,000 updates took the fast path).

## What made the difference

- **Tail recompute on live ticks** (`incremental.ts`): indicators are recomputed on the last 512 bars and checked
  against the stored values where the bars didn't change; only if they agree are the new values spliced in, otherwise a
  full recompute runs and the window doubles. Tested against a full recompute for every built-in indicator
  (`incremental.test.ts`, 416 indicators x 12 trades; equal within 1e-9 relative, the rounding of running sums).
  Cumulative lines (OBV) and very long EMAs end up always recomputing in full, which is always correct.
- **Indicator lines follow ticks at most every 100 ms.** The profile showed the chart library rebuilding each
  series' whole point list (5,000 objects) on every `update()`, so 20 indicator series updated every frame cost
  ~30 ms of mostly garbage collection. The candle and the animated last price still move every frame. The p95 that
  remains is the frame where the indicators catch up.
- **Signals are re-collected only when one changed**, legend numbers update in place (no DOM rebuild, at most once per
  frame), and crosshair moves never re-check the legend layout.
- **Heavy indicators run in a Web Worker** on histories of 2,000+ bars (`workerClient.ts`, protocol in
  `workerProtocol.ts`). The slowest built-ins take 100-230 ms on 5,000 bars (VaR/CVaR, ACP, DFT cycle, all candle
  patterns, percentile bands); they no longer freeze the page on load. Each indicator's cost per bar is measured, so
  the cheap ones (almost all) stay synchronous.
- **Restyling is cheap and rare**: changing colours or visibility restyles series instead of recomputing; the hover
  highlight is one restyle (no per-frame option tweens, which made the library rebuild every series each frame:
  22 ms per crosshair frame in a first attempt).

## Re-running

`npm run build`, `npx vite preview --port 4391`, then `node docs/research/chart-bench.mjs http://127.0.0.1:4391/ label`
(needs Playwright and Chromium; edit the two paths at the top for your machine). `PROFILE=1` prints the functions
that take the most time during ticks and crosshair moves.
