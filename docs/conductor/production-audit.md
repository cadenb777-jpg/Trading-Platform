# Production-readiness audit: trading-platform (for sale as a product)

Audited 2026-10-24 at commit a958295. This was a read-only audit: nothing was edited, committed or pushed.

## Total: 43 / 100

This agrees with the friend's 40. The engineering is better than the score suggests: tests pass, deploy is gated on them, the helper checks Origin, and no remote HTML is injected into the page. The low total comes from areas that are not code quality: legal and licensing, commercial setup, installation for a non-technical buyer, and support.

**The main point:** code alone cannot get this product past about 70. The data sources (Schwab individual API, Google News, Forex Factory, Yahoo, the Nasdaq API) are personal-use or unlicensed sources. Selling the product needs licences, Schwab commercial approval and legal review. Those are business actions, not engineering ones.

| # | Area | Score | Top gaps |
|---|---|---|---|
| 1 | Security | 6 | No auth token on the local socket. Secrets in plaintext JSON (no OS keychain; chmod does nothing on Windows; the token file is never chmod'd). No CSP. The summary request can fetch any URL (SSRF). Python packages not pinned. The AI can write client and portfolio records after reading web-search results. |
| 2 | Reliability | 6 | The browser side is good (timeouts, reconnect, error replies). No global browser error handler. Market holidays are unknown. The helper has no supervisor or auto-restart. Some scanner failures are silent (16 broad `except Exception`). |
| 3 | Testing & CI | 5 | The real count is 143 vitest tests in 17 files. Local `npm test` shows 1,146 because it also picks up `.claude/worktrees` copies. 70 Python tests. CI does not run Python tests. No lint for TS or Python. No end-to-end/UI tests. `schwab_helper.py` (1,119 lines) has no direct tests. |
| 4 | Install & onboarding | 3 | Buyers must install Python, download a GitHub ZIP, click past SmartScreen/Gatekeeper, get Schwab developer approval and create their own app, then click past a certificate warning. Updates are "re-download the ZIP". No uninstaller. |
| 5 | Legal / licensing | 1 | No LICENSE file. Personal-use or unlicensed data sources. The TradingView attribution is switched off on 4 of 5 charts. No terms or privacy policy. Signals and grades given to buyers may be regulated advice. Client personal data is sent to Anthropic. |
| 6 | Product / UX | 5 | Rich and consistent, with theme variables, empty/loading/error states and plain-language help. Weak spots: focus outlines removed in places, mobile only partly supported, 89 hard-coded colours, no in-app user guide or onboarding. |
| 7 | Performance | 7 | About 115 KB gzip for the first load, pages loaded on demand. One dynamic import does nothing. Helper CPU while scanning has never been measured: about 100 stocks x 3 time frames x 1,000 simulations plus a ~1,474-combination lab. |
| 8 | Maintainability | 6 | Strict TS, no `any`-heavy boundaries, files at or under ~1,100 lines. Gaps: `style.css` is 4,860 lines, the helper message protocol has no shared schema, the version banner is a growing chain of `v <` checks, and CLAUDE.md is the only architecture doc. |
| 9 | Observability & support | 3 | Rotating helper log and version reporting exist. No in-app "export diagnostics", no crash reporting, no bug-report path for users (GitHub Issues is developer-facing), no release notes beyond README prose. |
| 10 | Commercial readiness | 1 | No accounts, licence keys, payments, entitlements, support channel or business entity. One hard-coded GitHub Pages origin. Every buyer needs their own Schwab developer approval, which makes the funnel very hard. |

---

## Evidence by area

### 1. Security (6/10)

What is good:
- **The helper checks Origin.** `helper/schwab_helper.py:65-71` defines `ALLOWED_ORIGINS` (the owner's GitHub Pages origin plus localhost dev ports), enforced at `:1010` with `serve(..., origins=ALLOWED_ORIGINS, max_size=40 MiB)`. A random website the user visits gets refused during the handshake, and requests with no Origin header are refused too (None is not in the list). The friend's likely worry ("any site can drive the helper") is **not true**.
- It binds to `127.0.0.1` only (`:53`). Symbols are validated with a regex (`:73`, `:632`). Store collections are an allow-list (`helper/engine/store.py:15,30`). SQL is parameterised throughout.
- **No XSS from remote data.** Only 6 `innerHTML` uses in `src/`. Four render AI output through `src/ai/markdown.ts`, which escapes `& < > "` first (`:3,6`) and only builds `https?://` links (`:11`). The other two are fixed SVG templates (`src/ui/icons.ts:54`, `src/ui/sparkline.ts:31`). Everything else uses `h()` (`src/ui/dom.ts:5`), which uses `setAttribute` and `append` (text nodes).
- Secrets stay out of the browser. `settings.public()` returns only booleans (`helper/engine/settings.py:48-57`). Config and settings are chmod'd 0600 (`schwab_helper.py:180`, `settings.py:42`).
- `npm audit --omit=dev` reports **0 vulnerabilities**, and so does a full `npm audit`. `git grep` found no committed secrets.
- The SEC User-Agent includes the contact email (`helper/engine/core.py:99`) and requests are throttled with `Semaphore(5)` (`helper/engine/sec.py:17`). Both follow https://www.sec.gov/os/accessing-edgar-data (declared UA, ≤10 req/s).

Gaps:
- **No per-session secret.** The Origin header is only enforced by browsers. Any local process (malware, another user's script) can send `Origin: https://cadenb777-jpg.github.io` and get full access: read clients and portfolios (`store.list`), overwrite settings, use the user's Anthropic key. Also, every GitHub Pages repo of the `cadenb777-jpg` account shares that origin. For a sold product, add a random token that the helper creates and hands to the browser once, through a pairing step or a URL fragment the helper opens.
- **Secrets are plaintext JSON.** `~/.trading-platform/settings.json` holds the Anthropic key and `schwab_config.json` holds the client secret. `schwab_token.json` (`schwab_helper.py:62`) is written by schwab-py and never chmod'd. `chmod` does nothing on Windows. `settings.save` writes the file and only then calls chmod (`settings.py:40-42`), so the file is briefly readable under the default umask. Use the OS keychain (`keyring`: Windows Credential Manager / macOS Keychain), or at least create the file with 0600 from the start.
- **SSRF.** `summary` accepts any `http(s)` link (`schwab_helper.py:639`) and the shared client follows redirects (`core.py:82`). An XSS on the allowed origin, or a local process, could make the helper fetch LAN addresses (router admin pages, `169.254.169.254`). Block private and loopback IPs and limit hosts to known news domains.
- **No CSP.** `index.html` has no `Content-Security-Policy`. GitHub Pages cannot send headers, so add a `<meta http-equiv>` CSP: `default-src 'self'`; `connect-src 'self' ws://127.0.0.1:8765 https://api.exchange.coinbase.com wss://...`; `style-src 'self' fonts.googleapis.com`; `font-src fonts.gstatic.com`; `img-src 'self' data: blob:`.
- **AI prompt injection.** `helper/engine/ai.py` exposes write tools (`save_portfolio` :141, `save_client` :179, `ui_action` :188) next to `web_search` (:23). Text injected into a web page or news story could make the model change records. Require user confirmation in the browser for write tools.
- **Client personal data leaves the machine.** `list_clients` and the portfolio tools send client names and holdings to Anthropic. For an RIA that is a Reg S-P privacy issue and must be disclosed.
- **Python supply chain.** `helper/requirements.txt` uses ranges (`schwab-py>=1.5,<2`, `websockets>=14`, `httpx>=0.25`, `tzdata` unpinned) with no hashes or lockfile, and every user runs `pip install` on first start. Ship a pinned, hashed lock (`pip-compile --generate-hashes`) or a frozen build.
- Fonts load from Google Fonts (`index.html:7-9`), which sends each user's IP to Google. That needs a line in the privacy policy, or self-host the fonts.

### 2. Reliability (6/10)

What is good: `src/data/schwab.ts` has per-request timeouts (`:194-207`, the timer restarts on each streamed event), auto-reconnect while anything is listening (`:311-315`), re-subscribe after reconnect (`:170`), and an update banner for older helpers. The helper wraps every request and reports the failure instead of crashing (`schwab_helper.py:754`), answers unknown requests with an error (`:570-576`), keeps working when optional modules fail (`engine.LOAD_ERRORS`), uses a rotating log (`:1062`, 1 MB x1), serves stale cache with background refresh (`core.py:110-130`), and treats Nasdaq earnings failures as "unavailable" rather than "none". `src/storage.ts` wraps localStorage in try/catch.

Gaps:
- The browser has no `window.onerror` / `unhandledrejection` handler (grep found none). Uncaught errors vanish.
- `market_session` ignores holidays (`core.py:23-24`, stated in its docstring), so the scanner and labels treat holidays as trading days.
- No process supervisor: if the helper dies, the user must notice and double-click again. There is no auto-start at login.
- There are 16 broad `except Exception` blocks in `engine/scanner.py`. Check that each one logs.
- Schwab sign-in expires about weekly, and the fix is "close and restart" (`core.py:163`). The refresh-token expiry is never shown ahead of time.

### 3. Testing & CI (5/10)

- `npm test` reports 136 files and 1,146 tests passing, **but that is inflated 8x**. Vitest also collects the 7 copies under `.claude/worktrees/` (git-ignored, but there is no `test.exclude`). The real suite (`npx vitest run --dir src`) is **17 files, 143 tests**, covering indicators, backtest, script interpreter, bonds, portfolio, DCF, markdown, entry zone, quotes, the engine cache and the session.
- Helper: `python -m unittest discover helper/tests` gives **70 tests OK in 78.6 s**, all in one file, `test_engine.py`. It imports `strategies, alts, core, flow, invest, quant, scanner`. Not imported: `ai, sec, macro, research, positioning, store, settings, actuals, lab` (lab may be indirect), and nothing in `schwab_helper.py` (1,119 lines: protocol dispatch, news parsing and ranking, calendar, summaries).
- CI (`.github/workflows/deploy.yml`) runs `npm ci`, `npm test` and `npm run build` (`tsc --noEmit` + vite) **before** deploy. Good. The Python tests are **not** in CI. There is no lint (no eslint, prettier or ruff config), no end-to-end browser tests (Playwright is mentioned in CLAUDE.md but has no tests or config), no coverage report, and no PR workflow (it runs only on push to main).
- `tsconfig.json` is `strict` with `noUnused*`. Good.

### 4. Install & onboarding (3/10)

The buyer's path (`helper/README.md`):
1. Install Python and tick "Add to PATH" on Windows (`start-windows.bat` stops with "Python was not found").
2. Download a GitHub ZIP. **Today's link points at the owner's own repo** (`helper/README.md`, step 2; `src/main.ts:187`).
3. Click past SmartScreen ("Run anyway") or Gatekeeper (right-click, Open). Nothing is signed.
4. **Open a Schwab developer account, request Trader API access, create an app with callback `https://127.0.0.1:8182`, and wait for approval.** Every buyer must do this. It is the single biggest onboarding barrier and the README hardly explains it.
5. Paste keys into a console window, log in, then click past "Your connection is not private".
6. Re-login about weekly. Updates mean re-downloading the ZIP and copying it over. No auto-update, no uninstaller (the user deletes the folder and `~/.trading-platform` by hand).

Good: `splash.py` (standard library only) hides pip behind a progress bar and logs to `launcher.log`, and Settings shows which modules failed.

### 5. Legal / licensing for sale (1/10)

- **No LICENSE file.** `package.json` says `"license": "UNLICENSED"`, which means all rights reserved by default. There are no EULA or terms. `fflate` (MIT) and `lightweight-charts` (Apache-2.0) need their notices shipped. There is no THIRD_PARTY_NOTICES.
- **TradingView attribution.** The lightweight-charts README (`node_modules/lightweight-charts/README.md:127-131`) says: "You shall add the attribution notice from the NOTICE file and a link to https://www.tradingview.com/ to the page..." The `attributionLogo` option is the way to meet the link requirement. The code sets `attributionLogo: false` in `src/ui/charts.ts:25`, `src/ui/chartWindow.ts:165`, `src/pages/setupsPage.ts:482` and `src/pages/homePage.ts:70`. Only the main `ChartView` (`src/chart/ChartView.ts:91`) keeps the default logo. No attribution page exists. Easy fix: add an About/Credits page with the notice and link.
- **Data sources** (each is a blocker for selling unless licensed):
  - *Schwab Trader API.* Individual access is for apps that log into **your own** accounts. Distributing an app to other account holders, free or paid, needs **Trader API – Commercial** approval, which reportedly has long delays. Sources: https://blog.traderspost.io/article/thinkorswim-api, https://wealth-lab.com/Discussion/Schwab-broker-extension-Beta-release-11565, https://blog.traderspost.io/article/will-traderspost-reconnect-with-charles-schwab. I could not reach Schwab's own terms page; check developer.schwab.com → API Products. Under today's design each buyer brings their own Individual app. Whether selling software built for that is allowed needs Schwab's written answer. Showing exchange real-time data to non-professional users also involves exchange data agreements.
  - *Google News RSS* and the batchexecute decoding (`schwab_helper.py:98, 499-507`): the feeds are reported to be for non-commercial use, with attribution duties (https://www.searchenginejournal.com/google-news-offers-rss-and-atom-feeds/2022, https://www.fullpress.it/en/rss-feed-google-news-illegal-commercial-republication/). Decoding Google's internal `batchexecute` endpoint is reverse engineering an undocumented API.
  - *Full-article fetching and summarising* (`summary`): it copies publishers' copyrighted text into the app. That is risky in a paid product.
  - *CNBC / CoinDesk RSS*: publisher feeds normally allow personal, non-commercial use. A licence is needed for a commercial product.
  - *Forex Factory* (`nfs.faireconomy.media`, `schwab_helper.py:133`): the notices say the calendar database is copyrighted by Fair Economy, Inc. and must not be copied or redistributed without written consent (https://www.forexfactory.com/notices).
  - *Yahoo Finance* chart API (`core.py:147`) is called **with a spoofed Chrome User-Agent** (`core.py:18,82`). It is widely described as personal use only (https://pypi.org/project/yfinance/). Spoofing a browser to reach an undocumented endpoint is the weakest position possible.
  - *Nasdaq* `api.nasdaq.com/api/calendar/earnings` (`engine/scanner.py:397`): undocumented, browser UA. Nasdaq's site terms restrict automated use.
  - *Public-domain sources* that are fine with attribution: SEC EDGAR (follow fair access, which the code does), CFTC COT, FINRA short-volume files (check FINRA's terms for redistribution), Treasury Fiscal Data, FRED (free, but some series belong to third parties such as ICE BofA spreads and S&P indices, which FRED's terms limit for commercial use; check each series in `bonds.market`), Coinbase public market data (check the Coinbase API terms for commercial display).
- **Advice regulation.** The Setups page gives A/B/C grades, "buy-stop above...", entry, stop, target, a **position size calculator** and "what to do" (`src/home/tradeRead.ts:4`, `src/home/tradeGuide.ts`). Coming from a registered investment adviser and sold to the public, this is close to personalised or impersonal advice and to marketing-rule territory, and it may trigger a publisher-exclusion analysis. Current disclaimers are short one-liners (`tradeGuide.ts:269` "Education, not advice", `assistant.ts:113`, `insight.ts:38`, `researchPage.ts:336`). Backtests and hypothetical results shown to buyers fall under the SEC Marketing Rule's hypothetical-performance conditions if the RIA markets them. This needs a securities lawyer.
- **No privacy policy.** The app processes Schwab account access, client personal data (local, but sent to Anthropic through AI tools), the user's IP sent to Google Fonts and every data host, and the SEC contact email.
- **AI terms.** Using the Anthropic API under the buyer's own key is fine, but the product must pass through Anthropic's usage policy and say that AI output can be wrong.

### 6. Product / UX (5/10)

- Good: consistent `h()` UI, light/dark theme with 450 `var(--` uses, plain-English copy, glossary tooltips (`src/ui/glossary.ts`), modals close on Escape (`dom.ts:24-26`) and have `role="dialog"` and `aria-label`, 147 real `<button>`s and only 1 clickable `div`, 127 aria/role attributes, error banners when the helper is down (`homePage.ts:175`).
- Gaps: `outline: none` without a replacement at `src/style.css:211`, `:2020` and `:4820`; 89 hard-coded hex colours in `style.css` (against the project's own rule); no contrast audit; modals do not trap focus or return focus to the opener; the mobile layout is media queries only (ROADMAP Stage 11 says phone use is not built); no first-run tour or in-app user guide (the docs are the GitHub README); no "About / version / credits" page.

### 7. Performance (7/10)

`npm run build`: the main `index` chunk is 156.9 KB (55.7 KB gzip), `theme` (which includes lightweight-charts) is 182.5 KB (59.1 KB gzip), CSS is 66 KB (13.5 KB gzip), and pages load on demand (largest `investmentsPage` at 66 KB). The build takes 0.5 s. Warning: `calendarPage.ts` is imported both dynamically (`main.ts`) and statically (`homePage.ts`), so the dynamic import has no effect. Browser reply cache and request de-duplication are in place. **Helper CPU and RAM while scanning have not been measured**: Nasdaq-100 x 3 horizons x 3 strategies, 1,000-run simulations, Benjamini-Hochberg, and the lab's ~1,474 combinations x 3 walk-forward windows. On a buyer's laptop this needs a benchmark and a low-power mode.

### 8. Maintainability (6/10)

82 TS source files (~19.3 k lines). The largest are `indicators/more.ts` (861), `script/interpreter.ts` (847) and `invest/altsView.ts` (792). Python: `schwab_helper.py` (1,119), `engine/scanner.py` (1,041), `splash.py` (913). Sizes are reasonable. `src/style.css` is a single 4,860-line file. The WebSocket protocol is untyped on both sides (Python dicts against hand-written TS interfaces), with no shared JSON schema and no contract tests. `src/main.ts:186` has a growing ternary chain for each version. Docs: CLAUDE.md is dense but accurate, `docs/research/setups-statistics.md` exists, and there are no ADRs yet. 58 TS lines are over 300 characters. Mixed casing `Trading-Platform` and `trading-platform` in URLs (`schwab_helper.py:56`, `main.ts:187`).

### 9. Observability & support (3/10)

Have: helper log `~/.trading-platform/helper.log` (rotating), `launcher.log`, version in the status push, update banner, log path shown in Settings (`src/ui/settings.ts:94`). Missing: a one-click "Export diagnostics" (logs, versions, OS, `LOAD_ERRORS`, last errors, with secrets removed), a browser error log, opt-in crash reporting, a user-facing bug report or contact path, a CHANGELOG or release notes (versions are listed only in README prose), and releases tagged in git or on GitHub.

### 10. Commercial readiness (1/10)

No accounts, licensing, payments, entitlement checks, terms acceptance, support process or business entity. The site is one hard-coded origin, `https://cadenb777-jpg.github.io`, and the helper allows only that origin. A buyer cannot host their own copy without editing Python. Under the current architecture every buyer must (a) hold a Schwab brokerage account, (b) pass Schwab developer approval, and (c) bring their own Anthropic key. That rules out a mass-market subscription. Realistic models: (1) a one-time-licence desktop tool for Schwab clients who bring their own keys, which needs Schwab's OK; (2) a pivot to a licensed data vendor (Polygon/Massive, Databento, Tiingo, Intrinio, Benzinga News, Trading Economics calendar) plus the small backend ROADMAP Stage 11 already plans; (3) keep it as the owner's internal RIA tool and do not sell it.

---

## Prioritised fix list

### (A) Code fixes an engineer can do now

P0 = before any outside user, P1 = before a paid launch, P2 = polish. Effort: S < 1 day, M 1–3 days, L > 3 days.

| Pri | Fix | Where | Effort |
|---|---|---|---|
| P0 | **Add a LICENSE (proprietary EULA template, marked for legal review) and THIRD_PARTY_NOTICES** (lightweight-charts Apache-2.0 + NOTICE, fflate MIT, tslib 0BSD, Python packages: schwab-py MIT, websockets BSD, httpx BSD, numpy/scipy BSD, anthropic MIT). Generate them with `license-checker` / `pip-licenses`. | repo root, `package.json` license field | S |
| P0 | **Restore TradingView attribution**: remove `attributionLogo: false` or add an About/Credits page with the NOTICE text and a tradingview.com link. | `src/ui/charts.ts:25`, `src/ui/chartWindow.ts:165`, `src/pages/setupsPage.ts:482`, `src/pages/homePage.ts:70` | S |
| P0 | **Pairing token on the helper socket**: on first start the helper generates a 32-byte token stored at 0600 and opens the platform with `#pair=<token>`. The browser saves it and sends it as the first message (or a subprotocol header). The helper rejects anything else. Keep the Origin check. | `schwab_helper.py:619` `handle_browser`, `:1010`; `src/data/schwab.ts` connect | M |
| P0 | **SSRF guard on `summary`**: resolve the host and refuse private, loopback and link-local addresses; allow-list news hosts; check redirect targets the same way. | `schwab_helper.py:467-510, 639` | S |
| P0 | **Confirm AI write tools in the browser** (`save_portfolio`, `save_client`; mark web-search results as untrusted). | `helper/engine/ai.py:141,179,188`; `src/ai/assistant.ts` | M |
| P0 | **In-app Disclaimer, Terms and Privacy pages** (templates marked "DRAFT – legal review required"), a first-run acceptance gate, and a persistent "Education only, not investment advice; hypothetical results" banner on Setups, Backtest and the AI. | new `src/pages/legalPage.ts`, `src/main.ts`, `src/pages/setupsPage.ts`, `src/home/tradeGuide.ts:269` | M |
| P0 | **CSP meta tag** in `index.html` (`default-src 'self'`; connect-src for `ws://127.0.0.1:8765` and Coinbase; fonts; `img-src data: blob:`). Test every page with Playwright. | `index.html` | S |
| P0 | **CI: Python tests + lint + PR checks**: add a job with `setup-python`, `pip install -r helper/requirements.txt -r requirements-extra.txt`, `python -m unittest discover helper/tests`, `ruff check helper`; add eslint (`typescript-eslint`) for `src`; run on `pull_request` too. Deploy only when all jobs pass. | `.github/workflows/deploy.yml`, new `ci.yml` | S |
| P0 | **Fix the inflated local test count**: in `vite.config.ts` set `test: { exclude: ['**/node_modules/**', '.claude/**', 'dist/**'] }`. | `vite.config.ts` | S |
| P1 | **Secrets in the OS keychain** (`keyring`), with a fallback file created with `os.open(..., 0o600)`. chmod `schwab_token.json`. Remove the write-then-chmod race. | `engine/settings.py:37-45`, `schwab_helper.py:175-182`, token path `:62` | M |
| P1 | **Pin and hash Python dependencies** (`pip-compile --generate-hashes` → `requirements.lock`); splash installs with `--require-hashes`. | `helper/requirements*.txt`, `helper/splash.py:565, 726` | S |
| P1 | **Data provider abstraction** in the helper: interfaces `NewsSource`, `CalendarSource`, `EarningsSource`, `DividendSource`, `QuoteSource`, chosen in `settings.json` (`providers: {news: 'google_rss' \| 'benzinga', ...}`), with each source labelled `personal_use` or `licensed`. A "commercial build" flag refuses to load `personal_use` sources. Drop the spoofed `BROWSER_UA` for undocumented APIs. | `engine/core.py:18,82,147`, `schwab_helper.py:98-133, 467-510`, `engine/scanner.py:397` | L |
| P1 | **First-run setup wizard in the browser**: step-by-step Schwab developer instructions with screenshots, a callback-URL copy button, key entry through the helper (not the console), a status check, and an explanation of the certificate warning. | `src/ui/settings.ts`, new `src/ui/setupWizard.ts`, helper handlers `setup.*` | L |
| P1 | **Packaged installer**: PyInstaller or Briefcase bundles of the helper (no Python needed), a signed Windows MSI/EXE (Inno Setup or WiX) and a notarised macOS .app/.pkg, built by a GitHub Actions matrix on tags. Add auto-update (check GitHub Releases, then download) and an uninstaller that offers to delete `~/.trading-platform`. | new `packaging/`, `.github/workflows/release.yml` | L |
| P1 | **Export diagnostics**: a helper handler that zips the helper log, launcher log, versions, OS, `LOAD_ERRORS` and recent errors (secrets and emails removed), plus the browser error ring buffer. A "Report a problem" button in Settings that opens a pre-filled email or form. | new `engine/diag.py`, `src/ui/settings.ts:94` | M |
| P1 | **Global browser error capture** (`window.onerror`, `unhandledrejection`) into a ring buffer, shown in diagnostics. Optional opt-in Sentry (free tier). | `src/main.ts` | S |
| P1 | **Versioned release notes**: `CHANGELOG.md`, git tags `helper-v20`, GitHub Releases. The version banner reads notes from a JSON file instead of the ternary chain. | `src/main.ts:182-187`, README prose | S |
| P1 | **Configurable site origin and URLs**: `ALLOWED_ORIGINS` and `PLATFORM_URL` from settings or the build, so a licensed customer or white-label copy works. Fix the `Trading-Platform`/`trading-platform` casing. | `schwab_helper.py:56,65-71`, `src/main.ts:187` | S |
| P1 | **Helper protocol contract**: a JSON Schema (or TypedDict + generated TS types) for each request and reply, with contract tests for `handle_browser` dispatch, `rank_news`, calendar parsing and summary extraction. | `schwab_helper.py`, `src/data/schwab.ts`, `helper/tests/` | M |
| P1 | **Tests for untested handlers** (`ai` tool routing with a mocked SDK, `store`, `settings` validation, `sec`, `macro`, `research`, `positioning`) and Playwright smoke tests of each page with a fake helper. | `helper/tests/`, new `e2e/` | L |
| P1 | **Accessibility pass**: add `:focus-visible` replacements at `style.css:211, 2020, 4820`; focus trap and focus return in `openModal` (`dom.ts:19`); check contrast in both themes (axe-core in Playwright); `aria-live` for price and status updates; replace the 89 hex colours with variables. | `src/style.css`, `src/ui/dom.ts` | M |
| P1 | **Market holiday calendar** (NYSE holidays and half days) in `market_session` and the scanner. | `engine/core.py:23` | S |
| P1 | **Benchmark and cap helper CPU**: measure one full scan; add a "low-power" setting (fewer simulations, lab off, scan every 15 min) and run heavy work in a process pool at lower priority. | `engine/scanner.py`, `engine/lab.py` | M |
| P2 | Auto-start the helper at login (optional) and a tray icon showing its status. | packaging | M |
| P2 | Fix the ineffective dynamic import of `calendarPage` (move the shared parts out). | `src/pages/homePage.ts`, `src/main.ts` | S |
| P2 | Self-host the Inter and Source Serif fonts (privacy, CSP). | `index.html:7-9` | S |
| P2 | Split `style.css` per page/component. | `src/style.css` | M |
| P2 | Licence-key check scaffold (signed licence file checked by the helper) and an entitlement flag per feature, so business decisions can be wired in later. | helper + `src/main.ts` | M |
| P2 | Disclose and optionally remove client personal data from AI tool results (send initials or IDs instead of names). | `engine/ai.py:174-187, 379-403` | S |

With all of (A) done, a realistic score is about 70–75. The remaining points depend on (B).

### (B) Needs the owner's decision or outside action (code cannot fix these)

1. **Decide what is being sold.** Choose between a desktop tool for Schwab clients who bring their own keys, a SaaS on licensed data, or keeping it internal to the RIA. Every other item depends on this.
2. **Schwab.** Ask Schwab Developer Support in writing whether selling software that customers use with their own Individual Trader API apps is allowed, or apply for **Trader API – Commercial** (expect long delays). Ask about exchange real-time data entitlements for redistribution.
3. **Data licences.** Replace Google News RSS, article summaries, CNBC/CoinDesk RSS, Forex Factory, the Yahoo chart API and the Nasdaq earnings API with licensed feeds, or get written permission. Candidates: Benzinga/Tiingo news, Trading Economics or Finnhub calendar and earnings, Polygon (Massive)/Tiingo/EODHD for dividends and prices. Budget roughly a few hundred dollars a month or more. Check FRED third-party series (ICE BofA, S&P) and the Coinbase and FINRA terms for commercial display.
4. **Securities regulation.** As an RIA selling grades, entry/stop/target and position sizing to the public, have securities counsel review: the publisher's exclusion, Form ADV disclosure, the Marketing Rule on hypothetical and backtest performance, record-keeping, and whether the Setups and AI features must be removed or reworded for buyers. Get the disclaimers written by counsel.
5. **Business entity and IP.** Form an LLC, confirm the owner holds all code IP (AI-generated code, any contributors), register a trademark check for the product name, and stop using "TradingView-style" or "Bloomberg" marketing.
6. **Terms, EULA and privacy policy.** Have counsel finalise the templates from (A). Cover Anthropic data flows, Reg S-P for client data, Google Fonts and other third-party hosts, and data retention.
7. **Code signing.** Buy an Authenticode certificate (EV recommended, about $300–600 a year) and an Apple Developer account ($99 a year) for notarisation.
8. **Payments and licensing.** Choose a provider (Stripe, Lemon Squeezy or Paddle as merchant of record handles sales tax and VAT) and a licence model. A custom domain to replace `cadenb777-jpg.github.io` (about $12 a year).
9. **Support.** A support email or helpdesk, response-time promise, refund policy, and status/known-issues page.
10. **Insurance.** E&O / cyber cover once paying users touch brokerage credentials.

Sources consulted (web):
- https://blog.traderspost.io/article/thinkorswim-api
- https://blog.traderspost.io/article/will-traderspost-reconnect-with-charles-schwab
- https://wealth-lab.com/Discussion/Schwab-broker-extension-Beta-release-11565
- https://www.searchenginejournal.com/google-news-offers-rss-and-atom-feeds/2022
- https://www.fullpress.it/en/rss-feed-google-news-illegal-commercial-republication/
- https://www.forexfactory.com/notices
- https://pypi.org/project/yfinance/
- https://www.sec.gov/os/accessing-edgar-data

I could not retrieve Schwab's own developer terms or Google's or Yahoo's terms pages directly. The statements above rely on secondary sources and must be confirmed with the providers or counsel.
