/**
 * Brand tokens for @signalwire/address-widget.
 *
 * All CSS custom properties use the `--sw-address-*` prefix to avoid collision
 * with the host page or with `--sw-*` props consumed by @signalwire/web-components
 * sub-components (those are overridden separately in ./overrides.ts).
 *
 * Consumers override tokens by setting them on the `signalwire-address` element
 * or its host in the page CSS, e.g.
 *   signalwire-address { --sw-address-accent: #ff0066; }
 *
 * Values are drawn from the locked SignalWire design tokens:
 *   Fuchsia #F72A72 (emphasis), Blue #044EF4 (structural), Purple #601BE6,
 *   Turquoise #40E0D0 (positive), Gold #FFD700 (warning).
 */

import { css } from 'lit';

/**
 * Root-level tokens. Applied on `:host`. Dark is default; switch by setting
 *   signalwire-address[theme="light"]
 * which re-applies the light variants below.
 */
export const brandTokens = css`
  :host {
    /* Brand palette (locked) */
    --sw-address-accent: #f72a72;
    --sw-address-accent-strong: #f72a72;
    --sw-address-accent-glow: 0 4px 40px rgba(247, 42, 114, 0.08);
    --sw-address-accent-glow-strong: 0 0 20px rgba(247, 42, 114, 0.25);
    --sw-address-brand-blue: #044ef4;
    --sw-address-brand-purple: #601be6;
    --sw-address-positive: #40e0d0;
    --sw-address-warning: #ffd700;
    --sw-address-danger: #ef4444;

    /* Surfaces — dark theme defaults */
    --sw-address-bg-page: #0e0e18;
    --sw-address-bg-surface: #181a28;
    --sw-address-bg-raised: #222436;
    --sw-address-bg-overlay: rgba(14, 14, 24, 0.94);
    --sw-address-bg-subtle: rgba(255, 255, 255, 0.03);

    /* Foreground — dark theme defaults */
    --sw-address-fg-default: #f0f0f4;
    --sw-address-fg-secondary: #e8e8ec;
    --sw-address-fg-muted: #a0a0aa;
    --sw-address-fg-subtle: #73737e;
    --sw-address-fg-on-color: #ffffff;
    --sw-address-fg-headings: #f0f0f4;

    /* Borders */
    --sw-address-border: rgba(255, 255, 255, 0.12);
    --sw-address-border-strong: rgba(255, 255, 255, 0.15);

    /* Typography */
    --sw-address-font-heading: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI',
      sans-serif;
    --sw-address-font-body: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --sw-address-font-code: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', monospace;
    --sw-address-letter-spacing-eyebrow: 0.14em;

    /* Shape & motion */
    --sw-address-radius: 12px;
    --sw-address-radius-sm: 8px;
    --sw-address-radius-pill: 100px;
    --sw-address-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    --sw-address-duration-enter: 240ms;
    --sw-address-duration-exit: 200ms;
    --sw-address-duration-fast: 150ms;

    /* Layout */
    --sw-address-transcript-width: 340px;
    --sw-address-drawer-width: 440px;
    --sw-address-gutter: 16px;

    /* Stacking. Match the design-system z-index ladder but bump to the top
       so we sit above host-page overlays without the consumer having to fight. */
    --sw-address-z-launcher: 9999;
    --sw-address-z-overlay: 2147483000;

    /* Shadows */
    --sw-address-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
    --sw-address-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.6);
  }

  :host([theme='light']) {
    --sw-address-accent-glow: 0 4px 40px rgba(247, 42, 114, 0.05);
    --sw-address-accent-glow-strong: 0 0 20px rgba(247, 42, 114, 0.15);

    --sw-address-bg-page: #fafbfc;
    --sw-address-bg-surface: #f3f4f6;
    --sw-address-bg-raised: #e8eaf0;
    --sw-address-bg-overlay: rgba(250, 251, 252, 0.94);
    --sw-address-bg-subtle: rgba(0, 0, 0, 0.02);

    --sw-address-fg-default: #1a1a18;
    --sw-address-fg-secondary: #3a3a38;
    --sw-address-fg-muted: #737371;
    --sw-address-fg-subtle: #a8a8a6;
    --sw-address-fg-on-color: #ffffff;
    --sw-address-fg-headings: #070c2d;

    --sw-address-border: rgba(0, 0, 0, 0.1);
    --sw-address-border-strong: rgba(0, 0, 0, 0.18);

    --sw-address-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
    --sw-address-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.12);
  }
`;

/**
 * Utility: reset + base font stack on :host.
 * Every widget component includes this + brandTokens.
 *
 * `all: initial` is the shadow-boundary inheritance brake. Shadow DOM
 * encapsulates style rules from outside, but inherited properties
 * (text-align, font-size, font-weight, line-height, letter-spacing,
 * text-transform, color, etc.) still flow across the boundary from the
 * shadow host's ancestors. A host page with `.container { text-align:
 * center; }` would unintentionally style everything inside our overlay,
 * including user-supplied HTML/markdown/code in the content drawer.
 *
 * `all: initial` resets every property on :host to its CSS initial
 * value, so nothing leaks in from outside. CSS custom properties,
 * `direction`, and `unicode-bidi` are exempted by spec (per MDN) — so
 * our --sw-address-* tokens still flow, and RTL pages keep working.
 * After the reset we re-establish the handful of properties we actually
 * want to inherit down into the shadow tree.
 */
export const hostBase = css`
  :host {
    all: initial;
    display: block;
    font-family: var(--sw-address-font-body);
    font-size: 16px;
    font-weight: 400;
    line-height: 1.5;
    color: var(--sw-address-fg-default);
    text-align: start;
    box-sizing: border-box;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  /* iOS Safari: suppress the delay + zoom on double-tap for any
     interactive widget surface. Single-tap still fires click immediately. */
  :host button,
  :host [role='button'],
  :host a,
  :host [part='launcher'],
  :host [part='overlay'],
  :host [part='close'],
  :host [part='hangup'] {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
`;
