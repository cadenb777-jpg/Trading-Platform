import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

// The AI reads news, filings and web pages, so a planted instruction could make it answer with hostile HTML.
// Whatever it writes must come out as text: no tags, no handlers, no script links.
const ATTACKS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  '[click](https://ok.example/" onmouseover="alert(1))',
  '**<iframe src=https://evil.example>**',
  '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | 2 |',
  '- <b onclick=alert(1)>x</b>',
  '```\n</code><script>alert(1)</script>\n```',
  '> <style>body{display:none}</style>',
];

/** Every tag in the output: only the renderer's own, with only its own attributes, links only to http(s). */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'blockquote', 'hr', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
function unsafeParts(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const [whole, tag, attrs] = m;
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) bad.push(whole);
    for (const a of attrs.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      if (!['href', 'target', 'rel', 'class'].includes(a[1].toLowerCase())) bad.push(whole);
      if (a[1].toLowerCase() === 'href' && !/^https?:\/\//.test(a[2])) bad.push(whole);
    }
    const bare = attrs.replace(/([a-zA-Z-]+)\s*=\s*"[^"]*"/g, '').trim();
    if (bare) bad.push(whole); // anything outside quoted name="value" pairs (e.g. onerror=...)
  }
  return bad;
}

describe('AI answers can never inject HTML', () => {
  for (const md of ATTACKS) {
    it(md.slice(0, 40), () => expect(unsafeParts(renderMarkdown(md))).toEqual([]));
  }
  it('the checker itself catches hostile HTML', () => {
    expect(unsafeParts('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
    expect(unsafeParts('<a href="javascript:alert(1)">x</a>').length).toBeGreaterThan(0);
    expect(unsafeParts('<p onclick="x">a</p>').length).toBeGreaterThan(0);
  });
  it('normal formatting and safe links still work', () => {
    const html = renderMarkdown('**Bold** and a [source](https://www.sec.gov/x)');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<a href="https://www.sec.gov/x" target="_blank" rel="noopener">source</a>');
  });
});
