import { describe, expect, it } from 'vitest';
import { brief } from './brief';

describe('brief', () => {
  const long = 'Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide. It also sells a range of related services. The company offers iPhone, Mac, iPad and AirPods. It was founded in 1976 and is headquartered in Cupertino, California.';
  it('keeps short text as it is', () => {
    expect(brief('One line.', 100)).toBe('One line.');
    expect(brief(null)).toBe('');
  });
  it('keeps whole sentences up to the limit, never mid-word, and skips abbreviations', () => {
    const b = brief(long, 180);
    expect(b).toBe('Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide. It also sells a range of related services.');
    expect(b.length).toBeLessThanOrEqual(180);
  });
  it('keeps a long first sentence whole when it is not far over, else ends at a word', () => {
    expect(brief(long, 100)).toBe('Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide.');
    const one = 'word '.repeat(100).trim();
    const b = brief(one, 50);
    expect(b.endsWith('word.')).toBe(true);
    expect(b.length).toBeLessThanOrEqual(51);
  });
});
