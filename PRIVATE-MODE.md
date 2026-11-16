# Private mode: the platform from your own computer

While this GitHub repository is **private**, GitHub doesn't serve the website, the app's automatic updates or the
`TradingTerminal.exe` download (on the free plan those need a public repository). Private mode runs the whole platform
from a copy of the code on your computer instead. Your keys, logins and data stay where they always are
(`.trading-platform` in your user folder), so nothing needs setting up again.

## One-time setup (Windows, about 15 minutes)

1. **Install Git:** <https://git-scm.com> → *Download for Windows* → install with the default options.
2. **Install Node.js:** <https://nodejs.org> → the **LTS** version → install with the default options.
3. **Get the code** (one folder, in your user folder). Open **Terminal** (right-click the Start button → *Terminal*)
   and run:
   ```
   cd $env:USERPROFILE
   git clone https://github.com/cadenb777-jpg/Trading-Platform.git
   ```
   A GitHub sign-in window opens the first time: choose **Sign in with your browser** and approve. Git remembers it
   (Windows Credential Manager), so later updates need no sign-in. (An SSH key works too, if you already have one.)
4. **Start it:** open the **Trading-Platform** folder in your user folder and double-click
   **start-private-windows.bat**. The first start takes a few minutes (it installs the website's parts, builds the
   website and installs the app's parts). It then makes the **Trading Terminal** icon on your desktop and in the Start
   menu open this private copy (replacing the installed app's icon of that name).

## Only one copy

Keep just this one folder (`Trading-Platform` in your user folder). Close the Trading Terminal (tray icon → Quit), then
uninstall the installed **Trading Terminal** app if you have it (Windows Settings → Apps), and delete any other copies of
the platform (for example a ZIP copy on your Desktop) and their shortcuts. Never delete `.trading-platform` in your user
folder: that is where your keys, logins, portfolios and data live.

## Every day

Double-click **Trading Terminal** on your desktop. Each start gets the latest changes (`git pull`), rebuilds the website if
anything changed, and opens it: the start-up window shows the progress, then asks Terminal or Web. There is no black
window: the helper runs hidden in the background (right-click the tray icon → Show helper window to see it).

## Good to know

- The installed Trading Terminal (from the `.exe`) and the online website don't work while the repository is
  private; the Trading Terminal icon now opens the private copy.
- The website on your computer has its own browser storage, so chart layouts, the watchlist and display choices start
  fresh in private mode (your portfolios, accounts, alerts and settings are in the helper and stay).
- Private mode switches the online updaters off: it never downloads over your copy of the code.
- **When you go public:** GitHub → the repository → **Settings** → *Danger Zone* → **Change visibility** → public;
  then **Settings → Pages → Source: GitHub Actions**. The online website, the normal app and the download work again.
