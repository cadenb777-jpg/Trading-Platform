# The three main workflows

The owner does three things every day. Each one is now built around a single screen, borrowing a pattern from
Bloomberg or Koyfin. The aim is a platform that is deep, not wide: no new pages, and the clutter each design replaced
was removed.

## How the counts were measured

A Playwright script walked each workflow on the old build (`feat/workspace` before this change) and on the new one.
It ran against the fake helper (`fake_trade.py`, five Webull accounts, risk, futures and alerts data) with the same
seeded portfolios and clients. The script counted every click, every keystroke (each typed character counts) and every
scroll needed to reach something off screen. It stops at the order confirm window and never places an order. The
new build was walked in dark and light, at 1440 px and 390 px, with no console or page errors. The script is
`scratchpad/wf/measure.cjs` (not committed, because it needs the fake helper). Its screenshots are in
`scratchpad/ui-workflows/`.

| Workflow | Before (clicks / keys / scrolls) | After (clicks / keys / scrolls) | Keyboard only, before → after |
|---|---|---|---|
| 1. Morning check | 5 / 1 / 2 = **8 actions on 4 screens** | **0 actions, 1 screen**. Each item opens its home in 1 click | none → `j` to the item, then `Enter` |
| 2. Setup → ticket → confirm window | 6 / 0 / 1 = **7 actions**. The ticket had no target, R or plan | 3 / 0 / 0 = **3 actions**, starting from Home. With the plan, the read and the checklist | about 50 keys (46 Tabs to the buried button) → **11 keys** (`j`×8, `Enter`, `t`, `Enter`) |
| 3. Client review + report | 4 / 0 / 9 = **13 actions**. No risk vs tolerance, no drift, no notes | 3 / 0 / 0 = **3 actions** (rail, client, Report) | none → `/` `client smith` `Enter` (14 keys) and 1 click for the report |

## 1. Morning check (Home)

**Question:** what happened overnight, how are my accounts, and what needs my attention today?

**Before.** Home showed the three index charts, the market news, the coming-up list and a "Best setups" teaser that
listed trades already open. To see account value, alerts and setups at their entry, the owner had to visit Account,
open the Alerts window, visit Setups and come back to Home. News on holdings was a tab further down.

**After.** Home now opens on a **Morning brief** (src/home/morningBrief.ts, maths in src/home/brief.ts):

- **Overnight strip.** S&P 500, Nasdaq and Russell futures, the 10-year note and the 10-year yield, the dollar, euro,
  gold, oil and bitcoin, each with its day move. These are futures that trade almost around the clock, so they show
  the night. Clicking a chip opens that market on Futures (or Macro for the yield).
- **My accounts.** Total value of every real account, today's change in dollars and %, and the three holdings that
  moved most in dollars. Clicking the total opens Account. Clicking a mover opens its chart.
- **Needs attention.** Alerts that fired in the last 24 hours, price alerts within 2% of firing, A/B setups at their
  entry or getting close (one per stock), and today's high-impact US events. Each row opens its home: the Alerts
  window, the setup on Setups (with its time frame chosen), or the Calendar.
- News opens on **My holdings** when the owner holds anything.
- Keyboard: `j` / `k` move through the brief's rows, and `Enter` opens one.

**Borrowed from:** Bloomberg's launchpad monitor (`WEI` with a portfolio monitor and the alert list on one screen) and
Koyfin's "My dashboard", where every tile drills into its full view.

**Removed:** the "Best setups" teaser (src/home/setupsTeaser.ts), because Needs attention shows the setups that are
actionable. The Home COT line also went: COT lives on Futures, and the strip's futures chips link there. The longer
helper sentence beside the AI button was shortened.

## 2. Find and place a trade (Setups → chart → order ticket)

**Before.** On Setups the owner picked a setup and scrolled to step 5 of the trade guide to find "Open in order
ticket". That button sized the order from the guide's own account box (default $10,000), not from the real account.
On Trade, the ticket showed shares and cost, but not the target, reward:risk or the share of the account at risk. To
see the dollars at risk the owner had to switch Size by to Risk.

**After.**

- Setups detail has a primary **Trade this ▸** button. It is also the `t` key, and ↑/↓ or `j`/`k` move through the
  list. The guide ends with a "Trade X" button. Sells and trades already open have no ticket, because the platform
  never sells short.
- Trade this fills the ticket: a buy-stop at the trigger (or a limit at the open price), the setup's stop, and
  **Size by: Risk**. The size comes from the selected Webull account's value at the saved risk %. Linked panels
  follow the symbol (link colour).
- A **Plan** card sits next to the ticket (src/trade/planCard.ts, maths in src/trade/plan.ts). It shows the entry, the
  stop (−%), the target (the setup's own target, or the 2R guide) and +%, reward:risk, size, cost, dollars at risk and
  % of the account, and the risk setting. It warns when buying power or the max order value cuts the size, and when
  reward:risk is thin. It also shows the trade guide's **read** (the verdict and what to do) and the date to be out by.
  The Trade chart draws the plan's entry, stop and target lines.
- **Post-order checklist** (in the card): 1) place the entry: preview, then Place order in the confirm window;
  2) set the stop order: once the entry fills, "Fill stop order" fills a GTC stop sell, which still goes through
  preview and confirm; 3) set price alerts at the stop and target. These are alerts, never orders. Steps tick
  themselves from the account: an open buy, a position, a working stop sell, saved alerts.
- **Safety is unchanged.** Nothing new can send an order. The ticket's Preview leads to the one confirm window
  (src/trade/webull.ts), and only its Place button sends. No key places an order.

**Borrowed from:** Bloomberg's EMSX order ticket beside a position and risk panel, and the trade plan
or bracket view in thinkorswim's Active Trader. Like Koyfin's linked groups, the chart follows the ticket.

**Removed:** the buried "Open in order ticket" button and the guide-sized share count. The old Protect banner stays
only for other symbols: for the plan's symbol, checklist step 2 replaces it. The unused `openTradeGuide` pop-up was
also removed.

## 3. Review a client (portfolio, risk, report)

**Before.** Clients opened on an edit form. The only way to see a client's performance, risk or allocation was to
build the report preview and scroll through its pages. Risk tolerance, drift against a target model and adviser notes
did not exist.

**After.** A saved client opens on a **Client review** (src/reports/clientReview.ts, maths in src/reports/review.ts):

- A header with the name, household, account, objective and risk tolerance, plus **Report (PDF)** (one click), Preview
  report and Edit details.
- **Performance net and gross of fees.** Since start, YTD and 1 year net, each with the gross figure, plus fees paid
  and the effective rate. Net always comes first, as the Marketing Rule requires.
- **Risk vs tolerance.** A 1-5 scale (Conservative to Aggressive, with yearly volatility bands 0-6, 6-9, 9-13, 13-17
  and 17%+). The band is highlighted and the portfolio's volatility is marked on it, with within / above / below in
  plain words, plus max drawdown, beta and worst month. Tolerance is stored per client (`Client.riskTolerance`). When
  it is not set, it comes from the objective.
- **Allocation vs target.** Asset-class shares now against a target model (`Client.targetId`), the drift in points
  (±5 points counts as off) and the dollars to buy or sell to rebalance.
- **Holdings** with value, weight, yield and estimated income. **Upcoming income** for the next 12 months: total,
  monthly and yield, with the biggest payers.
- **Notes** (`Client.notes`, with the date they were last updated) and the last report on record.
- Keyboard: ↑/↓ in the client list. Command bar: **`CLIENT smith`** (or `CLNT`) opens that client's review. `CLIENT`
  on its own goes to Clients and lists the clients.

**Borrowed from:** Bloomberg `PORT` (holdings, performance and risk on one tab), Nitrogen/Riskalyze's risk number
against the client's tolerance, Orion's drift and rebalance view, and Bloomberg's code-plus-argument command style.

**Removed:** the edit form as the landing view. It is now "Edit details", and it gained the tolerance and
target-model fields.

## Not changed

- The helper is unchanged (HELPER_VERSION 34). The new client fields are saved by the existing `store.*` requests.
- Orders still go only through preview, then the confirm window, then Place. Futures stay long-only, on the Futures
  ticket.
