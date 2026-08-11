/**
 * Markdown renderer.
 *
 * marked → DOMPurify pipeline. `marked` output is always passed through the
 * sanitizer before we render, so even if a crafted markdown payload tries
 * to inject raw HTML it gets stripped to the allowlist.
 */

import { marked } from 'marked';
import { sanitizeHtml } from './sanitize';
import { highlightCode } from './highlight';

marked.setOptions({
  gfm: true,
  breaks: false
});

/**
 * Syntax-highlight fenced code blocks.
 *
 * Without this, ```` ```python ```` rendered as an unstyled `<pre>` — markdown
 * highlighting only existed on the drawer's `format: "code"` path, so a code
 * block arriving inside a markdown message got none of it. Chat replies are
 * markdown, so that was most of them.
 *
 * The output is `<span class="token …">`, and both `span` and `class` are on
 * the sanitizer's allowlist, so the highlighting survives sanitization.
 */
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = (lang || '').trim().split(/\s+/)[0];
      const body = highlightCode(text, language || undefined);
      const label = language
        ? `<span class="code-block-lang">${language}</span>`
        : '';
      return `<div class="code-block" data-language="${language || 'text'}">${label}<pre><code>${body}</code></pre></div>`;
    }
  }
});

/**
 * Render markdown to a sanitized HTML string.
 *
 * This is a synchronous wrapper — marked supports async extensions but we
 * don't use any, and synchronous output lines up with template rendering.
 */
export function renderMarkdown(input: string): string {
  if (!input) return '';
  const html = marked.parse(input, { async: false }) as string;
  return sanitizeHtml(html);
}
