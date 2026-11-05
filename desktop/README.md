# Trading Platform — desktop app

A Python program (PySide6 + pyqtgraph) beside the website, in the same repository. It has **its own helper**: the
repository's `helper/schwab_helper.py` started with `--desktop` (port 8766, only this app may connect, no scanner or
updater). The website keeps its helper on port 8765; both can run at the same time and share your Schwab login
(`~/.trading-platform`).

## Start it

- Windows: double-click `start-desktop-windows.bat`. Mac: double-click `start-desktop-mac.command`.
- The first start installs what it needs (a few minutes); after that it opens straight away.
- Set up Schwab once with the website's helper first (keys and login live in `~/.trading-platform`).

## Using it

- **Command line** (top right, press `/` or Ctrl+K): `AAPL` or `AAPL GP` = chart, `AAPL DES` = quote, `WEI` = world
  markets, `ACCT` = account.
- **Sections** across the top (Markets, Analyze, Money) and their pages as tabs; **watchlist** on the left (click to
  chart, type to add); a **ticker tape** of its quotes; **F1-F5** keys at the bottom.
- **Chart**: candles and volume, square dotted grid (it carries on past the last candle), pre-market (blue), after-hours
  (copper) and overnight (grey) shading on intraday charts, dashed last price in the candle's colour, crosshair
  read-out, 12h/24h button.
- **Account**: your Webull balances and positions, read-only.

The app never places orders: they stay on the website's Trade page (preview, then confirm). The desktop helper refuses
order requests, and `tests/test_no_trading.py` checks both.

Tests: `python -m unittest discover desktop/tests`. Checks without a screen: `QT_QPA_PLATFORM=offscreen python -m
tp_desktop --no-helper --port 8766 --screenshot shot.png`.

Planned next stages: indicators and drawings on the desktop chart, Setups and Research pages, multi-window layouts.
