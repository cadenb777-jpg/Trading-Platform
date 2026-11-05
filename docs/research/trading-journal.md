# Trading journal: what the apps do and what we built

Researched 2026-11 for the Journal page (`#journal`, code JRNL). Vendor pages describe their own products, so read the
feature claims as self-reported.

## What the apps advertise

- **TradeX** (the owner's examples: [App Store](https://apps.apple.com/us/app/trading-journal-tradex/id6751562060),
  [Google Play](https://play.google.com/store/apps/details?id=com.tradex.jn), [TradexAI](https://tradeexai.com/)):
  a daily dashboard with automatic P&L, win rate, best/worst trade, streaks and results by strategy; quick logging with
  entries/exits, notes, tags, screenshots and emotion chips; psychology insights; a P&L calendar; an AI coach for each
  trade and monthly reports; CSV import; tax-style reports.
- **Tradervue**: broker import, MAE/MFE per position (the biggest open loss and open profit while the trade was on)
  and MFE/MAE trend reports ([MFE and MAE calculations](https://help.tradervue.com/article/3440-mfe-and-mae-calculations),
  [MFE/MAE ratio](https://www.tradervue.com/blog/trend-reports-mfe-mae-ratio)).
- **Edgewonk**: expectancy (average P&L a trade), profit factor (won ÷ lost), and a score built from profit factor,
  return-to-drawdown and sample size ([performance statistics](https://edgewonk.com/blog/a-deep-dive-into-edgewonk-performance-statistics),
  [metrics explained](https://tradeciety.com/all-edgewonks-metrics-and-statistics-explained-for-successful-journaling)).
- **TradesViz**: 100+ charts and KPIs (win rate, expectancy, drawdown, MFE/MAE, equity curve, rolling profit factor),
  and how long it took to reach MFE/MAE ([MFE/MAE duration](https://tradesviz.com/blog/mfe-mae-duration)).
- **TraderSync**: hundreds of broker imports; no metric detail was found in public sources.

## The standard set (what every one of them shows)

Net and gross P&L after fees; win rate; average win and loss and their ratio (payoff); profit factor; expectancy in $
and in R (multiples of the planned risk); largest win/loss; consecutive wins/losses; equity curve and maximum drawdown;
Sharpe/Sortino on daily P&L; hold time; MAE/MFE; results by symbol, strategy/playbook, tag, emotion, time of day, day of
week and long vs short; a P&L calendar with day drill-down; an R histogram; plan adherence; a daily pre-market plan and
post-market review; playbooks as rule checklists; monthly reports and a CSV export.

## What we built, and how it differs

- **Connected, free and private.** Trades come from the owner's Webull fills (read-only backfill, about 2 years),
  broker CSV/Excel exports (Webull, Schwab incl. TD Ameritrade, Fidelity, IBKR Flex and Activity, Robinhood, E*TRADE,
  any other by matching columns), PDF statements through the AI (when the key is set) or manual entry. Everything lives
  in the helper's `platform.db`; screenshots in `~/.trading-platform/journal/`.
- **No double counting.** A fill is skipped when its order id, or its day, symbol, side, quantity and price, is already
  saved from any source. Positions held from before the history start at the broker's average cost, marked, and stay
  out of the statistics.
- **Plans travel with the trade.** Orders placed on the Trade page (and setups opened from the trade guide) carry their
  stop, target and strategy into the journal; R is exact for those. Without a stop, R uses one daily ATR, marked `*`.
- **Honest statistics.** Below 30 closed trades the page says so (see `setups-statistics.md`); small groups are greyed.
- **AI coach.** Shows the cost before it runs, reads only the owner's data (trade ids and dates cited), never trades.
- **Left out on purpose** (simplicity): broker sync for brokers other than Webull, options legs analysis, social sharing.
