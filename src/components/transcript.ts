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

import { css, html } from 'lit';
import { ref, createRef } from 'lit/directives/ref.js';
import type { Ref } from 'lit/directives/ref.js';
import type { TemplateResult } from 'lit';
import type { ChatEntry } from './chat-state';

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
  key: number
): TemplateResult {
  const part = entry.speaker === 'ai' ? 'bubble bubble-ai' : 'bubble bubble-user';
  return html`<div
    part=${part}
    class="bubble"
    data-speaker=${entry.speaker}
    data-state=${entry.state}
    data-key=${key}
  >
    ${entry.text}
  </div>`;
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
          if (e.kind === 'bubble') return renderBubble(e, i);
          if (e.kind === 'content')
            return renderContentChip(e, i, ctx.openContentId, ctx.onContentClick);
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
