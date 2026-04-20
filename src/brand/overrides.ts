/**
 * CSS variable overrides for `@signalwire/web-components` sub-components.
 *
 * Those components accept a known set of `--sw-*` custom properties for
 * theming. We declare them once at our shadow-root level; CSS custom
 * property inheritance cascades the values down into any sw-* component
 * rendered inside our widget.
 *
 * Any per-component tweak (e.g. border-radius differences between the
 * video container and the controls dock) is applied locally in that
 * component's stylesheet. This module owns the brand-wide defaults.
 */

import { css } from 'lit';

export const subcomponentOverrides = css`
  :host {
    /* sw-call-media + sw-call-controls + sw-self-media share this palette. */
    --sw-color-primary: var(--sw-address-brand-blue);
    --sw-color-primary-hover: #0342cf;
    --sw-color-danger: var(--sw-address-danger);
    --sw-color-danger-hover: #b91c1c;
    --sw-color-background: var(--sw-address-bg-page);
    --sw-color-surface: var(--sw-address-bg-raised);
    --sw-color-surface-hover: var(--sw-address-border-strong);
    --sw-color-text: var(--sw-address-fg-default);
    --sw-color-text-muted: var(--sw-address-fg-muted);
    --sw-color-border: var(--sw-address-border);
    --sw-color-active: var(--sw-address-danger);

    --sw-border-radius: var(--sw-address-radius);
    --sw-font-family: var(--sw-address-font-body);

    /* Spacing scale mapped from our address tokens. */
    --sw-space-1: 4px;
    --sw-space-2: 8px;
    --sw-space-3: 12px;
    --sw-space-4: 16px;
    --sw-space-6: 24px;
  }
`;
