# Privacy

> **DRAFT — needs review by a lawyer.** Not final legal text. Review before anyone other than the owner uses the
> software, and before storing client data (for example SEC Regulation S-P duties for an RIA).

## What is stored, and where

- **In your browser (localStorage):** chart layout, watchlist, drawings, scripts, theme. Nothing is sent to us.
- **On your computer (`~/.trading-platform/`):** API keys and settings, the Schwab login token, clients, portfolios,
  report branding (`platform.db`), downloaded-data cache (`cache.db`) and the helper log. Keys are never sent to the
  browser.
- **No server of ours.** The website is static files on GitHub Pages; there is no account, analytics or tracking.

## Who your computer talks to

The site and helper contact these services directly to fetch data you ask for: GitHub Pages (the site itself),
Google Fonts (fonts; Google sees your IP address), Coinbase, Charles Schwab, Google News, CNBC, SEC EDGAR (with the
contact email you enter), FRED, CFTC, Yahoo, Nasdaq, Forex Factory, U.S. Treasury Fiscal Data and, if you add keys,
Alpaca and Anthropic.

**AI assistant (Anthropic):** your questions and the data the assistant looks up to answer them (which can include
portfolio and client details) are sent to Anthropic under your own API key and Anthropic's terms.

## Deleting your data

Clear the site's data in your browser and delete the `~/.trading-platform/` folder.
