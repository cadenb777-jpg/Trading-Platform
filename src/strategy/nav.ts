/**
 * The Strategy Lab's menu entry, as a small descriptor so a nav registry can list it (section Analyze, code GAME).
 * main.ts adds it to its page list from here; the page itself downloads on first visit.
 */
export const STRATEGY_PAGE = {
  route: 'strategy',
  section: 'Analyze',
  code: 'GAME',
  label: 'Strategy Lab',
  /** The menu's one-word label. */
  short: 'Strategy',
  title: 'Strategy Lab',
  icon: 'game',
  description: 'Game theory: payoff matrices, game trees, coalitions and the Equilibrium-Prime analyst.',
  load: async () => (await import('../pages/strategyPage')).createStrategyPage(),
} as const;
