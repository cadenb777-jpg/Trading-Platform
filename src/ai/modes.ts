/** Assistant modes: the platform assistant, or a specialist with its own system prompt in the helper (engine/prompts). */

export type AiModeId = '' | 'equilibrium_prime';

export const AI_MODES: { id: AiModeId; label: string; blurb: string }[] = [
  { id: '', label: 'Assistant', blurb: 'The platform assistant: live data, charts, portfolios.' },
  {
    id: 'equilibrium_prime',
    label: 'Equilibrium-Prime',
    blurb: 'Game-theory analyst: models the situation as a game, computes the equilibria with the game engine and advises on strategy and rule changes. Attach PDFs or text as sources.',
  },
];

/** Starter requests for Equilibrium-Prime (the mode tags at the start pick how it answers). */
export const EQUILIBRIUM_STARTERS = [
  '[SOLVE] Model the pricing game between Firm A and Firm B from the uploaded Q3 reports',
  '[REDESIGN] Fix the moral hazard in this vendor agreement',
  '[RED TEAM] How credible is the negotiator’s walk-away threat?',
  '[SOLVE] Three members choosing whether to adopt a new technology (a Stag Hunt): what is the focal point that resolves it?',
];

export const modeLabel = (id: AiModeId) => AI_MODES.find((m) => m.id === id)?.label ?? 'Assistant';
