/**
 * The Strategy Lab's models and how results map onto the page. Pure (no DOM) and tested (model.test.ts).
 *
 * - Matrix games: 2-4 players; each cell holds every player's payoff typed as text ("3, 2", "-1; 0.5", "1/3 2/3").
 *   Payoffs go to the helper as text so decimals and fractions stay exact there (engine/gametheory.py).
 * - Trees: a flat list of nodes (parent + the action that leads to it) turned into the helper's nested tree.
 * - Coalitions: a value per group of players (missing = 0).
 */

export const MAX_PLAYERS = 4;
export const MAX_STRATEGIES = 8;

export interface MatrixModel {
  players: string[];
  strategies: string[][];
  /** profile key ("0,1" or "0,1,0") -> cell text, one payoff per player */
  cells: Record<string, string>;
}

export interface TreeNode {
  key: string;
  parent: string | null;
  /** The move that leads here from the parent ('' at the root). */
  action: string;
  label: string;
  /** Who moves here (decision nodes). */
  player: number;
  /** End points: each player's payoff as text. */
  payoffs: string;
}

export interface TreeModel {
  players: string[];
  nodes: TreeNode[];
}

export interface CoalitionModel {
  players: string[];
  /** coalition key (member indices joined by ",", e.g. "0,2") -> value text */
  values: Record<string, string>;
}

export const profileKey = (profile: number[]) => profile.join(',');

/** Every profile of the game, first player slowest. */
export function profiles(strategies: string[][]): number[][] {
  let out: number[][] = [[]];
  for (const s of strategies) out = out.flatMap((p) => s.map((_, i) => [...p, i]));
  return out;
}

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$|^[-+]?\d+\/\d+$/i;

/** Reads one cell: n payoffs separated by commas, semicolons or spaces. Numbers, decimals or fractions (1/3). */
export function parseCell(text: string, n: number): { values: string[] } | { error: string } {
  const parts = text
    .replace(/[−–]/g, '-')
    .replace(/[()[\]]/g, ' ')
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== n) return { error: `Needs ${n} payoffs (one per player)` };
  for (const p of parts) {
    if (!NUMBER.test(p)) return { error: `“${p}” isn’t a number` };
    if (/\/0+$/.test(p)) return { error: 'Can’t divide by zero' };
  }
  return { values: parts };
}

/** A payoff as a number (for display). */
export function payoffNumber(text: string): number {
  const [a, b] = text.split('/');
  return b === undefined ? Number(a) : Number(a) / Number(b);
}

export interface MatrixPayload {
  players: string[];
  strategies: string[][];
  payoffs: unknown[];
}

/** The game.solve_normal request body, or the first problem (cell key + message). */
export function matrixPayload(model: MatrixModel): { payload: MatrixPayload } | { error: string; cell?: string } {
  const n = model.players.length;
  if (n < 2 || n > MAX_PLAYERS) return { error: `Use 2 to ${MAX_PLAYERS} players` };
  if (model.strategies.length !== n) return { error: 'Each player needs a strategy list' };
  for (const s of model.strategies) if (!s.length || s.length > MAX_STRATEGIES) return { error: `Each player needs 1 to ${MAX_STRATEGIES} strategies` };
  const parsed: Record<string, string[]> = {};
  for (const p of profiles(model.strategies)) {
    const key = profileKey(p);
    const read = parseCell(model.cells[key] ?? '', n);
    if ('error' in read) return { error: `${model.strategies.map((s, i) => s[p[i]]).join(' / ')}: ${read.error}`, cell: key };
    parsed[key] = read.values;
  }
  const build = (prefix: number[]): unknown[] =>
    model.strategies[prefix.length].map((_, i) => (prefix.length === n - 1 ? parsed[profileKey([...prefix, i])] : build([...prefix, i])));
  return { payload: { players: model.players.map((p, i) => p.trim() || `Player ${i + 1}`), strategies: model.strategies.map((s) => s.map((x, i) => x.trim() || `S${i + 1}`)), payoffs: build([]) } };
}

/** Resizes a model (adding blank-but-valid "0, 0" cells and keeping the ones that remain). */
export function resizeMatrix(model: MatrixModel, players: number, counts: number[]): MatrixModel {
  const names = Array.from({ length: players }, (_, i) => model.players[i] ?? `Player ${i + 1}`);
  const strategies = Array.from({ length: players }, (_, p) =>
    Array.from({ length: Math.max(1, Math.min(MAX_STRATEGIES, counts[p] ?? model.strategies[p]?.length ?? 2)) }, (_, i) => model.strategies[p]?.[i] ?? `S${i + 1}`),
  );
  const cells: Record<string, string> = {};
  const zero = Array(players).fill('0').join(', ');
  for (const prof of profiles(strategies)) {
    const key = profileKey(prof);
    const old = model.cells[key];
    cells[key] = old && model.players.length === players ? old : zero;
  }
  return { players: names, strategies, cells };
}

function matrix(rows: string[], cols: string[], grid: string[][], players = ['Row', 'Column']): MatrixModel {
  const cells: Record<string, string> = {};
  grid.forEach((r, i) => r.forEach((c, j) => (cells[`${i},${j}`] = c)));
  return { players, strategies: [rows, cols], cells };
}

/** Textbook games, with a one-line story for a beginner. */
export const MATRIX_PRESETS: { key: string; name: string; story: string; model: () => MatrixModel }[] = [
  {
    key: 'pd',
    name: 'Prisoner’s Dilemma',
    story: 'Each does better by defecting whatever the other does, so both defect, though both cooperating pays more.',
    model: () => matrix(['Cooperate', 'Defect'], ['Cooperate', 'Defect'], [['3, 3', '0, 5'], ['5, 0', '1, 1']], ['Firm A', 'Firm B']),
  },
  {
    key: 'bos',
    name: 'Battle of the Sexes',
    story: 'Both want to be together but prefer different places: two ways to coordinate and a risky coin-flip third.',
    model: () => matrix(['Opera', 'Football'], ['Opera', 'Football'], [['3, 2', '0, 0'], ['0, 0', '2, 3']], ['Alex', 'Sam']),
  },
  {
    key: 'pennies',
    name: 'Matching Pennies',
    story: 'One wins by matching, the other by mismatching: the only stable plan is to be unpredictable.',
    model: () => matrix(['Heads', 'Tails'], ['Heads', 'Tails'], [['1, -1', '-1, 1'], ['-1, 1', '1, -1']], ['Matcher', 'Mismatcher']),
  },
  {
    key: 'chicken',
    name: 'Chicken (Hawk-Dove)',
    story: 'Whoever backs down loses face, but if neither does, both crash.',
    model: () => matrix(['Swerve', 'Straight'], ['Swerve', 'Straight'], [['0, 0', '-1, 1'], ['1, -1', '-10, -10']], ['Driver 1', 'Driver 2']),
  },
  {
    key: 'stag',
    name: 'Stag Hunt',
    story: 'Hunting the stag together pays most, but only if you trust the other to show up.',
    model: () => matrix(['Stag', 'Hare'], ['Stag', 'Hare'], [['4, 4', '0, 3'], ['3, 0', '3, 3']], ['Hunter 1', 'Hunter 2']),
  },
  {
    key: 'iesds',
    name: '3×3 solved by dominance',
    story: 'Cross out moves that are always worse, round after round, until one cell is left.',
    model: () => matrix(['Up', 'Mid', 'Down'], ['Left', 'Middle', 'Right'], [['1, 0', '1, 2', '0, 1'], ['0, 3', '0, 1', '2, 0'], ['0, 1', '0, 0', '-1, 2']]),
  },
  {
    key: 'adoption',
    name: 'Tech adoption (3 players)',
    story: 'A new system pays off only if all three switch; switching alone is wasted. A three-way Stag Hunt.',
    model: () => {
      const strategies = [['New', 'Old'], ['New', 'Old'], ['New', 'Old']];
      const cells: Record<string, string> = {};
      for (const p of profiles(strategies)) {
        const allNew = p.every((s) => s === 0);
        cells[profileKey(p)] = p.map((s) => (s === 1 ? '3' : allNew ? '4' : '0')).join(', ');
      }
      return { players: ['Member 1', 'Member 2', 'Member 3'], strategies, cells };
    },
  },
];

// ---------- results ----------

export interface DominanceStep {
  round: number;
  player: number;
  strategy: number;
  label: string;
  by: number;
  byLabel: string;
  kind: 'strict' | 'weak';
}

export interface NormalResult {
  players: string[];
  strategies: string[][];
  dominance: { strict: { remaining: number[][]; steps: DominanceStep[]; solved: boolean; note: string }; weak: { remaining: number[][]; steps: DominanceStep[]; solved: boolean; note: string } | null };
  pureNash: { profile: number[]; labels: string[]; payoffs: number[]; paretoOptimal: boolean }[];
  mixedNash: { probabilities: number[][]; exact: string[][]; payoffs: number[]; support: number[][]; pure: boolean; source?: string }[] | null;
  degenerate: boolean | null;
  pareto: number[][];
  bestResponses: { player: number; name: string; rows: { against: number[]; againstLabels: string[]; best: number[]; payoff: number }[] }[];
  cells: { profile: number[]; payoffs: number[]; nash: boolean; pareto: boolean; bestFor: number[] }[];
  welfare?: { kind: string; optimum: number; optimumProfiles: number[][]; worstEquilibrium: number | null; bestEquilibrium: number | null; priceOfAnarchy: number | null; priceOfStability: number | null; note: string | null };
  crossCheck?: { library: string; method: string; found: number; agrees?: boolean } | null;
  notes: string[];
}

export interface CellView {
  nash: boolean;
  pareto: boolean;
  /** Some player's strategy in this cell is crossed out by strict dominance. */
  dominated: boolean;
  /** Players for whom this cell's strategy is a best reply. */
  bestFor: number[];
  /** Where the row player (0) would move from here: toward a better row ('up'/'down'), and the column player (1). */
  rowArrow: 'up' | 'down' | null;
  colArrow: 'left' | 'right' | null;
}

/** "player:strategy" for every strategy removed by elimination (strict, or weak when asked). */
export function eliminated(result: NormalResult, weak = false): Set<string> {
  const steps = (weak ? result.dominance.weak?.steps : result.dominance.strict.steps) ?? [];
  return new Set(steps.map((s) => `${s.player}:${s.strategy}`));
}

/** What to show in one cell of the matrix. */
export function cellView(result: NormalResult, profile: number[], weak = false): CellView {
  const key = profileKey(profile);
  const cell = result.cells.find((c) => profileKey(c.profile) === key);
  const gone = eliminated(result, weak);
  const dominated = profile.some((s, p) => gone.has(`${p}:${s}`));
  const best = (player: number) => {
    const table = result.bestResponses[player];
    const others = profile.filter((_, q) => q !== player);
    return table?.rows.find((r) => profileKey(r.against) === profileKey(others))?.best ?? [];
  };
  const toward = (player: number) => {
    if (cell?.bestFor.includes(player)) return null;
    const b = best(player);
    if (!b.length) return null;
    const here = profile[player];
    // the nearest best reply in the direction of the first one
    return b[0] < here ? -1 : 1;
  };
  const r = toward(0);
  const c = toward(1);
  return {
    nash: !!cell?.nash,
    pareto: !!cell?.pareto,
    dominated,
    bestFor: cell?.bestFor ?? [],
    rowArrow: r === null ? null : r < 0 ? 'up' : 'down',
    colArrow: c === null ? null : c < 0 ? 'left' : 'right',
  };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Plain-language lines for a beginner, next to each result. */
export function explainNormal(result: NormalResult): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  const names = result.players;
  const steps = result.dominance.strict.steps;
  if (steps.length) {
    out.push({
      title: 'Always-worse moves',
      text: `${steps.map((s) => `${names[s.player]} never plays ${s.label} (${s.byLabel} pays more whatever the others do${s.round > 1 ? ', once the moves already crossed out are gone' : ''})`).join('; ')}.${result.dominance.strict.solved ? ' That leaves one cell: the game is solved by dominance alone.' : ''}`,
    });
  } else out.push({ title: 'Always-worse moves', text: 'No move is worse than another in every case, so nothing can be crossed out.' });
  const pure = result.pureNash;
  if (pure.length) {
    out.push({
      title: pure.length === 1 ? 'The stable outcome' : `${pure.length} stable outcomes`,
      text: `${list(pure.map((e) => `(${e.labels.join(', ')})`))}: from ${pure.length === 1 ? 'there' : 'each'}, no player can do better by changing their move alone. That is a Nash equilibrium.`,
    });
  } else out.push({ title: 'No stable cell', text: 'Every cell tempts someone to switch, so there is no pure-strategy equilibrium.' });
  const mixed = (result.mixedNash ?? []).filter((e) => !e.pure);
  for (const e of mixed) {
    out.push({
      title: 'Keeping the other guessing',
      text: `${names[0]} plays ${result.strategies[0].map((s, i) => `${s} ${pct(e.probabilities[0][i])}`).filter((_, i) => e.probabilities[0][i] > 0).join(', ')}; ${names[1]} plays ${result.strategies[1].map((s, i) => `${s} ${pct(e.probabilities[1][i])}`).filter((_, i) => e.probabilities[1][i] > 0).join(', ')}. These odds make the other player indifferent, so neither can exploit the other. Expected payoffs: ${e.payoffs.join(' and ')}.`,
    });
  }
  const inefficient = pure.filter((e) => !e.paretoOptimal);
  if (inefficient.length) {
    out.push({ title: 'A trap', text: `${list(inefficient.map((e) => `(${e.labels.join(', ')})`))} is stable, yet another cell is better for everyone. The ideal outcome is not the equilibrium outcome.` });
  }
  const w = result.welfare;
  if (w && w.priceOfAnarchy != null) {
    out.push({ title: 'Price of anarchy', text: `The best total is ${w.optimum}; the worst equilibrium gets ${w.worstEquilibrium}. Acting selfishly costs a factor of ${w.priceOfAnarchy} (1 means no loss).` });
  }
  if (result.degenerate) out.push({ title: 'Ties', text: 'Some players are indifferent between moves, so there may be more equilibria than listed (even infinitely many).' });
  return out;
}

// ---------- trees ----------

export interface TreePayloadNode {
  label: string;
  player?: number;
  moves?: { action: string; next: TreePayloadNode }[];
  payoffs?: string[];
}

export const childrenOf = (model: TreeModel, key: string) => model.nodes.filter((n) => n.parent === key);

/** The helper's nested tree from the flat editor list, or the first problem. Also maps each decision path to its node key. */
export function treePayload(model: TreeModel): { tree: TreePayloadNode; paths: Map<string, string> } | { error: string; node?: string } {
  const root = model.nodes.find((n) => n.parent === null);
  if (!root) return { error: 'The tree needs a first move' };
  const paths = new Map<string, string>();
  const n = model.players.length;
  const build = (node: TreeNode, path: number[], depth: number): TreePayloadNode | { error: string; node?: string } => {
    if (depth > 30) return { error: 'The tree is too deep', node: node.key };
    paths.set(path.join(','), node.key);
    const kids = childrenOf(model, node.key);
    if (!kids.length) {
      const read = parseCell(node.payoffs, n);
      if ('error' in read) return { error: `${node.label || 'End point'}: ${read.error}`, node: node.key };
      return { label: node.label || 'End', payoffs: read.values };
    }
    if (node.player < 0 || node.player >= n) return { error: `${node.label || 'Decision'}: pick who moves`, node: node.key };
    const moves: { action: string; next: TreePayloadNode }[] = [];
    for (let i = 0; i < kids.length; i++) {
      const next = build(kids[i], [...path, i], depth + 1);
      if ('error' in next) return next;
      moves.push({ action: kids[i].action.trim() || `Move ${i + 1}`, next });
    }
    return { label: node.label || 'Decision', player: node.player, moves };
  };
  const tree = build(root, [], 0);
  if ('error' in tree) return tree;
  return { tree, paths };
}

export interface TreeResult {
  players: string[];
  path: { path: number[]; action: string; player: number }[];
  payoffs: number[];
  decisions: { path: number[]; label: string; player: number; name: string; choice: number; action: string; best: number[]; onPath: boolean; actions: string[]; values: number[][] }[];
  nonCredibleThreats: { path: number[]; label: string; player: number; name: string; action: string; carriedOut: number[]; bestThere: string; wouldInduce: string[]; payoffsIfBelieved: number[] }[];
  notes: string[];
}

/** Node keys on the equilibrium path, and for each decision node the key of the chosen child. */
export function treeHighlights(result: TreeResult, paths: Map<string, string>): { onPath: Set<string>; chosen: Set<string>; threats: Set<string> } {
  const onPath = new Set<string>();
  const chosen = new Set<string>();
  const threats = new Set<string>();
  const rootKey = paths.get('');
  if (rootKey) onPath.add(rootKey);
  for (const step of result.path) {
    const d = result.decisions.find((x) => x.path.join(',') === step.path.join(','));
    const k = d ? paths.get([...step.path, d.choice].join(',')) : undefined;
    if (k) onPath.add(k);
  }
  for (const d of result.decisions) {
    const k = paths.get([...d.path, d.choice].join(','));
    if (k) chosen.add(k);
  }
  for (const t of result.nonCredibleThreats) {
    const d = result.decisions.find((x) => x.path.join(',') === t.path.join(','));
    const i = d?.actions.indexOf(t.action) ?? -1;
    const k = i >= 0 ? paths.get([...t.path, i].join(',')) : undefined;
    if (k) threats.add(k);
  }
  return { onPath, chosen, threats };
}

export function explainTree(result: TreeResult): { title: string; text: string }[] {
  const out = [
    {
      title: 'Thinking backwards',
      text: `Start at the last decisions and ask what each player would really do there, then step back. Play goes ${result.path.map((s) => `${result.players[s.player]}: ${s.action}`).join(' → ')}, ending with payoffs ${result.payoffs.join(', ')}. This is the subgame-perfect equilibrium.`,
    },
  ];
  for (const t of result.nonCredibleThreats) {
    out.push({
      title: 'Empty threat',
      text: `${t.name} would like everyone to believe they’d ${t.action} (then the others would ${t.wouldInduce.join(', then ')} and ${t.name} would get ${t.payoffsIfBelieved[t.player]}). But when the moment comes, ${t.bestThere} pays ${t.name} more, so the threat isn’t credible. To make it credible, ${t.name} would need a commitment that changes their own payoffs.`,
    });
  }
  return out;
}

export const TREE_PRESETS: { key: string; name: string; story: string; model: () => TreeModel }[] = [
  {
    key: 'entry',
    name: 'Entry deterrence',
    story: 'A newcomer decides whether to enter; the incumbent can fight a price war or share the market.',
    model: () => ({
      players: ['Entrant', 'Incumbent'],
      nodes: [
        { key: 'n1', parent: null, action: '', label: 'Entrant decides', player: 0, payoffs: '' },
        { key: 'n2', parent: 'n1', action: 'Stay out', label: 'Stays out', player: 0, payoffs: '0, 2' },
        { key: 'n3', parent: 'n1', action: 'Enter', label: 'Incumbent responds', player: 1, payoffs: '' },
        { key: 'n4', parent: 'n3', action: 'Fight', label: 'Price war', player: 0, payoffs: '-1, -1' },
        { key: 'n5', parent: 'n3', action: 'Accommodate', label: 'Share the market', player: 0, payoffs: '1, 1' },
      ],
    }),
  },
  {
    key: 'ultimatum',
    name: 'Ultimatum (split 4)',
    story: 'One proposes how to split 4; the other accepts or both get nothing.',
    model: () => {
      const nodes: TreeNode[] = [{ key: 'u0', parent: null, action: '', label: 'Proposer offers', player: 0, payoffs: '' }];
      [1, 2, 3].forEach((give, i) => {
        nodes.push({ key: `u${i}r`, parent: 'u0', action: `Offer ${give}`, label: 'Responder decides', player: 1, payoffs: '' });
        nodes.push({ key: `u${i}a`, parent: `u${i}r`, action: 'Accept', label: 'Deal', player: 0, payoffs: `${4 - give}, ${give}` });
        nodes.push({ key: `u${i}x`, parent: `u${i}r`, action: 'Reject', label: 'No deal', player: 0, payoffs: '0, 0' });
      });
      return { players: ['Proposer', 'Responder'], nodes };
    },
  },
];

// ---------- coalitions ----------

/** Every non-empty group of n players, smallest first: [[0], [1], ..., [0, 1], ...]. */
export function coalitions(n: number): number[][] {
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) out.push(Array.from({ length: n }, (_, i) => i).filter((i) => mask >> i & 1));
  return out.sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')));
}

export function coalitionPayload(model: CoalitionModel): { players: string[]; coalitions: { members: string[]; value: string }[] } | { error: string; coalition?: string } {
  const names = model.players.map((p, i) => p.trim() || `P${i + 1}`);
  if (new Set(names).size !== names.length) return { error: 'Give each player a different name' };
  const rows: { members: string[]; value: string }[] = [];
  for (const c of coalitions(names.length)) {
    const key = c.join(',');
    const text = (model.values[key] ?? '').trim().replace(/[−–]/g, '-');
    if (!text) continue;
    if (!NUMBER.test(text)) return { error: `{${c.map((i) => names[i]).join(', ')}}: “${text}” isn’t a number`, coalition: key };
    rows.push({ members: c.map((i) => names[i]), value: text });
  }
  const all = names.map((_, i) => i).join(',');
  if (!(model.values[all] ?? '').trim()) return { error: 'Give the value of everyone together (the last row)', coalition: all };
  return { players: names, coalitions: rows };
}

export const COALITION_PRESETS: { key: string; name: string; story: string; model: () => CoalitionModel }[] = [
  {
    key: 'gloves',
    name: 'Glove game',
    story: 'One player has a left glove, two have right gloves; only a pair is worth anything.',
    model: () => ({ players: ['Left', 'Right 1', 'Right 2'], values: { '0': '0', '1': '0', '2': '0', '0,1': '1', '0,2': '1', '1,2': '0', '0,1,2': '1' } }),
  },
  {
    key: 'majority',
    name: 'Majority vote',
    story: 'Any two of three can pass a deal worth 1; everyone wants in, so no split is safe.',
    model: () => ({ players: ['A', 'B', 'C'], values: { '0,1': '1', '0,2': '1', '1,2': '1', '0,1,2': '1' } }),
  },
  {
    key: 'jv',
    name: 'Joint venture',
    story: 'Three firms; bigger teams create more value, and firm A brings the most.',
    model: () => ({ players: ['Firm A', 'Firm B', 'Firm C'], values: { '0': '2', '1': '1', '2': '1', '0,1': '6', '0,2': '6', '1,2': '3', '0,1,2': '10' } }),
  },
];

export interface ShapleyResult {
  players: string[];
  shapley: number[];
  exact: string[];
  total: number;
  core: { nonEmpty: boolean | null; allocation: number[] | null; minimumNeeded?: number };
  shapleyInCore: boolean | null;
  shapleyBlocking: { members: number[]; value: number; gets: number }[] | null;
  notes: string[];
}

export function explainShapley(r: ShapleyResult): { title: string; text: string }[] {
  const out = [
    {
      title: 'Fair shares (Shapley value)',
      text: `Imagine players joining one by one in every possible order and paying each what they add when they arrive. On average: ${r.players.map((p, i) => `${p} ${r.exact[i]}`).join(', ')} (total ${r.total}).`,
    },
  ];
  if (r.core.nonEmpty === false) out.push({ title: 'No stable split', text: `The core is empty: whatever split you pick, some group can do better on its own. The groups would need ${r.core.minimumNeeded} to satisfy everyone, but only ${r.total} exists.` });
  else if (r.core.nonEmpty) {
    out.push({ title: 'A stable split exists', text: `The core is not empty: for example ${r.players.map((p, i) => `${p} ${r.core.allocation?.[i]}`).join(', ')} leaves no group wanting to break away.` });
    if (r.shapleyInCore === false && r.shapleyBlocking?.length) {
      const b = r.shapleyBlocking[0];
      out.push({ title: 'Fair is not stable here', text: `Under the fair shares, ${b.members.map((i) => r.players[i]).join(' + ')} would get ${Math.round(b.gets * 10000) / 10000} together but could make ${b.value} alone, so they’d walk away.` });
    } else if (r.shapleyInCore) out.push({ title: 'Fair and stable', text: 'The fair shares are also in the core: no group gains by leaving.' });
  }
  return out;
}

/** The current model as text for the AI (<game_model> block). */
export function modelText(kind: 'matrix' | 'tree' | 'coalition', data: unknown): string {
  return `Strategy Lab ${kind} model (JSON):\n${JSON.stringify(data)}`;
}
