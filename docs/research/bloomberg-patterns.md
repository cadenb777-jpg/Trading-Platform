# Bloomberg's design patterns, and how every screen here follows them

What Bloomberg screens have in common (owner's spec, parts 6-7, and the screenshots the owner shared), turned into the
rules this platform applies on every tab. The look is the platform's own (amber headings, blue glow, section accents);
the organisation is Bloomberg's. New screens follow these rules; `scripts/qa-clickthrough.mjs` checks the layout ones.

## 1. One screen grammar, top to bottom

| Band | Bloomberg | Here |
|---|---|---|
| A. Where you are | Command line, loaded security, function code and title | Rail (destination) + top row (that destination's views) + the security chip on Security pages |
| B. Title line | Function title left, actions right (Actions / Export / Settings) | `.ap-header`: amber uppercase title with an "i" for the explanation, actions on the right (one "Actions" menu where there are many) |
| C. Controls | Date range, periodicity, currency, source | Segmented controls (`.segmented`) on the title line or the first line of the body |
| D. View tabs | Numbered tabs under the title (Highlights · I/S · B/S …) | `.ap-tabrow`: its own full-width row under the title, underlined in the section accent. `pageFrame` puts any `.tabs[role=tablist]` there, so no page places them differently |
| E. Body | Tiled boxes, each with a thin header bar, no floating cards | Flat panels (6 px corners, hairline) with a tinted title bar (`.panel-head`, `.sv-panel-title`, `.fn-tile-head`, `.list-band`) |
| F. Footer | Source, timestamp, page | Each panel's source · as-of line; the status bar for the connection |

## 2. Rules inside the body

1. **Title bars name every box.** Uppercase amber, 11 px, tinted band; groups inside a list use `.list-band`.
2. **A box's header can open the full screen** ("All markets ›"): plain words, never a bare code.
3. **Facts are label | value lists** (`.kv`): label left, figure right, a faint rule between rows.
4. **Lists are tables**: banded header row, tight rows, right-aligned tabular numbers, numbered rows where you'd pick
   one, the subject row first and highlighted (Peers), medians/averages at the bottom (Peers, Screener).
5. **Colour has one meaning each**: green/red only for up/down or better/worse; amber for headings; blue for links and
   things you can click; neutral (blue/amber) for direction that is neither good nor bad (rates up/down).
6. **Pictures carry words**: every chart has one plain sentence under it (what it says) and a source line.
7. **Dense, not cramped**: 10 px gaps, 12-column grid, no empty half-screens; nothing smaller than 11 px.
8. **Nothing twice on one screen**: the rail's market pulse hides on pages that already show it (Today, Monitor,
   Chart); duplicate columns hide until they differ (Account's Total return).
9. **Every number says where it came from and when.**

## 3. Where each Bloomberg template lives here

| Template | Bloomberg functions | Here |
|---|---|---|
| Sectioned grid | WEI, BTMM, PX1 | Markets → Monitor, Macro board |
| Profile tiles | DES | Security → Overview |
| Statement grid + bar mode | FA | Security → Financials |
| Chart | GP, G | **Charts** (own destination), Security → Chart for a quick look |
| Numbered river | TOP, CN | Monitor news, Desk news, Security → News |
| Calendar table | ECO | Markets → Calendar |
| Mirrored chain | OMON | Security → Options |
| Builder + results | EQS | Ideas → Screener |
| Comps + scatter | RV | Security → Peers |
| KPI strip + tables | PORT | Money → Account, Portfolios |
| Tiled workspace | Launchpad | Today → Desk |
| Numbered menu | MENU | Launchpad (type a number + Enter) |
