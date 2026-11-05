# Design system

A serious, quiet terminal: deep navy in dark mode, paper and ink in light mode, sky for interaction and copper for
highlights. Everything lives in `src/style.css` (tokens at the top, signature touches in the "Design refresh" block);
canvas charts take the same colours from `THEME` in `src/ui/theme.ts`.

## Tokens

| Group | Tokens | Notes |
|---|---|---|
| Layers | `--bg` `--bg-deep` `--surface` `--raised` `--high` `--bg-chart` | page, cards, controls/hover, active controls |
| Lines | `--line` `--line-strong` `--grid-line` | hairlines; `--grid-line` is the faint blueprint grid |
| Text | `--text` `--text-strong` `--muted` `--faint` | `--faint` only for placeholders and decoration |
| Accents | `--accent` / `--accent-text` (sky, navy in light), `--accent-2` / `--accent-2-text` (copper), `--focus` | `--on-accent` on accent fills |
| Money | `--up` `--down` (lines, bars), `--up-text` `--down-text` (text), `--up-fill` `--down-fill` + `--on-fill` (Buy/Sell) | green leans blue, red leans warm, and they differ in lightness (colour-blind safe) |
| Atmosphere | `--grid-minor` `--grid-major` `--spot-sky` `--spot-copper` `--spot-deep` | the fixed page layer (`body::before`) |
| Glow | `--glow-sky` `--glow-copper` `--hero-bg` `--glass` `--bridge-sky` `--bridge-copper` | Home hero and its bridge, toasts |
| Space / shape | `--sp-1..6` (4px steps), `--radius-sm/-/-lg` (4/6/10), `--control-h` 32px | |
| Motion | `--dur-1` 120ms, `--dur-2` 180ms, `--ease`, `--lift` | off under `prefers-reduced-motion` |

Older names (`--panel`, `--panel-2`, `--border`, `--link` ...) point at these, so existing pages follow. Light mode
redefines the semantic tokens under `:root[data-theme='light']`. `src/ui/tokens.test.ts` checks every text token
against every background for 4.5:1 in both themes, and against the page colour where all background spots overlap.

## Type

- Inter for the interface; tabular numerals everywhere (set on `body`), numbers right-aligned in tables (`.num`).
- Cormorant Garamond (`--font-display`) only for page titles (`.ap-header h1`, `.tr-top h1`), the Home greeting,
  modal and section headings, and big figures (account total, index prices; lining numerals).
- Eyebrow labels: `.section-label`, `.stat-label` and table headers are spaced uppercase; `.section-label` gets a thin
  rule after it. Page titles sit on a short copper rule.

## Components

`.panel` (card with a faint top sheen), `.stat-card`, `.btn` (`.primary` / `.ghost` / `.danger`), `.input`, `.tabs`
(active tab has a copper underline), `.segmented`, `.chip`, `.badge`, `.data-table` (sticky headers only inside
`.table-wrap`, row hover with a sky edge, no zebra), `.modal` / `.popover` (rise in), `.toast` (glass, copper edge),
`.empty-state`, `.ap-error`. Clickable cards (`.idx-card`, `.brief-chip`, `.fut-tile`) lift 1px on hover.

## Navigation and the shell

Ideas taken from Fincept Terminal and Bloomberg (never their code or exact layout): sections instead of a long list of
tabs, a function bar, a launchpad, a status bar and a widget dashboard, all in our own colours, rounded edges and tokens.

- **One registry.** `src/ui/nav.ts` lists every page once (route, section, label, a unique Bloomberg-style code,
  keywords, one line about it) plus functions that aren't pages (WEI, COT, MULTI, AI, DATA, PREF...). The rail,
  sub-tabs, command bar (`/`, Ctrl+K), launchpad (Ctrl+L) and the AI's page list all read it. A new page = one entry
  here + its loader in main.ts `LOADERS` (typed, so a missing loader fails the build); `nav.test.ts` checks routes
  and codes.
- **Two levels.** The rail shows only the sections: Markets, Analyze, Money, Business, AI, then the launchpad;
  Alerts, Data, Settings and Collapse sit at the bottom. A section opens the page last visited in it. The top row
  shows the section's pages as sub-tabs (code as a quiet hint) and the command field on the right. Phones: the
  sections become a bottom bar, the sub-tabs scroll sideways, the command field is an icon.
- **Function bar.** Under a page title, numbered chips run that page's actions (keys 1-9, ignored while typing or with
  a dialog open) and a "Related" row links its neighbours by code. Opt in with `pageFrame(...).functions(actions,
  related)` or `functionBar()`. Actions live here, not as duplicate header buttons; the header keeps filters and
  display choices.
- **Status bar.** One thin row: helper and version, Schwab / Webull / SEC feeds, last latency, last update, the New York
  session and READY / BUSY / OFFLINE. Every item opens its detail (Data health or Settings).
- **Panels.** `panelHeader()` (src/ui/panel.ts): title, as-of, the panel's own controls, then refresh, open in full
  and collapse, always in that order.
- **Home widgets.** A 12-column grid (`src/home/widgets.ts`): indexes, my accounts, needs attention, setups, news,
  events, watchlist. Customise (key 2) shows drag handles (arrow keys move too), widths 4/6/8/12, remove, add and
  Reset to default; saved per device. The hero and bridge stay above the grid.

## Usability principles (owner's brief)

1. **Information hierarchy.** Each page leads with the few numbers that matter for a decision (its focal point).
   Details, explanations and supporting tables are one click away, not on the surface.
2. **Progressive disclosure.** Explanations, methods and "why" text live behind the "i" tips, folding sections and
   a detail drawer: easy to find, never in the way.
3. **Inter-page linking.** Every entity links to its home and related functions through the shared ticker card and
   link helpers (tickers → security view, accounts → Account, funds → fund detail, clients → client, events →
   calendar). Each page shows a small Related row in its function bar.
4. **Codes are first-class.** Every page and function keeps its code (DES, GP, FA, WEI, ECO, JRNL...). The command
   bar and launchpad search by code, name and keywords; codes show as subtle hints on tabs and menu items.
5. **Consistency.** The same order on every page: title, function bar, filters, focal content, detail. The same
   number formatting and the same empty, loading and error states.

## Principles (owner's brief: impactful, methodical, uncluttered)

- **Atmosphere lives on the page background, nowhere else.** One fixed layer (`body::before`) carries the blueprint
  grid (minor 24px, major 120px lines) and three soft colour spots (copper low left, sky top right, deep blue
  mid-page). It never scrolls or repaints. Cards, tables, tickets and charts stay clean and opaque on top of it.
- **Every element earns its place.** The bridge (`src/home/bridge.ts`: one glowing sky arch, a thinner copper arch
  above it, hangers fading to a baseline) belongs to the Home hero only: centred, scaling with the hero's width,
  below the text, with the overnight chips on glass above it.
- **One focal point per view.** Each page has one hero figure or chart; everything else supports it. One accent
  colour at a time per region: sky for interaction, copper for the single most important highlight.
- **Calm space and alignment.** Content sits on the 4/8px grid with shared edges; groups are separated by space
  before lines; lines before boxes. Related things are close, unrelated things apart.
- **Hierarchy by size and weight, not colour.** Colour is reserved for meaning (up/down, status, selection).
- **Motion explains.** Animate only what changed or what the pointer touches; ≤ 200 ms, eased; nothing loops.
- **Remove before adding.** A new visual touch replaces an old one or proves it helps a task; review new pages
  against this list before merging.

## Do

- Use tokens for every colour; add a token (both themes) rather than a hex in a rule.
- Reuse the classes above before adding new ones; keep the 4/8px rhythm.
- Check new pages at 1440, 1280 and 390 in both themes; charts follow with `followTheme(chart)`.

## Don't

- No firm names, logos, taglines, photos or addresses in the repo (client branding is imported from a file).
- No serif in dense data (tables, tickets, small numbers) and no colour as the only signal (use +/- and words too).
- No long or bouncy animations; nothing that moves without a hover, focus or press.
