import { describe, expect, it } from 'vitest';
import { REDIRECTS, resolveHash } from './routes';

const ROUTES = ['home', 'invest', 'futures', 'macro', 'calendar', 'chart', 'setups', 'research', 'flow', 'backtest', 'account', 'portfolio', 'trade', 'clients'];

describe('resolveHash', () => {
  it('keeps current routes as they are', () => {
    for (const r of ROUTES) expect(resolveHash(`#${r}`, ROUTES)).toEqual({ route: r, sub: '', hash: `#${r}`, redirected: false });
  });

  it('opens the Chart page modes', () => {
    expect(resolveHash('#chart/multi', ROUTES)).toMatchObject({ route: 'chart', sub: 'multi', hash: '#chart/multi', redirected: false });
    expect(resolveHash('#chart/scripts', ROUTES)).toMatchObject({ route: 'chart', sub: 'scripts', redirected: false });
    expect(resolveHash('#chart/chart', ROUTES)).toMatchObject({ route: 'chart', sub: '', hash: '#chart', redirected: true });
    expect(resolveHash('#chart/nonsense', ROUTES)).toMatchObject({ route: 'chart', sub: '', hash: '#chart', redirected: true });
  });

  it('redirects old routes so bookmarks keep working', () => {
    expect(resolveHash('#multi', ROUTES)).toMatchObject({ route: 'chart', sub: 'multi', hash: '#chart/multi', redirected: true });
    expect(resolveHash('#scripts', ROUTES)).toMatchObject({ route: 'chart', sub: 'scripts', hash: '#chart/scripts', redirected: true });
    expect(resolveHash('#portfolio/webull', ROUTES)).toMatchObject({ route: 'trade', hash: '#trade', redirected: true });
    expect(resolveHash('#flow/cot', ROUTES)).toMatchObject({ route: 'futures', sub: 'cot', hash: '#futures/cot', redirected: true });
    expect(resolveHash('#portfolios', ROUTES)).toMatchObject({ route: 'portfolio', redirected: true });
  });

  it('every redirect lands on a real page', () => {
    for (const from of Object.keys(REDIRECTS)) expect(ROUTES).toContain(resolveHash(`#${from}`, ROUTES).route);
  });

  it('an empty or unknown hash shows Home without rewriting the address', () => {
    expect(resolveHash('', ROUTES)).toMatchObject({ route: 'home', redirected: false });
    expect(resolveHash('#', ROUTES)).toMatchObject({ route: 'home', redirected: false });
    expect(resolveHash('#content', ROUTES)).toMatchObject({ route: 'home', redirected: false });
  });

  it('keeps a sub-path on other pages (the page decides what it means)', () => {
    expect(resolveHash('#futures/cot', ROUTES)).toMatchObject({ route: 'futures', sub: 'cot', redirected: false });
  });
});
