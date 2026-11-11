// Desktop app: every page, ticker card, command bar and menu at four window sizes, with the app's own page scripts
// (desktop/tp_desktop/titlebar.py): does anything sit under the window buttons (top-right 138x44)?
//   npx vite preview --port 5321 &   then   node scripts/window-buttons-sweep.cjs [sizes, e.g. 1280x720,1920x1040]
// Exit code 1 when something overlaps. Set NO_GUARD=1 to see what would overlap without the app's corner guard.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5321';
const inject = execFileSync('python3', ['-c', [
  // the app's page scripts, read from desktop/tp_desktop/titlebar.py without needing Qt installed (stub modules)
  'import sys, types',
  "class Any:\n    def __init__(self, *a, **k): pass\n    def __call__(self, *a, **k): return Any()\n    def __getattr__(self, n): return Any()\n    def __or__(self, o): return self",
  "for n in ('PySide6', 'PySide6.QtCore', 'PySide6.QtGui', 'PySide6.QtWidgets'):\n    m = types.ModuleType(n); m.__getattr__ = lambda name: Any; sys.modules[n] = m",
  `sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..', 'desktop'))})`,
  'from tp_desktop import titlebar as t',
  `print(t.DESKTOP_JS + ('' if ${JSON.stringify(process.env.NO_GUARD || '')} else t.KEEP_CLEAR_JS))`,
].join('\n')], { encoding: 'utf8' });
const SIZES = (process.argv[2] || '1024x700,1280x720,1440x900,1920x1040').split(',').map((s) => s.split('x').map(Number));
const ZONE_W = 138, ZONE_H = 44;
const detect = ([W, H]) => {
  const top = document.querySelector('.shell-top');
  const allowed = (el) => el === document.documentElement || el === document.body || (top && (el === top || top.contains(el) || el.contains(top))) || el.classList.contains('ai-drawer') || !!el.closest('.brand');
  const vw = innerWidth, hits = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (allowed(el) || el.closest('.atmos')) continue; // the flowing background behind everything
    const r = el.getBoundingClientRect();
    if (r.width >= vw - 2 && r.height >= innerHeight - 2) continue; // a full-window dimmer behind a pop-up
    if (!r.width || !r.height || r.right <= vw - W || r.left >= vw || r.bottom <= 0 || r.top >= H - 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.display === 'contents') continue;
    let out = false; // clipped away by a scrolling parent
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).overflow !== 'visible') { const pr = n.getBoundingClientRect(); if (pr.bottom <= 0 || pr.top >= H - 1 || pr.right <= vw - W) { out = true; break; } }
    }
    if (out) continue;
    hits.add(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')} @${Math.round(r.left)},${Math.round(r.top)}`);
  }
  return [...hits].slice(0, 4);
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const problems = [];
  let checked = 0;
  for (const [w, hgt] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: hgt } });
    await ctx.addInitScript(inject);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/#home`); await p.waitForTimeout(4000);
    const routes = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').split('/')[0]))].filter((r) => r.length > 1));
    const check = async (route, what) => {
      await p.waitForTimeout(350);
      checked++;
      const hit = await p.evaluate(detect, [ZONE_W, ZONE_H]);
      if (hit.length) problems.push(`${w}x${hgt} ${route} [${what}]: ${hit.join(' ; ')}`);
    };
    const reset = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); };
    for (const route of routes) {
      await p.goto(`${BASE}/${route}`); await p.waitForTimeout(1500);
      await check(route, 'page');
      const tick = await p.$('[data-ticker]:visible, .tape-item:visible, .tape a:visible, .tape button:visible');
      if (tick) { await tick.click({ timeout: 1500 }).catch(() => {}); await check(route, 'ticker card'); await reset(); }
      await p.keyboard.press('/'); await check(route, 'command bar'); await reset();
      const pops = await p.$$('[aria-haspopup]:visible');
      for (const btn of pops.slice(0, 6)) {
        const name = ((await btn.getAttribute('aria-label')) || (await btn.textContent()) || '').trim().slice(0, 30);
        await btn.click({ timeout: 1500 }).catch(() => {});
        await check(route, `menu ${name}`);
        await reset();
      }
    }
    for (const label of ['AI', 'Settings', 'Notifications', 'Alerts']) {
      await p.goto(`${BASE}/#home`); await p.waitForTimeout(1200);
      const el = await p.$(`[aria-label="${label}"]:visible`);
      if (el) { await el.click({ timeout: 1500 }).catch(() => {}); await check('#home', label); await reset(); }
    }
    await ctx.close();
  }
  console.log(`checked ${checked} states`);
  for (const x of [...new Set(problems)]) console.log('OVERLAP', x);
  await b.close();
  process.exitCode = problems.length ? 1 : 0;
})();
