/**
 * Strategy Lab (#strategy): game theory for decisions. A payoff-matrix editor (2-4 players), a game-tree editor and
 * coalition values, each solved live by the helper's exact game engine (engine/gametheory.py, game.* requests), with
 * plain-language explanations; and the Equilibrium-Prime analyst (the AI in its game-theory mode), which gets the
 * model on screen plus any source documents the owner adds. Nothing here trades.
 */
import { createAssistant } from '../ai/assistant';
import { ACCEPTED_FILES, readAttachment, type Attachment } from '../ai/files';
import { EQUILIBRIUM_STARTERS } from '../ai/modes';
import { engineRequest } from '../data/schwab';
import { pageFrame } from '../ui/charts';
import { h, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  COALITION_PRESETS,
  MATRIX_PRESETS,
  MAX_PLAYERS,
  MAX_STRATEGIES,
  TREE_PRESETS,
  cellView,
  childrenOf,
  coalitionPayload,
  coalitions,
  eliminated,
  explainNormal,
  explainShapley,
  explainTree,
  matrixPayload,
  modelText,
  parseCell,
  profileKey,
  profiles,
  resizeMatrix,
  treeHighlights,
  treePayload,
  type CoalitionModel,
  type MatrixModel,
  type NormalResult,
  type ShapleyResult,
  type TreeModel,
  type TreeResult,
} from '../strategy/model';

type View = 'matrix' | 'tree' | 'coalition';
const VIEWS: [View, string][] = [
  ['matrix', 'Payoff matrix'],
  ['tree', 'Game tree'],
  ['coalition', 'Coalitions'],
];
const STORE = 'tp:strategy:models';

interface Saved {
  view: View;
  matrix: MatrixModel;
  tree: TreeModel;
  coalition: CoalitionModel;
  weak: boolean;
  arrows: boolean;
  bargain: { points: string; disagreement: string; power: number };
}

function loadSaved(): Saved {
  const fallback: Saved = {
    view: 'matrix',
    matrix: MATRIX_PRESETS[0].model(),
    tree: TREE_PRESETS[0].model(),
    coalition: COALITION_PRESETS[0].model(),
    weak: false,
    arrows: false,
    bargain: { points: '10, 0; 0, 10', disagreement: '4, 0', power: 0.5 },
  };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* a per-viewer convenience only */
  }
  return fallback;
}

const explainList = (items: { title: string; text: string }[]) =>
  h('div', { class: 'sl-explain' }, ...items.map((x) => h('div', { class: 'sl-explain-item' }, h('b', {}, x.title), h('p', {}, x.text))));

const fmt = (x: number | null | undefined) => (x == null ? '–' : String(Math.round(x * 10000) / 10000));

export function createStrategyPage() {
  const saved = loadSaved();
  let view: View = saved.view;
  let matrix = saved.matrix;
  let tree = saved.tree;
  let coalition = saved.coalition;
  let weak = saved.weak;
  let arrows = saved.arrows;
  const bargainState = saved.bargain;
  let normal: NormalResult | null = null;
  let sources: Attachment[] = [];
  const sentSources = new Set<string>();

  const persist = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ view, matrix, tree, coalition, weak, arrows, bargain: bargainState } satisfies Saved));
    } catch {
      /* not critical */
    }
  };

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Strategy Lab views' });
  const frame = pageFrame('Strategy Lab', 'Model a decision as a game: who plays, what they can do, what they get. The engine finds the stable outcomes; Equilibrium-Prime explains them.', [tabs]);
  frame.el.classList.add('sl-page');
  const editor = h('section', { class: 'sl-editor', 'aria-label': 'Game editor' });
  const results = h('section', { class: 'sl-results', 'aria-live': 'polite', 'aria-label': 'Results' });

  // ---------- Equilibrium-Prime ----------
  const currentModel = () => {
    if (view === 'matrix') {
      const p = matrixPayload(matrix);
      return modelText('matrix', 'payload' in p ? p.payload : matrix);
    }
    if (view === 'tree') {
      const p = treePayload(tree);
      return modelText('tree', 'tree' in p ? { players: tree.players, tree: p.tree } : tree);
    }
    const p = coalitionPayload(coalition);
    return modelText('coalition', 'error' in p ? coalition : p);
  };
  const assistant = createAssistant({
    mode: 'window',
    fixedMode: 'equilibrium_prime',
    storeKey: 'tp:strategy:chat',
    title: 'Equilibrium-Prime',
    getContext: () => ({ page: 'Strategy Lab', route: 'strategy' }),
    getModel: currentModel,
    onAction: () => {},
    // a new chat has none of the sources: they are attached again with the next question
    onNewChat: () => {
      sentSources.clear();
      drawSources();
    },
  });
  assistant.el.classList.add('sl-ai');
  const sourceList = h('div', { class: 'sl-sources-list' });
  const sourceInput = h('input', { type: 'file', multiple: true, accept: ACCEPTED_FILES, hidden: true, 'aria-label': 'Add source documents' });
  sourceInput.addEventListener('change', async () => {
    for (const file of [...(sourceInput.files ?? [])]) {
      try {
        sources.push(await readAttachment(file));
      } catch (err) {
        toast((err as Error).message);
      }
    }
    sourceInput.value = '';
    drawSources();
  });
  function drawSources() {
    sourceList.replaceChildren(
      ...(sources.length
        ? sources.map((s, i) =>
            h(
              'span',
              { class: 'ai-chip' },
              icon('clip', 14),
              `${s.name} · ${s.info}${sentSources.has(s.name) ? ' · sent' : ''}`,
              h('button', { 'aria-label': `Remove ${s.name}`, onclick: () => (sources.splice(i, 1), drawSources()) }, '✕'),
            ),
          )
        : [h('span', { class: 'muted' }, 'No sources yet. Add the reports, contracts or notes behind the situation (PDF or text).')]),
    );
  }
  drawSources();
  /** Sends the model on screen (and sources not sent yet in this chat) to Equilibrium-Prime. */
  function askPrime(question?: string) {
    const fresh = sources.filter((s) => !sentSources.has(s.name));
    if (fresh.length) assistant.attach(fresh);
    for (const s of fresh) sentSources.add(s.name);
    drawSources();
    const what = view === 'matrix' ? 'payoff matrix' : view === 'tree' ? 'game tree' : 'coalition game';
    assistant.ask(question ?? `[SOLVE] Analyse the ${what} I built in the Strategy Lab (the <game_model>)${sources.length ? ', grounded in the attached sources' : ''}.`);
  }
  const primeCard = h(
    'aside',
    { class: 'sl-prime', 'aria-label': 'Equilibrium-Prime' },
    h(
      'div',
      { class: 'sl-sources' },
      h('div', { class: 'sl-sources-head' }, h('b', {}, 'Sources'), h('button', { class: 'btn small', onclick: () => sourceInput.click() }, icon('clip', 14), 'Add'), sourceInput),
      sourceList,
      h(
        'div',
        { class: 'sl-ask-row' },
        h('button', { class: 'btn primary', onclick: () => askPrime() }, '✦ Ask Equilibrium-Prime'),
        h(
          'select',
          {
            class: 'sl-starter',
            'aria-label': 'Example requests',
            onchange: (e: Event) => {
              const sel = e.target as HTMLSelectElement;
              if (sel.value) assistant.prefill(sel.value);
              sel.value = '';
            },
          },
          h('option', { value: '' }, 'Examples…'),
          ...EQUILIBRIUM_STARTERS.map((s) => h('option', { value: s }, s)),
        ),
      ),
      h('p', { class: 'muted sl-fine' }, 'It sees the model on this tab and your sources. Every equilibrium it states is computed by the game engine and listed under its answer. It never trades.'),
    ),
    assistant.el,
  );

  frame.body.replaceChildren(h('div', { class: 'sl-layout' }, h('div', { class: 'sl-main' }, editor, results), primeCard));

  function drawTabs() {
    tabs.replaceChildren(
      ...VIEWS.map(([v, label]) => h('button', { class: `tab${v === view ? ' active' : ''}`, role: 'tab', 'aria-selected': v === view ? 'true' : 'false', onclick: () => setView(v) }, label)),
    );
  }
  function setView(v: View) {
    view = v;
    persist();
    history.replaceState(null, '', v === 'matrix' ? '#strategy' : `#strategy/${v}`);
    render();
  }

  // ---------- requests ----------
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The solve in flight: aborted when a newer edit starts another, so stale re-solves don't queue up. */
  let inflight: AbortController | null = null;
  /** A game.* request for the current solve (cancelled by the next one). */
  const gameRequest = <T,>(type: string, params: Record<string, unknown>) => engineRequest<T>(type, params, 30000, undefined, inflight?.signal);
  /** Solves after a short pause (typing), ignoring replies that arrive after a newer edit. */
  function solveSoon(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(() => void solve(), delay);
  }
  function showError(message: string) {
    results.replaceChildren(h('div', { class: 'sl-error', role: 'alert' }, message));
  }
  async function solve() {
    const mine = ++seq;
    inflight?.abort();
    inflight = new AbortController();
    persist();
    try {
      if (view === 'matrix') await solveMatrix(mine);
      else if (view === 'tree') await solveTree(mine);
      else await solveCoalition(mine);
    } catch (err) {
      if (mine === seq && (err as Error).name !== 'AbortError') showError((err as Error).message || String(err));
    }
  }

  // ---------- matrix ----------
  const cellInputs = new Map<string, HTMLInputElement>();
  const cellTds = new Map<string, HTMLTableCellElement>();

  function drawMatrixEditor() {
    cellInputs.clear();
    cellTds.clear();
    const n = matrix.players.length;
    const preset = h(
      'select',
      {
        'aria-label': 'Load a textbook game',
        onchange: (e: Event) => {
          const p = MATRIX_PRESETS.find((x) => x.key === (e.target as HTMLSelectElement).value);
          if (!p) return;
          matrix = p.model();
          drawMatrixEditor();
          solveSoon(0);
        },
      },
      h('option', { value: '' }, 'Textbook games…'),
      ...MATRIX_PRESETS.map((p) => h('option', { value: p.key, title: p.story }, p.name)),
    );
    const playersSel = h(
      'select',
      {
        'aria-label': 'Number of players',
        onchange: (e: Event) => {
          const count = Number((e.target as HTMLSelectElement).value);
          matrix = resizeMatrix(matrix, count, matrix.strategies.map((s) => s.length));
          drawMatrixEditor();
          solveSoon(0);
        },
      },
      ...[2, 3, 4].slice(0, MAX_PLAYERS - 1).map((k) => h('option', { value: String(k), selected: k === n }, `${k} players`)),
    );
    const sizeInputs = matrix.players.map((name, p) =>
      h(
        'label',
        { class: 'sl-size' },
        h('span', { class: 'muted' }, `${name || `Player ${p + 1}`}: moves`),
        h('input', {
          type: 'number',
          min: 1,
          max: MAX_STRATEGIES,
          value: matrix.strategies[p].length,
          'aria-label': `Number of moves for ${name}`,
          onchange: (e: Event) => {
            const counts = matrix.strategies.map((s) => s.length);
            counts[p] = Math.max(1, Math.min(MAX_STRATEGIES, Math.round(Number((e.target as HTMLInputElement).value)) || 1));
            matrix = resizeMatrix(matrix, n, counts);
            drawMatrixEditor();
            solveSoon(0);
          },
        }),
      ),
    );
    const names = matrix.players.map((name, p) =>
      h('input', {
        class: `sl-player p${p}`,
        value: name,
        'aria-label': `Player ${p + 1} name`,
        oninput: (e: Event) => {
          matrix.players[p] = (e.target as HTMLInputElement).value;
          solveSoon();
        },
      }),
    );
    const toggles = h(
      'div',
      { class: 'sl-toggles' },
      h(
        'label',
        { class: 'sl-check', title: 'Also cross out moves that are never better and sometimes worse (the order can matter)' },
        h('input', { type: 'checkbox', checked: weak, onchange: (e: Event) => ((weak = (e.target as HTMLInputElement).checked), persist(), paintMatrix()) }),
        'Weak dominance',
      ),
      h(
        'label',
        { class: 'sl-check', title: 'Arrows show where each player would move from each cell' },
        h('input', { type: 'checkbox', checked: arrows, onchange: (e: Event) => ((arrows = (e.target as HTMLInputElement).checked), persist(), paintMatrix()) }),
        'Best-response arrows',
      ),
    );
    // one 2-player table per combination of the other players' moves
    const extra = matrix.strategies.slice(2);
    const combos = profiles(extra);
    const tables = combos.map((rest) => {
      const caption = rest.length
        ? h('caption', {}, rest.map((s, i) => `${matrix.players[i + 2] || `Player ${i + 3}`} plays ${matrix.strategies[i + 2][s]}`).join(' · '))
        : null;
      const head = h(
        'tr',
        {},
        h('th', { class: 'sl-corner', scope: 'col' }, h('span', { class: 'sl-who p1' }, matrix.players[1] || 'Player 2'), ' → ', h('br'), h('span', { class: 'sl-who p0' }, matrix.players[0] || 'Player 1'), ' ↓'),
        ...matrix.strategies[1].map((label, j) =>
          h(
            'th',
            { scope: 'col', 'data-col': j },
            h('input', {
              class: 'sl-label p1',
              value: label,
              title: label,
              'aria-label': `${matrix.players[1]} move ${j + 1}`,
              oninput: (e: Event) => {
                matrix.strategies[1][j] = (e.target as HTMLInputElement).value;
                (e.target as HTMLInputElement).title = matrix.strategies[1][j];
                solveSoon();
              },
            }),
          ),
        ),
      );
      const rows = matrix.strategies[0].map((label, i) =>
        h(
          'tr',
          {},
          h(
            'th',
            { scope: 'row', 'data-row': i },
            h('input', {
              class: 'sl-label p0',
              value: label,
              title: label,
              'aria-label': `${matrix.players[0]} move ${i + 1}`,
              oninput: (e: Event) => {
                matrix.strategies[0][i] = (e.target as HTMLInputElement).value;
                (e.target as HTMLInputElement).title = matrix.strategies[0][i];
                solveSoon();
              },
            }),
          ),
          ...matrix.strategies[1].map((_, j) => {
            const key = profileKey([i, j, ...rest]);
            const input = h('input', {
              class: 'sl-cell-input',
              value: matrix.cells[key] ?? '',
              inputmode: 'decimal',
              spellcheck: 'false',
              'aria-label': `Payoffs when ${[matrix.strategies[0][i], matrix.strategies[1][j], ...rest.map((s, q) => matrix.strategies[q + 2][s])].join(', ')}`,
              oninput: (e: Event) => {
                matrix.cells[key] = (e.target as HTMLInputElement).value;
                const ok = !('error' in parseCell(matrix.cells[key], n));
                input.classList.toggle('bad', !ok);
                solveSoon();
              },
            });
            cellInputs.set(key, input);
            const td = h('td', { class: 'sl-cell', 'data-key': key }, input, h('div', { class: 'sl-cell-marks', 'aria-hidden': 'true' }));
            cellTds.set(key, td);
            return td;
          }),
        ),
      );
      return h('div', { class: 'sl-table-wrap' }, h('table', { class: 'sl-matrix' }, caption, h('thead', {}, head), h('tbody', {}, ...rows)));
    });
    const extraLabels = extra.length
      ? h(
          'div',
          { class: 'sl-extra' },
          ...extra.map((s, q) =>
            h(
              'div',
              { class: 'sl-extra-row' },
              h('span', { class: 'muted' }, `${matrix.players[q + 2]}’s moves:`),
              ...s.map((label, k) =>
                h('input', {
                  class: 'sl-label',
                  value: label,
                  'aria-label': `${matrix.players[q + 2]} move ${k + 1}`,
                  onchange: (e: Event) => {
                    matrix.strategies[q + 2][k] = (e.target as HTMLInputElement).value;
                    drawMatrixEditor();
                    solveSoon(0);
                  },
                }),
              ),
            ),
          ),
        )
      : null;
    editor.replaceChildren(
      h('div', { class: 'sl-toolbar' }, preset, playersSel, ...sizeInputs),
      h('div', { class: 'sl-players' }, h('span', { class: 'muted' }, 'Players:'), ...names),
      extraLabels ?? '',
      h('p', { class: 'muted sl-fine' }, `Type each cell as ${n} payoffs, one per player in order (${matrix.players.join(', ')}), e.g. “3, 2”. Bigger is better. Fractions like 1/3 work.`),
      h('div', { class: 'sl-tables' }, ...tables),
      toggles,
      legend(),
    );
    paintMatrix();
  }

  function legend() {
    return h(
      'div',
      { class: 'sl-legend', 'aria-label': 'Legend' },
      h('span', {}, h('i', { class: 'sl-key nash' }), 'Nash equilibrium (stable)'),
      h('span', {}, h('i', { class: 'sl-key pareto' }, '★'), 'Pareto-optimal (no cell better for all)'),
      h('span', {}, h('i', { class: 'sl-key best' }, 'u'), 'Underlined payoff: best reply'),
      h('span', {}, h('i', { class: 'sl-key dominated' }), 'Crossed out by dominance'),
    );
  }

  /** Colours the cells from the latest result without rebuilding the inputs (so typing keeps focus). */
  function paintMatrix() {
    const gone = normal ? eliminated(normal, weak) : new Set<string>();
    for (const [key, td] of cellTds) {
      const profile = key.split(',').map(Number);
      const marks = td.querySelector('.sl-cell-marks') as HTMLElement;
      td.classList.remove('nash', 'pareto', 'dominated');
      marks.replaceChildren();
      if (!normal) continue;
      const v = cellView(normal, profile, weak);
      td.classList.toggle('nash', v.nash);
      td.classList.toggle('pareto', v.pareto);
      td.classList.toggle('dominated', v.dominated);
      const cell = normal.cells.find((c) => profileKey(c.profile) === key);
      if (cell) {
        marks.append(
          ...cell.payoffs.flatMap((u, p) => [
            p ? h('span', { class: 'sl-sep' }, ', ') : '',
            h('span', { class: `sl-pay p${Math.min(p, 3)}${v.bestFor.includes(p) ? ' best' : ''}`, title: v.bestFor.includes(p) ? `${normal!.players[p]}’s best reply` : '' }, fmt(u)),
          ]),
        );
      }
      if (v.pareto) marks.append(h('span', { class: 'sl-star', title: 'Pareto-optimal' }, '★'));
      if (arrows && (v.rowArrow || v.colArrow)) {
        marks.append(
          h('span', { class: 'sl-arrows' }, v.rowArrow ? h('span', { class: 'p0', title: `${normal.players[0]} would switch` }, v.rowArrow === 'up' ? '↑' : '↓') : '', v.colArrow ? h('span', { class: 'p1', title: `${normal.players[1]} would switch` }, v.colArrow === 'left' ? '←' : '→') : ''),
        );
      }
      if (arrows && v.nash) marks.append(h('span', { class: 'sl-arrows rest', title: 'Nobody wants to move' }, '●'));
    }
    editor.querySelectorAll<HTMLElement>('th[data-row]').forEach((th) => th.classList.toggle('dominated', gone.has(`0:${th.dataset.row}`)));
    editor.querySelectorAll<HTMLElement>('th[data-col]').forEach((th) => th.classList.toggle('dominated', gone.has(`1:${th.dataset.col}`)));
  }

  async function solveMatrix(mine: number) {
    const read = matrixPayload(matrix);
    if ('error' in read) {
      normal = null;
      paintMatrix();
      return showError(read.error);
    }
    const n = read.payload.players.length;
    const r = await gameRequest<NormalResult>('game.solve_normal', { ...read.payload, weak, welfare: 'sum' });
    if (mine !== seq) return;
    normal = r;
    paintMatrix();
    // a repeated-game line: can the best cell that isn't stable be kept up by grim trigger?
    let repeated: HTMLElement | null = null;
    const candidates = r.cells.filter((c) => c.pareto && !c.nash).sort((a, b) => b.payoffs.reduce((x, y) => x + y, 0) - a.payoffs.reduce((x, y) => x + y, 0));
    if (n === 2 && candidates.length && r.pureNash.length) {
      try {
        const rep = await gameRequest<{ threshold: number | null; cooperateLabels: string[]; punishLabels: string[] }>('game.repeated', {
          ...read.payload,
          cooperate: candidates[0].profile.map((s, p) => read.payload.strategies[p][s]),
        });
        if (mine !== seq) return;
        repeated = h(
          'div',
          { class: 'sl-card' },
          h('h3', {}, 'If the game is played again and again'),
          rep.threshold == null
            ? h('p', {}, `(${rep.cooperateLabels.join(', ')}) can’t be kept up by the threat of falling back to (${rep.punishLabels.join(', ')}).`)
            : h(
                'p',
                {},
                `Both can stick to (${rep.cooperateLabels.join(', ')}) if each threatens to switch to (${rep.punishLabels.join(', ')}) forever after any cheating (“grim trigger”), as long as they value the future enough: a discount factor δ of at least `,
                h('b', {}, fmt(rep.threshold)),
                `. δ is how much next round’s payoff is worth today (0.9 = 90%).`,
              ),
        );
      } catch {
        repeated = null;
      }
      if (mine !== seq) return;
    }
    const mixed = (r.mixedNash ?? []).filter((e) => !e.pure);
    results.replaceChildren(
      h(
        'div',
        { class: 'sl-cards' },
        h(
          'div',
          { class: 'sl-card' },
          h('h3', {}, 'Equilibria'),
          r.pureNash.length
            ? h('ul', { class: 'sl-eq' }, ...r.pureNash.map((e) => h('li', {}, h('span', { class: 'sl-badge nash' }, 'Pure'), ` (${e.labels.join(', ')}) → ${e.payoffs.map(fmt).join(', ')}`, e.paretoOptimal ? h('span', { class: 'sl-star', title: 'Pareto-optimal' }, ' ★') : '')))
            : h('p', { class: 'muted' }, 'No pure-strategy equilibrium.'),
          ...mixed.map((e) =>
            h(
              'div',
              { class: 'sl-mixed' },
              h('span', { class: 'sl-badge mixed' }, 'Mixed'),
              ...[0, 1].map((p) =>
                h(
                  'div',
                  { class: 'sl-probs' },
                  h('span', { class: `sl-who p${p}` }, r.players[p]),
                  ...r.strategies[p].map((s, i) =>
                    h(
                      'div',
                      { class: 'sl-prob' },
                      h('span', { class: 'sl-prob-label' }, s),
                      h('span', { class: 'sl-bar', 'aria-hidden': 'true' }, h('i', { class: `p${p}`, style: `width:${Math.round(e.probabilities[p][i] * 100)}%` })),
                      h('span', { class: 'sl-prob-num', title: e.exact[p][i] }, `${Math.round(e.probabilities[p][i] * 1000) / 10}%`),
                    ),
                  ),
                ),
              ),
              h('p', { class: 'muted sl-fine' }, `Expected payoffs ${e.payoffs.map(fmt).join(', ')}${e.source ? ` · found by ${e.source}` : ''}`),
            ),
          ),
          r.welfare && r.welfare.priceOfAnarchy != null ? h('p', { class: 'sl-fine' }, `Price of anarchy ${fmt(r.welfare.priceOfAnarchy)} · price of stability ${fmt(r.welfare.priceOfStability)} (total payoff)`) : '',
          r.crossCheck ? h('p', { class: 'muted sl-fine' }, r.crossCheck.agrees ? 'Cross-checked with nashpy (vertex enumeration): same equilibria.' : 'nashpy’s vertex enumeration found extra equilibria (degenerate game); they are listed.') : '',
          ...r.notes.map((t) => h('p', { class: 'muted sl-fine' }, t)),
        ),
        h('div', { class: 'sl-card' }, h('h3', {}, 'In plain words'), explainList(explainNormal(r))),
        repeated ?? '',
        bestResponseTable(r),
      ),
    );
  }

  function bestResponseTable(r: NormalResult) {
    if (r.players.length !== 2) return '';
    return h(
      'details',
      { class: 'sl-card sl-fold' },
      h('summary', {}, 'Best-response table'),
      ...r.bestResponses.map((t) =>
        h(
          'table',
          { class: 'sl-br' },
          h('caption', {}, `${t.name}’s best reply`),
          h('thead', {}, h('tr', {}, h('th', {}, 'If the other plays'), h('th', {}, 'Best reply'), h('th', {}, 'Gets'))),
          h('tbody', {}, ...t.rows.map((row) => h('tr', {}, h('td', {}, row.againstLabels.join(', ')), h('td', {}, row.best.map((b) => r.strategies[t.player][b]).join(' or ')), h('td', {}, fmt(row.payoff))))),
        ),
      ),
    );
  }

  // ---------- tree ----------
  let treeView: { onPath: Set<string>; chosen: Set<string>; threats: Set<string> } | null = null;
  let nodeSeq = 0;
  const newKey = () => `k${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

  function drawTreeEditor() {
    const n = tree.players.length;
    const preset = h(
      'select',
      {
        'aria-label': 'Load an example tree',
        onchange: (e: Event) => {
          const p = TREE_PRESETS.find((x) => x.key === (e.target as HTMLSelectElement).value);
          if (!p) return;
          tree = p.model();
          treeView = null;
          drawTreeEditor();
          solveSoon(0);
        },
      },
      h('option', { value: '' }, 'Examples…'),
      ...TREE_PRESETS.map((p) => h('option', { value: p.key, title: p.story }, p.name)),
    );
    const names = tree.players.map((name, p) =>
      h('input', {
        class: `sl-player p${p}`,
        value: name,
        'aria-label': `Player ${p + 1} name`,
        onchange: (e: Event) => {
          tree.players[p] = (e.target as HTMLInputElement).value;
          drawTreeEditor();
          solveSoon();
        },
      }),
    );
    const addPlayer = h('button', { class: 'btn small', disabled: n >= 4, onclick: () => (tree.players.push(`Player ${n + 1}`), padPayoffs(), drawTreeEditor(), solveSoon(0)) }, '+ Player');
    const removePlayer = h(
      'button',
      { class: 'btn small', disabled: n <= 2, onclick: () => (tree.players.pop(), tree.nodes.forEach((x) => (x.player = Math.min(x.player, tree.players.length - 1))), padPayoffs(), drawTreeEditor(), solveSoon(0)) },
      '− Player',
    );
    const rows: HTMLElement[] = [];
    const walk = (key: string, depth: number) => {
      const node = tree.nodes.find((x) => x.key === key);
      if (!node) return;
      const kids = childrenOf(tree, key);
      const leaf = !kids.length;
      const status = treeView?.threats.has(key) ? 'threat' : treeView?.onPath.has(key) ? 'path' : treeView?.chosen.has(key) ? 'chosen' : '';
      rows.push(
        h(
          'div',
          { class: `sl-node ${leaf ? 'leaf' : 'decision'} ${status}`, style: `--depth:${depth}`, 'data-key': key },
          node.parent
            ? h('input', {
                class: 'sl-action',
                value: node.action,
                placeholder: 'move',
                'aria-label': 'Move that leads here',
                oninput: (e: Event) => ((node.action = (e.target as HTMLInputElement).value), solveSoon()),
              })
            : h('span', { class: 'sl-root muted' }, 'Start'),
          h('input', { class: 'sl-node-label', value: node.label, placeholder: leaf ? 'outcome' : 'decision', 'aria-label': 'Node name', oninput: (e: Event) => ((node.label = (e.target as HTMLInputElement).value), solveSoon()) }),
          leaf
            ? h('input', {
                class: `sl-node-pay${'error' in parseCell(node.payoffs, n) ? ' bad' : ''}`,
                value: node.payoffs,
                placeholder: Array(n).fill('0').join(', '),
                'aria-label': `Payoffs (${tree.players.join(', ')})`,
                oninput: (e: Event) => {
                  node.payoffs = (e.target as HTMLInputElement).value;
                  (e.target as HTMLElement).classList.toggle('bad', 'error' in parseCell(node.payoffs, n));
                  solveSoon();
                },
              })
            : h(
                'select',
                { class: 'sl-node-player', 'aria-label': 'Who moves here', onchange: (e: Event) => ((node.player = Number((e.target as HTMLSelectElement).value)), drawTreeEditor(), solveSoon(0)) },
                ...tree.players.map((p, i) => h('option', { value: String(i), selected: node.player === i }, `${p} moves`)),
              ),
          status === 'threat' ? h('span', { class: 'sl-badge warn', title: 'A move the player would threaten but not carry out' }, 'Empty threat') : status === 'path' ? h('span', { class: 'sl-badge nash' }, 'Played') : status === 'chosen' ? h('span', { class: 'sl-badge soft' }, 'Would choose') : '',
          h('span', { class: 'spacer' }),
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Add a move from here',
              'aria-label': 'Add a move from here',
              onclick: () => {
                if (leaf) node.player = Math.min(node.player, n - 1);
                tree.nodes.push({ key: newKey(), parent: key, action: `Move ${kids.length + 1}`, label: '', player: 0, payoffs: Array(n).fill('0').join(', ') });
                drawTreeEditor();
                solveSoon(0);
              },
            },
            icon('plus', 16),
          ),
          node.parent
            ? h(
                'button',
                {
                  class: 'icon-btn',
                  title: 'Delete this branch',
                  'aria-label': 'Delete this branch',
                  onclick: () => {
                    const drop = new Set([key]);
                    let grew = true;
                    while (grew) {
                      grew = false;
                      for (const x of tree.nodes) if (x.parent && drop.has(x.parent) && !drop.has(x.key)) (drop.add(x.key), (grew = true));
                    }
                    tree.nodes = tree.nodes.filter((x) => !drop.has(x.key));
                    drawTreeEditor();
                    solveSoon(0);
                  },
                },
                icon('trash', 16),
              )
            : '',
        ),
      );
      for (const k of kids) walk(k.key, depth + 1);
    };
    const root = tree.nodes.find((x) => x.parent === null);
    if (root) walk(root.key, 0);
    editor.replaceChildren(
      h('div', { class: 'sl-toolbar' }, preset, addPlayer, removePlayer),
      h('div', { class: 'sl-players' }, h('span', { class: 'muted' }, 'Players:'), ...names),
      h('p', { class: 'muted sl-fine' }, `Each row is a point in the game. Decisions say who moves; end points list the payoffs (${tree.players.join(', ')}). Press + to add a move.`),
      h('div', { class: 'sl-tree', role: 'tree' }, ...rows),
      h(
        'div',
        { class: 'sl-legend' },
        h('span', {}, h('span', { class: 'sl-badge nash' }, 'Played'), 'on the equilibrium path'),
        h('span', {}, h('span', { class: 'sl-badge soft' }, 'Would choose'), 'off the path'),
        h('span', {}, h('span', { class: 'sl-badge warn' }, 'Empty threat'), 'not credible'),
      ),
    );
  }
  function padPayoffs() {
    const n = tree.players.length;
    for (const x of tree.nodes) {
      const parts = x.payoffs.split(/[,;\s]+/).filter(Boolean).slice(0, n);
      while (parts.length < n) parts.push('0');
      x.payoffs = parts.join(', ');
    }
  }

  async function solveTree(mine: number) {
    const read = treePayload(tree);
    if ('error' in read) {
      treeView = null;
      return showError(read.error);
    }
    const r = await gameRequest<TreeResult>('game.solve_tree', { tree: read.tree, players: tree.players });
    if (mine !== seq) return;
    const before = JSON.stringify(treeView && [...treeView.onPath, ...treeView.chosen, ...treeView.threats]);
    treeView = treeHighlights(r, read.paths);
    // repaint the badges only when they changed and no input has focus (typing keeps its place)
    if (before !== JSON.stringify([...treeView.onPath, ...treeView.chosen, ...treeView.threats]) && !editor.contains(document.activeElement)) drawTreeEditor();
    else paintTree();
    results.replaceChildren(
      h(
        'div',
        { class: 'sl-cards' },
        h(
          'div',
          { class: 'sl-card' },
          h('h3', {}, 'Subgame-perfect equilibrium'),
          h('p', { class: 'sl-path' }, ...r.path.flatMap((s, i) => [i ? ' → ' : '', h('span', { class: `sl-who p${Math.min(s.player, 3)}` }, r.players[s.player]), `: ${s.action}`])),
          h('p', {}, `Payoffs: ${r.payoffs.map((u, i) => `${r.players[i]} ${fmt(u)}`).join(', ')}`),
          ...r.notes.map((t) => h('p', { class: 'muted sl-fine' }, t)),
        ),
        h('div', { class: 'sl-card' }, h('h3', {}, 'In plain words'), explainList(explainTree(r))),
      ),
    );
  }
  /** Updates the row badges in place (when typing). */
  function paintTree() {
    editor.querySelectorAll<HTMLElement>('.sl-node').forEach((row) => {
      const key = row.dataset.key ?? '';
      row.classList.toggle('threat', !!treeView?.threats.has(key));
      row.classList.toggle('path', !!treeView?.onPath.has(key) && !treeView?.threats.has(key));
    });
  }

  // ---------- coalitions ----------
  function drawCoalitionEditor() {
    const n = coalition.players.length;
    const preset = h(
      'select',
      {
        'aria-label': 'Load an example',
        onchange: (e: Event) => {
          const p = COALITION_PRESETS.find((x) => x.key === (e.target as HTMLSelectElement).value);
          if (!p) return;
          coalition = p.model();
          drawCoalitionEditor();
          solveSoon(0);
        },
      },
      h('option', { value: '' }, 'Examples…'),
      ...COALITION_PRESETS.map((p) => h('option', { value: p.key, title: p.story }, p.name)),
    );
    const count = h(
      'select',
      {
        'aria-label': 'Number of players',
        onchange: (e: Event) => {
          const k = Number((e.target as HTMLSelectElement).value);
          coalition = { players: Array.from({ length: k }, (_, i) => coalition.players[i] ?? `P${i + 1}`), values: k === n ? coalition.values : {} };
          drawCoalitionEditor();
          solveSoon(0);
        },
      },
      ...[2, 3, 4, 5].map((k) => h('option', { value: String(k), selected: k === n }, `${k} players`)),
    );
    const names = coalition.players.map((name, p) =>
      h('input', {
        class: 'sl-player',
        value: name,
        'aria-label': `Player ${p + 1} name`,
        onchange: (e: Event) => ((coalition.players[p] = (e.target as HTMLInputElement).value), drawCoalitionEditor(), solveSoon(0)),
      }),
    );
    const rows = coalitions(n).map((c) => {
      const key = c.join(',');
      return h(
        'label',
        { class: 'sl-coalition' },
        h('span', {}, `{${c.map((i) => coalition.players[i]).join(', ')}}`),
        h('input', {
          value: coalition.values[key] ?? '',
          placeholder: '0',
          inputmode: 'decimal',
          'aria-label': `Value of ${c.map((i) => coalition.players[i]).join(', ')}`,
          oninput: (e: Event) => ((coalition.values[key] = (e.target as HTMLInputElement).value), solveSoon()),
        }),
      );
    });
    const bargain = h(
      'div',
      { class: 'sl-card sl-bargain' },
      h('h3', {}, 'Two-party bargaining'),
      h('p', { class: 'muted sl-fine' }, 'Possible deals as “player 1, player 2” payoffs separated by semicolons, and what each gets if talks fail.'),
      h('label', {}, h('span', {}, 'Deals'), h('input', { value: bargainState.points, 'aria-label': 'Possible deals', oninput: (e: Event) => ((bargainState.points = (e.target as HTMLInputElement).value), solveSoon()) })),
      h('label', {}, h('span', {}, 'If no deal'), h('input', { value: bargainState.disagreement, 'aria-label': 'Disagreement point', oninput: (e: Event) => ((bargainState.disagreement = (e.target as HTMLInputElement).value), solveSoon()) })),
      h(
        'label',
        {},
        h('span', {}, 'Player 1’s power'),
        h('input', { type: 'range', min: 0.05, max: 0.95, step: 0.05, value: bargainState.power, 'aria-label': 'Bargaining power of player 1', oninput: (e: Event) => ((bargainState.power = Number((e.target as HTMLInputElement).value)), solveSoon()) }),
      ),
      h('div', { class: 'sl-bargain-out' }),
    );
    editor.replaceChildren(
      h('div', { class: 'sl-toolbar' }, preset, count),
      h('div', { class: 'sl-players' }, h('span', { class: 'muted' }, 'Players:'), ...names),
      h('p', { class: 'muted sl-fine' }, 'What each group can earn on its own. Blank means 0. The last row is everyone together.'),
      h('div', { class: 'sl-coalitions' }, ...rows),
      bargain,
    );
  }

  async function solveCoalition(mine: number) {
    const read = coalitionPayload(coalition);
    const bargainOut = editor.querySelector('.sl-bargain-out') as HTMLElement | null;
    const points = bargainState.points.split(';').map((p) => parseCell(p, 2));
    const d = parseCell(bargainState.disagreement, 2);
    const bargainReq =
      points.every((p) => 'values' in p) && 'values' in d
        ? gameRequest<{ solution: number[] | null; gains?: number[]; notes: string[] }>('game.bargain', {
            points: points.map((p) => (p as { values: string[] }).values),
            disagreement: d.values,
            power: bargainState.power,
          }).catch((err: Error) => ({ solution: null, notes: [err.message] }))
        : Promise.resolve({ solution: null, notes: ['Type each deal and the no-deal point as two numbers.'] });
    if ('error' in read) {
      showError(read.error);
    } else {
      const r = await gameRequest<ShapleyResult>('game.shapley', read);
      if (mine !== seq) return;
      const max = Math.max(...r.shapley.map(Math.abs), 1e-9);
      results.replaceChildren(
        h(
          'div',
          { class: 'sl-cards' },
          h(
            'div',
            { class: 'sl-card' },
            h('h3', {}, 'Shapley value'),
            ...r.players.map((p, i) =>
              h(
                'div',
                { class: 'sl-prob' },
                h('span', { class: 'sl-prob-label' }, p),
                h('span', { class: 'sl-bar', 'aria-hidden': 'true' }, h('i', { class: 'p0', style: `width:${Math.round((Math.abs(r.shapley[i]) / max) * 100)}%` })),
                h('span', { class: 'sl-prob-num', title: r.exact[i] }, fmt(r.shapley[i])),
              ),
            ),
            h(
              'p',
              { class: 'sl-fine' },
              r.core.nonEmpty == null ? 'Core not checked.' : r.core.nonEmpty ? h('span', { class: 'sl-badge nash' }, 'Core: not empty') : h('span', { class: 'sl-badge warn' }, 'Core: empty'),
              r.shapleyInCore == null ? '' : r.shapleyInCore ? ' · the Shapley value is in the core' : ' · the Shapley value is not in the core',
            ),
            ...r.notes.map((t) => h('p', { class: 'muted sl-fine' }, t)),
          ),
          h('div', { class: 'sl-card' }, h('h3', {}, 'In plain words'), explainList(explainShapley(r))),
        ),
      );
    }
    const b = await bargainReq;
    if (mine !== seq || !bargainOut) return;
    bargainOut.replaceChildren(
      b.solution
        ? h('p', {}, 'Nash bargaining solution: player 1 gets ', h('b', {}, fmt(b.solution[0])), ', player 2 gets ', h('b', {}, fmt(b.solution[1])), b.gains ? ` (gains over no deal: ${b.gains.map(fmt).join(' and ')}). Each side’s threat point matters: a better outside option wins a bigger share.` : '')
        : h('p', { class: 'muted' }, b.notes.join(' ')),
    );
  }

  function render() {
    drawTabs();
    results.replaceChildren(h('div', { class: 'muted pad' }, 'Solving…'));
    if (view === 'matrix') drawMatrixEditor();
    else if (view === 'tree') drawTreeEditor();
    else drawCoalitionEditor();
    solveSoon(0);
  }

  return {
    el: frame.el,
    start(sub?: string) {
      const asked = VIEWS.find(([v]) => v === sub)?.[0];
      if (asked && asked !== view) view = asked;
      render();
    },
    stop() {
      clearTimeout(timer);
      inflight?.abort();
    },
    /** Opens Equilibrium-Prime with a question (from elsewhere on the platform). */
    ask: (question: string) => askPrime(question),
  };
}
