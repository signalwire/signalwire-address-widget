/**
 * Markdown renderer.
 *
 * marked → DOMPurify pipeline. `marked` output is always passed through the
 * sanitizer before we render, so even if a crafted markdown payload tries
 * to inject raw HTML it gets stripped to the allowlist.
 */

import { marked } from 'marked';
import { sanitizeHtml } from './sanitize';

marked.setOptions({
  gfm: true,
  breaks: false
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
