/**
 * Chat composer
 *
 * The text-entry dock for `mode="chat"` / `mode="both"`. Sits where the
 * controls dock sits in a voice call — same position, so a medium switch
 * swaps one for the other in place rather than moving the interaction target.
 *
 * Two deliberate departures from the standalone chat widget it replaces:
 *
 *   - A `<textarea>`, not an `<input type="text">`. The original was single-
 *     line, which meant Shift+Enter was excluded from submit AND could not
 *     insert a newline — it did nothing at all. Multi-line composition matters
 *     when the thing you are talking to answers in code.
 *   - The input and the send button get accessible names. The original had
 *     neither: a placeholder is not a label, and the send button was SVG-only.
 *
 * `font-size: 16px` on the textarea is not a style choice — anything smaller
 * makes iOS Safari zoom the viewport on focus.
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import type { Ref } from 'lit/directives/ref.js';

export interface ComposerContext {
  placeholder: string;
  /** Disables entry while a turn is in flight. */
  busy: boolean;
  /**
   * End the conversation outright. Distinct from closing the overlay, which
   * only hides it — this is the chat equivalent of the call dock's End, and
   * without it a chat conversation could only be ended by timing out.
   */
  onEnd?: () => void;
  /** Send the composed text. The composer clears itself. */
  onSend: (text: string) => void;
  /** Stable ref so the parent can restore focus after a turn completes. */
  inputRef: Ref<HTMLTextAreaElement>;
  /**
   * Escalate this text conversation to a call. Omitted when voice isn't
   * configured or we're already on a call, so the button is absent rather
   * than present-and-dead — the mirror of the controls dock's switch-to-chat.
   */
  onSwitchToVoice?: () => void;
}

/** Cap auto-grow so a pasted wall of text can't eat the transcript. */
const MAX_ROWS = 6;

export const composerStyles = css`
  .composer {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px var(--sw-address-gutter);
    background: var(--sw-address-bg-surface);
    border-top: 1px solid var(--sw-address-border);
  }

  .composer-input {
    flex: 1 1 auto;
    min-width: 0;
    /* One row to start; grows to MAX_ROWS then scrolls. */
    min-height: 44px;
    max-height: 140px;
    padding: 11px 16px;
    resize: none;
    overflow-y: auto;
    border: 1px solid var(--sw-address-border);
    border-radius: 22px;
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
    font-family: var(--sw-address-font-body);
    /* 16px minimum — smaller makes iOS Safari zoom the page on focus. */
    font-size: 16px;
    line-height: 1.4;
    transition: border-color var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .composer-input::placeholder {
    color: var(--sw-address-fg-muted);
  }

  .composer-input:focus {
    outline: none;
    border-color: var(--sw-address-brand-blue);
  }

  .composer-input:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 1px;
  }

  .composer-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Escalate to voice. A turquoise pill so it reads as the medium-switch
     affordance and explains itself with a label — turquoise is the brand's
     positive/active signal, kept distinct from the fuchsia Send and the red
     End so all three stay legible side by side. Collapses to an icon-only
     circle on a phone, where a labelled pill will not fit beside the input. */
  .composer-call {
    position: relative; /* anchor for the tooltip */
    flex: 0 0 auto;
    height: 48px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--sw-address-positive);
    border-radius: var(--sw-address-radius-pill);
    background: color-mix(in srgb, var(--sw-address-positive) 12%, var(--sw-address-bg-surface));
    color: var(--sw-address-positive);
    font-family: var(--sw-address-font-body);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .composer-call:hover {
    background: color-mix(in srgb, var(--sw-address-positive) 22%, var(--sw-address-bg-surface));
  }

  .composer-call:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }

  .composer-call svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  /* Our own tooltip — the native one is slow, unstyled and dead on touch.
     An inverse surface (fg-on-bg) so it pops against the dock in either
     theme. Right-anchored because the pill lives at the composer's right
     edge; it grows leftward and can't run off-screen. Shows on hover AND
     keyboard focus. */
  .composer-call[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    width: max-content;
    max-width: 220px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--sw-address-fg-default);
    color: var(--sw-address-bg-surface);
    font-family: var(--sw-address-font-body);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
    text-align: left;
    white-space: normal;
    box-shadow: var(--sw-address-shadow-md);
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition:
      opacity var(--sw-address-duration-fast) var(--sw-address-ease),
      transform var(--sw-address-duration-fast) var(--sw-address-ease);
    z-index: 20;
  }
  .composer-call[data-tooltip]::before {
    content: '';
    position: absolute;
    bottom: calc(100% + 5px);
    right: 18px;
    border: 5px solid transparent;
    border-top-color: var(--sw-address-fg-default);
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition:
      opacity var(--sw-address-duration-fast) var(--sw-address-ease),
      transform var(--sw-address-duration-fast) var(--sw-address-ease);
    z-index: 20;
  }
  .composer-call[data-tooltip]:hover::after,
  .composer-call[data-tooltip]:hover::before,
  .composer-call[data-tooltip]:focus-visible::after,
  .composer-call[data-tooltip]:focus-visible::before {
    opacity: 1;
    transform: translateY(0);
  }

  /* 48px minimum touch target per the mobile-first rule. Fuchsia because
     sending is the emphasis action in this dock, matching the launcher. */
  .composer-send {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--sw-address-accent);
    color: #fff;
    cursor: pointer;
    transition:
      transform var(--sw-address-duration-fast) var(--sw-address-ease),
      opacity var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .composer-send:hover:not(:disabled) {
    transform: scale(1.05);
  }

  .composer-send:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }

  .composer-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .composer-send svg {
    width: 20px;
    height: 20px;
    display: block;
  }

  /* End the conversation. Danger-coloured because it is destructive and
     irreversible — matches the call dock's End rather than the neutral
     switch button beside it. */
  .composer-end {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--sw-address-border);
    border-radius: 50%;
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-muted);
    cursor: pointer;
    transition: color var(--sw-address-duration-fast) var(--sw-address-ease);
  }
  .composer-end:hover {
    color: var(--sw-address-danger);
    border-color: var(--sw-address-danger);
  }
  .composer-end:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }
  .composer-end svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  /* Phone: three 48px controls plus an input do not fit on one row at
     360px, and shrinking the touch targets is not an option (48px minimum).
     So the buttons keep their size and the input takes a row of its own. */
  @media (max-width: 480px) {
    .composer {
      flex-wrap: wrap;
      gap: 8px;
    }
    .composer-input {
      order: -1;
      flex: 1 1 100%;
      min-width: 100%;
    }
    .composer-send {
      margin-left: auto;
    }
    /* Icon-only on a phone: the button row already carries send + end, and a
       labelled pill would push them off a 360px width. */
    .composer-call {
      width: 48px;
      padding: 0;
      gap: 0;
      justify-content: center;
    }
    .composer-call-label {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-input,
    .composer-send {
      transition: none;
    }
    .composer-send:hover:not(:disabled) {
      transform: none;
    }
    .composer-call[data-tooltip]::after,
    .composer-call[data-tooltip]::before {
      transition: none;
      transform: none;
    }
  }
`;

const callIcon = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
</svg>`;

const endIcon = html`<svg
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

const sendIcon = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <line x1="22" y1="2" x2="11" y2="13" />
  <polygon points="22 2 15 22 11 13 2 9 22 2" />
</svg>`;

/** Grow the textarea to fit its content, up to MAX_ROWS. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
  const max = lineHeight * MAX_ROWS;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

function submit(ctx: ComposerContext, el: HTMLTextAreaElement | undefined): void {
  if (!el) return;
  const text = el.value.trim();
  if (!text || ctx.busy) return;
  el.value = '';
  autoGrow(el);
  ctx.onSend(text);
}

export function renderComposer(ctx: ComposerContext): TemplateResult {
  return html`
    <form
      part="composer"
      class="composer"
      @submit=${(e: Event) => {
        e.preventDefault();
        submit(ctx, ctx.inputRef.value);
      }}
    >
      <textarea
        ${ref(ctx.inputRef)}
        part="composer-input"
        class="composer-input"
        rows="1"
        aria-label="Message"
        .placeholder=${ctx.placeholder}
        ?disabled=${ctx.busy}
        @input=${(e: Event) => autoGrow(e.target as HTMLTextAreaElement)}
        @keydown=${(e: KeyboardEvent) => {
          // Enter sends, Shift+Enter inserts a newline. Composition-safe:
          // during IME composition Enter is committing a candidate, not
          // ending a sentence, so sending there would truncate mid-word for
          // anyone typing Japanese, Chinese or Korean.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            submit(ctx, ctx.inputRef.value);
          }
        }}
      ></textarea>
      <button
        part="composer-send"
        class="composer-send"
        type="submit"
        aria-label="Send message"
        title="Send"
        ?disabled=${ctx.busy}
      >
        ${sendIcon}
      </button>
      ${ctx.onEnd
        ? html`
            <button
              part="composer-end"
              class="composer-end"
              type="button"
              aria-label="End conversation"
              title="End conversation"
              @click=${ctx.onEnd}
            >
              ${endIcon}
            </button>
          `
        : ''}
      ${ctx.onSwitchToVoice
        ? html`
            <button
              part="switch-to-voice"
              class="composer-call"
              type="button"
              aria-label="Switch to a voice call"
              data-tooltip="Switch to a voice call — talk instead of typing"
              @click=${ctx.onSwitchToVoice}
            >
              ${callIcon}<span class="composer-call-label">Call</span>
            </button>
          `
        : ''}
    </form>
  `;
}
