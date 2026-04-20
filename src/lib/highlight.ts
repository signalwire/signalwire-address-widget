/**
 * Code syntax highlighter.
 *
 * Prism core + a curated set of the most common languages an AI agent
 * would push back to a website (JS, TS, Python, JSON, Bash, SQL, CSS,
 * HTML, YAML, Markdown). Additional languages can be registered by the
 * consumer at runtime before rendering.
 *
 * Input is always escaped before we hand it to Prism so that unknown
 * languages fall back to plain-escaped text without executing any HTML.
 */

import Prism from 'prismjs';
// Register base languages by side-effect import. Each file auto-registers
// itself on the shared Prism instance.
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  shell: 'bash',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup'
};

function resolveLang(lang: string | undefined): string | null {
  if (!lang) return null;
  const key = lang.toLowerCase();
  return LANG_ALIASES[key] ?? key;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Highlight code. Returns an HTML fragment safe to inject as the innerHTML
 * of a `<code>` element. If the language is unknown the code is escaped
 * and returned verbatim.
 */
export function highlightCode(code: string, lang?: string): string {
  const resolved = resolveLang(lang);
  if (!resolved || !Prism.languages[resolved]) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, Prism.languages[resolved], resolved);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Prism brand-aligned dark theme styles. Inlined so the widget doesn't ship
 * an external CSS dep. Palette follows the SignalWire syntax tokens from
 * the design cheatsheet.
 */
export const prismStyles = `
  .code-block {
    display: block;
    padding: 14px 16px;
    background: #1e1e1f;
    color: #d4d4d8;
    font-family: var(--sw-address-font-code);
    font-size: 13px;
    line-height: 1.7;
    border-radius: var(--sw-address-radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.07);
    overflow-x: auto;
    white-space: pre;
  }
  .code-block .token.comment,
  .code-block .token.prolog,
  .code-block .token.doctype,
  .code-block .token.cdata { color: #898995; font-style: italic; }
  .code-block .token.punctuation { color: #d4d4d8; }
  .code-block .token.property,
  .code-block .token.tag,
  .code-block .token.boolean,
  .code-block .token.number,
  .code-block .token.constant,
  .code-block .token.symbol,
  .code-block .token.deleted { color: #ff6da0; }
  .code-block .token.selector,
  .code-block .token.attr-name,
  .code-block .token.string,
  .code-block .token.char,
  .code-block .token.builtin,
  .code-block .token.inserted { color: #40E0D0; }
  .code-block .token.operator,
  .code-block .token.entity,
  .code-block .token.url,
  .code-block .language-css .token.string,
  .code-block .style .token.string { color: #FFD700; }
  .code-block .token.atrule,
  .code-block .token.attr-value,
  .code-block .token.keyword { color: #6e9eff; }
  .code-block .token.function,
  .code-block .token.class-name { color: #40E0D0; }
  .code-block .token.regex,
  .code-block .token.important,
  .code-block .token.variable { color: #FFD700; }
`;
