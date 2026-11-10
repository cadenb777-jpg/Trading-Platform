# Trading Terminal — the desktop app

Your website, in its own app window. It is drawn by Qt WebEngine (the same Chromium engine that is inside Chrome),
showing the published website itself, so every page, chart, colour, the ticker tape and Bull are **exactly** the
website's: the same code, updated the moment the website is. It uses the same helper as the website, so prices,
alerts, your accounts and the Trade page (preview, then confirm; Test first) work exactly as in Chrome.

## Start it

- **First time:** Windows: double-click `start-desktop-windows.bat`. Mac: double-click `start-desktop-mac.command`.
  The start window shows a loading bar while it checks for a newer version and installs what it needs (the first
  time it downloads the Qt parts, about 150–250 MB, a few minutes; after that it opens straight away).
- It then puts a **Trading Terminal** icon (the logo) on your desktop (and in the Start menu on Windows).
  **From then on, just double-click the icon.** Deleted it by accident? Run `python launch.py --shortcut`.
- A splash with the logo shows while the website loads, then the app opens.
- **The helper:** if the website's helper is already running, the app uses it. If not, the start window runs it for
  you (its loading screen, the weekly Schwab login when it asks, its automatic updates) without opening Chrome. Keep
  the start window open while you use the app.
- Needs: Windows 10/11 (64-bit) or macOS 14 or newer, and the internet (the app shows the live website).
- **Coming from version 1.x:** your old start file installs 2.0 by itself, but that first time it can't start the
  helper yet. If the app says "Helper offline", close it and the start window, then start it once more (or double-click
  the new Trading Terminal icon).

## In the app

Everything on the website works the same (menu, command bar `/`, function keys, Bull, alerts, Trade). The window adds:

| Keys | What it does |
|------|--------------|
| Ctrl + `+` / Ctrl + `-` / Ctrl + `0` | Bigger / smaller / normal size (remembered) |
| F5 or Ctrl + R | Reload the page |
| F11 | Full screen on / off |
| Alt + ← / Alt + → | Back / forward |

- Links to other sites (news articles, SEC filings, fund websites) open in your normal browser.
- Downloads (exports, reports, the diagnostics file) ask where to save, starting in your Downloads folder.
- Price and setup alerts show as desktop notifications (with sound); printing opens the print dialog.
- No internet? A "Can't reach the platform" page shows and tries again every 15 seconds.
- The app remembers its size, position and zoom. Its settings (watchlist, chart layouts, Bull) are its own, kept in
  `~/.trading-platform/desktop-browser` (separate from Chrome's).

## Updates

The pages update with the website. The app window itself updates on start when GitHub has a newer version (the old
version is kept in `desktop_backup` and put back if the new one won't start). The helper updates itself.

## For changes

- The app never re-creates pages in Python: change the website and the app follows.
- Logo: `tp_desktop/assets/logo.svg`; run `python make_icons.py` (needs PySide6 and Pillow) to remake the `.ico`,
  `.icns` and `.png`, which are committed.
- Tests (no Qt needed): `python -m unittest discover desktop/tests`. A picture of the window without a screen:
  `QT_QPA_PLATFORM=offscreen python -m tp_desktop --url <site> --screenshot shot.png`.
- Bump `APP_VERSION` in `tp_desktop/__init__.py` on every desktop change.
