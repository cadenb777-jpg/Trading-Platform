# Schwab helper

A small program that runs on your computer, logs into your Schwab API app, and sends **live
prices from every US exchange** and **market news** (Google News and CNBC) to your platform. It only reads market data. It can't place,
change or cancel orders.

Your Schwab keys stay on your computer, in a hidden `.trading-platform` folder in your home
folder. They are never uploaded to GitHub or the website.

## One-time setup

### 1. Install Python (free)

Download it from **https://www.python.org/downloads/** and run the installer.

- **Windows:** on the first installer screen, tick **"Add python.exe to PATH"** before clicking Install.
- **Mac:** just click through the installer.

### 2. Download the project

1. Go to https://github.com/cadenb777-jpg/Trading-Platform
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it. On Windows: right-click the file, then **Extract All**. On Mac: double-click it.
4. Open the unzipped folder, then the **helper** folder inside it.

### 3. Start the helper

- **Windows:** double-click **start-windows.bat**.
  If you see "Windows protected your PC", click **More info**, then **Run anyway**.
- **Mac:** right-click **start-mac.command**, choose **Open**, then **Open** again.
  You only need to right-click the first time; after that, double-click works.

The first start takes a few minutes while it installs what it needs. The window shows a start screen
(your name, a random creature and colour theme) with one loading bar from 0 to 100%; the install
messages are kept out of sight in `~/.trading-platform/launcher.log`.

### 4. Enter your Schwab keys (first time only)

Find them at developer.schwab.com, under **Dashboard**, then **Apps**, then your app.

- Paste the **Client ID** (the helper may also call it the App Key) and press Enter.
- Paste the **Client Secret** and press Enter. It stays invisible while you paste; that's normal.

In the black window, **right-click** to paste. Ctrl+V doesn't always work there.

### 5. Log in to Schwab

Press Enter when asked and a browser window opens.

1. Log in with your **normal Schwab brokerage login**.
2. Select your account(s) and click **Allow** or **Done**.
3. You'll then see a **"Your connection is not private"** warning. This is expected: the login
   finishes on your own computer, which doesn't have a public security certificate.
   Click **Advanced**, then **Proceed to 127.0.0.1**.

The helper window then goes back to the start screen, finishes the loading bar and shows a live
status line at the bottom (for example **"● LIVE Streaming from Schwab · 1 platform tab connected"**).
Behind-the-scenes messages go to `~/.trading-platform/helper.log` instead of filling the window.
A few seconds later it opens the platform in Google Chrome (or your default browser), unless the platform is
already open in a tab. Turn that off in the platform's Settings window (Helper section), or start the helper
with `--no-browser`. The AI and portfolio maths load in the background while the helper starts, so charts are
ready first; anything that needs them waits a moment the first time.

### 6. Use it

Open https://cadenb777-jpg.github.io/trading-platform/ and choose **Stocks (Schwab)** in the
market dropdown.

- Use **Chrome** or **Edge**. Safari may block the connection to the helper.
- If the browser asks to allow the site to access apps or devices on your computer or network,
  click **Allow**.

## Updating the helper

When the platform gets new features, you may need a new copy of the helper. Download the ZIP
again (step 2), replace your old folder, and start it as usual. Your keys and login are kept.

Tip: to make updates start faster, copy the new files *into* your existing helper folder (choose
"Replace the files" when Windows asks) instead of deleting the folder. That keeps the hidden `.venv`
folder with the parts already installed, so the helper doesn't have to download them again. A fresh
folder downloads everything once (about 150 MB), which takes a few minutes; the start window shows
progress for each step.

Version 6 added the AI assistant and stock positioning; version 7 is a bug-fix update; version 8 adds the
Investments page (market boards, bonds, alternatives and private funds) and the new start screen; version 9
starts faster and opens the platform in Chrome when it's ready; version 10 adds the background market scanner
(the "Best setups" panel on Home), more accurate daily changes (from Schwab's official quotes), deeper options
put/call data and AI summaries on more pages. Version 11 makes the scanner backtest the exact plan shown on each card, retry symbols after temporary
Schwab errors, pace all its requests gently, and shows "At close" values on the Investments boards. Version 12 scans
every Nasdaq-100 stock every 5 minutes for swing trades (weekly swing with COT, z-score and Williams; mean reversion;
breakouts), adds RIA fee schedules to client reports and reads fund NAVs from the newest quarterly reports. Version 13 says on each setup card why it isn't an A-grade and fills in
the economic calendar's actual numbers for US releases (from the St. Louis Fed). Version 14 runs 1,000 simulations for every backtest check and adds the trade guide that
opens when you click a setup card. Version 15 builds each fund's NAV chart from its monthly NAV announcements, so
the alternatives pages show current prices instead of old quarterly data. Version 16 reads fewer filings the first
time a fund opens, so fund pages load faster. Version 17 fixes calendar actuals when the St. Louis Fed skips a
month and names the main reason when no setup beats a C-grade. Version 18 keeps open trades on the setups list
until they end, marks new setups and warns when two strategies disagree on a stock. Version 19 adds the Setups page:
short-swing (hourly), swing (daily) and position (weekly) trades, each stock judged against its own normal range,
a COT + z-score edge study, live entry alerts and an out-of-sample check. The first scan after starting takes a few
minutes longer while it downloads hourly and weekly history. Version 20 judges buys and sells separately and adds
the strategy lab, which searches about 1,500 rule combinations for ones that keep working on data they were not
chosen on. Version 21 adds the optional free Alpaca price history (see below), keeps replies from being lost,
saves to disk off the main loop and caps its memory use. Version 22 reworks the Setups scanner: every test now
counts trades taken in the same week as one bet, all results are after costs (also in R), Tier A needs the edge to
survive a correction for every strategy tested, double costs and both halves of history; 15 years of daily history;
every 30-minute bar is kept for good (and, with Alpaca keys in Settings, about 3 years of older 30-minute bars are
loaded once; hourly grades stay at B until 2 years of hourly history); simpler rules (pullback = z-score stretch and
turn, mean reversion = z-score only, breakout = 52-week high, one 200-day trend filter; COT is a reading unless the
edge study on your data shows it helps); lab survivors are judged only on trades after the day they were first
shown; and a weekly "rule tests" report on your own data. Version 23 lets the AI see the page you're on. Version 24 adds
dividend tracking on the Portfolios page (import a brokerage statement, then see yields, yearly income and a 12-month
dividend calendar; future dates are estimates from each stock's dividend history). Heavy maths runs in separate worker processes so prices
keep flowing during a scan; the first scan after updating takes longer while 15 years of history download. If an optional part
(the AI or portfolio maths) fails to install, the helper still starts and charts and prices keep working; the
platform's Settings window shows what's unavailable, and the helper writes a log to `~/.trading-platform/helper.log`. The first start after updating installs a few
more parts, so it takes a couple of minutes. Keys and emails are no longer typed into this window:
open **Settings** (gear icon, bottom of the left menu in the platform) to add your SEC email (needed
for company financials and insider trades), your Anthropic API key (for the AI) and, optionally, a free
FRED key. The helper saves them in `~/.trading-platform/settings.json`.

Your portfolios, clients and report branding are saved on your computer in
`~/.trading-platform/platform.db` (in your user folder), not in the browser or online.
Back up that file if the data matters to you.

## Alpaca (optional, free)

Schwab only keeps about 9 months of intraday bars (and about 48 days of 1-minute bars). Alpaca gives
free intraday price history for the whole US market back to 2016 (adjusted for splits and dividends).
With it, 30-minute and hourly charts reach back about 3 years, and the AI assistant can read hourly
history back to 2016. Alpaca is only used for **price history**: the platform never trades through it.

1. Go to [alpaca.markets](https://alpaca.markets) and sign up for a free account (no deposit needed).
2. Open your dashboard at [app.alpaca.markets](https://app.alpaca.markets). On the Home page, find
   **API Keys** and click **Generate New Keys** (paper-account keys are commonly reported to work;
   Test connection will confirm).
3. Copy both the **Key ID** and the **Secret Key**. The secret is shown only once; if you lose it,
   generate new keys.
4. In the platform, open **Settings** → **Data sources** → **Alpaca (free history)**, paste both keys,
   click **Save**, then **Test connection**. It should say "Connected".

The keys are saved by the helper in `~/.trading-platform/settings.json` and are never shown in the
browser again. Downloaded history is kept in `~/.trading-platform/cache.db`, so each stock is
downloaded once and only the newest bars are fetched after that. The free plan doesn't include the
newest 15 minutes; Schwab covers those.

## Webull (optional)

Webull lets the platform show your Webull account (balances, positions, orders), copy it into
Portfolios, and place **stock** orders from the Portfolios page. Schwab is still used only for prices.
Nothing extra needs installing: the helper talks to Webull directly.

1. Go to Webull's developer site ([developer.webull.com](https://developer.webull.com/apis/docs/getting-started))
   and **apply for API access** with your Webull account. Approval can take a few days.
2. Once approved, create an **App Key** and **App Secret** there. Copy both (keep the secret private).
3. Start in **Test**: Webull's SDK page ([SDKs and Tools](https://developer.webull.com/apis/docs/sdk)) lists
   shared **test** App Keys/Secrets for its practice environment (no real money, no application needed).
   Paste one of those first to try everything safely.
4. In the platform, open **Settings** → **Trading** → **Webull**, paste the App Key and App Secret, click
   **Save**, then **Test connection**. It should say "Connected to Webull Test". If Webull asks you to
   approve the API login, open the Webull app on your phone, approve it, and click Test connection again.
5. Open **Portfolios** → **Webull**. You'll see a calm blue "TEST — no real money" badge. Try **Sync to
   Portfolios** and a small test order: fill in the ticket, click **Preview order**, read the confirm
   window, then **Place test order**.
6. Only when you're comfortable: paste **your own** App Key/Secret, then in Settings click **Live (real
   money)** and type `LIVE` to confirm. The badge turns red: "LIVE — real money". Switch back to Test
   any time.

Safety rails (all checked by the helper, not the web page):

- Every order needs a **preview** and then a **confirm**. The preview is valid for 60 seconds and can be
  used once; the helper places exactly the previewed order.
- **Max order value** (default $1,000) and **max orders per day** (default 10) in Settings.
- US stocks only; you can't sell more shares than you hold (no short selling).
- Every order attempt, result and cancel is written to `~/.trading-platform/orders.log` (no keys).
- The AI assistant can never place, preview or cancel orders.
- Live can be switched on from the platform page itself, so only open the platform from its own site
  (cadenb777-jpg.github.io/trading-platform), and don't put other projects on the same GitHub Pages account or
  run other local web projects on ports 4173 or 5173 while the helper is running.
- If an order times out, the platform looks it up once; if it still can't tell, it says so. Check Orders
  in Webull before trying again, so you don't buy twice.

The keys are saved by the helper in `~/.trading-platform/settings.json` and are never sent back to
the browser. If Webull asked for an app approval, that login token is kept in
`~/.trading-platform/webull_token.json`. To disconnect, click **Remove** in Settings (it also switches
back to Test).

## Every day

Double-click the start file and keep its window open while you use the charts.
Close the window or press **Ctrl+C** to stop it.

**About once a week** Schwab requires you to log in again. The helper opens the login page
automatically when it's needed. Just repeat step 5.

## Troubleshooting

| Problem | Fix |
|---|---|
| Chart says "The Schwab helper isn't running" | Start the helper, wait for "running", then click **Try again** |
| "Python was not found" | Install Python (step 1). On Windows, tick "Add python.exe to PATH" |
| Something went wrong but the window only shows the start screen | Open `~/.trading-platform/helper.log` (or `launcher.log` if it happened while installing) |
| "Port 8765 is already in use" | The helper is already open in another window. Use that one |
| Login fails or "invalid client" | Your app may still be pending at Schwab, or the keys are wrong. Run the start file with `--reset`, or delete the `.trading-platform` folder in your home folder and start again |
| "Schwab login expired" | Close the helper and start it again to log in |
| Status says Live but prices don't move | Normal outside market hours. Pre-market starts 7am Eastern |

To enter new keys: on Windows, open the helper folder, click the address bar, type
`cmd`, press Enter, then run `start-windows.bat --reset`. On a Mac, open Terminal, then run
`cd` followed by a space, drag the helper folder into the window, press Enter, then run
`./start-mac.command --reset`.
