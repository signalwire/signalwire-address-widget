/**
 * <signalwire-address>
 *
 * Root custom element. Composes the launcher, overlay, video frame,
 * controls, transcript panel, and content drawer. Handles the full call
 * lifecycle: connect → dial → events → hangup → cleanup.
 *
 * See README.md for public API and EVENTS.md for server-side conventions.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Call } from '@signalwire/js';

import { brandTokens, hostBase } from './brand/tokens';
import { subcomponentOverrides } from './brand/overrides';
import { loadBrandFonts } from './brand/fonts';

import { createRef } from 'lit/directives/ref.js';
import { launcherStyles, renderLauncher } from './components/launcher';
import {
  overlayStyles,
  renderOverlay,
  lockBodyScroll,
  unlockBodyScroll,
  originFromRect
} from './components/overlay';
import { videoFrameStyles, renderVideoFrame } from './components/video-frame';
import type { VideoFrameRing } from './components/video-frame';
import { controlsStyles, renderControls } from './components/controls';
import { transcriptStyles, renderTranscript, createTranscriptRef, autoScrollTranscript } from './components/transcript';
import { contentDrawerStyles, renderContentDrawer } from './components/content-drawer';
import { ChatState } from './components/chat-state';

import { connectClient } from './lib/client';
import type { ConnectedClient } from './lib/client';
import { wireCallEvents } from './lib/events';
import { detectPlatform, safeTimezone, safeMatchMedia } from './lib/env';

import type {
  Theme,
  Layout,
  WidgetOptions,
  DisplayContentPayload,
  UserEventPayload,
  BeforeDialDetail,
  CallEventDetail
} from './types';

/**
 * Custom attribute converter for a boolean property whose default is
 * `true`. Lit's built-in Boolean converter treats any attribute presence
 * as true, so `foo="false"` resolves to true — not what we want when the
 * default is on. This one honors the string values "false" and "0" as
 * opt-outs and treats everything else (including empty-value presence) as
 * on.
 */
const boolDefaultTrue = {
  fromAttribute(value: string | null): boolean {
    if (value === null) return true;
    return value !== 'false' && value !== '0';
  },
  toAttribute(value: boolean): string | null {
    return value ? null : 'false';
  }
};

type OverlayState = 'closed' | 'entering' | 'open' | 'exiting';

@customElement('signalwire-address')
export class AddressWidget extends LitElement {
  static styles = [
    brandTokens,
    hostBase,
    subcomponentOverrides,
    launcherStyles,
    overlayStyles,
    videoFrameStyles,
    controlsStyles,
    transcriptStyles,
    contentDrawerStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      /* Chat region: a wrapper for the transcript + content drawer. In
         non-stacked mode it uses display:contents so its children behave
         like direct flex children of overlay-body (preserves the old
         sidebar + right-slide-drawer layout). In stacked mode it becomes
         a flex-column that claims the middle of overlay-body, giving the
         content drawer a positioned ancestor to absolute-overlay against. */
      .chat-region {
        display: contents;
      }

      .chat-region[data-stacked='true'] {
        display: flex;
        flex-direction: column;
        position: relative;
        flex: 1 1 0;
        min-height: 0;
      }

      /* Error card shown inside the overlay if dial/connect fails. */
      .error-card {
        max-width: 420px;
        margin: auto;
        padding: 24px;
        background: var(--sw-address-bg-raised);
        border: 1px solid var(--sw-address-border);
        border-radius: var(--sw-address-radius);
        color: var(--sw-address-fg-default);
        text-align: left;
        font-family: var(--sw-address-font-body);
      }
      .error-card h3 {
        font-family: var(--sw-address-font-heading);
        font-size: 18px;
        margin: 0 0 8px;
        color: var(--sw-address-fg-headings);
      }
      .error-card p {
        margin: 0;
        font-size: 14px;
        color: var(--sw-address-fg-muted);
        line-height: 1.6;
      }
    `
  ];

  // ─────────────────────────────────────────────────────────────────────
  // Public attributes / properties
  // ─────────────────────────────────────────────────────────────────────

  @property({ type: String, reflect: false }) token = '';

  @property({ type: String, reflect: true }) destination = '';

  @property({ type: String, reflect: true }) label = 'Start call';

  @property({ type: String, reflect: true }) theme: Theme = 'dark';

  @property({ type: Boolean, reflect: true }) video = true;

  @property({ type: Boolean, reflect: true }) audio = true;

  /**
   * Optional custom poster image URL. In video mode it replaces the
   * default SignalWire pre-call poster. In audio-only mode (`video=false`)
   * it's the only visual element shown in place of the video frame; if
   * omitted in audio-only mode, the video area collapses entirely.
   */
  @property({ type: String, reflect: true }) poster: string | null = null;

  /**
   * Overlay layout. `auto` = sidebar on desktop, stacked on mobile/audio;
   * `stacked` = always stacked (video smaller on top, transcript below).
   */
  @property({ type: String, reflect: true }) layout: Layout = 'auto';

  /**
   * Whether to render the local self-view overlay. Default true. Attribute
   * is `show-local-video` — use `show-local-video="false"` to hide.
   */
  @property({ attribute: 'show-local-video', reflect: true, converter: boolDefaultTrue })
  showLocalVideo = true;

  /** Browser echo-cancellation on the outgoing mic. Default true. */
  @property({ attribute: 'echo-cancellation', reflect: true, converter: boolDefaultTrue })
  echoCancellation = true;

  /** Browser noise-suppression on the outgoing mic. Default true. */
  @property({ attribute: 'noise-suppression', reflect: true, converter: boolDefaultTrue })
  noiseSuppression = true;

  /** Browser auto-gain-control on the outgoing mic. Default true. */
  @property({ attribute: 'auto-gain-control', reflect: true, converter: boolDefaultTrue })
  autoGainControl = true;

  /**
   * Initial microphone input volume as a percentage (0–200). 100 =
   * unchanged (unity); values below 100 reduce the outgoing mic level,
   * values above 100 boost up to 2× at 200 (the SDK's cap). Applied
   * locally via `call.setLocalMicrophoneGain` — no server round-trip.
   * Leave null to use the browser's natural gain.
   */
  @property({ attribute: 'input-volume', type: Number, reflect: true })
  inputVolume: number | null = null;

  /**
   * Auto-populate `capabilities` and `metadata` into userVariables at dial
   * time. `capabilities` is the agent-facing contract (what the widget
   * can render); `metadata` is the session context (page, client env,
   * widget identity). Default true. Opt out with `auto-identify="false"`
   * (attribute) or `autoIdentify: false` (option).
   */
  @property({ attribute: 'auto-identify', reflect: true, converter: boolDefaultTrue })
  autoIdentify = true;

  @property({ attribute: 'user-variables', reflect: false })
  set userVariablesAttr(value: string | Record<string, unknown> | null | undefined) {
    if (value == null || value === '') {
      this._userVariables = {};
      return;
    }
    if (typeof value === 'string') {
      try {
        this._userVariables = JSON.parse(value) as Record<string, unknown>;
      } catch {
        console.warn('[address-widget] user-variables attribute is not valid JSON');
        this._userVariables = {};
      }
    } else {
      this._userVariables = value;
    }
  }

  /** Raw event callback. Set programmatically — not via attribute. */
  onEvent: WidgetOptions['onEvent'];

  // ─────────────────────────────────────────────────────────────────────
  // Reactive state
  // ─────────────────────────────────────────────────────────────────────

  @state() private _overlayState: OverlayState = 'closed';
  /** Keyed on every ChatState update so Lit re-renders the transcript. */
  @state() private _chatVersion = 0;
  /**
   * All display_content payloads received this call, keyed by the id we
   * minted for them. Chips in the transcript reference these by id; the
   * drawer renders whichever is currently open. Cleared on close().
   */
  private _contentHistory = new Map<string, DisplayContentPayload>();
  /** Id of the payload whose drawer is currently open, or null when closed. */
  @state() private _openContentId: string | null = null;
  @state() private _error: string | null = null;
  @state() private _call: Call | null = null;
  @state() private _ring: VideoFrameRing = 'none';
  @state() private _audioMuted = false;
  @state() private _videoMuted = false;
  @state() private _audioInputDevices: MediaDeviceInfo[] = [];
  @state() private _videoInputDevices: MediaDeviceInfo[] = [];
  @state() private _selectedAudioInputId: string | null = null;
  @state() private _selectedVideoInputId: string | null = null;

  // ─────────────────────────────────────────────────────────────────────
  // Private fields
  // ─────────────────────────────────────────────────────────────────────

  private _userVariables: Record<string, unknown> = {};
  private _client: ConnectedClient | null = null;
  private _chat = new ChatState();
  private _unwireEvents: (() => void) | null = null;
  private _previouslyFocused: HTMLElement | null = null;
  private _previousBodyOverflow = '';
  private _escHandler?: (e: KeyboardEvent) => void;
  private _aiChunkTimer?: ReturnType<typeof setTimeout>;
  private _transcriptRef = createTranscriptRef();
  private _audioRef = createRef<HTMLAudioElement>();
  private _localVideoRef = createRef<HTMLVideoElement>();
  private _remoteStreamSub?: import('rxjs').Subscription;
  private _localStreamSub?: import('rxjs').Subscription;
  private _localGainSub?: import('rxjs').Subscription;
  private _deviceSubs: import('rxjs').Subscription[] = [];
  /** Outer subscription to `call.self$`. Tracked separately so its inner
   *  handler doesn't accidentally unsubscribe itself. */
  private _selfObserverSub: import('rxjs').Subscription | null = null;
  /** Subscriptions scoped to the current self participant (audioMuted$, videoMuted$). */
  private _selfSubs: import('rxjs').Subscription[] = [];
  /** Snapshot of the current self participant so toggle handlers don't
   *  depend on `call.self` being populated at the moment of the click. */
  private _self: import('@signalwire/js').CallSelfParticipant | null = null;

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    loadBrandFonts();
    this._chat.onUpdate = () => {
      this._chatVersion++;
    };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this._teardown();
    unlockBodyScroll(this._previousBodyOverflow);
    this._removeEscHandler();
  }

  override updated(): void {
    // Auto-scroll the transcript on every update once it has been
    // rendered. Safe to call regardless of whether the transcript is
    // visible; it no-ops when the ref is not resolved yet.
    autoScrollTranscript(this._transcriptRef.value);

    // Put the overlay <dialog> into the browser's top layer whenever it's
    // newly present. showModal() is what escapes ancestor stacking
    // contexts and containing blocks — the whole point of using <dialog>.
    this._syncDialogOpen();
  }

  /**
   * Ensure the overlay dialog's native open/closed state matches our
   * reactive _overlayState. Called from updated() so it runs after every
   * Lit render without needing a separate subscription.
   */
  private _syncDialogOpen(): void {
    const dialog = this.shadowRoot?.querySelector<HTMLDialogElement>('dialog.overlay');
    if (!dialog) return;
    const shouldBeOpen =
      this._overlayState === 'entering' || this._overlayState === 'open';
    if (shouldBeOpen && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Fallback: if showModal throws (already-open race, unsupported UA),
        // fall back to the `open` attribute — still paints, just without
        // top-layer guarantees.
        dialog.setAttribute('open', '');
      }
      // Intercept native ESC (dispatches 'cancel' before close) so our
      // animated close path runs instead of the dialog snapping shut.
      if (!dialog.dataset.swCancelBound) {
        dialog.dataset.swCancelBound = '1';
        dialog.addEventListener('cancel', (e) => {
          e.preventDefault();
          void this.close();
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public programmatic API
  // ─────────────────────────────────────────────────────────────────────

  /** Open the overlay and begin dialing. */
  async open(): Promise<void> {
    if (this._overlayState !== 'closed') return;
    if (!this.token) {
      this._surfaceError('Missing token. Configure the `token` attribute or mount option.');
      return;
    }
    if (!this.destination) {
      this._surfaceError('Missing destination. Configure the `destination` attribute.');
      return;
    }

    // Build the userVariables bag in precedence order (low → high):
    //   auto-identify block → widget's userVariables option → beforedial.setUserVariables
    // When autoIdentify is on we inject two nested keys:
    //   `capabilities` — what the widget can render (contract)
    //   `metadata`     — page/client/widget context (session features)
    // Consumer userVariables override or extend either via a matching key.
    const mergeVars: Record<string, unknown> = {
      ...(this.autoIdentify
        ? {
            capabilities: this._buildCapabilities(),
            metadata: this._buildMetadata()
          }
        : {}),
      ...this._userVariables
    };
    const detail: BeforeDialDetail = {
      setUserVariables: (vars) => Object.assign(mergeVars, vars)
    };
    const allow = this.dispatchEvent(
      new CustomEvent('signalwire-address:beforedial', {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true
      })
    );
    if (!allow) return;

    this._previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    this._previousBodyOverflow = lockBodyScroll();
    this._applyOriginFromLauncher();
    this._overlayState = 'entering';
    this._installEscHandler();
    await this.updateComplete;
    requestAnimationFrame(() => {
      if (this._overlayState === 'entering') this._overlayState = 'open';
    });

    // Start the call in the background so the overlay can show the
    // connecting-poster state immediately.
    void this._startCall(mergeVars);
  }

  /** Close the overlay and tear down any active call. */
  async close(): Promise<void> {
    if (this._overlayState === 'closed' || this._overlayState === 'exiting') return;
    this._overlayState = 'exiting';
    const call = this._call;
    await this._teardown();
    await this._awaitAnimation();
    // Pull the <dialog> out of the top layer after the exit animation.
    // Doing this before the animation would snap it invisible instantly.
    const dialog = this.shadowRoot?.querySelector<HTMLDialogElement>('dialog.overlay');
    if (dialog?.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
    this._overlayState = 'closed';
    this._contentHistory.clear();
    this._openContentId = null;
    this._chat.reset();
    this._chatVersion++;
    this._error = null;
    this._ring = 'none';
    this._removeEscHandler();
    unlockBodyScroll(this._previousBodyOverflow);
    this._previousBodyOverflow = '';
    this._previouslyFocused?.focus?.();
    this._previouslyFocused = null;

    if (call) {
      this.dispatchEvent(
        new CustomEvent<CallEventDetail>('signalwire-address:call-left', {
          detail: { call },
          bubbles: true,
          composed: true
        })
      );
    }
  }

  /** End the call but keep the overlay open. */
  async hangup(): Promise<void> {
    if (this._call) {
      try {
        await this._call.hangup();
      } catch (e) {
        console.warn('[address-widget] hangup error (ignoring)', e);
      }
    }
    await this.close();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Call lifecycle internals
  // ─────────────────────────────────────────────────────────────────────

  private async _startCall(userVariables: Record<string, unknown>): Promise<void> {
    try {
      this._client = await connectClient(this.token);
      const constraints = this.audio
        ? {
            echoCancellation: this.echoCancellation,
            noiseSuppression: this.noiseSuppression,
            autoGainControl: this.autoGainControl
          }
        : undefined;
      const call = await this._client.dial({
        destination: this.destination,
        audio: this.audio,
        video: this.video,
        inputAudioDeviceConstraints: constraints,
        userVariables
      });
      this._call = call;

      this._wireCallStateObservables(call);
      this._unwireEvents = wireCallEvents(call, {
        onUserPartial: (text, barged) => this._chat.onUserPartial(text, barged),
        onUserComplete: (text, barged) => this._chat.onUserComplete(text, barged),
        onAiChunk: (text, barged) => {
          this._chat.onAiChunk(text, barged);
          this._startAiSpeakingRing();
        },
        onAiComplete: (text, barged) => {
          this._chat.onAiComplete(text, barged);
          this._stopAiSpeakingRing();
        },
        onUserEvent: (payload) => this._handleUserEvent(payload)
      });

      this.dispatchEvent(
        new CustomEvent<CallEventDetail>('signalwire-address:call-joined', {
          detail: { call },
          bubbles: true,
          composed: true
        })
      );
    } catch (err) {
      console.error('[address-widget] call failed to start', err);
      this._surfaceError(
        err instanceof Error ? err.message : 'Unable to start the call. Please try again.'
      );
    }
  }

  private _wireCallStateObservables(call: Call): void {
    // Attach the remote stream's audio to our hidden <audio> sink so the
    // user hears it — the sibling <video> rendered by sw-call-media is
    // forced-muted by its own template for autoplay compliance.
    this._remoteStreamSub?.unsubscribe();
    this._remoteStreamSub = call.remoteStream$.subscribe((stream) => {
      const el = this._audioRef.value;
      if (!el) return;
      if (stream) {
        if (el.srcObject !== stream) {
          el.srcObject = stream;
        }
        // Best-effort play — the launcher click supplied the gesture.
        void el.play?.().catch(() => {
          /* autoplay may still fail if permissions are weird; ignore */
        });
      } else {
        el.srcObject = null;
      }
    });

    // Attach the local stream to the small self-preview overlay in the
    // video frame. sw-self-media from @signalwire/web-components needs an
    // MCU layoutLayers$ entry for self, which 1:1 calls don't provide, so
    // we render our own <video> and bind localStream$ directly.
    this._localStreamSub?.unsubscribe();
    this._localStreamSub = call.localStream$.subscribe((stream) => {
      const el = this._localVideoRef.value;
      if (!el) return;
      if (stream) {
        if (el.srcObject !== stream) {
          el.srcObject = stream;
        }
        void el.play?.().catch(() => {
          /* autoplay may fail — the preview just stays frozen in that case */
        });
      } else {
        el.srcObject = null;
      }
    });

    // Track self participant + its muted state so the controls dock reflects
    // them. call.self$ emits whenever the self participant is created or
    // replaced; on each emission we drop the old muted-state subs and set
    // up new ones. The outer subscription is stored in _selfObserverSub so
    // the inner cleanup can't accidentally unsubscribe itself.
    this._selfObserverSub?.unsubscribe();
    for (const sub of this._selfSubs) sub.unsubscribe();
    this._selfSubs = [];
    this._self = null;
    if (call.self$) {
      this._selfObserverSub = call.self$.subscribe((self) => {
        for (const s of this._selfSubs) s.unsubscribe();
        this._selfSubs = [];
        this._self = self ?? null;
        if (!self) {
          this._audioMuted = false;
          this._videoMuted = false;
          return;
        }
        // Observe server-side muted state. Server updates feed through here
        // when it accepts a mute; clicks below flip optimistically for the
        // case where the server returns 403 and the SDK falls back to a
        // local-only track disable (which never emits through these
        // observables). Last write wins — if a server update arrives it
        // replaces our optimistic value, but that value will match anyway.
        this._selfSubs.push(
          self.audioMuted$.subscribe((muted) => {
            this._audioMuted = muted === true;
          })
        );
        this._selfSubs.push(
          self.videoMuted$.subscribe((muted) => {
            this._videoMuted = muted === true;
          })
        );
      });
    }

    // Apply the initial input-volume preference via the local Web Audio
    // gain pipeline (call.setLocalMicrophoneGain). This is what actually
    // affects what the remote side hears for scope-less tokens — the
    // previously-used self.setAudioInputVolume is a server-side mix
    // volume that requires the call.microphone.volume.set scope and
    // doesn't touch the local track.
    //
    // The pipeline needs getUserMedia to have delivered a local stream
    // first, so we wait for the first non-null emission of
    // call.localStream$ and apply once.
    if (this.inputVolume != null && this.audio) {
      // inputVolume is a percentage: 100 = unchanged (unity), < 100
      // reduces, > 100 boosts. Clamped to [0, 200] since the SDK's
      // setLocalMicrophoneGain caps the gain multiplier at 2.
      const pct = Math.max(0, Math.min(200, Number(this.inputVolume)));
      const gain = pct / 100;
      // setLocalMicrophoneGain exists on WebRTCCall (the class) in the SDK
      // but hasn't been added to the public `Call` interface type yet.
      // Narrow cast until the SDK types catch up. Guarded at runtime so
      // older bundled SDKs without the method log a warning instead of
      // throwing TypeError.
      const gainCall = call as unknown as {
        setLocalMicrophoneGain?: (value: number) => void;
      };
      if (typeof gainCall.setLocalMicrophoneGain !== 'function') {
        console.warn(
          '[address-widget] setLocalMicrophoneGain not available on this SDK version; inputVolume ignored'
        );
      } else {
        let applied = false;
        this._localGainSub?.unsubscribe();
        this._localGainSub = call.localStream$.subscribe((stream) => {
          if (stream && !applied) {
            applied = true;
            try {
              gainCall.setLocalMicrophoneGain!(gain);
            } catch (err) {
              console.warn('[address-widget] setLocalMicrophoneGain failed:', err);
            }
          }
        });
      }
    }

    // Device lists + selection come from the client's DeviceController.
    this._wireDeviceObservables();

    // Ring updates on recovery / network issues. Priority:
    // reconnecting > network-warning > ai-speaking > none.
    const refreshRing = (): void => {
      const recovery = (call as unknown as { recoveryState?: string }).recoveryState;
      const issues = call.networkIssues ?? [];
      const hasCritical = issues.some((i) => i.severity === 'critical');
      const hasWarning = issues.length > 0;
      if (recovery && recovery !== 'idle') {
        this._ring = 'reconnecting';
      } else if (hasCritical || hasWarning) {
        this._ring = 'network-warning';
      } else if (this._aiChunkTimer) {
        this._ring = 'ai-speaking';
      } else {
        this._ring = 'none';
      }
    };

    if (call.recoveryState$) {
      call.recoveryState$.subscribe(refreshRing);
    }
    if (call.networkIssues$) {
      call.networkIssues$.subscribe(refreshRing);
    }
    // Close the overlay when the call ends.
    if (call.status$) {
      call.status$.subscribe((status: string) => {
        if (status === 'disconnected' || status === 'destroyed') {
          void this.close();
        }
      });
    }
  }

  private _wireDeviceObservables(): void {
    for (const sub of this._deviceSubs) sub.unsubscribe();
    this._deviceSubs = [];
    const client = this._client?.client;
    if (!client) return;
    this._deviceSubs.push(
      client.audioInputDevices$.subscribe((devices: MediaDeviceInfo[]) => {
        this._audioInputDevices = devices;
      })
    );
    this._deviceSubs.push(
      client.videoInputDevices$.subscribe((devices: MediaDeviceInfo[]) => {
        this._videoInputDevices = devices;
      })
    );
    this._deviceSubs.push(
      client.selectedAudioInputDevice$.subscribe((device: MediaDeviceInfo | null) => {
        this._selectedAudioInputId = device?.deviceId ?? null;
      })
    );
    this._deviceSubs.push(
      client.selectedVideoInputDevice$.subscribe((device: MediaDeviceInfo | null) => {
        this._selectedVideoInputId = device?.deviceId ?? null;
      })
    );
  }

  private _toggleAudio(): void {
    const self = this._self ?? this._call?.self;
    if (!self) return;
    const wasMuted = this._audioMuted;
    // Optimistic flip. The SDK's SelfParticipant.mute/unmute always runs
    // `vertoManager.mute/unmuteMainAudioInputDevice()` in its finally
    // block, so the local track state matches our optimistic flag even
    // when the server rejects the RPC (e.g. 403 Permission denied on
    // tokens that don't have call.mute scope). The audioMuted$ observable
    // only emits on server-side acceptance, so relying on it alone leaves
    // the UI stuck when the local fallback is the only thing that ran.
    this._audioMuted = !wasMuted;
    const action = wasMuted ? self.unmute() : self.mute();
    Promise.resolve(action).catch((err: unknown) => {
      console.warn('[address-widget] audio toggle error (ignored — local fallback applied):', err);
    });
  }

  private _toggleVideo(): void {
    const self = this._self ?? this._call?.self;
    if (!self) return;
    const wasMuted = this._videoMuted;
    this._videoMuted = !wasMuted;
    const action = wasMuted ? self.unmuteVideo() : self.muteVideo();
    Promise.resolve(action).catch((err: unknown) => {
      console.warn('[address-widget] video toggle error (ignored — local fallback applied):', err);
    });
  }

  private _selectAudioDevice(device: MediaDeviceInfo): void {
    this._client?.client.selectAudioInputDevice(device);
  }

  private _selectVideoDevice(device: MediaDeviceInfo): void {
    this._client?.client.selectVideoInputDevice(device);
  }

  private _startAiSpeakingRing(): void {
    this._ring = 'ai-speaking';
    if (this._aiChunkTimer) clearTimeout(this._aiChunkTimer);
    this._aiChunkTimer = setTimeout(() => {
      this._aiChunkTimer = undefined;
      // Don't override a warning/recovery ring.
      if (this._ring === 'ai-speaking') this._ring = 'none';
    }, 1500);
  }

  private _stopAiSpeakingRing(): void {
    if (this._aiChunkTimer) {
      clearTimeout(this._aiChunkTimer);
      this._aiChunkTimer = undefined;
    }
    if (this._ring === 'ai-speaking') this._ring = 'none';
  }

  private _handleUserEvent(payload: UserEventPayload): void {
    // Built-in: display_content opens the content drawer.
    if (payload.type === 'display_content') {
      const p = payload as unknown as DisplayContentPayload & Record<string, unknown>;
      // Tolerant extraction: the agent may send content/format at the top
      // level or nested under data/payload/body. format defaults to 'text'
      // when missing so a bare string still lands somewhere. Anything we
      // can coerce to a usable shape wins; otherwise we log the rejection
      // so the reason is visible in devtools.
      const src = (p as { data?: unknown; payload?: unknown; body?: unknown });
      const candidates: Array<Record<string, unknown>> = [p];
      if (src.data && typeof src.data === 'object') candidates.push(src.data as Record<string, unknown>);
      if (src.payload && typeof src.payload === 'object') candidates.push(src.payload as Record<string, unknown>);
      if (src.body && typeof src.body === 'object') candidates.push(src.body as Record<string, unknown>);

      let picked: DisplayContentPayload | null = null;
      for (const c of candidates) {
        const content = c.content;
        if (typeof content !== 'string') continue;
        const format =
          typeof c.format === 'string'
            ? (c.format as DisplayContentPayload['format'])
            : 'text';
        picked = {
          type: 'display_content',
          content,
          format,
          title: typeof c.title === 'string' ? c.title : undefined,
          language: typeof c.language === 'string' ? c.language : undefined
        } as DisplayContentPayload;
        break;
      }

      if (picked) {
        // Mint a unique id per push so repeats become distinct chips the
        // user can scroll back to. Store the full payload in history and
        // auto-open the drawer on the new one; closing drops _openContentId
        // but leaves the chip in the transcript.
        const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        this._contentHistory.set(id, picked);
        this._openContentId = id;
        this._chat.pushContent({
          id,
          title: picked.title ?? this._defaultChipTitle(picked),
          preview: this._buildPreview(picked),
          format: picked.format,
          language: picked.language
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn('[address-widget] display_content payload rejected — shape unexpected', payload);
      }
    }

    // Always forward to host callback / CustomEvent so consumers can
    // react to custom event types without us baking them in.
    this.onEvent?.(payload);
    this.dispatchEvent(
      new CustomEvent('signalwire-address:event', {
        detail: payload,
        bubbles: true,
        composed: true
      })
    );
  }

  /**
   * Default chip title for payloads that don't supply one — keeps the chip
   * from reading as an empty row when the agent skips `title`.
   */
  private _defaultChipTitle(p: DisplayContentPayload): string {
    switch (p.format) {
      case 'code':
        return p.language ? `Code (${p.language})` : 'Code';
      case 'markdown':
        return 'Markdown';
      case 'html':
        return 'HTML';
      case 'text':
      default:
        return 'Shared';
    }
  }

  /** One-line preview for the chip body. Collapse whitespace and truncate. */
  private _buildPreview(p: DisplayContentPayload): string {
    const raw = (p.content || '').replace(/\s+/g, ' ').trim();
    const max = 72;
    return raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
  }

  private _surfaceError(message: string): void {
    this._error = message;
    if (this._overlayState === 'closed') {
      // Open the overlay to show the error if it wasn't open yet.
      this._previouslyFocused = (document.activeElement as HTMLElement) ?? null;
      this._previousBodyOverflow = lockBodyScroll();
      this._applyOriginFromLauncher();
      this._overlayState = 'entering';
      this._installEscHandler();
      requestAnimationFrame(() => {
        if (this._overlayState === 'entering') this._overlayState = 'open';
      });
    }
  }

  private async _teardown(): Promise<void> {
    if (this._unwireEvents) {
      try {
        this._unwireEvents();
      } catch {
        /* noop */
      }
      this._unwireEvents = null;
    }
    if (this._remoteStreamSub) {
      try {
        this._remoteStreamSub.unsubscribe();
      } catch {
        /* noop */
      }
      this._remoteStreamSub = undefined;
    }
    if (this._localStreamSub) {
      try {
        this._localStreamSub.unsubscribe();
      } catch {
        /* noop */
      }
      this._localStreamSub = undefined;
    }
    if (this._localGainSub) {
      try {
        this._localGainSub.unsubscribe();
      } catch {
        /* noop */
      }
      this._localGainSub = undefined;
    }
    const localVideoEl = this._localVideoRef.value;
    if (localVideoEl) localVideoEl.srcObject = null;
    this._selfObserverSub?.unsubscribe();
    this._selfObserverSub = null;
    for (const sub of this._selfSubs) {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    }
    this._selfSubs = [];
    this._self = null;
    for (const sub of this._deviceSubs) {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    }
    this._deviceSubs = [];
    this._audioMuted = false;
    this._videoMuted = false;
    this._audioInputDevices = [];
    this._videoInputDevices = [];
    this._selectedAudioInputId = null;
    this._selectedVideoInputId = null;
    const audioEl = this._audioRef.value;
    if (audioEl) audioEl.srcObject = null;
    if (this._call) {
      try {
        await this._call.hangup();
      } catch {
        /* already ended */
      }
      this._call = null;
    }
    if (this._client) {
      try {
        this._client.disconnect();
      } catch {
        /* noop */
      }
      this._client = null;
    }
    if (this._aiChunkTimer) {
      clearTimeout(this._aiChunkTimer);
      this._aiChunkTimer = undefined;
    }
  }

  private _installEscHandler(): void {
    this._escHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void this.close();
      }
    };
    window.addEventListener('keydown', this._escHandler, { capture: true });
  }

  private _removeEscHandler(): void {
    if (this._escHandler) {
      window.removeEventListener('keydown', this._escHandler, { capture: true });
      this._escHandler = undefined;
    }
  }

  private _applyOriginFromLauncher(): void {
    const btn = this.shadowRoot?.querySelector<HTMLButtonElement>('.launcher');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vars = originFromRect(rect);
    for (const [key, value] of Object.entries(vars)) {
      this.style.setProperty(key, value);
    }
  }

  /**
   * Is the overlay using the vertical-stack layout? True when the caller
   * asked for `layout="stacked"`, or whenever video is off (audio-only
   * always stacks; mobile already stacks via media query as a fallback).
   */
  private _isStacked(): boolean {
    return this.layout === 'stacked' || !this.video;
  }

  /**
   * Advertise to the backend what this widget can render so the agent can
   * tailor its responses (e.g. only emit `display_content` with
   * `format: "code"` when the widget reports support). `version` here is
   * the bundle version the agent is talking to — useful for gating
   * behavior on newer capability additions. Consumers can override via
   * `userVariables.capabilities`.
   */
  private _buildCapabilities(): Record<string, unknown> {
    return {
      widget: 'signalwire-address',
      version: __WIDGET_VERSION__,
      display_content: {
        formats: ['text', 'markdown', 'code', 'html'],
        /** Minimized chips stay in the transcript so the user can reopen any past push. */
        persistent: true,
        /** The drawer exposes a copy-to-clipboard button. */
        copyable: true
      },
      /** The AI's utterances are rendered visibly in a chat transcript. */
      transcript: true,
      /** User's outgoing video is enabled for this call. */
      video: this.video,
      /** User's outgoing audio is enabled for this call. */
      audio: this.audio,
      /** User can see their own camera feed in a self-preview overlay. */
      self_preview: this.video && this.showLocalVideo
    };
  }

  /**
   * Build the session-metadata payload. Three sub-buckets:
   *   - `page`   — where the widget lives (url, title, referrer)
   *   - `client` — environment features (OS, locale, viewport, a11y prefs)
   *   - `widget` — widget self-identity (version, theme, layout, open time)
   * All values best-effort and guarded for SSR / non-browser contexts.
   */
  private _buildMetadata(): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      widget: {
        version: __WIDGET_VERSION__,
        opened_at: new Date().toISOString(),
        theme: this.theme,
        layout: this.layout,
        audio_only: !this.video
      }
    };

    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return meta;
    }

    const page: Record<string, unknown> = {
      url: window.location?.href,
      title: document?.title
    };
    if (document?.referrer) page.referrer = document.referrer;
    meta.page = page;

    meta.client = {
      user_agent: navigator.userAgent,
      platform: detectPlatform(),
      language: navigator.language,
      languages: Array.isArray(navigator.languages) ? [...navigator.languages] : undefined,
      timezone: safeTimezone(),
      timezone_offset_minutes: -new Date().getTimezoneOffset(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      device_pixel_ratio: window.devicePixelRatio,
      touch: 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0,
      online: navigator.onLine,
      cookies_enabled: navigator.cookieEnabled,
      hardware_concurrency: navigator.hardwareConcurrency,
      prefers_dark: safeMatchMedia('(prefers-color-scheme: dark)'),
      prefers_reduced_motion: safeMatchMedia('(prefers-reduced-motion: reduce)')
    };

    return meta;
  }

  private async _awaitAnimation(): Promise<void> {
    const overlay = this.shadowRoot?.querySelector<HTMLElement>('dialog.overlay');
    if (!overlay) return;
    await new Promise<void>((resolve) => {
      const handler = (): void => {
        overlay.removeEventListener('animationend', handler);
        resolve();
      };
      overlay.addEventListener('animationend', handler, { once: true });
      setTimeout(handler, 300);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  private _renderBody() {
    if (this._error) {
      return html`<div class="error-card">
        <h3>Could not connect</h3>
        <p>${this._error}</p>
      </div>`;
    }

    const entries = this._chat.getHistory();
    const hasChat = entries.length > 0;
    const openContent =
      this._openContentId !== null
        ? this._contentHistory.get(this._openContentId) ?? null
        : null;
    const hasContent = openContent !== null;

    return html`
      ${renderVideoFrame({
        call: this._call,
        ring: this._ring,
        audioRef: this._audioRef,
        localVideoRef: this._localVideoRef,
        videoEnabled: this.video,
        poster: this.poster,
        showLocalVideo: this.showLocalVideo
      })}
      ${renderControls({
        call: this._call,
        client: this._client,
        audioMuted: this._audioMuted,
        videoMuted: this._videoMuted,
        videoEnabled: this.video,
        audioInputDevices: this._audioInputDevices,
        videoInputDevices: this._videoInputDevices,
        selectedAudioInputId: this._selectedAudioInputId,
        selectedVideoInputId: this._selectedVideoInputId,
        onToggleAudio: () => this._toggleAudio(),
        onToggleVideo: () => this._toggleVideo(),
        onHangup: () => this.hangup(),
        onSelectAudioDevice: (d) => this._selectAudioDevice(d),
        onSelectVideoDevice: (d) => this._selectVideoDevice(d)
      })}
      <div class="chat-region" data-stacked=${String(this._isStacked())}>
        ${hasChat
          ? renderTranscript({
              entries,
              visible: true,
              stacked: this._isStacked(),
              scrollRef: this._transcriptRef,
              openContentId: this._openContentId,
              onContentClick: (id) => {
                this._openContentId = id;
              }
            })
          : nothing}
        ${hasContent
          ? renderContentDrawer({
              content: openContent,
              visible: true,
              stacked: this._isStacked(),
              onClose: () => {
                this._openContentId = null;
              }
            })
          : nothing}
      </div>
      <span hidden data-chat-version=${this._chatVersion}></span>
    `;
  }

  override render() {
    const overlayState = this._overlayState;
    return html`
      ${renderLauncher({
        label: this.label,
        open: () => this.open(),
        hidden: overlayState !== 'closed'
      })}
      ${overlayState !== 'closed'
        ? renderOverlay({
            close: () => this.close(),
            state: overlayState,
            stacked: this._isStacked(),
            ariaLabel: `Call ${this.destination || 'SignalWire address'}`,
            body: this._renderBody()
          })
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'signalwire-address': AddressWidget;
  }
}
