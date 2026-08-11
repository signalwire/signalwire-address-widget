/**
 * Medium picker
 *
 * The first screen of a `mode="both"` overlay when `default-mode="ask"`:
 * talk or type, chosen by the visitor rather than the page author.
 *
 * It exists as a screen rather than a second launcher button for a reason
 * that is not cosmetic. Opening chat calls `start()`, and the agent's greeting
 * is a billable turn — so a launcher that commits to a medium spends money
 * before the visitor has said what they want. A picker is the intent signal,
 * and nothing is spent, and no microphone is requested, until they choose.
 *
 * It also leaves the launcher's host-content `<slot>` alone, which two
 * side-by-side buttons could not.
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';

export interface MediumPickerContext {
  /** Chosen "talk" — dial. */
  onVoice: () => void;
  /** Chosen "type" — open chat. */
  onChat: () => void;
  /** Hidden when voice isn't configured (no token/destination). */
  voiceAvailable: boolean;
  /** Hidden when chat isn't configured (no gateway). */
  chatAvailable: boolean;
}

export const mediumPickerStyles = css`
  .picker {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    padding: 32px var(--sw-address-gutter);
    text-align: center;
  }

  .picker-heading {
    font-family: var(--sw-address-font-heading);
    font-size: 22px;
    font-weight: 600;
    color: var(--sw-address-fg-headings);
    margin: 0;
  }

  .picker-options {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* Both choices weighted equally: neither medium is the "real" one, and
     making one primary would answer the question the screen is asking. */
  .picker-option {
    width: 148px;
    min-height: 132px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px 16px;
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius);
    color: var(--sw-address-fg-default);
    font-family: var(--sw-address-font-body);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition:
      border-color var(--sw-address-duration-fast) var(--sw-address-ease),
      transform var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .picker-option:hover {
    border-color: var(--sw-address-positive);
    transform: translateY(-2px);
  }

  .picker-option:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }

  .picker-option svg {
    width: 28px;
    height: 28px;
    display: block;
    color: var(--sw-address-positive);
  }

  .picker-note {
    margin: 0;
    max-width: 30ch;
    font-family: var(--sw-address-font-body);
    font-size: 13px;
    line-height: 1.5;
    color: var(--sw-address-fg-muted);
  }

  @media (max-width: 767px) {
    .picker-option {
      width: 132px;
      min-height: 118px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .picker-option {
      transition: none;
    }
    .picker-option:hover {
      transform: none;
    }
  }
`;

const iconMic = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  <line x1="12" y1="19" x2="12" y2="23" />
</svg>`;

const iconType = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
</svg>`;

export function renderMediumPicker(ctx: MediumPickerContext): TemplateResult {
  return html`
    <div part="picker" class="picker" role="group" aria-label="Choose how to talk">
      <h2 class="picker-heading">How do you want to talk?</h2>
      <div class="picker-options">
        ${ctx.voiceAvailable
          ? html`
              <button
                part="picker-voice"
                class="picker-option"
                type="button"
                @click=${ctx.onVoice}
              >
                ${iconMic}
                <span>Talk</span>
              </button>
            `
          : ''}
        ${ctx.chatAvailable
          ? html`
              <button
                part="picker-chat"
                class="picker-option"
                type="button"
                @click=${ctx.onChat}
              >
                ${iconType}
                <span>Type</span>
              </button>
            `
          : ''}
      </div>
      <p class="picker-note">
        You can switch either way later without repeating yourself.
      </p>
    </div>
  `;
}
