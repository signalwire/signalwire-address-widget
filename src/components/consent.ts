/**
 * Consent UI — pre-call modal and in-call "Recording" badge.
 *
 * The widget gates dial behind a one-time prompt when
 * `consent-required` is on. Tone is intentionally low-friction: a
 * "heads-up" rather than a legal wall. Audio is functionally required
 * for an AI voice demo, so the audio checkbox is disabled-checked
 * (FYI) and the only real choice is whether to share video.
 *
 * Styling lives here alongside the markup so it can be themed via
 * shadow parts (`consent-modal`, `consent-badge`).
 */

import { css, html, nothing } from 'lit';
import { ref, createRef } from 'lit/directives/ref.js';
import type { Ref } from 'lit/directives/ref.js';
import type { TemplateResult } from 'lit';

export interface ConsentDraft {
  /** Consent to share audio (required). */
  audio: boolean;
  /** Whether the recording may be used to train AI models. */
  train: boolean;
  /** Preference (not consent): start the call with the camera sending. */
  camera: boolean;
  /** Selected audio input deviceId, or null = browser default. */
  audioDeviceId: string | null;
  /** Selected video input deviceId, or null = browser default. */
  videoDeviceId: string | null;
}

export interface ConsentModalContext {
  /** When false, modal returns `nothing` so the parent can skip
   *  reserving space and skip top-layer activation. */
  open: boolean;
  /** Current draft values reflected in the checkboxes. Parent owns
   *  the draft state so toggling is observable for the Start button. */
  draft: ConsentDraft;
  /** Whether the parent widget is in video mode. When false the
   *  camera-share toggle + camera picker are hidden. */
  showCameraOption: boolean;
  /** Enumerated audio input devices. Empty array hides the picker. */
  audioDevices: MediaDeviceInfo[];
  /** Whether the live microphone check is enabled at all. When false the
   *  meter is not rendered and no microphone is opened on this screen. */
  micCheck: boolean;
  /** Live input level, 0..1, for the meter beside the microphone picker. */
  micLevel: number;
  /**
   * True once the selected microphone has been continuously silent long
   * enough to be worth flagging. Distinct from `micLevel === 0`, which is
   * also true for the first frame and between words.
   */
  micSilent: boolean;
  /** Whether the meter could not open the microphone at all. */
  micError: boolean;
  /** Enumerated video input devices. Empty array hides the picker. */
  videoDevices: MediaDeviceInfo[];
  /** Stable dialog ref so the parent can call `showModal()` /
   *  `close()` after Lit renders it. */
  dialogRef: Ref<HTMLDialogElement>;
  /** Toggle a single field in the draft. */
  onDraftChange: (field: keyof ConsentDraft, value: boolean | string | null) => void;
  /** User clicked "Start call". Parent persists + dials. */
  onAccept: () => void;
  /** User clicked "Cancel" or pressed ESC. Parent closes without
   *  saving anything. */
  onCancel: () => void;
}

export interface ConsentBadgeContext {
  /** When false, returns `nothing`. */
  show: boolean;
  /** True when the user's camera is sending — drives the badge text
   *  (we always record what's flowing). */
  camera: boolean;
}

export const consentStyles = css`
  /* ─────────────────────────────────────────────────────────────────
     Modal
     ───────────────────────────────────────────────────────────────── */
  .consent-modal {
    padding: 0;
    margin: 0;
    border: none;
    max-width: none;
    max-height: none;
    background: transparent;
    color: var(--sw-address-fg-default);
    width: 100vw;
    height: 100vh;
    position: fixed;
    inset: 0;
    overflow: hidden;
    z-index: var(--sw-address-z-overlay);
    display: grid;
    place-items: center;
  }
  .consent-modal::backdrop {
    background: rgba(0, 0, 0, 0.55);
  }
  .consent-modal:not([open]) {
    display: none;
  }
  .consent-card {
    width: min(440px, calc(100vw - 32px));
    background: var(--sw-address-bg-surface);
    color: var(--sw-address-fg-default);
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius);
    padding: 24px;
    box-shadow: var(--sw-address-shadow-lg);
    font-family: var(--sw-address-font-body);
    text-align: start;
    animation: consent-enter 220ms var(--sw-address-ease, ease-out) both;
  }
  @keyframes consent-enter {
    from { transform: translateY(8px) scale(0.96); opacity: 0; }
    to   { transform: translateY(0)    scale(1);    opacity: 1; }
  }
  .consent-title {
    margin: 0 0 10px;
    font-family: var(--sw-address-font-heading);
    font-size: 18px;
    font-weight: 600;
    color: var(--sw-address-fg-headings);
  }
  .consent-body {
    margin: 0 0 18px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--sw-address-fg-muted);
  }
  .consent-toggles {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }
  .consent-device {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--sw-address-fg-muted);
  }
  .consent-device select {
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius-sm);
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
  }
  .consent-device select:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }
  .mic-meter {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mic-meter__bar {
    height: 6px;
    border-radius: 3px;
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    overflow: hidden;
  }
  .mic-meter__fill {
    height: 100%;
    /* Turquoise: the brand's positive-state colour, and this is the one
       genuinely positive signal on the screen — the microphone works. */
    background: var(--sw-address-positive);
    transition: width 60ms linear;
  }
  /* Gold is the warning role. Reserved for exactly this: a microphone that
     is connected and producing nothing, which the visitor can still fix. */
  .mic-meter[data-silent='true'] .mic-meter__bar {
    border-color: var(--sw-address-warning);
  }
  .mic-meter[data-silent='true'] .mic-meter__hint {
    color: var(--sw-address-warning);
  }
  .mic-meter__hint {
    font-size: 11px;
    line-height: 1.4;
    color: var(--sw-address-fg-muted);
  }
  .mic-meter--error {
    font-size: 11px;
    line-height: 1.4;
    color: var(--sw-address-warning);
  }
  @media (prefers-reduced-motion: reduce) {
    .mic-meter__fill {
      transition: none;
    }
  }
  .consent-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--sw-address-bg-raised);
    border: 1px solid var(--sw-address-border);
    border-radius: var(--sw-address-radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .consent-toggle input[type='checkbox'] {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--sw-address-positive);
  }
  .consent-toggle[data-disabled='true'] {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .consent-toggle[data-disabled='true'] input {
    cursor: not-allowed;
  }
  .consent-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .consent-btn {
    font: inherit;
    padding: 8px 16px;
    border-radius: var(--sw-address-radius-pill);
    border: 1px solid var(--sw-address-border);
    background: var(--sw-address-bg-raised);
    color: var(--sw-address-fg-default);
    cursor: pointer;
    transition: background var(--sw-address-duration-fast) var(--sw-address-ease);
  }
  .consent-btn:hover {
    background: var(--sw-address-bg-subtle);
  }
  .consent-btn[data-primary='true'] {
    background: var(--sw-address-accent);
    border-color: var(--sw-address-accent);
    color: #fff;
  }
  .consent-btn[data-primary='true']:hover {
    filter: brightness(1.08);
  }
  .consent-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .consent-btn:focus-visible {
    outline: 2px solid var(--sw-address-brand-blue);
    outline-offset: 2px;
  }
  .consent-foot {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--sw-address-fg-muted);
  }
  .consent-foot a {
    color: var(--sw-address-accent);
    text-decoration: none;
  }
  .consent-foot a:hover {
    text-decoration: underline;
  }

  /* ─────────────────────────────────────────────────────────────────
     "Recorded demo" badge (in-call) and pre-call edit link.
     Intentionally low-key — no red, no pulsing dot, no warning-light
     pattern. Just a quiet pill that says what's going on. The pre-call
     modal and edit link are where the consent decision lives; this
     badge is reinforcement, not alarm.
     ───────────────────────────────────────────────────────────────── */
  .consent-badge {
    position: absolute;
    top: max(16px, env(safe-area-inset-top, 16px));
    left: max(16px, env(safe-area-inset-left, 16px));
    z-index: 3;
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    background: rgba(0, 0, 0, 0.45);
    color: rgba(255, 255, 255, 0.85);
    font-family: var(--sw-address-font-body);
    font-size: 11px;
    border-radius: var(--sw-address-radius-pill);
    backdrop-filter: blur(8px);
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .consent-card { animation: none; }
  }

`;

/**
 * Live input meter.
 *
 * The point is not decoration: a microphone with no signal is
 * indistinguishable from a working one through every WebRTC API, so the only
 * way a visitor can tell is by watching the bar move while they talk. The
 * "no signal" state is called out explicitly rather than left as a flat bar,
 * because a flat bar reads as "not started yet" and gets ignored.
 */
function renderMicMeter(ctx: ConsentModalContext): TemplateResult | typeof nothing {
  if (!ctx.micCheck) return nothing;
  if (ctx.micError) {
    return html`<div class="mic-meter mic-meter--error" role="status">
      Can't open that microphone. Pick another, or check your browser's
      microphone permission.
    </div>`;
  }
  const pct = Math.round(Math.min(1, Math.max(0, ctx.micLevel)) * 100);
  return html`
    <div class="mic-meter" data-silent=${String(ctx.micSilent)}>
      <div
        class="mic-meter__bar"
        role="meter"
        aria-label="Microphone input level"
        aria-valuenow=${pct}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="mic-meter__fill" style=${`width:${pct}%`}></div>
      </div>
      <div class="mic-meter__hint">
        ${ctx.micSilent
          ? html`<strong>No sound detected.</strong> Say something \u2014 if the bar
              stays flat, this microphone isn't picking anything up.`
          : html`Say something to check your microphone.`}
      </div>
    </div>
  `;
}

export function renderConsentModal(ctx: ConsentModalContext): TemplateResult {
  // Audio is required for an AI voice demo to function — the checkbox
  // is rendered for transparency but disabled-checked. Video is the
  // real opt-in.
  const audioRequired = true;
  const canAccept = ctx.draft.audio; // audio must be on
  return html`
    <dialog
      part="consent-modal"
      class="consent-modal"
      ${ref(ctx.dialogRef)}
      aria-labelledby="sw-consent-title"
      @cancel=${(e: Event) => {
        e.preventDefault();
        ctx.onCancel();
      }}
    >
      <div class="consent-card">
        <h2 id="sw-consent-title" class="consent-title">Call recording</h2>
        <p class="consent-body">
          This call is recorded. Audio and transcripts are used to improve our AI and
          customer support experience, and aren't shared or sold to third parties.
        </p>
        <div class="consent-toggles">
          <label class="consent-toggle" data-disabled=${String(audioRequired)}>
            <input
              type="checkbox"
              .checked=${ctx.draft.audio}
              ?disabled=${audioRequired}
              @change=${(e: Event) =>
                ctx.onDraftChange('audio', (e.target as HTMLInputElement).checked)}
            />
            <span>Share audio <em style="opacity:0.7;font-style:normal">(required)</em></span>
          </label>
          <label class="consent-toggle">
            <input
              type="checkbox"
              .checked=${ctx.draft.train}
              @change=${(e: Event) =>
                ctx.onDraftChange('train', (e.target as HTMLInputElement).checked)}
            />
            <span>Allow my audio to help train future AI features</span>
          </label>
          ${ctx.showCameraOption
            ? html`<label class="consent-toggle">
                <input
                  type="checkbox"
                  .checked=${ctx.draft.camera}
                  @change=${(e: Event) =>
                    ctx.onDraftChange('camera', (e.target as HTMLInputElement).checked)}
                />
                <span
                  >Share my camera
                  <em style="opacity:0.7;font-style:normal"
                    >(recorded; not used to train AI)</em
                  ></span
                >
              </label>`
            : nothing}
        </div>
        ${ctx.audioDevices.length > 0 && ctx.draft.audio
          ? html`<div class="consent-device">
              <label for="sw-consent-mic">Microphone</label>
              <select
                id="sw-consent-mic"
                .value=${ctx.draft.audioDeviceId ?? ''}
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  ctx.onDraftChange('audioDeviceId', v ? v : null);
                }}
              >
                <option value="">Browser default</option>
                ${ctx.audioDevices.map(
                  (d, i) => html`<option value=${d.deviceId}>${d.label || `Microphone ${i + 1}`}</option>`
                )}
              </select>
              ${renderMicMeter(ctx)}
            </div>`
          : nothing}
        ${ctx.showCameraOption && ctx.videoDevices.length > 0 && ctx.draft.camera
          ? html`<div class="consent-device">
              <label for="sw-consent-cam">Camera</label>
              <select
                id="sw-consent-cam"
                .value=${ctx.draft.videoDeviceId ?? ''}
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  ctx.onDraftChange('videoDeviceId', v ? v : null);
                }}
              >
                <option value="">Browser default</option>
                ${ctx.videoDevices.map(
                  (d, i) => html`<option value=${d.deviceId}>${d.label || `Camera ${i + 1}`}</option>`
                )}
              </select>
            </div>`
          : nothing}
        <div class="consent-actions">
          <button class="consent-btn" type="button" @click=${ctx.onCancel}>Cancel</button>
          <button
            class="consent-btn"
            data-primary="true"
            type="button"
            ?disabled=${!canAccept}
            @click=${ctx.onAccept}
          >
            Start call
          </button>
        </div>
      </div>
    </dialog>
  `;
}

export function renderConsentBadge(ctx: ConsentBadgeContext): TemplateResult | typeof nothing {
  if (!ctx.show) return nothing;
  const label = ctx.camera ? 'Recorded demo · audio + video' : 'Recorded demo · audio';
  return html`<span part="consent-badge" class="consent-badge" aria-label=${label}
    >${label}</span
  >`;
}

/** Create a stable ref for the modal dialog. */
export function createConsentModalRef(): Ref<HTMLDialogElement> {
  return createRef<HTMLDialogElement>();
}
