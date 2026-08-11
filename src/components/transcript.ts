/**
 * Transcript panel
 *
 * Renders the chat history produced by `ChatState`. Hidden until there is
 * at least one entry (partial or complete) — AddressWidget gates this by
 * passing `visible=false` when `chat.hasAny` is false.
 *
 * Layout:
 *   - Desktop (>= 768px): right sidebar at `--sw-address-transcript-width`.
 *   - Mobile (< 768px): bottom drawer taking ~35vh.
 *
 * Per brand, turquoise is the positive/active signal and fuchsia is
 * emphasis. We use turquoise left-edge for AI bubbles (they carry the
 * destination's voice) and fuchsia right-edge for user bubbles.
 */

import { css, html, nothing } from 'lit';
import { ref, createRef } from 'lit/directives/ref.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { Ref } from 'lit/directives/ref.js';
import type { TemplateResult } from 'lit';
import type { ChatEntry } from './chat-state';
import { renderMarkdown } from '../lib/markdown';

export interface TranscriptContext {
  entries: ChatEntry[];
  visible: boolean;
  /**
   * When true, the transcript drops the right-sidebar shape and flows as a
   * full-width vertical panel. Set by AddressWidget in audio-only mode
   * (and implicitly by the mobile media query).
   */
  stacked: boolean;
  /** Stable ref so the parent can auto-scroll the panel when new entries arrive. */
  scrollRef: Ref<HTMLDivElement>;
  /** Id of the content chip whose drawer is currently open, if any. */
  openContentId: string | null;
  /** Fired when a content chip is clicked — reopens that payload's drawer. */
  onContentClick: (id: string) => void;
  /**
   * Optional image shown beside each agent reply. Omit for none — replies
   * then sit flush left, which is the layout without this feature.
   */
  avatarUrl?: string | null;
  /**
   * One load failure retires the avatar for the session. A URL that 404s or
   * is blocked by CSP would otherwise leave a broken-image glyph beside every
   * single reply.
   */
  onAvatarError?: () => void;
}

export const transcriptStyles = css`
  .transcript {
    position: relative;
    flex: 0 0 var(--sw-address-transcript-width);
    width: var(--sw-address-transcript-width);
    max-width: 100%;
    background: var(--sw-address-bg-surface);
    border-left: 1px solid var(--sw-address-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    z-index: 2;
  }

  .transcript-header {
    padding: 18px var(--sw-address-gutter) 12px;
    border-bottom: 1px solid var(--sw-address-border);
    font-family: var(--sw-address-font-code);
    font-size: 11px;
    letter-spacing: var(--sw-address-letter-spacing-eyebrow);
    text-transform: uppercase;
    color: var(--sw-address-fg-muted);
    flex: 0 0 auto;
  }

  .transcript-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 16px var(--sw-address-gutter) 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
  }

  .bubble {
    max-width: 84%;
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--sw-address-fg-default);
    background: var(--sw-address-bg-raised);
    word-wrap: break-word;
    overflow-wrap: anywhere;
    /* Pin text-align: host pages often set text-align on marketing
       sections and that inherits through the shadow DOM. Bubbles must
       read left-aligned regardless of embedding context. */
    text-align: start;
  }

  .bubble[data-speaker='ai'] {
    align-self: flex-start;
    border-left: 2px solid var(--sw-address-positive);
    border-top-left-radius: 4px;
  }

  .bubble[data-speaker='user'] {
    align-self: flex-end;
    border-right: 2px solid var(--sw-address-accent);
    border-top-right-radius: 4px;
  }

  .bubble[data-state='partial'] {
    opacity: 0.7;
    font-style: italic;
  }

  .bubble[data-state='partial']::after {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 6px;
    border-radius: 50%;
    background: currentColor;
    animation: bubble-dot 1.1s ease-in-out infinite;
    vertical-align: middle;
    opacity: 0.6;
  }

  @keyframes bubble-dot {
    0%,
    100% {
      transform: scale(0.6);
      opacity: 0.3;
    }
    50% {
      transform: scale(1);
      opacity: 0.9;
    }
  }

  /* Coach insight: full-width row dropped inline by an ai_sidecar
     insight event. Turquoise-edged so it pops against user/AI bubbles
     without aligning to either side. Brand notes turquoise = positive
     active state, and coaching guidance fits that. */
  .insight {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--sw-address-positive) 10%, var(--sw-address-bg-raised));
    border: 1px solid var(--sw-address-border);
    border-left: 3px solid var(--sw-address-positive);
    border-radius: 10px;
    color: var(--sw-address-fg-default);
    font-family: var(--sw-address-font-body);
    text-align: start;
    animation: insight-pulse 1.2s ease-out 1;
  }

  .insight-eyebrow {
    font-family: var(--sw-address-font-code);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--sw-address-positive);
  }

  .insight-text {
    font-size: 14px;
    line-height: 1.45;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }

  @keyframes insight-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--sw-address-positive) 35%, transparent);
    }
    70% {
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .insight {
      animation: none;
    }
  }

  /* Avatar column beside an agent reply. */
  .bubble-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    align-self: flex-start;
    max-width: 92%;
  }
  .bubble-row .bubble {
    /* The row owns the alignment now; the bubble fills what is left. */
    align-self: auto;
    max-width: 100%;
  }
  .avatar {
    /* Top of the reply, not vertically centred: a long answer would float
       the avatar into the middle of its own paragraph. */
    align-self: flex-start;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    /* Something behind a transparent PNG, plus a rim so a light avatar still
       reads as a circle against the panel. */
    background: var(--sw-address-bg-raised);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
  .avatar img {
    width: 100%;
    height: 100%;
    /* contain, not cover: scaled down whole rather than cropped, so a
       character or logo keeps its head and its margins. */
    object-fit: contain;
    display: block;
  }

  /* Markdown inside a chat bubble. Chat replies are markdown — lists,
     tables and fenced code are the normal case, not the exception — and
     without these they rendered as an unstyled run of text. */
  .bubble-md > *:first-child { margin-top: 0; }
  .bubble-md > *:last-child { margin-bottom: 0; }
  .bubble-md p { margin: 0 0 8px; }
  .bubble-md ul,
  .bubble-md ol { margin: 0 0 8px; padding-left: 20px; }
  .bubble-md li { margin: 2px 0; }
  .bubble-md h1,
  .bubble-md h2,
  .bubble-md h3 {
    font-family: var(--sw-address-font-heading);
    font-size: 15px;
    font-weight: 600;
    margin: 10px 0 6px;
    color: var(--sw-address-fg-headings);
  }
  .bubble-md a {
    color: var(--sw-address-accent);
    text-decoration: underline;
  }
  .bubble-md blockquote {
    margin: 6px 0;
    padding-left: 10px;
    border-left: 2px solid var(--sw-address-positive);
    color: var(--sw-address-fg-muted);
  }
  /* Inline code: a chip, not a block. */
  .bubble-md code {
    font-family: var(--sw-address-font-code);
    font-size: 12px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--sw-address-bg-subtle);
  }
  /* Fenced block: dark in both themes, matching the content drawer, because
     a code palette that flips with the page theme reads as a bug. */
  .bubble-md .code-block {
    position: relative;
    margin: 8px 0;
    border-radius: 6px;
    background: #1e1e1f;
    border: 1px solid var(--sw-address-border);
    overflow: hidden;
  }
  .bubble-md .code-block-lang {
    display: block;
    padding: 4px 10px;
    font-family: var(--sw-address-font-code);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sw-address-fg-muted);
    background: #2a2a2e;
  }
  .bubble-md .code-block pre {
    margin: 0;
    padding: 10px;
    overflow-x: auto;
    max-height: 300px;
  }
  .bubble-md .code-block code {
    background: none;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #d4d4d8;
  }
  /* Tables scroll rather than widening the bubble. */
  .bubble-md table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 13px;
    margin: 8px 0;
  }
  .bubble-md th,
  .bubble-md td {
    border: 1px solid var(--sw-address-border);
    padding: 4px 8px;
    text-align: left;
  }
  .bubble-md img { max-width: 100%; border-radius: 6px; }

  /* Conversation status line (currently only the chat idle-timeout notice).
     Deliberately quiet — muted, centred, no accent edge. It is not a turn and
     must not read like one, and it is not a warning either: the conversation
     ending on idle is ordinary. Gold is reserved for actual warnings per the
     brand rules, so this stays neutral. */
  .notice {
    align-self: center;
    max-width: 85%;
    padding: 6px 12px;
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius-sm);
    color: var(--sw-address-fg-muted);
    font-family: var(--sw-address-font-body);
    font-size: 12px;
    line-height: 1.45;
    text-align: center;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }

  /* Content chip: minimized placeholder for a display_content push.
     Fuchsia-edged card that reads as a callable button. */
  .content-chip {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    border-left: 2px solid var(--sw-address-accent);
    border-radius: 10px;
    color: var(--sw-address-fg-default);
    font-family: var(--sw-address-font-body);
    text-align: start;
    cursor: pointer;
    transition:
      background var(--sw-address-duration-fast) var(--sw-address-ease),
      border-color var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .content-chip:hover {
    background: var(--sw-address-bg-subtle);
    border-color: var(--sw-address-accent);
  }

  .content-chip:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }

  .content-chip[data-open='true'] {
    background: var(--sw-address-bg-subtle);
    border-color: var(--sw-address-accent);
  }

  .content-chip-icon {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--sw-address-bg-subtle);
    color: var(--sw-address-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--sw-address-font-code);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .content-chip-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .content-chip-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--sw-address-fg-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .content-chip-preview {
    font-family: var(--sw-address-font-code);
    font-size: 11px;
    color: var(--sw-address-fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .content-chip-open {
    flex: 0 0 auto;
    color: var(--sw-address-fg-muted);
    display: inline-flex;
    align-items: center;
  }

  .content-chip-open svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  /* Mobile: width goes to 100% and flex shifts to grow instead of the
     fixed sidebar width. The overlay-body flips to column direction via
     its own media query, so the transcript flows below the video. */
  @media (max-width: 767px) {
    .transcript {
      width: 100%;
      flex: 1 1 0;
      min-height: 120px;
      border-left: none;
      border-top: 1px solid var(--sw-address-border);
    }
    .bubble {
      max-width: 92%;
    }
  }

  /* Explicit stacked layout — same shape as the mobile rules above, but
     triggered by the stacked attribute regardless of screen size. */
  .transcript[data-stacked='true'] {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    flex: 1 1 0;
    min-height: 120px;
    border-left: none;
    border-top: 1px solid var(--sw-address-border);
  }

  @media (prefers-reduced-motion: reduce) {
    .transcript {
      transition: none;
    }
    .bubble[data-state='partial']::after {
      animation: none;
    }
  }
`;

/**
 * Render a single bubble. `tabindex="-1"` so focus-trap doesn't land here.
 */
function renderBubble(
  entry: ChatEntry & { kind: 'bubble' },
  key: number,
  avatarUrl?: string | null,
  onAvatarError?: () => void
): TemplateResult {
  const part = entry.speaker === 'ai' ? 'bubble bubble-ai' : 'bubble bubble-user';
  // Chat turns are typed or generated, so they carry markdown — lists,
  // tables, fenced code — and render as such. Voice turns are speech and
  // render as plain text: there is no markup in what someone said, and
  // treating a transcript as markdown lets a stray asterisk silently
  // italicise half a sentence. Partials stay plain either way; they are
  // mid-stream and may hold a half-written fence.
  const asMarkdown = entry.medium === 'chat' && entry.state === 'complete';
  // Avatar only on the agent's side. A row wrapper keeps the bubble's own
  // alignment intact while giving the image a column beside it.
  const avatar =
    avatarUrl && entry.speaker === 'ai'
      ? html`<div class="avatar" aria-hidden="true">
          <img src=${avatarUrl} alt="" @error=${() => onAvatarError?.()} />
        </div>`
      : nothing;
  const bubble = html`<div
    part=${part}
    class="bubble"
    data-speaker=${entry.speaker}
    data-state=${entry.state}
    data-medium=${entry.medium ?? 'voice'}
    data-key=${key}
  >
    ${asMarkdown
      ? html`<div class="bubble-md">${unsafeHTML(renderMarkdown(entry.text))}</div>`
      : entry.text}
  </div>`;
  if (avatar === nothing) return bubble;
  return html`<div class="bubble-row" data-key=${key}>${avatar}${bubble}</div>`;
}

const openIcon = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <polyline points="9 18 15 12 9 6" />
</svg>`;

function iconLabel(format: 'text' | 'markdown' | 'code' | 'html'): string {
  switch (format) {
    case 'code':
      return '</>';
    case 'markdown':
      return 'MD';
    case 'html':
      return '{}';
    case 'text':
    default:
      return 'T';
  }
}

function renderInsight(
  entry: ChatEntry & { kind: 'insight' },
  key: number
): TemplateResult {
  return html`<div
    part="insight"
    class="insight"
    role="status"
    aria-live="polite"
    data-key=${key}
  >
    <span class="insight-eyebrow">${entry.label ?? 'Coach'}</span>
    <span class="insight-text">${entry.text}</span>
  </div>`;
}

/**
 * A status line about the conversation, not a turn in it. Centred, no bubble,
 * no avatar column, no timestamp — its own branch rather than a styled-down
 * bubble, so it cannot inherit bubble padding or a speaker alignment.
 * Rendered as plain text: the only source is our own copy, never the model.
 */
function renderNotice(
  entry: ChatEntry & { kind: 'notice' },
  key: number
): TemplateResult {
  return html`<div
    part="notice"
    class="notice"
    role="status"
    aria-live="polite"
    data-key=${key}
  >
    ${entry.text}
  </div>`;
}

function renderContentChip(
  entry: ChatEntry & { kind: 'content' },
  key: number,
  openContentId: string | null,
  onContentClick: (id: string) => void
): TemplateResult {
  const isOpen = entry.id === openContentId;
  const label =
    entry.format === 'code'
      ? `Shared code${entry.language ? ` (${entry.language})` : ''}`
      : entry.title;
  return html`<button
    part="content-chip"
    class="content-chip"
    type="button"
    data-key=${key}
    data-format=${entry.format}
    data-open=${String(isOpen)}
    aria-label=${`Open shared ${entry.format}: ${entry.title}`}
    aria-expanded=${String(isOpen)}
    @click=${() => onContentClick(entry.id)}
  >
    <span class="content-chip-icon" aria-hidden="true">${iconLabel(entry.format)}</span>
    <span class="content-chip-body">
      <span class="content-chip-title">${label}</span>
      <span class="content-chip-preview">${entry.preview}</span>
    </span>
    <span class="content-chip-open" aria-hidden="true">${openIcon}</span>
  </button>`;
}

export function renderTranscript(ctx: TranscriptContext): TemplateResult {
  return html`
    <aside
      part="transcript"
      class="transcript"
      data-visible=${String(ctx.visible)}
      data-stacked=${String(ctx.stacked)}
      aria-hidden=${String(!ctx.visible)}
      aria-label="Call transcript"
    >
      <header class="transcript-header">Transcript</header>
      <div class="transcript-body" ${ref(ctx.scrollRef)}>
        ${ctx.entries.map((e, i) => {
          if (e.kind === 'bubble')
            return renderBubble(e, i, ctx.avatarUrl, ctx.onAvatarError);
          if (e.kind === 'content')
            return renderContentChip(e, i, ctx.openContentId, ctx.onContentClick);
          if (e.kind === 'notice') return renderNotice(e, i);
          return renderInsight(e, i);
        })}
      </div>
    </aside>
  `;
}

/** Helper: auto-scroll a transcript body to the bottom if it has overflow. */
export function autoScrollTranscript(el: HTMLElement | undefined): void {
  if (!el) return;
  // Scroll so the latest entry is visible. Uses smooth scroll per CSS.
  el.scrollTop = el.scrollHeight;
}

/** Create a ref the parent can pass into `renderTranscript`. */
export function createTranscriptRef(): Ref<HTMLDivElement> {
  return createRef<HTMLDivElement>();
}
