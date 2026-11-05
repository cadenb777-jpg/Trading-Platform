import { describe, expect, it } from 'vitest';
import {
  COALITION_PRESETS,
  MATRIX_PRESETS,
  TREE_PRESETS,
  cellView,
  coalitionPayload,
  coalitions,
  eliminated,
  explainNormal,
  explainTree,
  matrixPayload,
  parseCell,
  profiles,
  resizeMatrix,
  treeHighlights,
  treePayload,
  type NormalResult,
  type TreeResult,
} from './model';
import { extractMath, fillMath } from './math';

// Replies from the helper's engine/gametheory.py (Prisoner's Dilemma; entry deterrence with the preset's moves).
const PD: NormalResult = {
  players: ['Row', 'Col'],
  strategies: [['Cooperate', 'Defect'], ['Cooperate', 'Defect']],
  dominance: {
    strict: {
      remaining: [[1], [1]],
      steps: [
        { round: 1, player: 0, strategy: 0, label: 'Cooperate', by: 1, byLabel: 'Defect', kind: 'strict' },
        { round: 1, player: 1, strategy: 0, label: 'Cooperate', by: 1, byLabel: 'Defect', kind: 'strict' },
      ],
      solved: true,
      note: '',
    },
    weak: null,
  },
  pureNash: [{ profile: [1, 1], labels: ['Defect', 'Defect'], payoffs: [1, 1], paretoOptimal: false }],
  pareto: [[0, 0], [0, 1], [1, 0]],
  bestResponses: [
    { player: 0, name: 'Row', rows: [{ against: [0], againstLabels: ['Cooperate'], best: [1], payoff: 5 }, { against: [1], againstLabels: ['Defect'], best: [1], payoff: 1 }] },
    { player: 1, name: 'Col', rows: [{ against: [0], againstLabels: ['Cooperate'], best: [1], payoff: 5 }, { against: [1], againstLabels: ['Defect'], best: [1], payoff: 1 }] },
  ],
  cells: [
    { profile: [0, 0], payoffs: [3, 3], nash: false, pareto: true, bestFor: [] },
    { profile: [0, 1], payoffs: [0, 5], nash: false, pareto: true, bestFor: [1] },
    { profile: [1, 0], payoffs: [5, 0], nash: false, pareto: true, bestFor: [0] },
    { profile: [1, 1], payoffs: [1, 1], nash: true, pareto: false, bestFor: [0, 1] },
  ],
  mixedNash: [{ probabilities: [[0, 1], [0, 1]], exact: [['0', '1'], ['0', '1']], payoffs: [1, 1], support: [[1], [1]], pure: true }],
  degenerate: false,
  welfare: { kind: 'sum', optimum: 6, optimumProfiles: [[0, 0]], worstEquilibrium: 2, bestEquilibrium: 2, priceOfAnarchy: 3, priceOfStability: 3, note: null },
  notes: [],
};

describe('matrix editor parsing', () => {
  it('reads payoffs separated by commas, semicolons or spaces, with fractions and unicode minus', () => {
    expect(parseCell('3, 2', 2)).toEqual({ values: ['3', '2'] });
    expect(parseCell(' −1 ; 0.5 ', 2)).toEqual({ values: ['-1', '0.5'] });
    expect(parseCell('(1/3 2/3)', 2)).toEqual({ values: ['1/3', '2/3'] });
    expect(parseCell('1, 2, 3', 3)).toEqual({ values: ['1', '2', '3'] });
  });

  it('explains bad cells', () => {
    expect(parseCell('3', 2)).toEqual({ error: 'Needs 2 payoffs (one per player)' });
    expect(parseCell('3, x', 2)).toEqual({ error: '“x” isn’t a number' });
    expect(parseCell('1/0, 2', 2)).toEqual({ error: 'Can’t divide by zero' });
  });

  it('builds the nested payoffs the helper expects (first player outermost)', () => {
    const r = matrixPayload(MATRIX_PRESETS[0].model());
    expect('payload' in r && r.payload.payoffs).toEqual([[['3', '3'], ['0', '5']], [['5', '0'], ['1', '1']]]);
    const three = matrixPayload(MATRIX_PRESETS.find((p) => p.key === 'adoption')!.model());
    if (!('payload' in three)) throw new Error(three.error);
    expect(three.payload.payoffs).toHaveLength(2);
    expect((three.payload.payoffs as string[][][][])[0][0][0]).toEqual(['4', '4', '4']);
    expect((three.payload.payoffs as string[][][][])[0][0][1]).toEqual(['0', '0', '3']);
  });

  it('points at the first bad cell and fills blank labels', () => {
    const m = MATRIX_PRESETS[0].model();
    m.cells['1,0'] = '5';
    expect(matrixPayload(m)).toEqual({ error: 'Defect / Cooperate: Needs 2 payoffs (one per player)', cell: '1,0' });
    const ok = MATRIX_PRESETS[0].model();
    ok.strategies[0][1] = ' ';
    ok.players[1] = '';
    const r = matrixPayload(ok);
    expect('payload' in r && [r.payload.strategies[0][1], r.payload.players[1]]).toEqual(['S2', 'Player 2']);
  });

  it('resizes, keeping cells and adding zero cells', () => {
    const m = resizeMatrix(MATRIX_PRESETS[0].model(), 2, [3, 2]);
    expect(m.strategies[0]).toEqual(['Cooperate', 'Defect', 'S3']);
    expect(m.cells['0,1']).toBe('0, 5');
    expect(m.cells['2,1']).toBe('0, 0');
    const three = resizeMatrix(m, 3, [2, 2, 2]);
    expect(Object.keys(three.cells)).toHaveLength(8);
    expect(three.cells['0,0,1']).toBe('0, 0, 0');
    expect(profiles([['a', 'b'], ['c']])).toEqual([[0, 0], [1, 0]]);
  });
});

describe('result mapping', () => {
  it('marks Nash, Pareto, dominated cells and best replies', () => {
    expect(cellView(PD, [1, 1])).toMatchObject({ nash: true, pareto: false, dominated: false, bestFor: [0, 1], rowArrow: null, colArrow: null });
    expect(cellView(PD, [0, 0])).toMatchObject({ nash: false, pareto: true, dominated: true, bestFor: [], rowArrow: 'down', colArrow: 'right' });
    expect(cellView(PD, [1, 0])).toMatchObject({ rowArrow: null, colArrow: 'right' });
    expect([...eliminated(PD)].sort()).toEqual(['0:0', '1:0']);
  });

  it('explains in plain words', () => {
    const text = explainNormal(PD).map((x) => `${x.title}: ${x.text}`).join('\n');
    expect(text).toContain('Row never plays Cooperate');
    expect(text).toContain('(Defect, Defect)');
    expect(text).toContain('A trap');
    expect(text).toContain('factor of 3');
  });
});

describe('tree editor', () => {
  it('turns the flat list into the nested tree and highlights the backward-induction path and the empty threat', () => {
    const model = TREE_PRESETS[0].model();
    const read = treePayload(model);
    if ('error' in read) throw new Error(read.error);
    expect(read.tree.player).toBe(0);
    expect(read.tree.moves?.map((m) => m.action)).toEqual(['Stay out', 'Enter']);
    expect(read.tree.moves?.[1].next.moves?.[0].next.payoffs).toEqual(['-1', '-1']);
    const result: TreeResult = {
      players: ['Entrant', 'Incumbent'],
      path: [{ path: [], action: 'Enter', player: 0 }, { path: [1], action: 'Accommodate', player: 1 }],
      payoffs: [1, 1],
      decisions: [
        { path: [], label: 'Entrant decides', player: 0, name: 'Entrant', choice: 1, action: 'Enter', best: [1], onPath: true, actions: ['Stay out', 'Enter'], values: [[0, 2], [1, 1]] },
        { path: [1], label: 'Incumbent responds', player: 1, name: 'Incumbent', choice: 1, action: 'Accommodate', best: [1], onPath: true, actions: ['Fight', 'Accommodate'], values: [[-1, -1], [1, 1]] },
      ],
      nonCredibleThreats: [{ path: [1], label: 'Incumbent responds', player: 1, name: 'Incumbent', action: 'Fight', carriedOut: [-1, -1], bestThere: 'Accommodate', wouldInduce: ['Stay out'], payoffsIfBelieved: [0, 2] }],
      notes: [],
    };
    const hl = treeHighlights(result, read.paths);
    expect([...hl.onPath].sort()).toEqual(['n1', 'n3', 'n5']);
    expect([...hl.threats]).toEqual(['n4']);
    expect(explainTree(result).map((x) => x.title)).toEqual(['Thinking backwards', 'Empty threat']);
  });

  it('reports a bad end point', () => {
    const model = TREE_PRESETS[0].model();
    model.nodes[1].payoffs = '1';
    expect(treePayload(model)).toMatchObject({ node: 'n2' });
  });
});

describe('coalitions', () => {
  it('lists every group and sends named members', () => {
    expect(coalitions(3)).toEqual([[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]);
    const r = coalitionPayload(COALITION_PRESETS[0].model());
    if ('error' in r) throw new Error(r.error);
    expect(r.coalitions.find((c) => c.members.length === 3)).toEqual({ members: ['Left', 'Right 1', 'Right 2'], value: '1' });
    expect(coalitionPayload({ players: ['A', 'B'], values: { '0': '1' } })).toMatchObject({ coalition: '0,1' });
    expect(coalitionPayload({ players: ['A', 'A'], values: { '0,1': '1' } })).toEqual({ error: 'Give each player a different name' });
  });
});

describe('maths in answers', () => {
  it('finds inline and displayed LaTeX but leaves dollar amounts and code alone', () => {
    const { text, parts } = extractMath('If $\\delta \\ge \\frac{1}{2}$ it holds. Costs $5 and $10.\n$$u_i(s) = 3$$\n`$x$`');
    expect(parts).toEqual([
      { tex: 'u_i(s) = 3', display: true },
      { tex: '\\delta \\ge \\frac{1}{2}', display: false },
    ]);
    expect(text).toContain('Costs $5 and $10.');
    expect(text).toContain('`$x$`');
  });

  it('shows formulas as source when KaTeX is unavailable, and typesets with it', () => {
    const { text, parts } = extractMath('$x<1$');
    expect(fillMath(text, parts, null)).toBe('<code class="sl-tex">x&lt;1</code>');
    const fake = { renderToString: (tex: string, o: Record<string, unknown>) => `[${tex}|${o.displayMode}]` };
    const block = extractMath('$$a$$');
    expect(fillMath(`<p>${block.text}</p>`, block.parts, fake)).toBe('<div class="sl-math-block">[a|true]</div>');
  });
});
