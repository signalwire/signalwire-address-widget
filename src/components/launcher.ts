/**
 * Launcher
 *
 * The clickable surface the consumer sees on the host page. Rendered by
 * AddressWidget on every update — the widget itself sits as an inline anchor,
 * and the launcher is the button inside it.
 *
 * Slotting strategy:
 *   - If the host passes children (slotted content), those render inside the
 *     launcher button. The button styling (brand fuchsia pill) wraps them.
 *   - If no children, the `label` attribute text renders as the button's text.
 *
 * Theme overrides all flow through `--sw-address-*` tokens. A consumer that
 * wants their own button entirely can set `::part(launcher) { all: unset; }`
 * in their page CSS.
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';

export interface LauncherContext {
  label: string;
  open: () => void | Promise<void>;
  /** Set true while the overlay is already open, so the launcher hides itself. */
  hidden: boolean;
}

export const launcherStyles = css`
  .launcher {
    font-family: var(--sw-address-font-body);
    font-size: 15px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: 0;
    padding: 12px 22px;
    border-radius: var(--sw-address-radius-pill);
    background: var(--sw-address-accent);
    color: var(--sw-address-fg-on-color);
    border: 1px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 44px;
    box-shadow: var(--sw-address-accent-glow);
    transition:
      transform var(--sw-address-duration-fast) var(--sw-address-ease),
      box-shadow var(--sw-address-duration-fast) var(--sw-address-ease),
      filter var(--sw-address-duration-fast) var(--sw-address-ease);
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .launcher:hover {
    box-shadow: var(--sw-address-accent-glow-strong);
    transform: translateY(-1px);
    filter: brightness(1.04);
  }

  .launcher:active {
    transform: translateY(0);
    filter: brightness(0.96);
  }

  .launcher:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 3px;
  }

  .launcher:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .launcher[hidden] {
    display: none;
  }

  /* Simple talk-bubble SVG icon shown to the left of the label by default.
     Hidden when a slotted child is present so the consumer's own content
     stays uncrowded. */
  .launcher .launcher-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    display: block;
  }

  /* Hide our icon if the host slotted their own content in. */
  .launcher.has-slot .launcher-icon {
    display: none;
  }
`;

/**
 * Default inline icon. Small speech-bubble glyph. Shown when the host didn't
 * pass their own content.
 */
const defaultIcon = html`<svg
  class="launcher-icon"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path
    d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
  />
</svg>`;

export function renderLauncher(ctx: LauncherContext): TemplateResult {
  return html`
    <button
      part="launcher"
      class="launcher"
      type="button"
      aria-label=${ctx.label}
      ?hidden=${ctx.hidden}
      @click=${ctx.open}
    >
      ${defaultIcon}
      <span class="launcher-label"><slot>${ctx.label}</slot></span>
    </button>
  `;
}
