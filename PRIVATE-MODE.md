# Private mode: the platform from your own computer

While this GitHub repository is **private**, GitHub doesn't serve the website, the app's automatic updates or the
`TradingTerminal.exe` download (on the free plan those need a public repository). Private mode runs the whole platform
from a copy of the code on your computer instead. Your keys, logins and data stay where they always are
(`.trading-platform` in your user folder), so nothing needs setting up again.

## One-time setup (Windows, about 15 minutes)

1. **Install Git:** <https://git-scm.com> → *Download for Windows* → install with the default options.
2. **Install Node.js:** <https://nodejs.org> → the **LTS** version → install with the default options.
3. **Make your SSH key.** Open **Terminal** (right-click the Start button → *Terminal*) and run, with your own
   GitHub email, pressing **Enter** at every question:
   ```
   ssh-keygen -t ed25519 -C "your GitHub email"
   ```
4. **Copy the public key:**
   ```
   type $env:USERPROFILE\.ssh\id_ed25519.pub | clip
   ```
   Only this `.pub` file is ever shared. The other file (`id_ed25519`, no `.pub`) is your private key: never share it.
5. **Add it to GitHub:** github.com → your picture (top right) → **Settings** → **SSH and GPG keys** →
   **New SSH key** → title "My PC" → paste → **Add SSH key**.
6. **Test it:**
   ```
   ssh -T git@github.com
   ```
   Type **yes** if asked. It should say *Hi cadenb777-jpg!*
7. **Get the code:**
   ```
   cd $env:USERPROFILE
   git clone git@github.com:cadenb777-jpg/Trading-Platform.git
   ```
8. **Start it:** open the **Trading-Platform** folder in your user folder and double-click
   **start-private-windows.bat**. The first start takes a few minutes (it installs the website's parts, builds the
   website and installs the app's parts). It then puts a **Trading Terminal (private)** icon on your desktop and in
   the Start menu.

## Every day

Double-click **Trading Terminal (private)**. Each start gets the latest changes (`git pull`), rebuilds the website if
anything changed, and opens it: the same Terminal or Web choice, window buttons and tray icon as the normal app.

## Good to know

- The installed Trading Terminal (from the `.exe`) and the online website don't work while the repository is
  private: use the private icon.
- The website on your computer has its own browser storage, so chart layouts, the watchlist and display choices start
  fresh in private mode (your portfolios, accounts, alerts and settings are in the helper and stay).
- Private mode switches the online updaters off: it never downloads over your copy of the code.
- **When you go public:** GitHub → the repository → **Settings** → *Danger Zone* → **Change visibility** → public;
  then **Settings → Pages → Source: GitHub Actions**. The online website, the normal app and the download work again.
