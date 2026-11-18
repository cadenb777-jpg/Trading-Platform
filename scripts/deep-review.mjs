// Deep review: every page and tab at one width. Clicks every visible button inside the page, checks errors, overlaps,
// stuck pop-ups, scrolling (reaches the end, no trapped inner scrollers, nothing hidden under the status bar) and
// empty space on the first screen. Runs against the stand-in helper in a throwaway browser profile.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const width = +(process.argv[2] || 1280);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width, height: 900 } });
const p = await ctx.newPage();
ctx.on('page', (np) => np !== p && np.close().catch(() => {})); // links that open a new tab
p.on('dialog', (d) => d.dismiss().catch(() => {}));
let errs = [];
p.on('pageerror', (e) => errs.push(`PAGEERR ${e.message.slice(0, 140)}`));
p.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_|Failed to load resource|fonts|not in test/.test(m.text()) && errs.push(m.text().slice(0, 140)));
await p.route((u) => u.hostname === 'coinbase.com' || u.hostname.endsWith('.coinbase.com'), (r) => r.abort());

const overlaps = () => p.evaluate(() => {
  const out = [];
  const vis = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length;
  const sb = document.querySelector('.statusbar, .status-bar, footer.sb, .app-status')?.getBoundingClientRect();
  for (const parent of document.querySelectorAll('.app-main *')) {
    const kids = [...parent.children].filter((k) => vis(k) && !['absolute', 'fixed', 'sticky'].includes(getComputedStyle(k).position) && !(k instanceof SVGElement));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), hh = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 3 && hh > 3 && a.width > 4 && c.width > 4) out.push(`OVERLAP ${kids[i].tagName}.${String(kids[i].className).slice(0, 28)} x ${kids[j].tagName}.${String(kids[j].className).slice(0, 28)} (${Math.round(w)}x${Math.round(hh)})`);
    }
  }
  for (const e of document.querySelectorAll('.app-main *')) {
    if (!vis(e) || e.childElementCount || e.closest('.sr-only, .visually-hidden')) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && e.textContent.trim()) out.push(`CLIPPED ${e.tagName}.${String(e.className).slice(0, 28)} "${e.textContent.trim().slice(0, 28)}"`);
  }
  return [...new Set(out)].slice(0, 10);
});

// scrolling: the page's scroller reaches its end; inner scrollers that trap the wheel; content cut by the status bar
const scrolling = () => p.evaluate(async () => {
  const out = [];
  const main = document.querySelector('.app-main');
  const view = [...document.querySelectorAll('.views > *')].find((v) => !v.hidden && v.offsetParent) ?? main;
  const scrollers = [...view.querySelectorAll('*'), view].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 40; });
  const page = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (page) {
    page.scrollTop = page.scrollHeight;
    await new Promise((r) => setTimeout(r, 250));
    const max = page.scrollHeight - page.clientHeight;
    if (page.scrollTop < max - 2) out.push(`SCROLL did not reach the end (${Math.round(page.scrollTop)} of ${Math.round(max)})`);
    const box = page.getBoundingClientRect();
    const sb = [...document.querySelectorAll('body > *, .shell *')].find((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().top > innerHeight - 80 && e.getBoundingClientRect().width > innerWidth * 0.5);
    const limit = Math.min(box.bottom, sb ? sb.getBoundingClientRect().top : innerHeight);
    const closed = (e) => { const d = e.closest('details:not([open])'); return !!d && !e.closest('summary'); };
    const last = [...page.querySelectorAll('*')].filter((e) => e.offsetParent && e.childElementCount === 0 && e.textContent.trim() && !closed(e)).map((e) => e.getBoundingClientRect().bottom);
    const lowest = Math.max(0, ...last);
    if (lowest > limit + 2) out.push(`SCROLL last content ${Math.round(lowest - limit)}px under the bottom bar at full scroll`);
    page.scrollTop = 0;
  }
  // inner scrollers taller than half the screen inside the page scroller trap the wheel
  for (const e of scrollers) {
    if (e === page || e.closest('.chart-page, .tv-lightweight-charts, .modal')) continue;
    if (e.clientHeight > innerHeight * 0.55) out.push(`TRAP inner scroller ${e.tagName}.${String(e.className).slice(0, 30)} ${e.clientHeight}px tall`);
  }
  // sideways scroll of the whole page
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`HSCROLL page ${document.documentElement.scrollWidth - innerWidth}px wider than the screen`);
  return out;
});

// empty space on the first screen: sample points over the page area; a point is empty when it lands on a big container
const emptiness = () => p.evaluate(() => {
  const main = document.querySelector('.app-main').getBoundingClientRect();
  const area = main.width * main.height;
  const top = main.top + 60, bottom = Math.min(innerHeight - 30, main.bottom);
  const cols = 24, rows = 16;
  let empty = 0, total = 0;
  const emptyRows = [];
  for (let r = 0; r < rows; r++) {
    let rowEmpty = 0;
    for (let c = 0; c < cols; c++) {
      const x = main.left + 12 + ((main.width - 24) * (c + 0.5)) / cols;
      const y = top + ((bottom - top) * (r + 0.5)) / rows;
      const el = document.elementFromPoint(x, y);
      total++;
      const rect = el?.getBoundingClientRect();
      const big = !el || el === document.body || el.matches('.app-main, .views, .analysis-page, .ap-body, .shell, html') || (rect && rect.width * rect.height > area * 0.45 && !el.closest('canvas, svg, table, .tv-lightweight-charts, textarea, .chart-page'));
      if (big) { empty++; rowEmpty++; }
    }
    emptyRows.push(rowEmpty / cols);
  }
  // the longest run of rows that are mostly empty (a blank band)
  let run = 0, best = 0;
  for (const f of emptyRows) { run = f > 0.7 ? run + 1 : 0; best = Math.max(best, run); }
  return { emptyPct: Math.round((empty / total) * 100), blankBandPx: Math.round((best * (bottom - top)) / rows) };
});

const routes = only ?? ['home', 'desk', 'monitor', 'invest', 'futures', 'macro', 'calendar', 'chart', 'sec/AAPL/DES', 'research', 'flow', 'setups', 'screener', 'backtest', 'strategy', 'account', 'portfolio', 'trade', 'journal', 'prospect', 'clients'];
const report = {};
await p.goto('http://localhost:5322/#home'); await p.waitForTimeout(3500);
const SKIP = /log ?out|delete view|delete|^remove|place order|confirm order|send to webull|go live|live mode/i;
for (const r of routes) {
  errs = [];
  await p.evaluate((h) => (location.hash = h), r); await p.waitForTimeout(2600);
  const found = { empty: await emptiness(), base: await overlaps(), scroll: await scrolling(), clicks: 0, issues: [] };
  const sel = '.views > *:not([hidden]) button:visible';
  const labels = await p.locator(sel).evaluateAll((bs) => bs.map((x, i) => ({ i, t: (x.textContent || x.title || x.getAttribute('aria-label') || '').trim().slice(0, 40) })));
  const seen = new Set();
  for (const { t } of labels.slice(0, 70)) {
    if (!t || seen.has(t) || SKIP.test(t)) continue;
    seen.add(t);
    const btn = p.locator(sel).filter({ hasText: t }).first();
    if (!(await btn.count())) continue;
    const before = errs.length;
    try { await btn.click({ timeout: 1500 }); } catch { continue; }
    found.clicks++;
    await p.waitForTimeout(350);
    // anything that opened: close it and make sure nothing is left blocking the page
    const opened = await p.evaluate(() => [...document.querySelectorAll('.modal, [role=dialog], .popover, .fn-menu')].some((m) => m.offsetParent && !m.hidden));
    if (opened) {
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      const still = await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop, .modal, .cmd-backdrop')].filter((m) => m.offsetParent).length);
      if (still) { found.issues.push(`"${t}": pop-up does not close with Escape`); await p.locator('.modal .icon-btn, .modal button[aria-label*=Close], .modal-close').first().click({ timeout: 800 }).catch(() => {}); }
    }
    if (errs.length > before) found.issues.push(`"${t}": ${errs.slice(before).join(' | ')}`);
    const o = await overlaps();
    if (o.length) found.issues.push(`after "${t}": ${o.slice(0, 3).join('; ')}`);
    // a click that navigated away: come back
    const now = await p.evaluate(() => location.hash.slice(1));
    if (now !== r) { await p.evaluate((h) => (location.hash = h), r); await p.waitForTimeout(1200); }
  }
  found.issues = [...new Set(found.issues)].slice(0, 12);
  report[r] = found;
  console.error(`${r}: clicks ${found.clicks}, empty ${found.empty.emptyPct}% band ${found.empty.blankBandPx}px, issues ${found.issues.length + found.base.length + found.scroll.length}`);
}
console.log(JSON.stringify(report, null, 1));
await b.close();
