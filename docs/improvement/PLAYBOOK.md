# Improvement playbook

The rules every scheduled improvement session follows. The owner approves every change: sessions only *propose*.

## Hard rules (never broken)

1. **Never trade.** Never place, preview, change or cancel an order; never call Webull, Schwab or any broker with the
   owner's keys; never run the helper against the owner's accounts. Code that places orders (`helper/engine/webull.py`,
   `src/trade/`) is only changed when the owner asked for it, and such a change is flagged in red in the report.
2. **Never publish.** Work on a branch `improve/<date>-<topic>`, open a pull request, stop. Never merge, never push to
   `main`. The owner approves (merges) or turns it down.
3. **Never weaken security.** Keys stay in `~/.trading-platform`; nothing secret in the repo, the browser or logs;
   the helper stays on 127.0.0.1 with its origin list; the CSP stays strict. Security fixes are welcome, loosening is not.
4. **Never invent data.** A figure is shown only from a source, with its time; when sources disagree, say so.
5. **Simplicity scales.** Remove before adding. A change that adds clutter, settings or indicators without a measured
   gain is not proposed.
6. **At most two open improvement pull requests.** If two are waiting, don't open a third: add findings to the
   newest one's report instead.
7. **Legal and ethical only.** No inside information, no market manipulation, no scraping that a site forbids, no
   copying AGPL or proprietary code, no real firm's branding.

## The loop (human judgement + machine checking)

1. **Learn from experience.** Read `docs/improvement/LESSONS.md` (what was proposed before, what the owner approved or
   turned down, and why) and the open/closed `improve/` pull requests. Don't repeat a rejected idea without new evidence.
2. **Find what's wrong (diagnostics).** Run every check: `npm test`, `npm run build`,
   `python -m unittest discover helper/tests`, `python -m unittest discover desktop/tests`, the security scans in
   `.github/workflows/security.yml`, the self-check's pure checks (`helper/engine/selfcheck.py`), the window-button
   overlap sweep and the scroll-smoothness measurement (60 fps target), and read the latest CI runs. A failing check is
   always the first priority.
3. **Hypothesis.** One focused change: what is wrong or could be better, for whom, and why it helps the owner trade or
   understand the market (clearer, more accurate, faster, safer, a better way to show data, Bloomberg-grade).
4. **Research the maths and the evidence.** Primary sources first: academic papers (SSRN, arXiv, journals), official
   documentation (exchanges, FRED, SEC, data vendors), textbooks. Forums and trader lore are ideas to test, never proof.
   Re-derive the maths; cite the source in the report.
5. **Experiment.** Measure before; change on the branch; measure after (tests, screenshots at several window sizes,
   timings, numbers checked against an independent source). A trading idea must pass the platform's own statistics
   before it is shown as more than research: random-entry test, Holm correction across everything tested, walk-forward
   on unseen data, results after costs (see `docs/research/setups-statistics.md`). If it fails, it is not proposed;
   it goes into the lessons log.
6. **Decide.** Use game-theory reasoning where a choice is genuinely uncertain (not every time): compare the owner's
   payoff with and without the change across situations (rising, falling and choppy markets; a glance versus deep
   study), the worst case (could it mislead? slow things down? add clutter?), and whether a simpler option dominates.
   Propose only changes that are better in expectation and never meaningfully worse.
7. **Report and wait.** Open the pull request with the report below, then stop.
8. **Remember.** Add a line to `LESSONS.md` in the same pull request (proposed, date, one-line why).

## The report (the pull request description), in plain language

- **What changes** (one or two sentences a beginner understands).
- **Why** (the problem found, or the gain, with the evidence: the measurement, the failing check, the paper).
- **Before / after** (numbers, screenshots, or the exact figures checked).
- **Risk** (what could go wrong; what it touches; "orders: not touched" stated explicitly).
- **How it was checked** (every test and check run, with results).
- **Decision** (the short game-theory or cost/benefit reasoning when it was a judgement call).
- **To approve:** merge the pull request (or tell Claude "approve #N"); the owner's private copy picks it up at its
  next start.
