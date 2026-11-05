import { describe, expect, it } from 'vitest';
import styleCss from './style.css?raw';

// Merges have dropped closing braces before, which silently turned whole sections into phone-only rules.
describe('style.css', () => {
  it('is read for real (an empty ?raw import would pass the brace check)', () => {
    expect(styleCss.length).toBeGreaterThan(10_000);
  });

  it('has balanced braces that never go negative', () => {
    const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let lowest = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      else if (ch === '}') lowest = Math.min(lowest, --depth);
    }
    expect({ depth, lowest }).toEqual({ depth: 0, lowest: 0 });
  });
});
