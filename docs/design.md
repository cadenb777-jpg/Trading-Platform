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
| Glow | `--glow-sky` `--glow-copper` `--hero-bg` `--glass` | headers, Home hero, toasts |
| Space / shape | `--sp-1..6` (4px steps), `--radius-sm/-/-lg` (4/6/10), `--control-h` 32px | |
| Motion | `--dur-1` 120ms, `--dur-2` 180ms, `--ease`, `--lift` | off under `prefers-reduced-motion` |

Older names (`--panel`, `--panel-2`, `--border`, `--link` ...) point at these, so existing pages follow. Light mode
redefines the semantic tokens under `:root[data-theme='light']`. `src/ui/tokens.test.ts` checks every text token
against every background for 4.5:1 in both themes.

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

## Do

- Use tokens for every colour; add a token (both themes) rather than a hex in a rule.
- Reuse the classes above before adding new ones; keep the 4/8px rhythm.
- Check new pages at 1440, 1280 and 390 in both themes; charts follow with `followTheme(chart)`.

## Don't

- No firm names, logos, taglines, photos or addresses in the repo (client branding is imported from a file).
- No serif in dense data (tables, tickets, small numbers) and no colour as the only signal (use +/- and words too).
- No long or bouncy animations; nothing that moves without a hover, focus or press.
