import { describe, expect, it } from 'vitest';
import styleCss from '../style.css?raw';

// Text and background tokens must stay readable (WCAG AA: 4.5:1 for normal text) in both themes.
const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2];
  return out;
}

const dark = block(':root');
const light = { ...dark, ...block(":root[data-theme='light']") };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = ['text', 'text-strong', 'muted', 'accent-text', 'accent-2-text', 'up-text', 'down-text', 'warn-text'];
const BACKGROUNDS = ['bg', 'surface', 'raised', 'high'];
const PAIRS: [string, string][] = [
  ...TEXT.flatMap((t) => BACKGROUNDS.map((b) => [t, b] as [string, string])),
  ['on-accent', 'accent'],
  ['on-fill', 'up-fill'],
  ['on-fill', 'down-fill'],
];

describe('design tokens', () => {
  it('reads the stylesheet (vite.config test.css includes style.css, or ?raw would be empty)', () => {
    expect(styleCss.length).toBeGreaterThan(10_000);
  });

  for (const [name, theme] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: every text pair reaches 4.5:1`, () => {
      const failing = PAIRS.filter(([fg, bg]) => {
        expect(theme[fg], `--${fg}`).toMatch(/^#/);
        expect(theme[bg], `--${bg}`).toMatch(/^#/);
        return contrast(theme[fg], theme[bg]) < 4.5;
      }).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(theme[fg], theme[bg]).toFixed(2)}`);
      expect(failing).toEqual([]);
    });
  }

  it('the design refresh block uses tokens, not hard-coded colours', () => {
    const start = styleCss.indexOf('Design refresh: signature touches');
    const end = styleCss.indexOf('---------- Webull (Portfolios');
    expect(start).toBeGreaterThan(0);
    expect(styleCss.slice(start, end)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
