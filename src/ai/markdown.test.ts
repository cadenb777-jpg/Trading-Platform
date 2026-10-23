import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, bold, lists and tables', () => {
    const html = renderMarkdown('## Title\n\n**Bold** text\n\n- one\n- two\n\n| A | B |\n|---|---|\n| x | 1.5% |');
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<td class="num">1.5%</td>');
  });

  it('escapes HTML and only links http(s)', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.com)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://a.com"');
  });
});
