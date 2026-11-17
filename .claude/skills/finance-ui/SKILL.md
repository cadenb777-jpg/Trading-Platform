---
name: finance-ui
description: This platform's own design contract for any new or redesigned page, panel, chart or widget (the owner's colours, one hero visual per page, AI on every page, speed and no layout jank). Use before building or changing UI in src/, together with frontend-design and webapp-testing.
---

# Finance UI (this platform)

The owner wants each page to answer its main question at a glance, the way Macro's Fed-decision view does, with AI
explaining where the edge is. The design is free to change; these rules are not.

## Look
- Apple-quality finish (owner, 2026-11-17): San Francisco on Apple devices, Inter elsewhere (--font-ui); numbers in
  the same font with tabular digits; frosted glass (backdrop-filter) only on fixed chrome and pop-ups, never on
  scrolling panels (it drops frames); rounded glassy panels; space instead of borders. Less reading: explanations go
  in hover tips (src/ui/quiet.ts does long panel and page notes automatically), detail folds away.
- Fincept Terminal is the reference look (owner's choice): near-black, monospace, small uppercase amber headings with
  a rule, hairline panels, underlined uppercase tabs, label-value lists. Bloomberg is the feature checklist only.
  Keep the platform's signature on top: orange/amber accents and the blue glow (greeting banner, background, panel hover).
  The shared layer is the "Terminal look" block at the end of src/style.css: reuse its classes (.panel/.panel-head,
  .stat-cards, .data-table, .kv) instead of new one-off styles.
- Colours only through the CSS variables in `src/style.css` (`:root` and `:root[data-theme='light']`); never hex in
  new CSS. Labels amber/copper (`--accent-2-text`), figures white (`--text-strong`), green/red (`--up*`, `--down*`)
  only for good/bad, sky (`--accent`) for interaction. Both themes must work.
- Dense but calm: data first, few borders, numbers right-aligned in tables, units always shown, every figure says
  its source and date (hover or a small line).
- Each destination has its own accent (`--section-accent`, set from body[data-section]): use it for edges, glows and
  highlights in that section, never for text meaning good/bad. No rainbow: one accent per section plus amber.
- No decoration that carries no data (glows, emoji, gradient text, pulsing).

## Each page
1. One hero visual answering the page's main question (a gauge, a probability ladder, a heat map, a curve...).
   Before building it, sketch 3 different ways to show the same data and pick the one read fastest.
2. Then the detail, folded or in tabs.
3. AI: an insight button (`insightButton`) with page-specific suggestions (PAGE_SUGGESTIONS), and, where the page has
   things to do, an AI action in `src/ai/actions.ts` (never anything that trades).

## Speed and stability
- No work on scroll; charts resize with ResizeObserver, update in place, and are disposed when the page hides.
- Requests go through `engineRequest` (cached); show skeletons for waits over ~300 ms, never empty boxes.
- Check every change in the browser (Playwright, `executablePath: '/opt/pw-browsers/chromium'`) at 1280 and 375 px
  in dark and light: no horizontal page scroll, no overlapping labels, no console errors, smooth scrolling.
- Tests for any maths or data shaping (vitest / helper unittest) before publishing; one pull request per page.
