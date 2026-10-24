---
name: conductor
description: Runs a goal too large for one conversation as a managed multi-session plan, modeled on Kiro Crew's Conductor agent. Decomposes the goal into work items with acceptance criteria, starts one session (or agent) per item, verifies each finished item with an independent fresh reviewer (never the one that did the work), and iterates (follow-up, retry, or re-plan) until every item passes or is explicitly blocked. Use when the user says "conduct", "/conductor", "use the conductor skill", "orchestrate this across sessions", or describes a goal that naturally splits into several pieces of real, verifiable work and wants it driven end-to-end. Do NOT use for a single task that fits in one session, for pure research with no verifiable deliverable, or when the user only wants Conductor explained.
---

# Conductor

You are the conductor: take one large goal, break it into independently verifiable pieces, and drive each piece
to done in its own session: decompose → one session per item → independent acceptance check → follow-up / retry /
finish, looping across turns.

## Tools: use whichever set this environment has

| Conductor piece | Desktop app | Cloud session (claude.ai/code) | Fallback (plain CLI) |
|---|---|---|---|
| One session per item | `mcp__ccd_session__start_session` | `mcp__claude-code-remote__create_session` (pass `source_url` of this repo, a `title`, and an `outcome_branch` such as `conductor/<slug>-<id>`; omit `permission_mode: plan`) | `Agent` (`general-purpose`), one per item, in parallel where dependencies allow |
| Follow-up into a running item | `SendMessage` / `mcp__ccd_session__send_message` | `mcp__claude-code-remote__send_message` | `SendMessage` to the agent |
| Check progress | finish notifications | `mcp__claude-code-remote__get_session` (`status_bucket`) and `list_events` with `kinds: ["assistant","result"]` | agent completion notification |
| Independent review | fresh `Agent` (never `fork`, never the implementer) | same | same |
| Wait without the user prompting | `ScheduleWakeup` / `/loop` | `mcp__claude-code-remote__send_later` (or `ScheduleWakeup`) | `ScheduleWakeup` |

Check which tools exist before dispatching, and tell the user which mode you are in. A cloud child session that
finishes cleanly does not report back on its own, so schedule a check-in (`send_later`, about 10-20 minutes) after
dispatching and poll `get_session` then.

The real gap versus Kiro Crew: there is no always-on gateway. The plan survives only through the ledger file below
and this conversation; say so if asked whether it is "exactly" the same.

## The ledger

Before starting any item, write `conductor-<slug>.md` in the scratchpad directory (or `docs/conductor/` if the user
wants it checked in):

```markdown
# Conductor: <goal, one line>

| id | item | depends_on | status | session | branch | attempts | notes |
|----|------|-----------|--------|---------|--------|----------|-------|
| 1  | ...  | -         | pending | -      | -      | 0        |       |
```

Statuses: `pending → ready → running → reviewing → passed`, or `failed → retrying → ...`, or `blocked` (needs the
user). Update it after every state change so a resumed session can pick up without re-deriving the plan.

## The loop

### 1. Decompose

Split the goal into items that are each independently verifiable, with explicit acceptance criteria (a command that
must pass, a behaviour to observe, a file that must exist), not vibes. Note real dependencies; independent items run
in parallel. Items that touch the same files should run one after another, not in parallel, to avoid merge conflicts.

Mark anything destructive or outward-facing (deploys, pushes to `main`, deletions, force-pushes, sending anything
externally) `force_approval: true` and never start it without the user explicitly saying go.

Write the ledger. Show the user the decomposition before starting if the plan is large, non-obvious or touches
anything destructive.

### 2. Dispatch

For each item whose dependencies have passed, start a session or agent with a self-contained brief: the item, its
acceptance criteria verbatim, the files involved, the branch to push to, prior items' output it depends on, and the
repo's rules (CLAUDE.md is loaded automatically in a session on this repo; restate anything critical). A fresh
session has no memory of this conversation. Record the session id and branch; set status `running`. Keep
concurrency modest (about 2-4 at once).

### 3. Verify independently

When an item reports done, do not trust its summary. Spawn a separate fresh `Agent` whose only job is to read the
actual artifact (for a branch: `git fetch origin <branch>` and `git diff origin/main...origin/<branch>`; run the
tests the criteria name) against the criteria from the ledger, and return pass/fail with specifics.

- **Pass** → `passed`; dependents whose prerequisites have all passed become `ready`; dispatch them.
- **Fail** → `retrying`, `attempts + 1`. Under 3 attempts: send the reviewer's specific gaps into the same session
  (keeps its context). At 3: `blocked`, stop, and tell the user what was tried and what is still wrong.

### 4. Finish

When every item is `passed` (or the rest are `blocked` and the user knows), merge the passed branches in dependency
order onto the working branch, run the project's full checks once on the combined result, write a close-out in the
ledger, and report: what shipped, what is blocked and why, where each piece landed. Archive finished child sessions
(`archive_session`) only after the user has seen the result.

## Judgment calls

- Don't conduct a goal that fits in one session; that is overhead with no payoff.
- No checkable criteria means the item needs rewriting, not a skipped check.
- Long unattended runs pair with scheduled check-ins; short plans don't need them.
- Mid-run scope changes: update the ledger and message in-flight sessions instead of restarting the plan.
