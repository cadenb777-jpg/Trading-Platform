import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const S = '/tmp/claude-0/-home-user-trading-platform/28a2f284-591b-5aea-af29-3b40274a7dff/scratchpad/audit';
const width = +(process.argv[2] || 1280);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(`[${p.url().split('#')[1]}] PAGEERR ${e.message.slice(0, 160)}`));
p.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_|Failed to load resource|fonts/.test(m.text()) && errs.push(`[${p.url().split('#')[1]}] ${m.text().slice(0, 160)}`));
await p.route(/coinbase\.com/, (r) => r.abort());
// overlapping siblings: visible elements in the same parent whose boxes intersect (layout bugs), ignoring overlays
const overlaps = () => p.evaluate(() => {
  const out = [];
  const vis = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length;
  for (const parent of document.querySelectorAll('.app-main *')) {
    const kids = [...parent.children].filter((k) => vis(k) && !['absolute', 'fixed', 'sticky'].includes(getComputedStyle(k).position) && k.tagName !== 'svg' && !(k instanceof SVGElement));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), hgt = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 3 && hgt > 3 && a.width > 4 && c.width > 4) out.push(`${kids[i].tagName}.${String(kids[i].className).slice(0, 30)} x ${kids[j].tagName}.${String(kids[j].className).slice(0, 30)} (${Math.round(w)}x${Math.round(hgt)})`);
    }
  }
  // text cut off without an ellipsis
  for (const e of document.querySelectorAll('.app-main *')) {
    if (!vis(e) || e.childElementCount || e.closest('.sr-only, .visually-hidden')) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && e.textContent.trim()) out.push(`CLIPPED ${e.tagName}.${String(e.className).slice(0, 30)} "${e.textContent.trim().slice(0, 30)}"`);
  }
  return [...new Set(out)].slice(0, 12);
});
const report = {};
const routes = ['home', 'desk', 'monitor', 'invest', 'futures', 'macro', 'calendar', 'research', 'chart', 'flow', 'setups', 'screener', 'backtest', 'strategy', 'account', 'portfolio', 'trade', 'journal', 'prospect', 'clients'];
await p.goto('http://localhost:5322/#home'); await p.waitForTimeout(4000);
for (const r of routes) {
  await p.evaluate((h) => (location.hash = h), r); await p.waitForTimeout(2500);
  const found = { base: await overlaps(), tabs: {} };
  // click every in-page tab (not the shell top row) and look again
  const sel = '.app-main .tab:visible, .app-main [role=tab]:visible, .app-main .segmented button:visible';
  const n = Math.min(14, await p.locator(sel).count());
  for (let i = 0; i < n; i++) {
    const t = p.locator(sel).nth(i);
    let label = `#${i}`;
    try { label = ((await t.textContent({ timeout: 1500 })) ?? '').trim().slice(0, 20) || label; } catch { continue; }
    const t0 = Date.now();
    try { await t.click({ timeout: 2000 }); } catch { found.tabs[label] = ['not clickable']; continue; }
    await p.waitForTimeout(900);
    const ms = Date.now() - t0;
    const o = await overlaps();
    if (o.length || ms > 2000) found.tabs[label] = [...o, ...(ms > 2000 ? [`slow ${ms} ms`] : [])];
  }
  // open the Actions menu if there is one, check it, close with Escape
  const act = p.locator('.views > *:not([hidden]) .fn-toggle').first();
  if (await act.count()) { await act.click(); await p.waitForTimeout(300); found.actionsOpen = await p.evaluate(() => { const m = [...document.querySelectorAll('.fn-menu')].find((x) => !x.hidden && x.offsetParent); if (!m) return 'did not open'; const r = m.getBoundingClientRect(); return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 ? `off screen ${Math.round(r.right)}x${Math.round(r.bottom)}` : 'ok'; }); await p.keyboard.press('Escape'); await p.mouse.click(5, 880); }
  report[r] = found;
}
// command palette
await p.keyboard.press('/'); await p.waitForTimeout(400);
report.palette = await p.evaluate(() => [...document.querySelectorAll('[class*=cmd], [role=dialog]')].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 100).map((e) => e.className).slice(0, 3));
await p.keyboard.type('NVDA'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(200); report.paletteClosed = await p.evaluate(() => !document.querySelector('.cmd-backdrop'));
// chart: add and remove indicators
await p.evaluate(() => (location.hash = 'chart')); await p.waitForTimeout(3000);
report.chartLegendBefore = await p.evaluate(() => document.querySelectorAll('.legend-row.indicator').length);
// add an indicator through the picker, then remove it from the legend
const addBtn = p.locator('.chart-page button:visible', { hasText: /Indicators|\+ Indicator|fx/i }).first();
report.addBtn = await addBtn.count();
if (report.addBtn) {
  await addBtn.click(); await p.waitForTimeout(500);
  report.pickerOpen = await p.evaluate(() => [...document.querySelectorAll('[role=dialog], .modal, .popover, .ind-picker')].filter((e) => e.offsetParent).map((e) => e.className).slice(0, 2));
  await p.keyboard.type('MACD'); await p.waitForTimeout(400);
  const pick = p.locator('[role=dialog] button:visible, .modal button:visible, .popover button:visible', { hasText: /MACD/ }).first();
  if (await pick.count()) { await pick.click(); await p.waitForTimeout(800); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  report.chartLegendAfterAdd = await p.evaluate(() => document.querySelectorAll('.legend-row.indicator').length);
  report.chartOverlapAfterAdd = await overlaps();
  await p.screenshot({ path: `${S}/qa-chart-added-${width}.png` });
  const row = p.locator('.legend-row.indicator', { hasText: /MACD/ }).first();
  if (await row.count()) {
    await row.hover(); await p.waitForTimeout(300);
    const rm = row.locator('button[title*=Remove], button[aria-label*=Remove]').first();
    try { await rm.click({ timeout: 3000 }); } catch { report.removeHidden = 'remove button not reachable on hover'; }
    await p.waitForTimeout(600);
  }
  report.chartLegendAfterRemove = await p.evaluate(() => document.querySelectorAll('.legend-row.indicator').length);
}
await p.screenshot({ path: `${S}/qa-chart-${width}.png` });
console.log(JSON.stringify(report, null, 1));
console.log('ERRORS', errs);
await b.close();
