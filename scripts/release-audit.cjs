// Release audit (see CLAUDE.md, Design and QA skills): every route x theme x width -> console errors, overlapping
// controls, clipped text, sideways overflow. Run against `npx vite preview` with a helper (or the fake one):
//   BASE=http://localhost:4173 HELPER_PORT=8765 node scripts/release-audit.cjs   (writes audit.json)
const { chromium } = require('playwright'); const fs = require('fs');
const scan = (process.env.SCAN_FIXTURE ? fs.readFileSync(process.env.SCAN_FIXTURE, 'utf8') : '{"horizons":{},"setups":[]}');
const ROUTES = (process.env.ROUTES || 'home,invest,futures,macro,calendar,flow,chart,research/AAPL,setups,backtest,strategy,account,portfolio,trade,journal,clients,prospect,sec/AAPL,chart/multi').split(',');
const THEMES = (process.env.THEMES || 'dark,light').split(','); const WIDTHS = (process.env.WIDTHS || '1536,390').split(',').map(Number);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const report = [];
  for (const theme of THEMES) for (const width of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width, height: width < 600 ? 844 : 864 }, bypassCSP: true });
    await ctx.addInitScript(([t, scan, port]) => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(u, p) { super(String(u).replace(':8765', ':' + port), p); } send(d) { try { const m = JSON.parse(d); if (m.type === 'scanner.results') { setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: m.id, type: 'engine', data: JSON.parse(scan) }) })), 50); return; } } catch {} return super.send(d); } }; try { localStorage.setItem('tp-theme', t); } catch {} }, [theme, scan, String(process.env.HELPER_PORT || 8765)]);
    const p = await ctx.newPage(); let errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource|WebSocket|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 140)); });
    for (const r of ROUTES) {
      errs = [];
      await p.goto('' + (process.env.BASE || 'http://localhost:4173') + '/#' + r); await p.waitForTimeout(3500);
      const found = await p.evaluate(() => {
        // the part of an element you can actually see: clipped by every scrolling/clipping ancestor and the window
        const seen = (e) => { const r = e.getBoundingClientRect(); let L = Math.max(0, r.left), T = Math.max(0, r.top), R = Math.min(innerWidth, r.right), B = Math.min(innerHeight, r.bottom); for (let a = e.parentElement; a; a = a.parentElement) { const st = getComputedStyle(a); if (st.overflowX !== 'visible' || st.overflowY !== 'visible') { const q = a.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); } if (st.position === 'fixed') break; } return { left: L, top: T, right: R, bottom: B }; };
        const vis = (e) => { const s = getComputedStyle(e); const r = seen(e); return r.right - r.left > 2 && r.bottom - r.top > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
        const name = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (e.innerText || e.getAttribute('aria-label') || e.value || '').trim().slice(0, 24) + '"');
        const out = { overlap: [], clipped: [], overflow: [] };
        const ctl = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=tab]')].filter((e) => vis(e) && !e.closest('.buddy, .atmos, [hidden]'));
        for (let i = 0; i < ctl.length && out.overlap.length < 12; i++) for (let j = i + 1; j < ctl.length; j++) {
          const a = ctl[i], c = ctl[j]; if (a.contains(c) || c.contains(a)) continue;
          const A = seen(a), B = seen(c);
          const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left), oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (ox > 4 && oy > 4) { out.overlap.push(name(a) + ' X ' + name(c) + ` (${Math.round(ox)}x${Math.round(oy)})`); if (out.overlap.length >= 12) break; }
        }
        for (const e of document.querySelectorAll('.views > *:not([hidden]) *, .shell-top *, .rail *')) {
          if (out.clipped.length >= 15) break;
          if (!vis(e) || !e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const s = getComputedStyle(e);
          if (s.textOverflow === 'ellipsis') continue;
          if ((s.overflowX === 'hidden' || s.overflow === 'hidden' || s.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 2) out.clipped.push(name(e) + ` ${e.scrollWidth}>${e.clientWidth}`);
        }
        const view = [...document.querySelectorAll('.views > *')].find((v) => v.offsetParent);
        if (document.scrollingElement.scrollWidth > innerWidth + 2) out.overflow.push('page wider than screen by ' + (document.scrollingElement.scrollWidth - innerWidth));
        if (view && view.scrollWidth > view.clientWidth + 2 && getComputedStyle(view).overflowX !== 'hidden') out.overflow.push('view scrolls sideways by ' + (view.scrollWidth - view.clientWidth));
        return out;
      });
      const n = found.overlap.length + found.clipped.length + found.overflow.length + errs.length;
      if (n) report.push({ where: `${r} ${theme} ${width}`, ...found, errors: [...new Set(errs)] });
      process.stdout.write(n ? 'x' : '.');
    }
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(process.env.AUDIT_OUT || 'audit.json', JSON.stringify(report, null, 1));
  console.log('\npages with findings:', report.length);
})();
