# Chart look: what we restyle, and what the chart library still decides

The owner wants the charts to read as a floor trader's tool (Bloomberg's ordered header, square grid and axes),
not as stock TradingView Lightweight Charts. This note lists what the platform now draws or styles itself, what the
library (lightweight-charts 5.2.1, Apache-2.0) still controls, and how a custom renderer could take over the rest.

## Ours now

| Part | How | Where |
|---|---|---|
| No library logo | `layout.attributionLogo: false` on every chart (`followTheme`); attribution in Settings > About and THIRD_PARTY_NOTICES.md | `src/ui/theme.ts` |
| Fonts | Inter on both axes; digits from a tabular-figure system font via a digits-only `@font-face` ("TP Figures"), because a canvas cannot switch on Inter's `tnum` | `src/chart/chartFeel.css`, `CHART_FONT` |
| Last-price tag | Our own bold rounded tag on the price axis (green/red by the last candle, no flash), drawn by a series primitive; the library's label is off, its dashed price line stays | `ChartChrome` in `src/chart/axisChrome.ts` |
| Time axis | Our own labels drawn at our vertical grid lines (years, months, dates, 24-hour times), the year on a second row under the first label of each year; the library's time labels are blanked | `src/chart/grid.ts` |
| Crosshair | Label format "Thu 05 Nov 14:35" (daily: "Thu 05 Nov 2026"); label boxes in the theme's `axisLabel` colour | `crosshairLabel`, `chartThemeOptions` |
| Grid | Our square dotted grid on every chart (library grid off): crisp 1-device-pixel dots every 4px, pixel-aligned; horizontal lines at the price axis' own steps (the library's tick maths, re-implemented in `priceTickSpan`), vertical lines at the calendar level whose spacing is closest to it, so cells are near square. Checked by a Playwright pixel-sampling script | `src/chart/grid.ts`, attached by `followTheme` |
| Frame and separators | Axis lines and pane separators in the theme's `frame` colour, separator hover in the accent; a 1px inset frame round the chart | `theme.ts`, `chartFeel.css` |
| Volume | A slim histogram in its own sub-pane (a sixth of the price pane) with its own axis and a pane label | `ChartView.addIndicator` |
| Session separators | A thin vertical line at each New York day open on intraday stock charts | `ChartChrome.drawSessions` |
| Header row | Symbol, last with arrow, change and %, At, Op, Hi, Lo, day range, previous close, volume, relative volume, dollar value, VWAP distance, session clock | `src/chart/securityHeader.ts` |
| Range bar | 1D 3D 1M 6M YTD 1Y 5Y Max, remembered per timeframe, fetches more history when needed | `src/chart/rangeBar.ts`, `range.ts` |
| Legend box | Translucent card: last, high/low with dates, average for the bars on screen, then indicators | `src/chart/legendBox.ts` |
| Tooltip | Our hover card (already ours) | `src/chart/hoverCard.ts` |
| Loading / empty | Our own card over the chart instead of a blank canvas | `src/chart/chartState.ts` |

## Still decided by the library

- **Axis label boxes for other series and the crosshair**: shape (square, fixed padding) and font weight are fixed; we
  can set only their colours. The last-price tag is ours because a primitive can draw on the price axis
  (`priceAxisPaneViews`); indicator last-value labels and the crosshair label are still the library's boxes.
- **Price tick placement**: which prices get a label is the library's choice; the grid re-computes the same steps
  (`priceTickSpan`, copied from lightweight-charts 5.2.1's PriceTickMarkBuilder; re-check it when upgrading). Edge
  labels the library adds or drops near the top and bottom are not mirrored.
- **One font for both axes** (`layout.fontFamily`/`fontSize`): the price axis cannot be larger than the time axis.
- **Crosshair line style**: colour, width and dash only.
- **Pane separators**: colour and hover colour only (no thickness or handle shape).
- **Two-row time axis**: the library draws one row; our labels and year row are painted in the extra height we ask
  for (`minimumHeight`) while the library's own labels are blank strings.
- **Device pixel ratio in headless Chromium**: the chart canvases stayed at 1x even with a 2x device scale factor in
  Playwright, so the 2x pixel check ran on 1x canvases; the grid snaps to whatever ratio the canvas reports.

## Ideas for a custom renderer (if the owner wants to go further)

1. **Own price axis**: hide `rightPriceScale` labels (`visible: true`, `textColor: transparent`) and draw every label
   from a primitive's `priceAxisPaneViews`, so crosshair, indicator and last-price tags share one shape and font.
2. **Own crosshair labels**: crosshair `labelVisible: false` and draw the time/price boxes from the time- and
   price-axis pane views on `subscribeCrosshairMove`.
3. **Own tick positions**: compute "nice" price steps and calendar ticks ourselves and draw both the grid (a pane
   primitive at `zOrder: 'bottom'`) and the labels, turning the library's grid and labels off. This gives truly
   square cells (equal pixel steps) and Bloomberg's exact month/year layout.
4. **Full renderer**: only if the above is not enough. A canvas or WebGL renderer of our own would own everything
   but must re-implement panning, kinetic scroll, zoom, autoscale and pane resizing that the library gives for free.
   Not worth it while the primitives cover the look.
