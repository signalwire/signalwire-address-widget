/**
 * Controls dock
 *
 * Three-button dock centered at the bottom of the overlay:
 *   - Mic   (click: toggle mute • chevron: pick input device)
 *   - Camera (click: toggle mute • chevron: pick input device)
 *   - End call
 *
 * Device menus use the native Popover API (`popovertarget` + `popover`
 * attribute) so light-dismiss + ESC are handled by the browser. Menus sit
 * inside the same shadow root as the buttons, so host-page stacking can't
 * steal them.
 *
 * Mute state is driven by `call.self.audioMuted$` / `videoMuted$` in
 * AddressWidget, which passes the current values in via the render
 * context. Device lists come from the client's DeviceController.
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { Call } from '@signalwire/js';
import type { ConnectedClient } from '../lib/client';

export interface ControlsContext {
  call: Call | null;
  client: ConnectedClient | null;
  audioMuted: boolean;
  videoMuted: boolean;
  /** Show the camera control; hidden when `video` option was false. */
  videoEnabled: boolean;
  audioInputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  selectedAudioInputId: string | null;
  selectedVideoInputId: string | null;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onHangup: () => void;
  onSelectAudioDevice: (device: MediaDeviceInfo) => void;
  onSelectVideoDevice: (device: MediaDeviceInfo) => void;
}

export const controlsStyles = css`
  .controls-dock {
    position: absolute;
    bottom: max(20px, env(safe-area-inset-bottom, 20px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--sw-address-radius-pill);
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    box-shadow: var(--sw-address-shadow-md);
    backdrop-filter: blur(12px);
    max-width: calc(100% - 32px);
  }

  /* Split button: primary (toggle mute) on left, chevron trigger on right,
     with a subtle divider between them. */
  .split {
    display: inline-flex;
    align-items: stretch;
    border-radius: var(--sw-address-radius-pill);
    overflow: hidden;
    background: var(--sw-address-bg-subtle);
    border: 1px solid var(--sw-address-border);
  }

  .split[data-muted='true'] {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.45);
  }

  .btn {
    font: inherit;
    background: transparent;
    color: var(--sw-address-fg-default);
    border: none;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--sw-address-duration-fast) var(--sw-address-ease),
      color var(--sw-address-duration-fast) var(--sw-address-ease);
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .btn:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
    z-index: 1;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    width: 48px;
    height: 48px;
    border-radius: var(--sw-address-radius-pill) 0 0 var(--sw-address-radius-pill);
  }

  .btn-primary svg {
    width: 20px;
    height: 20px;
    display: block;
  }

  .btn-chevron {
    width: 26px;
    border-radius: 0 var(--sw-address-radius-pill) var(--sw-address-radius-pill) 0;
    border-left: 1px solid var(--sw-address-border);
    color: var(--sw-address-fg-muted);
  }

  .btn-chevron svg {
    width: 14px;
    height: 14px;
    display: block;
    transition: transform var(--sw-address-duration-fast) var(--sw-address-ease);
  }

  /* Standalone hangup — pill-shaped, destructive red. */
  .btn-hangup {
    height: 48px;
    padding: 0 22px;
    border-radius: var(--sw-address-radius-pill);
    background: var(--sw-address-danger);
    color: var(--sw-address-fg-on-color);
    font-weight: 600;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-hangup:hover {
    background: #b91c1c;
  }
  .btn-hangup svg {
    width: 18px;
    height: 18px;
  }

  /* Popover dropdown. Uses the native Popover API for light-dismiss and
     top-layer rendering; positioning is done in JS because CSS Anchor
     Positioning isn't universal yet. top and left are set imperatively
     right after showPopover() fires. */
  [popover] {
    position: fixed;
    top: 0;
    left: 0;
    margin: 0;
    padding: 6px;
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius-sm);
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
    box-shadow: var(--sw-address-shadow-lg);
    min-width: 220px;
    max-width: 320px;
    font-family: var(--sw-address-font-body);
    font-size: 13px;
    color-scheme: dark;
  }
  :host([theme='light']) [popover] {
    color-scheme: light;
  }

  .menu-header {
    padding: 8px 10px 4px;
    font-family: var(--sw-address-font-code);
    font-size: 10px;
    letter-spacing: var(--sw-address-letter-spacing-eyebrow);
    text-transform: uppercase;
    color: var(--sw-address-fg-muted);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    color: var(--sw-address-fg-default);
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .menu-item:hover {
    background: var(--sw-address-bg-subtle);
  }
  .menu-item[data-active='true']::before {
    content: '';
    display: inline-block;
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sw-address-accent);
  }
  .menu-item[data-active='false']::before {
    content: '';
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
  }
  .menu-empty {
    padding: 12px 10px;
    color: var(--sw-address-fg-muted);
    font-style: italic;
  }

  @media (max-width: 480px) {
    .controls-dock {
      gap: 8px;
      padding: 6px;
    }
    .btn-hangup {
      padding: 0 14px;
    }
    .btn-hangup .hangup-label {
      display: none;
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────
// Icons (kept inline to avoid an external asset pipeline)
// ─────────────────────────────────────────────────────────────────────

const iconMic = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  <line x1="12" y1="19" x2="12" y2="23" />
  <line x1="8" y1="23" x2="16" y2="23" />
</svg>`;

const iconMicOff = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="1" y1="1" x2="23" y2="23" />
  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
  <line x1="12" y1="19" x2="12" y2="23" />
  <line x1="8" y1="23" x2="16" y2="23" />
</svg>`;

const iconCam = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polygon points="23 7 16 12 23 17 23 7" />
  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
</svg>`;

const iconCamOff = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
  <line x1="1" y1="1" x2="23" y2="23" />
</svg>`;

const iconHangup = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" transform="scale(-1,1) translate(-24,0) rotate(135 12 12)" />
</svg>`;

const iconChevron = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="18 15 12 9 6 15" />
</svg>`;

// ─────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────

function renderDeviceMenu(
  id: string,
  header: string,
  devices: MediaDeviceInfo[],
  selectedId: string | null,
  onSelect: (d: MediaDeviceInfo) => void
): TemplateResult {
  return html`
    <div
      id=${id}
      popover
      @toggle=${(e: Event) => positionOnToggle(e, id)}
    >
      <div class="menu-header">${header}</div>
      ${devices.length === 0
        ? html`<div class="menu-empty">No devices detected</div>`
        : devices.map(
            (device) => html`<button
              class="menu-item"
              type="button"
              data-active=${String(isMatch(device, selectedId))}
              @click=${(e: Event) => {
                onSelect(device);
                closePopoverFromEvent(e);
              }}
              title=${device.label || device.deviceId}
            >
              <span>${device.label || 'Device ' + device.deviceId.slice(0, 6)}</span>
            </button>`
          )}
    </div>
  `;
}

function isMatch(device: MediaDeviceInfo, selectedId: string | null): boolean {
  if (!selectedId) return device.deviceId === 'default';
  return device.deviceId === selectedId;
}

type PopoverElement = HTMLElement & {
  hidePopover?: () => void;
};

/**
 * Position `popover` near `invoker`: preferably above, right-aligned with
 * the invoker's right edge; below if there isn't room above; clamped to
 * the viewport. Called on the popover's `toggle` event once it has
 * transitioned to open — dimensions are real at that point, and the
 * browser hasn't painted yet, so setting top/left happens without flash.
 */
function placePopover(popover: HTMLElement, invoker: HTMLElement): void {
  const inv = invoker.getBoundingClientRect();
  const pop = popover.getBoundingClientRect();
  const gap = 8;
  const margin = 8;

  let top = inv.top - pop.height - gap;
  if (top < margin) top = inv.bottom + gap;

  let left = inv.right - pop.width;
  if (left < margin) left = margin;
  if (left + pop.width > window.innerWidth - margin) {
    left = window.innerWidth - pop.width - margin;
  }

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

/**
 * Handler for the popover's `toggle` event. When the popover has just
 * opened, position it relative to its `popovertarget` invoker. When it
 * closes, reset inline position so a subsequent open computes fresh.
 */
function positionOnToggle(event: Event, popoverId: string): void {
  const ev = event as Event & { newState?: string };
  const popover = event.currentTarget as HTMLElement;
  if (ev.newState !== 'open') {
    popover.style.top = '';
    popover.style.left = '';
    return;
  }
  const root = popover.getRootNode() as ShadowRoot | Document;
  const invoker = (root as Document).querySelector(
    `[popovertarget="${popoverId}"]`
  ) as HTMLElement | null;
  if (!invoker) return;
  placePopover(popover, invoker);
}

function closePopoverFromEvent(event: Event): void {
  const btn = event.currentTarget as HTMLElement;
  const popover = btn.closest('[popover]') as PopoverElement | null;
  popover?.hidePopover?.();
}

export function renderControls(ctx: ControlsContext): TemplateResult {
  const callReady = ctx.call !== null;
  const active = callReady;

  return html`
    <div part="controls" class="controls-dock" data-active=${String(active)}>
      <div class="split" data-muted=${String(ctx.audioMuted)}>
        <button
          class="btn btn-primary"
          type="button"
          aria-label=${ctx.audioMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed=${String(ctx.audioMuted)}
          ?disabled=${!callReady}
          @click=${ctx.onToggleAudio}
          title=${ctx.audioMuted ? 'Unmute' : 'Mute'}
        >
          ${ctx.audioMuted ? iconMicOff : iconMic}
        </button>
        <button
          class="btn btn-chevron"
          type="button"
          aria-label="Select microphone"
          aria-haspopup="menu"
          popovertarget="sw-address-mic-menu"
          popovertargetaction="toggle"
          ?disabled=${!ctx.client || ctx.audioInputDevices.length === 0}
          title="Select microphone"
        >
          ${iconChevron}
        </button>
      </div>
      ${renderDeviceMenu(
        'sw-address-mic-menu',
        'Microphone',
        ctx.audioInputDevices,
        ctx.selectedAudioInputId,
        ctx.onSelectAudioDevice
      )}

      ${ctx.videoEnabled
        ? html`
            <div class="split" data-muted=${String(ctx.videoMuted)}>
              <button
                class="btn btn-primary"
                type="button"
                aria-label=${ctx.videoMuted ? 'Turn camera on' : 'Turn camera off'}
                aria-pressed=${String(ctx.videoMuted)}
                ?disabled=${!callReady}
                @click=${ctx.onToggleVideo}
                title=${ctx.videoMuted ? 'Turn camera on' : 'Turn camera off'}
              >
                ${ctx.videoMuted ? iconCamOff : iconCam}
              </button>
              <button
                class="btn btn-chevron"
                type="button"
                aria-label="Select camera"
                aria-haspopup="menu"
                popovertarget="sw-address-cam-menu"
                popovertargetaction="toggle"
                ?disabled=${!ctx.client || ctx.videoInputDevices.length === 0}
                title="Select camera"
              >
                ${iconChevron}
              </button>
            </div>
            ${renderDeviceMenu(
              'sw-address-cam-menu',
              'Camera',
              ctx.videoInputDevices,
              ctx.selectedVideoInputId,
              ctx.onSelectVideoDevice
            )}
          `
        : nothing}

      <button
        part="hangup"
        class="btn-hangup"
        type="button"
        aria-label="End call"
        @click=${ctx.onHangup}
      >
        ${iconHangup}
        <span class="hangup-label">End</span>
      </button>
    </div>
  `;
}
