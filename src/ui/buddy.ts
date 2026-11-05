/**
 * Bull, the market buddy: a small dog (our own drawing) who lives on every page except the Chart page. His face
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

const SVG = `
<svg viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}" aria-hidden="true">
  <g class="b-tail"><path d="M76 70 q14 -6 12 -22" fill="none" stroke="#b9773f" stroke-width="7" stroke-linecap="round"/></g>
  <ellipse cx="50" cy="76" rx="27" ry="19" fill="#d9a066"/>
  <ellipse cx="50" cy="82" rx="15" ry="11" fill="#f2d3ad"/>
  <path d="M44 60 l6 6 l6 -6 l-3 22 l-3 4 l-3 -4 z" fill="#123b68"/><path d="M47.6 70 l5 -2 M47 75 l6 -2" stroke="#e0803f" stroke-width="1.6"/>
  <g class="b-head">
    <path class="b-ear" d="M24 22 q-10 4 -8 26 q2 10 10 6 q4 -16 6 -26 z" fill="#8a5a33"/>
    <path class="b-ear b-ear-r" d="M76 22 q10 4 8 26 q-2 10 -10 6 q-4 -16 -6 -26 z" fill="#8a5a33"/>
    <ellipse cx="50" cy="38" rx="26" ry="24" fill="#d9a066"/>
    <ellipse cx="50" cy="48" rx="14" ry="10" fill="#f2d3ad"/>
    <ellipse cx="50" cy="42" rx="5" ry="3.6" fill="#1b1b22"/>
    <g class="f-happy">
      <path d="M36 33 q4 -5 8 0 M56 33 q4 -5 8 0" fill="none" stroke="#1b1b22" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M42 48 q8 9 16 0" fill="#7a2230" stroke="#1b1b22" stroke-width="2"/><path d="M47 51 q3 5 6 0" fill="#ff8fa3"/>
      <circle cx="33" cy="44" r="3" fill="#ff8fa3" opacity=".55"/><circle cx="67" cy="44" r="3" fill="#ff8fa3" opacity=".55"/>
    </g>
    <g class="f-calm">
      <circle cx="40" cy="33" r="3.2" fill="#1b1b22"/><circle cx="60" cy="33" r="3.2" fill="#1b1b22"/>
      <circle cx="41" cy="32" r="1" fill="#fff"/><circle cx="61" cy="32" r="1" fill="#fff"/>
      <path d="M44 49 q6 4 12 0" fill="none" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="f-sad">
      <path d="M34 27 l9 3 M66 27 l-9 3" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>
      <circle cx="40" cy="34" r="3.2" fill="#1b1b22"/><circle cx="60" cy="34" r="3.2" fill="#1b1b22"/>
      <path d="M44 52 q6 -5 12 0" fill="none" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>
      <path class="b-tear" d="M63 39 q2 4 0 6 q-2 -2 0 -6" fill="#7ac3ee"/>
    </g>
  </g>
</svg>`;

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
  const close = h('button', { type: 'button', class: 'buddy-close', title: 'Hide Bull (bring him back with the code PUP)', 'aria-label': 'Hide the market buddy' }, '×');
  const dog = h('button', { type: 'button', class: 'buddy-dog', title: 'Bull, your market buddy: click to pet, drag to move, double-click to send him off', 'aria-label': 'Pet the market buddy' });
  dog.innerHTML = SVG;
  root = h('div', { class: 'buddy', 'data-mood': 'calm' }, bubble, close, dog);
  document.body.append(root);
  const el = root;

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
    say(petLine(percent, pets++));
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
