/**
 * Content drawer
 *
 * Receives `display_content` user_event payloads and renders the content
 * in a slide-in panel. Supports four formats:
 *
 *   - `text`      → plain text in a monospaced block
 *   - `markdown`  → rendered via marked + DOMPurify
 *   - `code`      → syntax-highlighted via Prism (code token palette matches brand)
 *   - `html`      → sanitized via DOMPurify (allowlist only)
 *
 * Slide-in from the right on desktop, from the bottom on mobile. Hidden
 * until the first `display_content` event arrives — AddressWidget gates
 * via `visible`. New pushes replace the current content (single-drawer
 * policy for v1; history can be added later).
 *
 * Includes a copy-to-clipboard button (header) and an explicit close
 * button. ESC on the overlay closes the whole call — we don't want ESC
 * to close the drawer separately.
 */

import { css, html, unsafeCSS } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { TemplateResult } from 'lit';

import { renderMarkdown } from '../lib/markdown';
import { highlightCode, prismStyles } from '../lib/highlight';
import { sanitizeHtml } from '../lib/sanitize';
import type { DisplayContentPayload } from '../types';

export interface ContentDrawerContext {
  content: DisplayContentPayload | null;
  visible: boolean;
  onClose: () => void;
  /**
   * When true, the drawer drops its absolute-positioned sidebar shape and
   * flows as a flex sibling below the transcript (stacked / audio-only /
   * mobile). AddressWidget sets this from the same _isStacked() flag used
   * by the overlay + transcript.
   */
  stacked: boolean;
}

export const contentDrawerStyles = css`
  ${unsafeCSS(prismStyles)}

  .content-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--sw-address-drawer-width);
    max-width: calc(100% - 32px);
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
    border-left: 2px solid var(--sw-address-accent);
    box-shadow: var(--sw-address-shadow-lg);
    z-index: 4;
    display: flex;
    flex-direction: column;
    transform: translateX(110%);
    transition: transform var(--sw-address-duration-enter) var(--sw-address-ease);
  }

  .content-drawer[data-visible='true'] {
    transform: translateX(0);
  }

  .content-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--sw-address-border);
    gap: 12px;
    flex: 0 0 auto;
  }

  .content-drawer-title {
    font-family: var(--sw-address-font-code);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: var(--sw-address-letter-spacing-eyebrow);
    text-transform: uppercase;
    color: var(--sw-address-accent);
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content-drawer-actions {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    flex: 0 0 auto;
  }

  .content-drawer-iconbutton {
    width: 32px;
    height: 32px;
    border-radius: var(--sw-address-radius-sm);
    background: transparent;
    color: var(--sw-address-fg-muted);
    border: 1px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      background var(--sw-address-duration-fast) var(--sw-address-ease),
      color var(--sw-address-duration-fast) var(--sw-address-ease),
      border-color var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .content-drawer-iconbutton:hover {
    background: var(--sw-address-bg-subtle);
    color: var(--sw-address-fg-default);
    border-color: var(--sw-address-border);
  }

  .content-drawer-iconbutton:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }

  .content-drawer-iconbutton svg {
    width: 16px;
    height: 16px;
    display: block;
  }

  .content-drawer-copied {
    color: var(--sw-address-positive) !important;
  }

  .content-drawer-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 18px;
    font-family: var(--sw-address-font-body);
    font-size: 15px;
    line-height: 1.6;
    /* Lock left-aligned: text-align inherits, and embedding hosts often
       have text-align:center on marketing sections. Without this pin,
       markdown paragraphs and code blocks render centered when the
       widget is embedded in such a section. */
    text-align: start;
  }

  .content-drawer-body > :first-child {
    margin-top: 0;
  }
  .content-drawer-body > :last-child {
    margin-bottom: 0;
  }

  .content-drawer-body p {
    margin: 0 0 12px;
  }

  .content-drawer-body h1,
  .content-drawer-body h2,
  .content-drawer-body h3,
  .content-drawer-body h4 {
    font-family: var(--sw-address-font-heading);
    color: var(--sw-address-fg-headings);
    line-height: 1.2;
    margin: 16px 0 8px;
  }

  .content-drawer-body h1 {
    font-size: 22px;
  }
  .content-drawer-body h2 {
    font-size: 18px;
  }
  .content-drawer-body h3 {
    font-size: 16px;
  }

  .content-drawer-body a {
    color: var(--sw-address-accent);
    text-decoration: underline;
  }

  .content-drawer-body code {
    font-family: var(--sw-address-font-code);
    font-size: 0.9em;
    background: var(--sw-address-bg-subtle);
    padding: 1px 5px;
    border-radius: 4px;
  }

  .content-drawer-body pre {
    margin: 12px 0;
  }

  .content-drawer-body pre code {
    background: transparent;
    padding: 0;
  }

  .content-drawer-text {
    font-family: var(--sw-address-font-body);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  @media (max-width: 767px) {
    .content-drawer {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      max-width: none;
      max-height: 70vh;
      border-left: none;
      border-top: 2px solid var(--sw-address-accent);
      transform: translateY(110%);
    }
    .content-drawer[data-visible='true'] {
      transform: translateY(0);
    }
  }

  /* Stacked layout (audio-only or layout="stacked"): the drawer lives
     inside the .chat-region wrapper rendered by AddressWidget, which
     becomes the positioned ancestor. The drawer absolute-overlays the
     transcript for the lifetime of the content push — close it and the
     transcript underneath is intact. */
  .content-drawer[data-stacked='true'] {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    min-height: 0;
    border-left: none;
    border-top: none;
    transform: none;
    transition: none;
    z-index: 5;
    box-shadow: var(--sw-address-shadow-lg);
  }

  @media (prefers-reduced-motion: reduce) {
    .content-drawer {
      transition: none;
    }
  }
`;

const copyIcon = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
</svg>`;

const closeIcon = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <line x1="18" y1="6" x2="6" y2="18" />
  <line x1="6" y1="6" x2="18" y2="18" />
</svg>`;

/**
 * Render body HTML for a payload. Always returns a string of sanitized
 * HTML (safe to inject via unsafeHTML directive).
 */
function renderBody(payload: DisplayContentPayload): string {
  switch (payload.format) {
    case 'markdown':
      return renderMarkdown(payload.content);
    case 'html':
      return sanitizeHtml(payload.content);
    case 'code': {
      const highlighted = highlightCode(payload.content, payload.language);
      return `<pre class="code-block" data-language="${payload.language ?? 'text'}"><code>${highlighted}</code></pre>`;
    }
    case 'text':
    default:
      // Escape by letting the DOM do it — we wrap in a <pre> via template.
      return '';
  }
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('content-drawer-copied');
    setTimeout(() => btn.classList.remove('content-drawer-copied'), 1400);
  } catch (err) {
    console.warn('[address-widget] clipboard write failed', err);
  }
}

export function renderContentDrawer(ctx: ContentDrawerContext): TemplateResult {
  const { content, visible, onClose } = ctx;

  const title = content?.title ?? 'Shared';
  const body = content ? renderBody(content) : '';

  return html`
    <section
      part="content-drawer"
      class="content-drawer"
      data-visible=${String(visible)}
      data-stacked=${String(ctx.stacked)}
      aria-hidden=${String(!visible)}
      aria-label=${`Shared content${content?.title ? `: ${content.title}` : ''}`}
    >
      <header part="content-drawer-header" class="content-drawer-header">
        <span class="content-drawer-title">${title}</span>
        <div class="content-drawer-actions">
          <button
            class="content-drawer-iconbutton"
            type="button"
            aria-label="Copy to clipboard"
            title="Copy"
            @click=${(e: Event) => {
              if (!content) return;
              void copyToClipboard(content.content, e.currentTarget as HTMLButtonElement);
            }}
          >
            ${copyIcon}
          </button>
          <button
            part="close"
            class="content-drawer-iconbutton"
            type="button"
            aria-label="Close shared content"
            title="Close"
            @click=${onClose}
          >
            ${closeIcon}
          </button>
        </div>
      </header>
      <div part="content-drawer-body" class="content-drawer-body">
        ${!content
          ? html`<p class="content-drawer-text">No content.</p>`
          : content.format === 'text'
            ? html`<div class="content-drawer-text">${content.content}</div>`
            : html`${unsafeHTML(body)}`}
      </div>
    </section>
  `;
}
