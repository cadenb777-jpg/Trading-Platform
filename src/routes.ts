/**
 * Hash routes: every page has one home. A hash is "#page" or "#page/mode" (the Chart page's modes: #chart/multi,
 * #chart/scripts). Old routes from before the restructure redirect, so bookmarks keep working. Pure and tested
 * (routes.test.ts).
 */

/** Old hash (without #) -> where it lives now. */
export const REDIRECTS: Record<string, string> = {
  multi: 'chart/multi',
  scripts: 'chart/scripts',
  'portfolio/webull': 'trade', // the Portfolios > Webull view: ordering info is on Trade, totals on Account
  webull: 'trade',
  'flow/cot': 'futures/cot', // the full COT table and any CFTC market live on Futures
  cot: 'futures/cot',
  // short names people may type
  portfolios: 'portfolio',
  accounts: 'account',
};

/** The Chart page's modes (the tabs Chart | Workspace | Scripts; the Workspace keeps the old 'multi' hash). */
export const CHART_MODES = ['chart', 'multi', 'scripts'] as const;
export type ChartMode = (typeof CHART_MODES)[number];

export interface Resolved {
  /** The page's route, e.g. 'chart'. */
  route: string;
  /** The part after the slash, e.g. 'multi' for #chart/multi ('' when none). */
  sub: string;
  /** The hash to show (with #). Differs from the one asked for when it was redirected or unknown. */
  hash: string;
  /** The hash asked for was an old one (or unknown) and should be replaced. */
  redirected: boolean;
}

/** Reads a hash ("#multi", "#chart/scripts", "", "#nope") into the page to show, following old routes. */
export function resolveHash(hash: string, routes: readonly string[], fallback = 'home'): Resolved {
  const asked = hash.replace(/^#/, '').trim();
  let raw = asked;
  for (let i = 0; i < 3 && REDIRECTS[raw]; i++) raw = REDIRECTS[raw];
  const [route, ...rest] = raw.split('/');
  // an unknown hash shows the first page but is left alone (as before)
  if (!routes.includes(route)) return { route: fallback, sub: '', hash: `#${fallback}`, redirected: false };
  let sub = rest.join('/');
  if (route === 'chart' && (sub === 'chart' || !(CHART_MODES as readonly string[]).includes(sub))) sub = '';
  const canonical = sub ? `${route}/${sub}` : route;
  return { route, sub, hash: `#${canonical}`, redirected: asked !== canonical && asked !== '' };
}
