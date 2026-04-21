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
function renderBubble(entry: ChatEntry, key: number): TemplateResult {
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
        ${ctx.entries.map((e, i) => renderBubble(e, i))}
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
