/**
 * Inline status banner
 *
 * Thin dismissible strip rendered inside the overlay, above the video
 * frame. Used for recovery lifecycle messaging ("Reconnecting…",
 * "Connection restored", "Connection lost") and the one-shot
 * "Reconnected to call" note after auto-reattach.
 *
 * Intentionally minimal — no complex toast queue, no animation hooks.
 * Whatever the parent passes in is what the user sees. Parent decides
 * when to set it to null to dismiss.
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';

export type BannerLevel = 'info' | 'warning' | 'success' | 'error';

export interface BannerMessage {
  level: BannerLevel;
  text: string;
  /**
   * When true, a small close button is rendered so the user can dismiss.
   * Transient banners (e.g. "Connection restored" that auto-clears after
   * 2s) don't need one.
   */
  dismissible?: boolean;
}

export interface BannerContext {
  message: BannerMessage | null;
  onDismiss: () => void;
}

export const bannerStyles = css`
  .banner {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    font-family: var(--sw-address-font-body);
    font-size: 13px;
    line-height: 1.4;
    border-bottom: 1px solid var(--sw-address-border);
  }
  .banner[data-level='info'] {
    background: var(--sw-address-bg-subtle);
    color: var(--sw-address-fg-default);
  }
  .banner[data-level='warning'] {
    background: color-mix(in srgb, var(--sw-address-warning, #ffd700) 12%, var(--sw-address-bg-surface));
    color: var(--sw-address-fg-default);
    border-bottom-color: var(--sw-address-warning, #ffd700);
  }
  .banner[data-level='success'] {
    background: color-mix(in srgb, var(--sw-address-positive) 12%, var(--sw-address-bg-surface));
    color: var(--sw-address-fg-default);
    border-bottom-color: var(--sw-address-positive);
  }
  .banner[data-level='error'] {
    background: color-mix(in srgb, var(--sw-address-accent) 14%, var(--sw-address-bg-surface));
    color: var(--sw-address-fg-default);
    border-bottom-color: var(--sw-address-accent);
  }
  .banner-text {
    flex: 1 1 auto;
  }
  .banner-dismiss {
    flex: 0 0 auto;
    background: transparent;
    border: none;
    color: var(--sw-address-fg-muted);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--sw-address-radius-sm);
    font-size: 18px;
    line-height: 1;
  }
  .banner-dismiss:hover {
    background: var(--sw-address-bg-subtle);
    color: var(--sw-address-fg-default);
  }
  .banner-dismiss:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }
`;

export function renderBanner(ctx: BannerContext): TemplateResult | typeof import('lit').nothing {
  const { message } = ctx;
  if (!message) return html``;
  return html`
    <div
      part="banner"
      class="banner"
      data-level=${message.level}
      role=${message.level === 'error' ? 'alert' : 'status'}
      aria-live=${message.level === 'error' ? 'assertive' : 'polite'}
    >
      <span class="banner-text">${message.text}</span>
      ${message.dismissible
        ? html`<button
            class="banner-dismiss"
            type="button"
            aria-label="Dismiss notification"
            @click=${ctx.onDismiss}
          >
            ×
          </button>`
        : null}
    </div>
  `;
}
