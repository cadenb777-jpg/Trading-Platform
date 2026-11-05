/**
 * Markdown with LaTeX for Equilibrium-Prime answers: $...$, \(...\) inline and $$...$$, \[...\] displayed, typeset with
 * KaTeX (downloaded only when an answer has maths). Dollar amounts stay text: an opening $ must be followed by a
 * non-space and a closing $ must not be preceded by a space or followed by a digit ("$5 and $10" is not maths).
 */
import { renderMarkdown } from '../ai/markdown';

export interface MathPart {
  tex: string;
  display: boolean;
}

const token = (i: number) => `⟦M${i}⟧`;
const TOKEN = /⟦M(\d+)⟧/g;

/** Replaces maths with placeholder tokens (outside code), returning the text and the formulas. */
export function extractMath(md: string): { text: string; parts: MathPart[] } {
  const parts: MathPart[] = [];
  const keep = (tex: string, display: boolean) => {
    parts.push({ tex: tex.trim(), display });
    return token(parts.length - 1);
  };
  // leave code blocks and inline code alone
  const pieces = md.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  const text = pieces
    .map((piece, i) => {
      if (i % 2 === 1) return piece;
      return piece
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(tex, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => keep(tex, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => keep(tex, false))
        .replace(/(^|[^\\$])\$(?=\S)([^$\n]*?[^\s\\$])\$(?!\d)/g, (_, pre: string, tex: string) => pre + keep(tex, false));
    })
    .join('');
  return { text, parts };
}

type Katex = { renderToString(tex: string, opts: Record<string, unknown>): string };
let katexLoad: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (m.default ?? m) as Katex);
  return katexLoad;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Puts typeset formulas into rendered HTML (a formula KaTeX can't read is shown as its source). */
export function fillMath(html: string, parts: MathPart[], katex: Katex | null): string {
  return html.replace(/<p>\s*(⟦M\d+⟧)\s*<\/p>/g, '$1').replace(TOKEN, (_, i: string) => {
    const part = parts[Number(i)];
    if (!part) return '';
    if (!katex) return `<code class="sl-tex">${escape(part.tex)}</code>`;
    try {
      const out = katex.renderToString(part.tex, { displayMode: part.display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' });
      return part.display ? `<div class="sl-math-block">${out}</div>` : out;
    } catch {
      return `<code class="sl-tex">${escape(part.tex)}</code>`;
    }
  });
}

/** Markdown plus maths. Synchronous first paint (formulas as source) is `renderMarkdownMathSync`. */
export async function renderMarkdownMath(md: string): Promise<string> {
  const { text, parts } = extractMath(md);
  const html = renderMarkdown(text);
  if (!parts.length) return html;
  const katex = await loadKatex().catch(() => null);
  return fillMath(html, parts, katex);
}

/** While an answer streams: formulas shown as their source (typeset once the answer is complete). */
export function renderMarkdownMathSync(md: string): string {
  const { text, parts } = extractMath(md);
  return fillMath(renderMarkdown(text), parts, null);
}
