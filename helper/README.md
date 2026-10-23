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

The first start takes a minute while it installs what it needs.

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

The helper window then says **"Schwab helper is running."**

### 6. Use it

Open https://cadenb777-jpg.github.io/trading-platform/ and choose **Stocks (Schwab)** in the
market dropdown.

- Use **Chrome** or **Edge**. Safari may block the connection to the helper.
- If the browser asks to allow the site to access apps or devices on your computer or network,
  click **Allow**.

## Updating the helper

When the platform gets new features, you may need a new copy of the helper. Download the ZIP
again (step 2), replace your old folder, and start it as usual. Your keys and login are kept.

Version 5 adds the analysis engine (Flow, Research, Macro, Portfolios, Clients). The first start
installs a few more parts, so it takes a couple of minutes. It also asks once for an **email
address**: the SEC asks tools that download its filings to include a contact email. It is only sent
to the SEC.

Your portfolios, clients and report branding are saved on your computer in
`~/.trading-platform/platform.db` (in your user folder), not in the browser or online.
Back up that file if the data matters to you.

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
| "Port 8765 is already in use" | The helper is already open in another window. Use that one |
| Login fails or "invalid client" | Your app may still be pending at Schwab, or the keys are wrong. Run the start file with `--reset`, or delete the `.trading-platform` folder in your home folder and start again |
| "Schwab login expired" | Close the helper and start it again to log in |
| Status says Live but prices don't move | Normal outside market hours. Pre-market starts 7am Eastern |

To enter new keys: on Windows, open the helper folder, click the address bar, type
`cmd`, press Enter, then run `start-windows.bat --reset`. On a Mac, open Terminal, then run
`cd` followed by a space, drag the helper folder into the window, press Enter, then run
`./start-mac.command --reset`.
