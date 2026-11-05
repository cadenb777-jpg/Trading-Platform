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
| Time axis | Our labels (months on daily bars, days intraday, 24-hour times), the year on a second row under the first label of each year; years move into the labels when more than ~2.5 years are on screen | `src/chart/axis.ts`, `ChartChrome` |
| Crosshair | Label format "Thu 05 Nov 14:35" (daily: "Thu 05 Nov 2026"); label boxes in the theme's `axisLabel` colour | `crosshairLabel`, `chartThemeOptions` |
| Grid | Square dotted grid on every chart (the library lines it up with the ticks) | `chartThemeOptions` |
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
- **Tick placement**: which times and prices get a label (and so where grid lines fall) is the library's choice; we
  format the text and set density (`tickMarkDensity`), not the positions. "Square" cells depend on the zoom.
- **One font for both axes** (`layout.fontFamily`/`fontSize`): the price axis cannot be larger than the time axis.
- **Crosshair line style**: colour, width and dash only.
- **Pane separators**: colour and hover colour only (no thickness or handle shape).
- **Two-row time axis**: the library draws one row; the year row is ours, painted in the extra height we ask for
  (`minimumHeight`), so it follows the library's labels by position, not by sharing its layout.

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
