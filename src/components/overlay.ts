/**
 * Overlay
 *
 * Full-viewport shell that opens when the launcher is clicked. Hosts the
 * video frame, controls, transcript panel, and content drawer.
 *
 * The overlay lives inside the widget's shadow root. Positioning is
 * position:fixed with z-index `--sw-address-z-overlay` so host-page stacking
 * contexts don't push it behind anything.
 *
 * Enter motion scales up from the launcher's bounding rect; AddressWidget
 * sets `--enter-x` / `--enter-y` custom properties just before the overlay
 * renders so the transform-origin matches the click location.
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';

export interface OverlayContext {
  close: () => void | Promise<void>;
  body: TemplateResult;
  /** Optional title read by screen readers. Announced on open. */
  ariaLabel?: string;
  /** When set to 'exiting', plays the reverse animation before unmount. */
  state: 'entering' | 'open' | 'exiting';
  /**
   * When true, the overlay body uses a vertical stack (video-or-poster at
   * top, transcript below) regardless of screen size. Mobile always
   * stacks; this flag lets audio-only mode stack on desktop too.
   */
  stacked: boolean;
}

export const overlayStyles = css`
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--sw-address-z-overlay);
    background: var(--sw-address-bg-page);
    color: var(--sw-address-fg-default);
    display: grid;
    grid-template-rows: 1fr;
    grid-template-columns: 1fr;
    transform-origin: var(--enter-x, 50%) var(--enter-y, 50%);
    transform: scale(0.08);
    opacity: 0;
    will-change: transform, opacity;
    animation: overlay-enter var(--sw-address-duration-enter) var(--sw-address-ease) forwards;
  }

  .overlay[data-state='exiting'] {
    animation: overlay-exit var(--sw-address-duration-exit) var(--sw-address-ease) forwards;
  }

  @keyframes overlay-enter {
    0% {
      transform: scale(0.08);
      opacity: 0;
      filter: blur(8px);
    }
    60% {
      opacity: 1;
      filter: blur(0);
    }
    100% {
      transform: scale(1);
      opacity: 1;
      filter: blur(0);
    }
  }

  @keyframes overlay-exit {
    from {
      transform: scale(1);
      opacity: 1;
    }
    to {
      transform: scale(0.08);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay {
      animation-duration: 1ms;
    }
    .overlay[data-state='exiting'] {
      animation-duration: 1ms;
    }
  }

  /* Focus-trap sentinels — invisible focusable elements that catch tab/shift-tab
     leaving the overlay and warp back to the start/end. */
  .focus-sentinel {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    opacity: 0;
  }

  /* Top-right floating close button. Always reachable, minimal ornament.
     Duplicates ESC + hangup but never hurts on small screens. */
  .close-button {
    position: absolute;
    top: max(16px, env(safe-area-inset-top, 16px));
    right: max(16px, env(safe-area-inset-right, 16px));
    z-index: 2;
    width: 40px;
    height: 40px;
    border-radius: var(--sw-address-radius-pill);
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
    border: 1px solid var(--sw-address-border);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      background var(--sw-address-duration-fast) var(--sw-address-ease),
      transform var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  .close-button:hover {
    background: var(--sw-address-border-strong);
    transform: rotate(90deg);
  }

  .close-button:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 3px;
  }

  .close-button svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  /* Body layout. On desktop/tablet the children are absolute-positioned
     layers (video fills the frame, transcript is a right sidebar, drawer
     slides in over the top). On mobile we switch to a flex column so
     video anchors to the top, transcript flows below it, and we reserve
     space at the bottom for the controls dock. */
  .overlay-body {
    position: relative;
    inset: 0;
    display: grid;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  @media (max-width: 767px) {
    .overlay-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      /* Reserve height for the controls dock so transcript doesn't flow
         underneath it. Dock is ~48px tall plus breathing room. */
      padding-bottom: calc(68px + max(16px, env(safe-area-inset-bottom, 16px)));
    }
  }

  /* Explicit stacked layout — applied in audio-only mode on any screen
     size so the transcript fills vertically instead of sitting as a
     narrow sidebar next to a mostly-empty video slot. */
  .overlay-body[data-stacked='true'] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: calc(68px + max(16px, env(safe-area-inset-bottom, 16px)));
  }
`;

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

export function renderOverlay(ctx: OverlayContext): TemplateResult {
  return html`
    <div
      part="overlay"
      class="overlay"
      data-state=${ctx.state}
      role="dialog"
      aria-modal="true"
      aria-label=${ctx.ariaLabel ?? 'Call in progress'}
    >
      <div
        class="focus-sentinel"
        tabindex="0"
        @focus=${(e: FocusEvent) => handleSentinelFocus(e, 'start')}
      ></div>
      <button
        part="close"
        class="close-button"
        type="button"
        aria-label="Close call"
        @click=${ctx.close}
      >
        ${closeIcon}
      </button>
      <div class="overlay-body" data-stacked=${String(ctx.stacked)}>${ctx.body}</div>
      <div
        class="focus-sentinel"
        tabindex="0"
        @focus=${(e: FocusEvent) => handleSentinelFocus(e, 'end')}
      ></div>
    </div>
  `;
}

/**
 * Focus-trap handler. When a sentinel receives focus via keyboard tabbing,
 * find all focusable elements inside the overlay body and jump to the
 * opposite end. This keeps keyboard focus inside the overlay.
 */
function handleSentinelFocus(event: FocusEvent, which: 'start' | 'end'): void {
  const sentinel = event.currentTarget as HTMLElement;
  const overlay = sentinel.closest('.overlay');
  if (!overlay) return;
  const body = overlay.querySelector('.overlay-body');
  if (!body) return;

  const focusables = Array.from(
    body.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

  // Include the close button too — it sits outside .overlay-body.
  const close = overlay.querySelector<HTMLElement>('.close-button');
  if (close) focusables.push(close);

  if (focusables.length === 0) return;

  const target = which === 'start' ? focusables[focusables.length - 1] : focusables[0];
  target.focus();
}

/**
 * Lock/unlock the host page scroll while the overlay is open. Returns the
 * previous overflow value so callers can restore it.
 */
export function lockBodyScroll(): string {
  if (typeof document === 'undefined') return '';
  const previous = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return previous;
}

export function unlockBodyScroll(previous: string): void {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = previous;
}

/**
 * Compute CSS custom-property values for the launcher-origin animation
 * based on the launcher's current bounding rect. Host element sets these
 * on the shadow-root container so the overlay's transform-origin matches.
 */
export function originFromRect(
  rect: DOMRect
): { '--enter-x': string; '--enter-y': string } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    '--enter-x': `${cx}px`,
    '--enter-y': `${cy}px`
  };
}
