/**
 * The market buddy (Bull by default; name and coat colours are yours to change with the ✎ button): a small pixel dog (our own drawing) who lives on every page except the Chart page. His face
 * follows the S&P 500 (SPY) today: happy above +0.3%, calm in between, worried below -0.3%. Click to pet him
 * (hearts, a wag and a word about the market), drag him anywhere (remembered), double-click and he trots somewhere
 * new. Every minute or so he wanders a little on his own (not with reduced motion, not while the tab is hidden).
 * The × on hover hides him; the code PUP (or the launchpad) brings him back. Mood maths is pure and tested.
 */
import { quoteChange, subscribeQuote, type MarketRef } from '../data/quotes';
import { h } from './dom';

export type Mood = 'happy' | 'calm' | 'sad';
const POS_KEY = 'tp-buddy-pos';
const HIDE_KEY = 'tp-buddy-hidden';
const SIZE = 78;

/** The mood for a percent change of the S&P 500 today (null = no data yet: calm). */
export function moodFor(percent: number | null): Mood {
  if (percent == null || !Number.isFinite(percent)) return 'calm';
  return percent > 0.3 ? 'happy' : percent < -0.3 ? 'sad' : 'calm';
}

/** What he says when petted. */
export function petLine(percent: number | null, n: number): string {
  if (percent == null) return n % 2 ? 'Woof! Waiting for prices…' : 'Good morning! Start the helper and I’ll watch the market.';
  const p = `${percent >= 0 ? '+' : '−'}${Math.abs(percent).toFixed(2)}%`;
  const m = moodFor(percent);
  const lines =
    m === 'happy'
      ? [`Woof! S&P ${p} today. Green across the board!`, `Tail’s wagging: S&P ${p}.`, 'Good day to stick to the plan.']
      : m === 'sad'
        ? [`Rough one… S&P ${p}. Stick to your stops.`, `S&P ${p}. Pets help. Thanks.`, 'Red days happen. Size down, stay calm.']
        : [`Quiet market: S&P ${p}.`, `Steady today (S&P ${p}). Patience pays.`, 'Nothing wild. Good time to review your plan.'];
  return lines[n % lines.length];
}

/** Keeps a position on screen (with the dog's size). */
export function clampPos(x: number, y: number, w: number, hgt: number): [number, number] {
  return [Math.round(Math.min(Math.max(4, x), Math.max(4, w - SIZE - 4))), Math.round(Math.min(Math.max(4, y), Math.max(4, hgt - SIZE - 30)))];
}

/** Coat colours: fur, ears and outline. */
export const COATS: Record<string, [string, string, string]> = {
  Beagle: ['#e39a5c', '#8a4a26', '#3b2416'],
  Golden: ['#e8b04a', '#b97a22', '#4a3010'],
  Chocolate: ['#8a5634', '#4f2c16', '#24140a'],
  Grey: ['#aab4c0', '#6b7684', '#2a2f38'],
  Midnight: ['#454b58', '#2a2e38', '#101218'],
  Cream: ['#f1dcb5', '#c9a06a', '#4a3a24'],
};

// 18 x 17 pixel dog (our own drawing, after the owner's sketch). O outline, E ear, F fur, W white, P cheek, K nose,
// T tie. Eyes and mouth are drawn per mood on top; the tail is its own group so it can wag.
const MAP = [
  '......OOOOOO......',
  '.....OFFWWFFO.....',
  '..OOOFFFWWFFFOOO..',
  '.OEEOFFFWWFFFOEEO.',
  '.OEEFFFFWWFFFFEEO.',
  '.OEEFFFFWWFFFFEEO.',
  '.OEEFFFWWWWFFFEEO.',
  '.OEEPFWWKKWWFPEEO.',
  '..OOFFWWWWWWFFOO..',
  '....OFFWWWWFFO....',
  '....OOTTTTTTOO....',
  '.....OFFTTFFO.....',
  '....OFFWWTWFFO....',
  '....OFFWWWWFFO....',
  '....OFWWWWWWFO....',
  '....OFFOOOOFFO....',
  '....OOO....OOO....',
];
const CLASS: Record<string, string> = { O: 'p-o', E: 'p-e', F: 'p-f', W: 'p-w', P: 'p-p', K: 'p-k', T: 'p-t' };

/** Pixel rows as rects (runs of one colour merged), for an SVG. Pure, tested. */
export function pixelRects(map: string[]): string {
  let out = '';
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (CLASS[c]) out += `<rect class="${CLASS[c]}" x="${x}" y="${y}" width="${w}" height="1"/>`;
      x += w;
    }
  });
  return out;
}

const px = (cls: string, pts: [number, number][]) => pts.map(([x, y]) => `<rect class="${cls}" x="${x}" y="${y}" width="1" height="1"/>`).join('');

const SVG = `
<svg viewBox="0 0 18 17" width="${SIZE}" height="${Math.round((SIZE * 17) / 18)}" shape-rendering="crispEdges" aria-hidden="true">
  <g class="b-tail">${px('p-o', [[14, 11], [15, 11], [16, 12], [16, 13]])}${px('p-f', [[14, 12], [15, 12], [15, 13], [14, 13]])}</g>
  <g class="b-head">${pixelRects(MAP)}
    <g class="f-calm">${px('p-k', [[6, 4], [6, 5], [11, 4], [11, 5], [8, 9], [9, 9]])}${px('p-w', [[6, 4], [11, 4]]).replace(/p-w/g, 'p-shine')}</g>
    <g class="f-happy">${px('p-k', [[5, 5], [6, 4], [7, 5], [10, 5], [11, 4], [12, 5], [7, 8], [10, 8]])}${px('p-tongue', [[8, 8], [9, 8], [8, 9], [9, 9]])}</g>
    <g class="f-sad">${px('p-k', [[6, 5], [6, 6], [11, 5], [11, 6], [5, 4], [12, 4], [7, 9], [10, 9], [8, 8], [9, 8]])}${px('p-tear', [[12, 7], [12, 8]])}</g>
  </g>
</svg>`;

interface Look {
  name: string;
  coat: string;
}
const LOOK_KEY = 'tp-buddy-look';

let root: HTMLElement | null = null;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private window: this visit only
  }
}

/** Shows or hides him (the PUP code). */
export function toggleBuddy() {
  const hidden = !readJson(HIDE_KEY, false);
  writeJson(HIDE_KEY, hidden);
  if (root) root.hidden = hidden;
  else if (!hidden) initBuddy();
}

export function initBuddy() {
  if (root || readJson(HIDE_KEY, false)) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bubble = h('div', { class: 'buddy-bubble', role: 'status', 'aria-live': 'polite', hidden: true });
  const close = h('button', { type: 'button', class: 'buddy-close', title: 'Hide your buddy (bring him back with the code PUP)', 'aria-label': 'Hide the market buddy' }, '×');
  const dog = h('button', { type: 'button', class: 'buddy-dog', title: 'Bull, your market buddy: click to pet, drag to move, double-click to send him off', 'aria-label': 'Pet the market buddy' });
  dog.innerHTML = SVG;
  const edit = h('button', { type: 'button', class: 'buddy-edit', title: 'Name and colours', 'aria-label': 'Change the buddy’s name and colours' }, '✎');
  root = h('div', { class: 'buddy', 'data-mood': 'calm' }, bubble, edit, close, dog);
  document.body.append(root);
  const el = root;
  let look: Look = { name: 'Bull', coat: 'Beagle', ...readJson<Partial<Look>>(LOOK_KEY, {}) };
  const applyLook = () => {
    const [fur, ear, line] = COATS[look.coat] ?? COATS.Beagle;
    el.style.setProperty('--b-fur', fur);
    el.style.setProperty('--b-ear', ear);
    el.style.setProperty('--b-line', line);
    dog.title = `${look.name}, your market buddy: click to pet, drag to move, double-click to send him off`;
    dog.setAttribute('aria-label', `Pet ${look.name}`);
  };
  applyLook();
  edit.addEventListener('click', () => {
    const panel = h('div', { class: 'buddy-panel', role: 'dialog', 'aria-label': 'Buddy name and colours' });
    const name = h('input', { class: 'input', value: look.name, maxlength: '16', 'aria-label': 'Name' }) as HTMLInputElement;
    name.addEventListener('input', () => {
      look = { ...look, name: name.value.trim() || 'Bull' };
      writeJson(LOOK_KEY, look);
      applyLook();
    });
    const swatches = Object.entries(COATS).map(([k, [fur, ear]]) => {
      const b = h('button', { type: 'button', class: `buddy-swatch${k === look.coat ? ' on' : ''}`, title: k, 'aria-label': k, style: `background: linear-gradient(135deg, ${fur} 55%, ${ear} 55%)` });
      b.addEventListener('click', () => {
        look = { ...look, coat: k };
        writeJson(LOOK_KEY, look);
        applyLook();
        panel.querySelectorAll('.buddy-swatch').forEach((x) => x.classList.toggle('on', x === b));
      });
      return b;
    });
    const done = h('button', { type: 'button', class: 'btn', onclick: () => panel.remove() }, 'Done');
    panel.append(h('label', { class: 'buddy-panel-k' }, 'NAME'), name, h('div', { class: 'buddy-panel-k' }, 'COLOURS'), h('div', { class: 'buddy-swatches' }, ...swatches), done);
    el.querySelector('.buddy-panel')?.remove();
    el.append(panel);
    name.focus();
  });

  let percent: number | null = null;
  subscribeQuote({ provider: 'schwab', symbol: 'SPY' } as MarketRef, (q) => {
    percent = quoteChange(q)?.percent ?? null;
    el.dataset.mood = moodFor(percent);
  });

  // where he sits
  let [x, y] = readJson<[number, number]>(POS_KEY, [innerWidth - SIZE - 28, innerHeight - SIZE - 60]);
  const place = (nx: number, ny: number, save = true) => {
    [x, y] = clampPos(nx, ny, innerWidth, innerHeight);
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (save) writeJson(POS_KEY, [x, y]);
  };
  place(x, y, false);
  addEventListener('resize', () => place(x, y, false));

  let bubbleTimer = 0;
  const say = (text: string) => {
    bubble.textContent = text;
    bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => (bubble.hidden = true), 4000);
  };

  let pets = 0;
  const pet = () => {
    el.classList.remove('petting');
    void el.offsetWidth; // restart the animation
    el.classList.add('petting');
    window.setTimeout(() => el.classList.remove('petting'), 1600);
    for (let i = 0; i < 3; i++) {
      const heart = h('span', { class: 'buddy-heart', 'aria-hidden': 'true' }, '♥');
      heart.style.left = `${20 + i * 18}px`;
      heart.style.animationDelay = `${i * 120}ms`;
      el.append(heart);
      window.setTimeout(() => heart.remove(), 1400);
    }
    say(`${look.name}: ${petLine(percent, pets++)}`);
  };

  const trot = (dx: number, dy: number) => {
    el.classList.add('walking');
    el.classList.toggle('facing-left', dx < 0);
    place(x + dx, y + dy);
    window.setTimeout(() => el.classList.remove('walking'), 1300);
  };

  // drag (pointer), with a click when it barely moved
  let start: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;
  dog.addEventListener('pointerdown', (e) => {
    start = { px: e.clientX, py: e.clientY, x, y, moved: false };
    dog.setPointerCapture(e.pointerId);
  });
  dog.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    el.classList.add('dragging');
    place(start.x + dx, start.y + dy, false);
  });
  dog.addEventListener('pointerup', () => {
    if (!start) return;
    const moved = start.moved;
    start = null;
    el.classList.remove('dragging');
    if (moved) writeJson(POS_KEY, [x, y]);
    else pet();
  });
  dog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pet();
    }
  });
  dog.addEventListener('dblclick', () => trot((Math.random() - 0.5) * 500, (Math.random() - 0.5) * 300));
  close.addEventListener('click', () => toggleBuddy());

  if (!reduce) {
    const wander = () => {
      if (!document.hidden && !start && !el.hidden) trot((Math.random() - 0.5) * 160, (Math.random() - 0.5) * 60);
      window.setTimeout(wander, 45_000 + Math.random() * 45_000);
    };
    window.setTimeout(wander, 30_000);
  }
}
