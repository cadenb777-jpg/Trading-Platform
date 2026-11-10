# Security

The platform handles broker keys and can place real orders, so it is built in layers: if one fails, the next still
holds. Nothing is "bulletproof"; these are the protections, what checks them, and what only the owner can switch on.

## How it is protected

| Where | Protection | Checked by |
|-------|-----------|------------|
| Keys and logins | Only on the owner's computer (`~/.trading-platform`), never in the browser or this repository. Files are private to the owner (helper `make_private`: folders 700, files 600 on Mac/Linux). | `helper/tests/test_security.py`, secret scan |
| Orders | Only through the Trade page: preview, then the confirm window; Test first, a typed `LIVE` opt-in, a maximum order value and orders per day; every attempt logged. The AI never trades; Schwab and Alpaca are market data only. | helper tests (`test_webull.py` and others) |
| The helper connection | Accepts only the published website (and local development) as origin. | `test_security.py` |
| The website | Content Security Policy: scripts only from the site itself (no inline scripts or `eval`), no plug-ins, no form posts. Refuses to run inside another site's frame (clickjacking guard, `src/frameGuard.ts`). AI answers and outside text are escaped, never inserted as HTML. | `frameGuard.test.ts`, `markdownSafety.test.ts` |
| Downloaded documents | SEC filings, news feeds and spreadsheets are read with `helper/engine/safexml.py`, which refuses XML entity bombs and external entities. SQL uses placeholders; dynamic column names come from fixed lists. | `test_security.py` |
| The desktop app | Shows only the website; other sites open in the normal browser (web and e-mail links only: no `file:`, network or program links). Notifications and the clipboard only for the website. | `desktop/tests/test_policy.py` |
| Updates | Downloaded only from GitHub over HTTPS, checked before anything runs, rolled back if the new version won't start. | `test_updater.py`, `desktop/tests/test_update.py` |
| This repository | Each workflow job has only the permissions it needs (only `deploy` publishes); every GitHub Action is pinned to an exact commit; checkouts keep no token. | `.github/workflows/*` |

## Automatic checks

- **Security checks** (`.github/workflows/security.yml`, every push and pull request and every Monday): no new
  secrets (`.secrets.baseline` lists the known fake test keys), no known high-severity vulnerabilities in the website,
  helper or desktop packages (`npm audit`, `pip-audit`), no high-severity Python issues (`bandit`).
- **CodeQL** (`.github/workflows/codeql.yml`): GitHub's code scanning for TypeScript and Python; results under
  Security > Code scanning.
- **Dependabot** (`.github/dependabot.yml`): proposes package and Action updates as pull requests that run all tests.
- Security skills for reviews are in `.claude/skills/sec-*` (Trail of Bits, CC BY-SA 4.0).

## What only the owner can switch on (GitHub settings, a few minutes)

The helper updates itself from this repository, so **this GitHub account is the most valuable thing to protect**:
anyone who could push here could ship code to the helper.

1. **Two-factor authentication** on the GitHub account (Settings > Password and authentication). Use an authenticator
   app or a passkey, not SMS.
2. **Branch protection for `main`** (repository Settings > Branches > Add rule): require a pull request or at least
   the status checks "Test and deploy" to pass, and block force pushes and deletion.
3. **Secret scanning and push protection** (repository Settings > Code security): turn on *Secret scanning*, *Push
   protection*, *Dependabot alerts* and *Dependabot security updates*.
4. On your computer: keep the operating system and browser up to date, and don't share the computer account that runs
   the helper.

## Reporting a problem

Something looks wrong (an unexpected order, a login you didn't make)? Stop the helper (close its window), change the
Webull and Schwab passwords and regenerate their API keys, and send the helper log (`~/.trading-platform/helper.log`)
from Settings > Send diagnostics (keys and account numbers are masked).
