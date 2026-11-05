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
  '[SOLVE] Model the pricing game between Firm A and Firm B using the Q3 reports uploaded as sources.',
  '[REDESIGN / MECHANISM] Analyze the moral hazard in the vendor agreement (Source 2) and redesign it to align incentives.',
  '[RED TEAM] Stress-test the credibility of Party X’s walk-away threat (Source 4).',
  '[SOLVE] Model the 3-member technology adoption decision (Source 1) as a Stag Hunt and find the focal point that resolves it.',
];

export const modeLabel = (id: AiModeId) => AI_MODES.find((m) => m.id === id)?.label ?? 'Assistant';
