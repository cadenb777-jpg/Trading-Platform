import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Merges have dropped closing braces before, which silently turned whole sections into phone-only rules.
describe('style.css', () => {
  it('has balanced braces that never go negative', () => {
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let lowest = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      else if (ch === '}') lowest = Math.min(lowest, --depth);
    }
    expect({ depth, lowest }).toEqual({ depth: 0, lowest: 0 });
  });
});
