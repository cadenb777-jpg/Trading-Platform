// Chart performance benchmark: node bench.mjs <baseUrl> <label>
// Mocks the helper WebSocket (ws://127.0.0.1:8765) with Playwright so the numbers don't depend on the network.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const LABEL = process.argv[3] ?? 'run';
const OUT = process.env.OUT ?? '/tmp';
const N = 5000;
const STEP = 300;
const NOW = Math.floor(Date.now() / 1000 / STEP) * STEP;
const INDICATORS = ['volume', 'sma', 'ema', 'bb', 'vwap', 'rsi', 'macd', 'atr', 'stoch', 'cdl_engulfing'];

function makeBars(symbol) {
  let seed = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let price = 100 + rand() * 100;
  const bars = [];
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = Math.max(1, open * (1 + (rand() - 0.5) * 0.01));
    const high = Math.max(open, close) * (1 + rand() * 0.003);
    const low = Math.min(open, close) * (1 - rand() * 0.003);
    bars.push({ time: NOW - (N - 1 - i) * STEP, open, high, low, close, volume: Math.round(1000 + rand() * 9000) });
    price = close;
  }
  return bars;
}
const lastClose = new Map();

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const r1 = (v) => Math.round(v * 100) / 100;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let socket = null;
const subscribed = new Set();
await page.routeWebSocket('ws://127.0.0.1:8765', (ws) => {
  socket = ws;
  ws.send(JSON.stringify({ type: 'status', status: 'live', message: 'Live', version: 41 }));
  ws.onMessage((raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'history') {
      const bars = makeBars(msg.symbol);
      lastClose.set(msg.symbol, bars[bars.length - 1].close);
      ws.send(JSON.stringify({ type: 'history', id: msg.id, bars }));
    } else if (msg.type === 'subscribe') subscribed.add(msg.symbol);
    else if (msg.type === 'unsubscribe') subscribed.delete(msg.symbol);
    else if (msg.id !== undefined) ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'not in benchmark' }));
  });
});
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

await page.addInitScript((ids) => {
  localStorage.setItem(
    'tp:state:v1',
    JSON.stringify({
      provider: 'schwab',
      symbols: { schwab: 'AAA' },
      timeframe: '5m',
      indicators: ids.map((id, i) => ({ uid: `b${i}`, defId: id, params: {}, colors: {}, visible: true })),
      watchlistOpen: false,
      extendedHours: true,
    }),
  );
  // Time every animation-frame callback: work per frame = the sum for one frame timestamp.
  const orig = window.requestAnimationFrame.bind(window);
  const work = new Map();
  window.__work = work;
  window.requestAnimationFrame = (cb) =>
    orig((t) => {
      const s = performance.now();
      try {
        cb(t);
      } finally {
        work.set(t, (work.get(t) ?? 0) + performance.now() - s);
      }
    });
}, INDICATORS);

const t0 = Date.now();
await page.goto(BASE + '#chart');
await page.waitForFunction(() => document.querySelector('.chart-page .price')?.textContent?.length > 0, null, { timeout: 30000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const initialLoad = Date.now() - t0;
await page.waitForTimeout(800);

async function switchSymbol(sym) {
  return page.evaluate(async (sym) => {
    const input = document.querySelector('.chart-page input.symbol');
    const price = document.querySelector('.chart-page .price');
    const t0 = performance.now();
    const done = new Promise((resolve) => {
      const obs = new MutationObserver(() => {
        if (price.textContent) {
          obs.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
        }
      });
      obs.observe(price, { childList: true, characterData: true, subtree: true });
    });
    input.value = sym;
    input.dispatchEvent(new Event('change'));
    return done;
  }, sym);
}

// 1. time to first paint for a symbol switch (5,000 bars, 10 indicators)
const paints = [];
for (const s of ['BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG']) {
  paints.push(await switchSymbol(s));
  await page.waitForTimeout(300);
}
const firstPaint = pct(paints.slice(1), 50);

const prof = await page.context().newCDPSession(page);
await prof.send('Profiler.enable');
async function frameWork(action, name = '') {
  await page.evaluate(() => window.__work.clear());
  if (process.env.PROFILE) await prof.send('Profiler.start');
  await action();
  if (process.env.PROFILE) {
    const { profile } = await prof.send('Profiler.stop');
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    console.log('PROFILE', name, [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)}ms ${k}`).join('\n  '));
  }
  await page.waitForTimeout(100);
  const list = await page.evaluate(() => [...window.__work.entries()].sort((a, b) => a[0] - b[0]));
  const work = list.map((e) => e[1]);
  const intervals = list.slice(1).map((e, i) => e[0] - list[i][0]);
  return { frames: work.length, workP50: r1(pct(work, 50)), workP95: r1(pct(work, 95)), workMean: r1(mean(work)), intervalP95: r1(pct(intervals, 95)) };
}

const chartBox = await page.locator('.chart-page .chart').boundingBox();
const cx = chartBox.x + chartBox.width * 0.5;
const cy = chartBox.y + chartBox.height * 0.35;

// 2. live ticks: one trade every ~16 ms for 3 s (a new bar every 60 trades)
const sym = 'GGG';
const ticks = await frameWork(async () => {
  let price = lastClose.get(sym) ?? 100;
  let t = NOW + 1;
  for (let i = 0; i < 180; i++) {
    price *= 1 + (Math.random() - 0.5) * 0.001;
    if (i % 60 === 59) t += STEP;
    socket.send(JSON.stringify({ type: 'trade', symbol: sym, price, size: 3, time: t + (i % 60) }));
    await new Promise((r) => setTimeout(r, 16));
  }
}, 'ticks');

// 3. crosshair move
const crosshair = await frameWork(async () => {
  for (let i = 0; i < 90; i++) {
    await page.mouse.move(chartBox.x + 60 + (i / 90) * (chartBox.width - 160), cy + Math.sin(i / 8) * 80);
    await page.waitForTimeout(16);
  }
}, 'crosshair');

// 4. pan (drag) then zoom (wheel)
const pan = await frameWork(async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx - i * 8, cy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
});
const zoom = await frameWork(async () => {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i < 20 ? -120 : 120);
    await page.waitForTimeout(25);
  }
});

// 5. memory after 20 symbol switches
const client = await page.context().newCDPSession(page);
const heap = async () => {
  await client.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(200);
  await client.send('HeapProfiler.collectGarbage');
  return (await client.send('Runtime.getHeapUsage')).usedSize / 1048576;
};
const heapBefore = await heap();
for (let i = 0; i < 20; i++) {
  await switchSymbol(`M${String.fromCharCode(65 + i)}X`);
  await page.waitForTimeout(150);
}
const heapAfter = await heap();
const canvases = await page.evaluate(() => document.querySelectorAll('.chart-page canvas').length);

const result = {
  label: LABEL,
  bars: N,
  indicators: INDICATORS.length,
  initialLoadMs: initialLoad,
  symbolSwitchFirstPaintMs: r1(firstPaint),
  paints: paints.map(r1),
  ticks,
  crosshair,
  pan,
  zoom,
  heapBeforeMB: r1(heapBefore),
  heapAfter20SwitchesMB: r1(heapAfter),
  canvases,
  errors: [...new Set(errors)].slice(0, 10),
};
console.log(JSON.stringify(result, null, 1));
const fs = await import('fs');
fs.writeFileSync(`${OUT}/bench-${LABEL}.json`, JSON.stringify(result, null, 1));
await page.screenshot({ path: `${OUT}/bench-${LABEL}.png` });
await browser.close();
