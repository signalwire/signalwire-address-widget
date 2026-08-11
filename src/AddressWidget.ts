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
import { bannerStyles, renderBanner } from './components/banner';
import type { BannerMessage } from './components/banner';
import {
  consentStyles,
  renderConsentModal,
  renderConsentBadge,
  createConsentModalRef
} from './components/consent';
import type { ConsentDraft } from './components/consent';

import { connectClient } from './lib/client';
import type { ConnectedClient } from './lib/client';
import { DEFAULT_TIMEOUT_SECONDS } from './lib/expiry';
import { ChatSession } from './lib/chat-session';
import { composerStyles, renderComposer } from './components/composer';
import { mediumPickerStyles, renderMediumPicker } from './components/medium-picker';
import { wireCallEvents } from './lib/events';
import { detectPlatform, safeTimezone, safeMatchMedia } from './lib/env';
import { readConsent, writeConsent } from './lib/consent';
import type { ConsentRecord } from './lib/consent';
import {
  readValidLast,
  writeLast,
  clearLast,
  readChat,
  writeChat,
  readContent,
  writeContent,
  clearCall,
  sweepOrphans
} from './lib/persistence';

import type {
  Theme,
  Layout,
  Mode,
  Presentation,
  PanelPosition,
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
    bannerStyles,
    consentStyles,
    composerStyles,
    mediumPickerStyles,
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

  /**
   * Enable outgoing video. Default true.
   *
   * Uses `boolDefaultTrue` rather than Lit's built-in Boolean converter,
   * which resolves ANY attribute presence to true — so the documented
   * `video="false"` opt-out silently kept the camera on. Every other
   * default-true boolean on this element already used the custom
   * converter; these two were the outliers.
   */
  @property({ reflect: true, converter: boolDefaultTrue }) video = true;

  /** Enable outgoing audio. Default true. Same converter rationale as `video`. */
  @property({ reflect: true, converter: boolDefaultTrue }) audio = true;

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
   * Which transports this widget offers: `voice` (default), `chat`, or
   * `both`. See the `Mode` type. `chat`/`both` require `gateway-url` and
   * `chat-key`; `voice`/`both` require `token`.
   */
  @property({ type: String, reflect: true }) mode: Mode = 'voice';

  /**
   * Which transport opens first when `mode="both"`. Ignored otherwise.
   *
   *   - `voice` (default) — dial immediately, the widget's original behaviour
   *   - `chat`  — open text immediately
   *   - `ask`   — show a picker and let the visitor choose
   *
   * `ask` is not only a UX choice: opening chat calls `start()`, and the
   * agent's greeting is a billable turn, so committing to a medium before the
   * visitor has expressed one spends money on a guess. It also defers the
   * microphone permission prompt until someone has actually asked for voice.
   */
  @property({ attribute: 'default-mode', reflect: true })
  defaultMode: 'voice' | 'chat' | 'ask' = 'voice';

  /**
   * Overlay presentation — `immersive` (default) or `panel`. Applies to
   * BOTH mediums: chat is immersive by default too, so switching medium
   * changes the content rather than the surface. See the `Presentation`
   * type for why panel sizing is inert in immersive mode.
   */
  @property({ type: String, reflect: true })
  presentation: Presentation = 'immersive';

  /** Corner anchoring when `presentation="panel"`. Ignored when immersive. */
  @property({ type: String, reflect: true })
  position: PanelPosition = 'bottom-right';

  /**
   * Chat gateway URL — a `ChatGateway` mounted by the Python SDK. Required
   * for `mode="chat"` and `mode="both"`.
   *
   * Note there is no trailing-slash normalisation anywhere in the chat
   * path: the gateway's route IS `/`, so a bare origin must keep it.
   */
  @property({ attribute: 'gateway-url', reflect: true }) gatewayUrl = '';

  /**
   * Publishable key for the chat gateway, sent as `Authorization: Bearer`.
   *
   * Safe in the page by design, and NOT reflected — unlike `token` (a SAT)
   * this is a public credential, but there is still no reason to write it
   * back into the DOM. The gateway injects `config_url` server-side, so a
   * key lifted from the page reaches only the agent it was issued for.
   */
  @property({ attribute: 'chat-key', reflect: false }) chatKey = '';

  /**
   * Image shown beside each agent reply in chat. Scaled to fit the circle
   * whole rather than cropped, so a logo with its own margins survives.
   * Omit for no avatar.
   */
  @property({ attribute: 'avatar-url', reflect: true }) avatarUrl: string | null = null;

  /** Composer placeholder text. */
  @property({ attribute: 'chat-placeholder', reflect: true })
  chatPlaceholder = 'Type a message...';

  /**
   * Let the caller type during a VOICE call. Off by default.
   *
   * Not a transport and not related to `mode`: the text is injected into the
   * live call as the caller's own turn and the agent answers out loud, so the
   * call never stops being a call. Useful when speech is the wrong input —
   * a noisy room, a URL or an order number that ASR keeps mangling — while
   * still wanting the answer spoken.
   *
   * Distinct from switching to chat, which stops the speaking entirely.
   * Requires `gateway-url`, because the injection endpoint is served
   * alongside the chat gateway; it does NOT require `chat-key`.
   */
  @property({ attribute: 'type-to-talk', reflect: true, type: Boolean })
  typeToTalk = false;

  /**
   * Composer placeholder while on a voice call, if `type-to-talk` is on.
   * Kept short — the voice dock leaves the input far less room than chat
   * mode does, and a longer string simply truncates.
   */
  @property({ attribute: 'type-to-talk-placeholder', reflect: true })
  typeToTalkPlaceholder = 'Or type…';

  /**
   * Reopen the widget automatically when a reload resumes a conversation
   * that had not ended. The voice path already does this via
   * `auto-reattach`; this is the chat half, and the same rule applies —
   * RESUME only. A brand new conversation never opens unprompted, because
   * that is an interruption rather than a restoration.
   */
  @property({ attribute: 'chat-auto-open', reflect: true, converter: boolDefaultTrue })
  chatAutoOpen = true;

  /**
   * Resume a chat conversation across a reload. The handle lives in
   * sessionStorage, so it is scoped to the TAB: a reload keeps the
   * conversation, a second tab starts its own, and closing the tab ends it.
   * That is what a visitor expects a chat window to do, and it is why this
   * is not localStorage. Separate from `auto-reattach`, which is the voice
   * path's equivalent.
   */
  @property({ attribute: 'chat-persistence', reflect: true, converter: boolDefaultTrue })
  chatPersistence = true;

  /** sessionStorage key for the chat handle. Change only to run two widgets on one origin. */
  @property({ attribute: 'chat-storage-key', reflect: true })
  chatStorageKey = 'sw-chat-handle';

  /** Ignore any stored chat handle and always open a fresh conversation. */
  @property({ attribute: 'chat-always-new', reflect: true, type: Boolean })
  chatAlwaysNew = false;

  /** End the chat conversation server-side when the overlay closes. */
  @property({ attribute: 'chat-end-on-close', reflect: true, type: Boolean })
  chatEndOnClose = false;

  /**
   * Idle seconds after which the chat service ends the conversation, used to
   * warn that the next message starts a new one. `0` disables the notice.
   *
   * A fallback only: the gateway reports the real value on `start`/`log` and
   * that wins. It is an approximation on purpose — the service sweeps for
   * idle conversations periodically, so the real end lags this. Erring early
   * is the safe direction.
   */
  @property({ attribute: 'chat-timeout-seconds', type: Number, reflect: true })
  chatTimeoutSeconds: number = DEFAULT_TIMEOUT_SECONDS;

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
   * values above 100 boost up to 2× at 200 (the SDK's cap). Passed
   * through to `call.setLocalMicrophoneGain` on the same percentage
   * scale — no local conversion. Leave null to use the browser's
   * natural gain.
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

  /**
   * Stable identifier for this widget instance. Used to scope
   * sessionStorage entries for reattach so a call started from one
   * widget on the page is reopened in the same widget after reload.
   *
   * When omitted, we assign `address-widget-<N>` where N is the zero-
   * based position of this element in document order among all
   * `<signalwire-address>` elements. That default works for static
   * pages. Set explicitly when the widget's DOM position may shift
   * between reloads (e.g. CMS-managed layouts).
   */
  @property({ attribute: 'widget-id', reflect: true }) widgetId = '';

  /**
   * Reattach to an active call after a page reload. When true (the
   * default), the widget eagerly connects the SignalWire client on
   * mount if sessionStorage shows this widget-id was the last one with
   * a live call, waits for the server-pushed `verto.attach`, and
   * auto-opens the overlay with the transcript/content rehydrated.
   * Set to `false` to disable surprise auto-opens on reload.
   */
  @property({ attribute: 'auto-reattach', reflect: true, converter: boolDefaultTrue })
  autoReattach = true;

  /**
   * Advanced / dev-only. Pin fresh dials from this widget to a specific
   * FreeSWITCH node by id. When set, the SDK includes `node_id` on the
   * `verto.invite` frame so the cluster routes to that box. Leave
   * blank for normal load-balanced placement. Server may override the
   * hint if the target node is unhealthy / out of pool.
   *
   * Not surfaced in the README; intended for dev/QA traffic steering.
   */
  @property({ attribute: 'node-id', reflect: true }) nodeId: string | null = null;

  /**
   * Enable verbose SDK diagnostics — sets `logLevel: 'debug'` and
   * `debug: { logWsTraffic: true }` on the SignalWire client so every
   * verto frame, state transition, and recovery event prints to the
   * console. Off by default. Use for troubleshooting only — noisy.
   * Logger config is global per the SDK, so flipping this on affects
   * all client instances on the page.
   */
  @property({ type: Boolean, reflect: true }) debug = false;

  /**
   * Require the user to consent to call recording before each fresh
   * dial. The modal is shown on every launcher click as a pre-call
   * setup step — pre-filled from any saved consent + device prefs so
   * return users one-click through. Audio is required for the AI
   * voice flow to function; video is a per-call preference (not
   * consent — we record it but don't analyze it).
   *
   * On by default — opt out with `consent-required="false"` (attribute)
   * or `consentRequired: false` (option). Consent state is forwarded
   * to the SWML side as `userVariables.metadata.consent` so the agent
   * can audit it.
   */
  @property({ attribute: 'consent-required', reflect: true, converter: boolDefaultTrue })
  consentRequired = true;

  /**
   * Schema / policy version the consent record is tagged with. Bump
   * this attribute when the consent copy or scope materially changes
   * so previously-stored consent invalidates and users are re-prompted
   * under the new terms. Defaults to 1.
   */
  @property({ attribute: 'consent-version', type: Number, reflect: true })
  consentVersion = 2;

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

  /** Raw sidecar-event callback. Set programmatically — not via attribute. */
  onSidecarEvent: WidgetOptions['onSidecarEvent'];

  /** Fired when the user accepts the consent prompt. */
  onConsentGiven: WidgetOptions['onConsentGiven'];

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
  /** Inline status banner shown at the top of the overlay body. */
  @state() private _banner: BannerMessage | null = null;
  /**
   * Which transport is currently driving the conversation. Distinct from
   * `mode`, which is what the widget is *allowed* to do — this is what it is
   * doing right now, and it flips on a medium switch.
   */
  @state() private _activeMedium: 'voice' | 'chat' = 'voice';
  /** A chat turn is in flight (restore, start, or send). */
  @state() private _chatBusy = false;
  /**
   * The overlay is showing the medium picker and nothing has been started.
   * Distinct from "no call yet" — this is a deliberate pause, not a
   * connecting state, and the overlay must not render a call's chrome.
   */
  @state() private _picking = false;
  /**
   * Active consent record (origin-wide). Loaded from localStorage on
   * mount, updated when the user accepts/edits, cleared by `close()`
   * only if they explicitly reset. Null means "not yet given" — when
   * `consentRequired` is true this triggers the modal on launcher
   * click.
   */
  @state() private _consent: ConsentRecord | null = null;
  /** True while the consent modal is open (pre-call or edit flow). */
  @state() private _consentModalOpen = false;
  /**
   * Draft state of the modal's controls. Audio is always true (the
   * checkbox is disabled-checked for transparency); video and device
   * selections are the user-toggled fields.
   */
  @state() private _consentDraft: ConsentDraft = {
    audio: true,
    train: true,
    camera: true,
    audioDeviceId: null,
    videoDeviceId: null
  };
  /** Devices enumerated on modal open (best-effort — labels may be
   *  empty until first getUserMedia grants permission). */
  @state() private _consentAudioDevices: MediaDeviceInfo[] = [];
  @state() private _consentVideoDevices: MediaDeviceInfo[] = [];
  /**
   * Set when `_acceptConsent` re-enters `open()` to dial. Causes the
   * consent gate inside `open()` to skip for that one call so we don't
   * loop the modal back open.
   */
  private _consentBypassGate = false;
  /**
   * Set once the visitor has answered the medium picker, so re-entering
   * `open()` to run the normal dial path doesn't just show the picker again.
   * Same shape as `_consentBypassGate`, and cleared on close so the next
   * visit asks afresh.
   */
  private _mediumBypassGate = false;
  /**
   * True while a medium switch is tearing down its old transport. Suppresses
   * the call-ended handler, which otherwise cannot distinguish "the call
   * ended, close the widget" from "we ended the call on purpose because the
   * conversation is moving to text".
   */
  private _switchingMedium = false;
  /** One-shot guard so auto-open-on-resume cannot fight the close button. */
  private _chatAutoOpened = false;
  /** One-shot guard for the deferred chat restore — see _maybeRestoreChat. */
  private _chatRestoreAttempted = false;
  /**
   * A single avatar load failure retires it for the session. Without this a
   * 404 or CSP-blocked image leaves a broken-image glyph beside every reply.
   */
  @state() private _avatarBroken = false;
  /**
   * Insertion-ordered content ids so persisted content can be rehydrated
   * in the same order the user saw them. `_contentHistory` is a Map but
   * Map iteration order is only stable if we never re-key; keeping a
   * parallel array is explicit and safe to serialize.
   */
  private _contentOrder: string[] = [];

  // ─────────────────────────────────────────────────────────────────────
  // Private fields
  // ─────────────────────────────────────────────────────────────────────

  private _userVariables: Record<string, unknown> = {};
  private _client: ConnectedClient | null = null;
  // The "AI dialogue" chat — receives user/AI partials and completes
  // from `<ai>` agent events (ai.partial_result, ai.response_utterance,
  // ai.completion, ai.speech_detect).
  private _chat = new ChatState();
  // The "transcribe" chat — a separate conversation surface for
  // live-transcribe / ai_sidecar bridged-call flows. Receives complete
  // utterances from `calling.ai.transcribe.utterance`, plus sidecar
  // `insight` events. Mutually exclusive with _chat in practice (the
  // SWML script picks one mode), but the widget renders whichever has
  // entries.
  private _transcribeChat = new ChatState();
  /**
   * The chat transport, when `mode` includes it. Owns its own handle,
   * persistence and idle clock; feeds the SAME `_chat` transcript the voice
   * path does, which is what lets a conversation span both mediums in one
   * panel instead of two.
   */
  private _chatSession: ChatSession | null = null;
  /**
   * A chat handle captured for the next dial, set by `switchToVoice` before
   * the local session is detached. Consumed once, by the dial it was captured
   * for.
   */
  private _pendingChatHandoff: string | null = null;
  /**
   * Random per-call token proving this browser is the party on the call.
   * Sent once, inside the dial's userVariables, and redeemed at the agent for
   * a chat handle when the visitor presses "switch to text" — the button path
   * cannot use the SWAIG tool, because that only fires if the model chooses
   * to call it.
   */
  private _handoffNonce: string | null = null;
  private _composerRef = createRef<HTMLTextAreaElement>();
  private _unwireEvents: (() => void) | null = null;
  private _previouslyFocused: HTMLElement | null = null;
  private _previousBodyOverflow = '';
  private _escHandler?: (e: KeyboardEvent) => void;
  private _aiChunkTimer?: ReturnType<typeof setTimeout>;
  private _transcriptRef = createTranscriptRef();
  private _audioRef = createRef<HTMLAudioElement>();
  private _remoteVideoRef = createRef<HTMLVideoElement>();
  private _consentModalRef = createConsentModalRef();
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
  private _recoveryEventSub?: import('rxjs').Subscription;
  /** Firehose subscriptions for `debug=true` — log every SDK call event. */
  private _firehoseSubs: import('rxjs').Subscription[] = [];
  private _bannerTimer?: ReturnType<typeof setTimeout>;
  /** Deferred auto-open when reattach completes while the tab is hidden. */
  private _pendingAutoOpen: (() => void) | null = null;
  private _visibilityHandler?: () => void;
  /** True while `_attemptReattach` is running. Prevents a launcher
   *  click from racing with the eager client connect. */
  private _reattaching = false;

  // ─────────────────────────────────────────────────────────────────────
  // Chat transport
  // ─────────────────────────────────────────────────────────────────────

  /** Whether this widget is configured to talk over chat at all. */
  private _chatEnabled(): boolean {
    return (this.mode === 'chat' || this.mode === 'both') && !!this.gatewayUrl && !!this.chatKey;
  }

  /**
   * Build the chat session lazily, once. Its callbacks feed the same
   * `_chat` transcript the voice path writes to — a chat reply and a spoken
   * reply are the same conversation, and after a switch they sit in the same
   * scroll.
   */
  private _ensureChatSession(): ChatSession | null {
    if (this._chatSession) return this._chatSession;
    if (!this._chatEnabled()) return null;

    this._chatSession = new ChatSession(
      {
        gatewayUrl: this.gatewayUrl,
        key: this.chatKey,
        debug: this.debug,
        storageKey: this.chatStorageKey,
        persistence: this.chatPersistence,
        alwaysNew: this.chatAlwaysNew,
        timeoutSeconds: this.chatTimeoutSeconds,
        connectionError: undefined
      },
      {
        onUser: (text) => {
          this._chat.medium = 'chat';
          this._chat.onUserComplete(text, false);
          this._scheduleTranscriptScroll();
        },
        onAssistant: (text, userEvent) => {
          this._chat.medium = 'chat';
          this._chat.onAiComplete(text, false);
          this._scheduleTranscriptScroll();
          // Same handler the voice path uses, so `display_content` opens the
          // drawer identically on both transports and chips survive a switch.
          if (userEvent) this._handleUserEvent(userEvent as UserEventPayload);
        },
        onRestored: (messages) => {
          this._chat.medium = 'chat';
          this._chat.replaceWithTranscript(messages);
          this._scheduleTranscriptScroll();
        },
        onNotice: (text) => {
          this._chat.pushNotice(text);
          this._scheduleTranscriptScroll();
          // A chat that timed out IS over — same as a call that hung up.
          // The session has already dropped its handle; this makes the UI
          // agree, so a reload starts fresh instead of resuming something
          // the service has closed.
          if (this._activeMedium === 'chat') {
            this._forgetLastMedium();
          }
        },
        onLoading: (loading) => {
          this._chatBusy = loading;
          // The composer is disabled while busy, which blurs it. Restore
          // focus when the turn lands so the next message can just be typed.
          if (!loading) this._refocusComposer();
        },
        onError: (message) => {
          this._error = message;
        },
        onResumed: () => {
          this._activeMedium = 'chat';
          this._rememberLastMedium('chat');
          // Reopen on resume, once. The guard matters: without it, closing
          // the widget would immediately reopen it, because `resumed` stays
          // true for the life of the conversation.
          if (this.chatAutoOpen && !this._chatAutoOpened) {
            this._chatAutoOpened = true;
            void this.open();
          }
        }
      }
    );
    return this._chatSession;
  }

  /**
   * Mint this call's handoff nonce, if a button-triggered switch is possible.
   *
   * `crypto.randomUUID` where available; the fallback is only for old
   * browsers and is still 128 bits from `getRandomValues`. Nothing about
   * this is a secret in the cryptographic sense — it just has to be
   * unguessable for its one-hour life.
   */
  private _mintHandoffNonceVars(): Record<string, unknown> {
    if (!this._chatEnabled()) {
      this._handoffNonce = null;
      return {};
    }
    let nonce: string;
    try {
      nonce =
        typeof crypto?.randomUUID === 'function'
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
    } catch {
      // No crypto at all — skip the button path rather than issue something
      // guessable. The model-invoked switch_to_chat still works.
      this._handoffNonce = null;
      return {};
    }
    this._handoffNonce = nonce;
    return { handoff_nonce: nonce };
  }

  /** Whether a "switch to text" affordance should be offered right now. */
  private _canSwitchToChat(): boolean {
    return (
      this.mode === 'both' &&
      this._activeMedium === 'voice' &&
      this._chatEnabled() &&
      !!this._handoffNonce &&
      !!this._call
    );
  }

  /**
   * Move this call to text at the visitor's request rather than the model's.
   *
   * Redeems the nonce for a handle, then joins the same path the
   * model-invoked handoff uses. The nonce is why this exists: a handle can
   * only be minted server-side, and the gateway refuses to open a chat on a
   * conversation the browser names, so the browser needs something that
   * proves which call it is on without naming anything.
   */
  async switchToChat(): Promise<void> {
    const nonce = this._handoffNonce;
    if (!nonce || !this._chatEnabled()) return;

    this._showBanner({ level: 'info', text: 'Switching to text…' });

    // Set BEFORE the request, not inside _handleChatHandoff. /handoff now
    // hangs the call up SERVER-side so its post-prompt fires immediately, so
    // call.status$ goes disconnected while this fetch is still in flight —
    // i.e. before the old guard was ever set, and the widget closed itself
    // mid-switch.
    this._switchingMedium = true;
    const endpoint = this.gatewayUrl.replace(/\/+$/, '') + '/handoff';

    let handle = '';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { handle?: string };
      handle = typeof data.handle === 'string' ? data.handle : '';
    } catch (err) {
      console.warn('[address-widget] handoff redemption failed', err);
    }

    if (!handle) {
      // The server may already have hung the call up before failing, so the
      // guard has to come off or the widget can never close itself again.
      this._switchingMedium = false;
      this._showBanner({
        level: 'warning',
        text: "Couldn't switch to text — staying on the call.",
        dismissible: true
      });
      return;
    }

    // Single-use server-side; drop ours so the button can't be pressed twice.
    this._handoffNonce = null;
    await this._handleChatHandoff({ type: 'chat_handoff', handle });
  }

  /**
   * Move a live call to text chat, carrying the conversation.
   *
   * The widget owns the teardown ordering, and that is the point. sigmond3's
   * `switch_to_chat` deliberately does NOT hang up: a server-side hangup could
   * beat the `chat_handoff` user_event to the browser, and the handoff would
   * be lost with no way to recover it. So the server mints and announces, and
   * we decide when the call actually ends.
   *
   * The transcript is deliberately NOT cleared. Visual continuity is local and
   * instant — the voice turns are already on screen. The model's context
   * arrives separately, server-side, because a browser-supplied conversation
   * history would be a prompt-injection vector: a malicious host page could
   * hand the agent a fabricated exchange.
   */
  private async _handleChatHandoff(payload: UserEventPayload): Promise<void> {
    const handle = typeof payload.handle === 'string' ? payload.handle : '';
    if (!handle) {
      console.warn('[address-widget] chat_handoff without a handle', payload);
      return;
    }

    const session = this._ensureChatSession();
    if (!session) {
      // The agent offered something this widget cannot do. Say so rather
      // than silently dropping the call.
      console.warn(
        '[address-widget] chat_handoff received but chat is not configured ' +
          '(needs gateway-url and chat-key)'
      );
      this._showBanner({
        level: 'warning',
        text: 'Text chat is not available here.',
        dismissible: true
      });
      return;
    }

    this._showBanner({ level: 'info', text: 'Switching to text…' });

    // Set BEFORE teardown: hanging up drives call.status$ to disconnected,
    // which the call-ended subscriber would otherwise read as a reason to
    // close the whole overlay.
    this._switchingMedium = true;
    try {
      // Releases the call, media and client but leaves the overlay open and
      // the transcript intact — the visitor stays in the same surface.
      await this._teardown();

      this._activeMedium = 'chat';
      this._chat.medium = 'chat';
      this._rememberLastMedium('chat');
      this._banner = null;

      await session.adoptHandle(handle);
    } finally {
      // Cleared in a finally so a failed handoff cannot leave the widget
      // permanently unable to close itself when a later call ends.
      this._switchingMedium = false;
    }
    this._refocusComposer();
  }

  /**
   * userVariables carrying an in-progress chat conversation into a voice
   * call, so the agent can pick up where the text left off.
   *
   * Empty unless there is actually a live chat handle — a cold voice call
   * must not send a stale one, or the agent would seed itself from a
   * conversation the visitor considers finished.
   */
  private _takeChatHandoffVars(): Record<string, unknown> {
    const handle = this._pendingChatHandoff ?? this._chatSession?.currentHandle;
    // Consumed, not read: a handle must seed exactly one call. Leaving it set
    // would let a later, unrelated dial pick up a conversation the visitor
    // considers finished.
    this._pendingChatHandoff = null;
    if (!handle) return {};
    return { chat_handle: handle };
  }

  /**
   * Move an in-progress chat to a voice call.
   *
   * Mirrors the voice→chat direction: the chat conversation is ended (one
   * conversation, one active transport) and the handle rides along on the
   * dial so the agent can recover its id and seed the call with what was
   * already said.
   */
  async switchToVoice(): Promise<void> {
    if (this._activeMedium !== 'chat') return;
    if (!this.token || !this.destination) {
      this._surfaceError('Voice is not configured for this widget.');
      return;
    }

    const session = this._chatSession;
    const handle = session?.currentHandle ?? null;

    // No eager surface swap here. The capture is a live chat_log read now —
    // no summarizer, no waiting on a post-prompt — so this is fast enough
    // that flipping to a connecting poster first just added a flash of
    // empty call UI before the real one.
    this._showBanner({ level: 'info', text: 'Starting a call…' });

    // End the chat leg and wait for its summary BEFORE dialing. The agent
    // does the ending and the waiting; we just don't proceed until it says
    // the record is written. Without this the call's SWML fetch races a
    // post-prompt that is still seconds away, and the call opens knowing
    // nothing — which is what all the polling used to paper over.
    if (handle) {
      try {
        const res = await fetch(this.gatewayUrl.replace(/\/+$/, '') + '/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        // Proceed anyway: a call with thin context beats refusing to place
        // one the visitor explicitly asked for.
        console.warn('[address-widget] chat leg capture failed', err);
      }
    }

    // Detach locally rather than ending again — the agent already closed the
    // conversation as part of capturing it.
    this._pendingChatHandoff = handle;
    session?.detach();

    this._activeMedium = 'voice';
    this._chat.medium = 'voice';
    // Already chosen — this re-enters open(), which must dial rather than
    // present the picker again.
    this._mediumBypassGate = true;

    // Back to closed so `open()` runs its normal path — consent gate
    // included. A switch into voice needs microphone permission and, where
    // configured, recording consent; skipping those because the conversation
    // happened to start in text would quietly bypass both.
    this._overlayState = 'closed';
    await this.open();
  }

  /**
   * Whether typing is available right now on a live voice call.
   *
   * Needs `gateway-url` for the endpoint but deliberately NOT `chat-key`:
   * that route authorizes on the per-call nonce, not the publishable key,
   * because what it has to prove is "you are on this call" rather than "you
   * may talk to this agent".
   */
  private _typeToTalkAvailable(): boolean {
    return (
      this.typeToTalk &&
      this._activeMedium === 'voice' &&
      !!this.gatewayUrl &&
      !!this._handoffNonce &&
      !!this._call
    );
  }

  /**
   * Send a typed message into the live call.
   *
   * Echoed into the transcript locally, because nothing will echo it for us:
   * our user bubbles come from `ai.speech_detect`, which is ASR of actual
   * audio, and a typed message never passes through it. Echoed optimistically
   * so the caller sees their words immediately rather than after a round trip
   * they have no other feedback on.
   */
  private async _sendTypedMessage(text: string): Promise<void> {
    const nonce = this._handoffNonce;
    if (!nonce || !text.trim()) return;

    // Deliberately NOT echoed locally. The engine inserts the injected text
    // into the conversation itself and it comes back down the same event
    // stream a spoken turn would, so echoing here produced the message twice.
    const endpoint = this.gatewayUrl.replace(/\/+$/, '') + '/say';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, text: text.trim() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn('[address-widget] typed message failed', err);
      this._showBanner({
        level: 'warning',
        text: "That message may not have been delivered.",
        dismissible: true
      });
    }
  }

  /**
   * Replay a stored chat conversation, once, as soon as the host has actually
   * configured us.
   *
   * Deliberately NOT in connectedCallback. That fires when the element
   * upgrades during parsing, but `gateway-url` is usually set as a PROPERTY
   * from a script — it is only known at runtime, so the documented pattern is
   * `el.gatewayUrl = resolveGateway()` after the element is in the DOM. At
   * upgrade time the config is still empty, `_chatEnabled()` is false, and the
   * restore silently never happened: reload a live chat and it came back
   * blank and closed.
   *
   * `updated()` runs on every render, so this catches the config whenever it
   * lands — attribute, property, or a host that configures late.
   *
   * Still the only load-time chat work, and still just a `log` read. Reads are
   * not billed; opening a conversation is, so that waits for `open()`.
   */
  private _maybeRestoreChat(): void {
    if (this._chatRestoreAttempted) return;
    if (!this._chatEnabled()) return;
    this._chatRestoreAttempted = true;
    // Re-derive now that the config exists; the value computed at
    // connectedCallback was based on an unconfigured widget.
    this._activeMedium = this._leadMedium();
    void this._ensureChatSession()?.restore();
  }

  /** sessionStorage key recording which medium was last active, per widget. */
  private get _lastMediumKey(): string {
    return `swaw:medium/${this.widgetId}`;
  }

  /**
   * Remember the active medium so a reload knows what to restore into.
   * Tab-scoped like the chat handle it accompanies — a conversation does not
   * outlive the tab it happened in.
   */
  private _rememberLastMedium(medium: 'voice' | 'chat'): void {
    try {
      sessionStorage.setItem(this._lastMediumKey, medium);
    } catch {
      /* private mode — resume is best-effort, same as the handle itself */
    }
  }

  /** Called when a conversation genuinely ends, by either medium. */
  private _forgetLastMedium(): void {
    try {
      sessionStorage.removeItem(this._lastMediumKey);
    } catch {
      /* noop */
    }
  }

  /**
   * End the chat conversation outright — the chat counterpart of hanging up.
   * Distinct from closing the overlay, which only hides it.
   */
  private async _endChat(): Promise<void> {
    await this._chatSession?.end();
    this._forgetLastMedium();
    this._chat.reset();
    await this.close();
  }

  /** Send a composed chat message. */
  private _sendChatMessage(text: string): void {
    const session = this._ensureChatSession();
    if (!session) return;
    this._activeMedium = 'chat';
    void session.send(text);
  }

  /**
   * Put focus back in the composer after a turn completes. Deferred a tick
   * because the textarea is still `disabled` at the moment the state flips,
   * and focusing a disabled element is a no-op.
   */
  private _refocusComposer(): void {
    if (this._activeMedium !== 'chat') return;
    setTimeout(() => this._composerRef.value?.focus(), 0);
  }

  private _scheduleTranscriptScroll(): void {
    void this.updateComplete.then(() =>
      autoScrollTranscript(this._transcriptRef.value)
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    loadBrandFonts();
    this._chat.onUpdate = () => {
      this._chatVersion++;
      this._persistChat();
    };
    this._transcribeChat.onUpdate = () => {
      this._chatVersion++;
    };
    // Lead medium decides what the launcher opens onto.
    this._activeMedium = this._leadMedium();
    // NOTE: the chat restore deliberately does NOT happen here — see
    // _maybeRestoreChat(), called from updated(). At this point the host may
    // not have configured us yet.
    // Assign a stable widget id before any reattach logic runs so we can
    // key sessionStorage by it. Explicit widget-id attribute wins;
    // otherwise we use the zero-based document-order index among all
    // <signalwire-address> elements on the page.
    if (!this.widgetId) {
      try {
        const all = document.querySelectorAll('signalwire-address');
        const idx = Array.prototype.indexOf.call(all, this);
        this.widgetId = idx >= 0 ? `address-widget-${idx}` : 'address-widget-0';
      } catch {
        this.widgetId = 'address-widget-0';
      }
    }
    // Sweep this widget's stale orphans on every mount. Safe to call
    // whether or not we actually reattach.
    sweepOrphans(this.widgetId);
    // Restore prior consent (origin-wide). Null means we'll prompt on
    // launcher click if `consentRequired` is on.
    this._consent = readConsent(this.consentVersion);
    if (this._consent) {
      this._consentDraft = {
        audio: this._consent.audio,
        train: this._consent.train,
        camera: this._consent.camera,
        audioDeviceId: this._consent.audioDeviceId,
        videoDeviceId: this._consent.videoDeviceId
      };
    }
    if (this.autoReattach) {
      void this._attemptReattach();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this._teardown();
    unlockBodyScroll(this._previousBodyOverflow);
    this._removeEscHandler();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = undefined;
    }
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = undefined;
    }
    // Releases the idle-clock interval and its visibilitychange/focus
    // listeners. Deliberately does NOT end the conversation — the handle
    // survives in sessionStorage so a remount resumes it.
    this._chatSession?.destroy();
  }

  override updated(): void {
    this._maybeRestoreChat();

    // Auto-scroll the transcript on every update once it has been
    // rendered. Safe to call regardless of whether the transcript is
    // visible; it no-ops when the ref is not resolved yet.
    autoScrollTranscript(this._transcriptRef.value);

    // Put the overlay <dialog> into the browser's top layer whenever it's
    // newly present. showModal() is what escapes ancestor stacking
    // contexts and containing blocks — the whole point of using <dialog>.
    this._syncDialogOpen();
    // Same dance for the consent modal — it's a separate <dialog>.
    this._syncConsentDialogOpen();
  }

  /** Open the consent / pre-call setup modal. Always opens as a
   *  pass-through step on launcher click — pre-fills from any saved
   *  consent + device prefs so return users one-click through. */
  private _openConsentModal(): void {
    // Seed the draft from the saved record (if any).
    if (this._consent) {
      this._consentDraft = {
        audio: this._consent.audio,
        train: this._consent.train,
        camera: this._consent.camera,
        audioDeviceId: this._consent.audioDeviceId,
        videoDeviceId: this._consent.videoDeviceId
      };
    } else {
      this._consentDraft = {
        audio: true,
        train: true,
        camera: true,
        audioDeviceId: null,
        videoDeviceId: null
      };
    }
    this._consentModalOpen = true;
    // Enumerate devices best-effort. Labels are populated after the
    // first getUserMedia grants permission; first-call users get
    // generic "Microphone 1" / "Camera 1" fallback labels.
    void this._refreshConsentDevices();
  }

  private async _refreshConsentDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this._consentAudioDevices = devices.filter((d) => d.kind === 'audioinput');
      this._consentVideoDevices = devices.filter((d) => d.kind === 'videoinput');
    } catch {
      this._consentAudioDevices = [];
      this._consentVideoDevices = [];
    }
  }

  private _cancelConsentModal(): void {
    this._consentModalOpen = false;
  }

  private async _acceptConsent(): Promise<void> {
    // Audio is required; the Start button is disabled when unchecked,
    // but defensively re-check here.
    if (!this._consentDraft.audio) return;
    const record = writeConsent(
      this._consentDraft.audio,
      this.consentVersion,
      this._consentDraft.train,
      this._consentDraft.camera,
      this._consentDraft.audioDeviceId,
      this._consentDraft.videoDeviceId
    );
    this._consent = record;
    this._consentModalOpen = false;
    // Tell consumers + the agent that consent was given.
    this.onConsentGiven?.(record);
    this.dispatchEvent(
      new CustomEvent('signalwire-address:consent-given', {
        detail: record,
        bubbles: true,
        composed: true
      })
    );
    // Re-enter open() to dial, bypassing the consent gate this once.
    this._consentBypassGate = true;
    await this.open();
  }

  private _syncConsentDialogOpen(): void {
    const dialog = this._consentModalRef.value;
    if (!dialog) return;
    if (this._consentModalOpen && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else if (!this._consentModalOpen && dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
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

  /** Open the overlay, on whichever medium this widget leads with. */
  async open(): Promise<void> {
    if (this._overlayState !== 'closed') return;
    // Let an in-flight reattach finish (or fail) before we start a
    // fresh dial — otherwise we'd double-connect the client.
    if (this._reattaching) return;

    // Ask first: open onto the picker and start nothing. No dial, no
    // getUserMedia, no billable greeting until the visitor has said which
    // they want. `_choose*` below resumes from here.
    if (this._shouldAskMedium()) {
      this._picking = true;
      await this._openOverlay();
      return;
    }

    // Chat-led: no token, no dial, no media permissions. Opening is also the
    // first moment the visitor has shown intent, and therefore the first
    // moment it is fair to charge for a turn — the greeting is a turn, so
    // `ensureStarted` deliberately happens here and not on mount.
    if (this._leadMedium() === 'chat') {
      const session = this._ensureChatSession();
      if (!session) {
        this._surfaceError(
          'Chat is not configured. Set `gateway-url` and `chat-key`.'
        );
        return;
      }
      this._activeMedium = 'chat';
      this._openOverlay();
      await session.ensureStarted();
      this._refocusComposer();
      return;
    }

    if (!this.token) {
      this._surfaceError('Missing token. Configure the `token` attribute or mount option.');
      return;
    }
    if (!this.destination) {
      this._surfaceError('Missing destination. Configure the `destination` attribute.');
      return;
    }
    // Gate on consent when the feature is on. The modal always opens
    // on launcher click (it's a pre-call setup step, not a one-time
    // consent wall) — it pre-fills from any saved consent so return
    // users one-click through. Cancel bails out. `_acceptConsent`
    // re-enters this method with `_consentBypassGate=true` so we
    // don't loop the modal back open.
    if (this.consentRequired && !this._consentBypassGate) {
      this._openConsentModal();
      return;
    }
    this._consentBypassGate = false;

    // Build the userVariables bag in precedence order (low → high):
    //   auto-identify block → widget's userVariables option → beforedial.setUserVariables
    // When autoIdentify is on we inject two nested keys:
    //   `capabilities` — what the widget can render (contract)
    //   `metadata`     — page/client/widget context (session features)
    // Consumer userVariables override or extend either via a matching key.
    const baseMetadata = this.autoIdentify ? this._buildMetadata() : {};
    // Fold consent (if given) into metadata.consent so the agent /
    // SWML can audit it. Stays in the metadata bag rather than at the
    // top level to keep the public userVariables shape stable.
    if (this._consent) {
      const meta = baseMetadata as Record<string, unknown>;
      meta.consent = {
        audio: this._consent.audio,
        train: this._consent.train,
        given_at: this._consent.ts,
        version: this._consent.version
      };
      // Hard-to-miss flag for the agent / SWML side: when the user
      // declines training, surface a top-level boolean alongside the
      // nested consent block so policy enforcement doesn't depend on
      // reading the nested shape.
      if (!this._consent.train) {
        meta.no_training = true;
      }
    }
    const mergeVars: Record<string, unknown> = {
      ...(this.autoIdentify
        ? {
            capabilities: this._buildCapabilities(),
            metadata: baseMetadata
          }
        : this._consent
          ? { metadata: baseMetadata }
          : {}),
      // chat -> voice continuity. The handle is opaque and HMAC-signed; the
      // agent verifies it with the gateway it already hosts and recovers the
      // conversation id from inside it. Passing the id itself would defeat
      // the point — the browser is never trusted with it, precisely so a
      // publishable key plus a guessed id cannot continue someone else's
      // conversation.
      ...this._takeChatHandoffVars(),
      ...this._mintHandoffNonceVars(),
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

    await this._openOverlay();

    // Start the call in the background so the overlay can show the
    // connecting-poster state immediately.
    void this._startCall(mergeVars);
  }

  /**
   * Visitor picked voice. Re-enters `open()` with the picker dismissed, so
   * the dial takes its ordinary path — consent gate, beforedial event and
   * all — rather than a shortcut that would quietly skip them.
   */
  private async _chooseVoice(): Promise<void> {
    this._picking = false;
    this._mediumBypassGate = true;
    this._activeMedium = 'voice';
    this._chat.medium = 'voice';
    this._overlayState = 'closed';
    await this.open();
  }

  /** Visitor picked text. This is the first billable moment. */
  private async _chooseChat(): Promise<void> {
    const session = this._ensureChatSession();
    if (!session) {
      this._surfaceError('Chat is not configured. Set `gateway-url` and `chat-key`.');
      return;
    }
    this._picking = false;
    // Latched here too: a later switchToVoice re-enters open(), and being
    // asked to choose again after already choosing would be nonsense.
    this._mediumBypassGate = true;
    this._activeMedium = 'chat';
    this._rememberLastMedium('chat');
    this._chat.medium = 'chat';
    await session.ensureStarted();
    this._refocusComposer();
  }

  /**
   * Which medium this widget leads with. `both` defers to `default-mode`;
   * a widget configured for chat but missing gateway credentials falls back
   * to voice rather than opening onto a dead surface.
   */
  private _leadMedium(): 'voice' | 'chat' {
    // An open chat conversation wins: reopening the overlay should drop you
    // back into the conversation you were having, not offer a fresh start.
    if (this._chatSession?.isActive) return 'chat';
    if (this.mode === 'chat') return 'chat';
    if (this.mode === 'both' && this.defaultMode === 'chat' && this._chatEnabled()) {
      return 'chat';
    }
    return 'voice';
  }

  /**
   * Whether opening should present a choice rather than committing.
   *
   * Only when both mediums are actually usable — asking someone to pick
   * between two things when one of them cannot work is worse than just doing
   * the one that can.
   */
  private _shouldAskMedium(): boolean {
    if (this._mediumBypassGate) return false;
    // Nothing to ask if a conversation is already under way — you chose when
    // you started it, and asking again would imply the last one is gone.
    if (this._chatSession?.isActive) return false;
    return (
      this.mode === 'both' &&
      this.defaultMode === 'ask' &&
      this._chatEnabled() &&
      !!this.token &&
      !!this.destination
    );
  }

  /**
   * The overlay entry transition, shared by both mediums so a chat-led open
   * gets the same focus capture, scroll lock and origin animation a call does.
   */
  private async _openOverlay(): Promise<void> {
    this._previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    this._previousBodyOverflow = lockBodyScroll();
    this._applyOriginFromLauncher();
    this._overlayState = 'entering';
    this._installEscHandler();
    await this.updateComplete;
    requestAnimationFrame(() => {
      if (this._overlayState === 'entering') this._overlayState = 'open';
    });
  }

  /** Close the overlay and tear down any active call. */
  async close(): Promise<void> {
    if (this._overlayState === 'closed' || this._overlayState === 'exiting') return;
    // Both gates are per-visit: a second open should ask again rather than
    // silently reusing what the visitor picked last time.
    this._picking = false;
    this._mediumBypassGate = false;
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
    // Snapshot the callId before clearing so the storage-cleanup call
    // below can reference the right keys.
    const closedCallId = call?.id ?? null;
    this._contentHistory.clear();
    this._contentOrder = [];
    this._openContentId = null;
    this._banner = null;
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = undefined;
    }
    // Honour end-on-close before deciding whether the conversation survives.
    if (this.chatEndOnClose) {
      await this._chatSession?.handleClose(true);
    }

    // A live chat conversation KEEPS its transcript. Closing the overlay on a
    // chat is hiding a window, not ending anything — the conversation is still
    // open server-side, and `restore()` will not replay it on reopen because
    // its one-shot guard has already fired. Resetting here left a blank panel
    // attached to a conversation the agent still remembered, so you typed into
    // an empty window and got answers about things you could no longer see.
    //
    // A voice call is the opposite: it is genuinely over, so its transcript
    // goes.
    if (!this._chatSession?.isActive) {
      this._chat.reset();
    }
    this._transcribeChat.reset();
    if (closedCallId) {
      clearCall(this.widgetId, closedCallId);
    } else {
      clearLast();
    }
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

  /**
   * End the whole conversation and close the overlay.
   *
   * Deliberately broader than "hang up the call": it also ends any chat
   * session and forgets the last-active medium, so pressing End finishes
   * the conversation rather than one leg of it, and a reload afterwards
   * starts fresh instead of resuming something the user deliberately ended.
   */
  async hangup(): Promise<void> {
    // Pressing End ends the CONVERSATION, not just this leg — so a reload
    // afterwards starts fresh rather than resuming something the user
    // deliberately finished.
    this._forgetLastMedium();
    await this._chatSession?.end();
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
      this._client = await connectClient(this.token, { debug: this.debug });
      const constraints: MediaTrackConstraints | undefined = this.audio
        ? {
            echoCancellation: this.echoCancellation,
            noiseSuppression: this.noiseSuppression,
            autoGainControl: this.autoGainControl,
            ...(this._consent?.audioDeviceId
              ? { deviceId: { exact: this._consent.audioDeviceId } }
              : {})
          }
        : undefined;
      // Video send-side honors the user's camera-share preference
      // when consent is on (false = don't send camera). Receive-side
      // stays tied to the widget's video mode so the user can still
      // see the remote (e.g. Sigmond's avatar) even when their own
      // camera is off — we don't store video, so it's a preference,
      // not a consent gate.
      const sendVideo = this.consentRequired && this._consent
        ? this.video && this._consent.camera
        : this.video;
      const call = await this._client.dial({
        destination: this.destination,
        audio: this.audio,
        video: sendVideo,
        receiveVideo: this.video,
        inputAudioDeviceConstraints: constraints,
        userVariables,
        ...(this.nodeId ? { nodeId: this.nodeId } : {})
      });
      this._call = call;

      // Record this widget as the owner of the active call so a page
      // reload can route reattach back here. Persisted chat/content
      // entries start empty and grow as events arrive.
      writeLast({
        widgetId: this.widgetId,
        callId: call.id,
        destination: this.destination
      });

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
        onUserEvent: (payload) => this._handleUserEvent(payload),
        onSidecarEvent: (payload) => this._handleSidecarEvent(payload),
        onTranscribeUtterance: (role, text) => {
          // Map roles into the transcribe-chat bubble pipeline. Per the
          // sidecar default (customer_role: 'remote-caller'), the widget
          // caller is typically the remote leg, so remote-caller → user
          // side and local-caller → ai side. ChatState's
          // onAiComplete/onUserComplete commit a complete bubble.
          if (role === 'local-caller') {
            this._transcribeChat.onAiComplete(text, false);
          } else {
            this._transcribeChat.onUserComplete(text, false);
          }
        }
      });

      this._rememberLastMedium('voice');
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
    // Attach the remote stream to BOTH the hidden <audio> sink (for
    // playback — the visible <video> is muted for autoplay compliance)
    // AND the visible <video> element (for picture). Same stream object
    // on both elements is fine — the audio element ignores video
    // tracks, the video element ignores audio tracks (because muted).
    this._remoteStreamSub?.unsubscribe();
    this._remoteStreamSub = call.remoteStream$.subscribe((stream) => {
      const audioEl = this._audioRef.value;
      const videoEl = this._remoteVideoRef.value;
      if (audioEl) {
        if (stream) {
          if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
          // Best-effort play — the launcher click supplied the gesture.
          void audioEl.play?.().catch(() => {
            /* autoplay may still fail if permissions are weird; ignore */
          });
        } else {
          audioEl.srcObject = null;
        }
      }
      if (videoEl) {
        if (stream) {
          if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
          void videoEl.play?.().catch(() => {
            /* video is muted so autoplay should always succeed; ignore */
          });
        } else {
          videoEl.srcObject = null;
        }
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
      // Both our public `inputVolume` and the SDK's
      // `call.setLocalMicrophoneGain(value)` are on the same 0..200
      // percentage scale (100 = unity). Pass it through as-is.
      //
      // `setLocalMicrophoneGain` exists on the WebRTCCall class but
      // isn't surfaced on the public `Call` interface type yet, so we
      // narrow via `as` for the TS side. Runtime access is a direct
      // method call on the same instance object.
      const pct = Math.max(0, Math.min(200, Number(this.inputVolume)));
      const gainCall = call as unknown as {
        setLocalMicrophoneGain(value: number): void;
      };
      let applied = false;
      this._localGainSub?.unsubscribe();
      this._localGainSub = call.localStream$.subscribe((stream) => {
        if (stream && !applied) {
          applied = true;
          try {
            gainCall.setLocalMicrophoneGain(pct);
          } catch (err) {
            console.warn('[address-widget] setLocalMicrophoneGain failed:', err);
          }
        }
      });
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
    // Close the overlay when the call ends — unless we are the ones ending
    // it. A medium switch tears the call down deliberately and keeps the
    // overlay open, so without this guard the hangup inside _teardown()
    // reaches here as an ordinary disconnect and closes the widget out from
    // under a chat that is about to start.
    if (call.status$) {
      call.status$.subscribe((status: string) => {
        if (status === 'disconnected' || status === 'destroyed') {
          if (this._switchingMedium) return;
          void this.close();
        }
      });
    }

    // Surface recovery pipeline events as plain-language banners.
    // `reinvite_started`        → "Reconnecting…" (stays until succeeded/failed)
    // `reinvite_succeeded`      → "Connection restored" (auto-dismiss)
    // `max_attempts_reached`    → "Connection lost", close overlay
    // `call_recovery_failed`    → same as max_attempts_reached
    // `video_disabled`          → inform user of bandwidth-driven video pause
    // `video_restored`          → confirm restoration
    this._recoveryEventSub?.unsubscribe();
    const recoveryEvent$ = (call as unknown as {
      recoveryEvent$?: import('rxjs').Observable<{ action: string; reason?: string }>;
    }).recoveryEvent$;
    if (recoveryEvent$) {
      this._recoveryEventSub = recoveryEvent$.subscribe((event) => {
        switch (event.action) {
          case 'reinvite_started':
          case 'call_recovering':
            this._showBanner({ level: 'warning', text: 'Reconnecting…' });
            break;
          case 'reinvite_succeeded':
          case 'call_recovered':
            this._showBanner(
              { level: 'success', text: 'Connection restored', dismissible: true },
              3000
            );
            break;
          case 'max_attempts_reached':
          case 'call_recovery_failed':
            this._showBanner({ level: 'error', text: 'Connection lost', dismissible: false });
            if (this._call) {
              clearCall(this.widgetId, this._call.id);
            }
            void this.close();
            break;
          case 'video_disabled':
            this._showBanner(
              {
                level: 'info',
                text: 'Video paused to maintain audio quality',
                dismissible: true
              },
              5000
            );
            break;
          case 'video_restored':
            this._showBanner(
              { level: 'success', text: 'Video restored', dismissible: true },
              3000
            );
            break;
          default:
            break;
        }
      });
    }

    // Debug firehose: when `debug=true`, log every emission from the
    // SDK's general call-event streams. We normally avoid these in
    // favor of typed `call.subscribe(eventType)` calls (see CLAUDE.md),
    // but for diagnostics they catch anything on the wire that doesn't
    // hit one of our explicit subscriptions.
    for (const sub of this._firehoseSubs) {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    }
    this._firehoseSubs = [];
    if (this.debug) {
      const fireCall = call as unknown as {
        callEvent$?: import('rxjs').Observable<unknown>;
        signalingEvent$?: import('rxjs').Observable<unknown>;
      };
      if (fireCall.callEvent$) {
        this._firehoseSubs.push(
          fireCall.callEvent$.subscribe((evt) => {
            console.log('[address-widget][firehose][callEvent$]', evt);
          })
        );
      }
      if (fireCall.signalingEvent$) {
        this._firehoseSubs.push(
          fireCall.signalingEvent$.subscribe((evt) => {
            console.log('[address-widget][firehose][signalingEvent$]', evt);
          })
        );
      }
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
    // Built-in: chat_handoff moves this conversation to text in place.
    if (payload.type === 'chat_handoff') {
      void this._handleChatHandoff(payload);
      // Falls through to the host callback / CustomEvent below, so a page
      // can observe the switch even though we act on it ourselves.
    }

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
        this._contentOrder.push(id);
        this._openContentId = id;
        // Push the chip into both chat surfaces so it's visible whether
        // the call is in AI-agent mode or transcribe/sidecar mode (and
        // survives a mode swap mid-call). Same pattern as sidecar
        // insights.
        const chip = {
          id,
          title: picked.title ?? this._defaultChipTitle(picked),
          preview: this._buildPreview(picked),
          format: picked.format,
          language: picked.language
        };
        this._chat.pushContent(chip);
        this._transcribeChat.pushContent(chip);
        this._persistContent();
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
   * Route AI-sidecar coaching events:
   *   - `insight` → drop a turquoise InsightEntry into the transcript
   *   - `error`   → console.warn (noisy enough to surface in devtools;
   *                 the host's CustomEvent listener can also pick it up)
   *   - everything else (`turn`, `action`, `tool_call`, `tool_result`,
   *     `start`, `stop`, `final`, `request`, `thought`,
   *     `global_data_change`, `history_pruned`, ...) → re-emit only.
   *     Turn events in particular carry the raw transcript fed into
   *     the LLM — they're not user-facing content; consumers can opt
   *     into rendering them via the CustomEvent / onSidecarEvent hooks.
   *
   * Every event also flows through to `onSidecarEvent` and the
   * `signalwire-address:sidecar` CustomEvent so consumers can drive
   * their own debug log / CRM hooks without the widget baking in
   * specific behavior for every type.
   */
  private _handleSidecarEvent(payload: UserEventPayload): void {
    if (payload.type === 'insight') {
      const text = typeof payload.raw === 'string' ? payload.raw : '';
      if (text) {
        const tickId = typeof payload.tick_id === 'number' ? payload.tick_id : undefined;
        // Insights belong to whichever surface ends up active. Push
        // into both so the visible chat picks them up regardless of
        // which mode the call lands in (or transitions to).
        const insight = { text, tickId, ts: Date.now() };
        this._chat.pushInsight(insight);
        this._transcribeChat.pushInsight(insight);
      }
    } else if (payload.type === 'tool_result') {
      // Tool results — when the LLM's tool returned something. Surface
      // the human-readable response inline so the agent can see what
      // ran. Skip the built-in `sidecar_skip` (it's noise, not advice).
      const name = typeof payload.name === 'string' ? payload.name : '';
      if (name && name !== 'sidecar_skip') {
        const rawResponse = typeof payload.response === 'string' ? payload.response : '';
        // The response is usually a JSON-encoded { response: "..." }
        // payload from the SWAIG function. Try to unwrap it; fall back
        // to the raw string if parse fails.
        let responseText = rawResponse;
        try {
          const parsed = JSON.parse(rawResponse) as { response?: unknown };
          if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string') {
            responseText = parsed.response;
          }
        } catch {
          /* keep raw */
        }
        const text = responseText ? `${name}: ${responseText}` : name;
        const tickId = typeof payload.tick_id === 'number' ? payload.tick_id : undefined;
        const note = { text, label: 'Tool', tickId, ts: Date.now() };
        this._chat.pushInsight(note);
        this._transcribeChat.pushInsight(note);
      }
    } else if (payload.type === 'error') {
      console.warn('[address-widget] sidecar error:', payload);
    }

    this.onSidecarEvent?.(payload);
    this.dispatchEvent(
      new CustomEvent('signalwire-address:sidecar', {
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

  /**
   * Try to reopen an active call left over from before a page reload.
   *   1. Read `swaw:last`. If missing / stale / for a different widget,
   *      stay closed (sweep already ran in connectedCallback).
   *   2. Eager-connect the client and wait briefly for the server to
   *      push `verto.attach`, which surfaces the call on
   *      `client.session.calls`.
   *   3. If we find a call whose `.to` matches our destination,
   *      rehydrate chat + content history, open the overlay, and wire
   *      the normal live subscriptions.
   *   4. On any failure / no-match / timeout, disconnect the eager
   *      client and clear the stored pointer so a user click doesn't
   *      inherit confusing state.
   */
  private async _attemptReattach(): Promise<void> {
    const last = readValidLast();
    if (!last || last.widgetId !== this.widgetId) return;
    // Token required to connect. Without it we can't reattach; leave
    // the pointer alone so a later caller that supplies the token can
    // still use it.
    if (!this.token) return;

    this._reattaching = true;
    let client: ConnectedClient;
    try {
      client = await connectClient(this.token, { debug: this.debug });
    } catch {
      clearCall(this.widgetId, last.callId);
      this._reattaching = false;
      return;
    }

    const deadline = Date.now() + 5000;
    let matched: Call | null = null;
    while (Date.now() < deadline) {
      const calls = (client.client.session?.calls ?? []) as Call[];
      matched = calls.find((c) => (c as unknown as { to?: string }).to === last.destination) ?? null;
      if (matched) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    if (!matched) {
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
      clearCall(this.widgetId, last.callId);
      this._reattaching = false;
      return;
    }

    // Rehydrate in-memory state from the snapshot before the overlay
    // flashes open, so first paint already shows history.
    const chatSnap = readChat(this.widgetId, last.callId);
    if (chatSnap) this._chat.loadSnapshot(chatSnap);
    const contentSnap = readContent(this.widgetId, last.callId);
    if (contentSnap) {
      this._contentHistory.clear();
      this._contentOrder = [];
      for (const { id, payload } of contentSnap) {
        this._contentHistory.set(id, payload);
        this._contentOrder.push(id);
      }
    }

    // Store the call + rewrite a fresh snapshot + `last` pointer so a
    // second reload during the live portion still has data to load.
    this._client = client;
    this._call = matched;
    this._persistChat();
    this._persistContent();
    writeLast({
      widgetId: this.widgetId,
      callId: last.callId,
      destination: this.destination
    });

    const open = (): void => {
      this._previousBodyOverflow = lockBodyScroll();
      this._overlayState = 'entering';
      this._installEscHandler();
      requestAnimationFrame(() => {
        if (this._overlayState === 'entering') this._overlayState = 'open';
      });
      this._showBanner(
        { level: 'success', text: 'Reconnected to call', dismissible: true },
        4000
      );
      // Wire the live subscriptions after the overlay is committed so
      // the inner refs (audio sink, local video) exist.
      void this.updateComplete.then(() => {
        if (!this._call) return;
        this._wireCallStateObservables(this._call);
        this._unwireEvents = wireCallEvents(this._call, {
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
          onUserEvent: (payload) => this._handleUserEvent(payload),
        onSidecarEvent: (payload) => this._handleSidecarEvent(payload),
        onTranscribeUtterance: (role, text) => {
          // Map roles into the transcribe-chat bubble pipeline. Per the
          // sidecar default (customer_role: 'remote-caller'), the widget
          // caller is typically the remote leg, so remote-caller → user
          // side and local-caller → ai side. ChatState's
          // onAiComplete/onUserComplete commit a complete bubble.
          if (role === 'local-caller') {
            this._transcribeChat.onAiComplete(text, false);
          } else {
            this._transcribeChat.onUserComplete(text, false);
          }
        }
        });
      });
    };

    this._reattaching = false;
    if (document.visibilityState === 'visible') {
      open();
    } else {
      this._pendingAutoOpen = open;
      this._visibilityHandler = (): void => {
        if (document.visibilityState === 'visible' && this._pendingAutoOpen) {
          const pending = this._pendingAutoOpen;
          this._pendingAutoOpen = null;
          if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = undefined;
          }
          pending();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  /**
   * Write the current transcript snapshot to sessionStorage. Called on
   * every ChatState update; partials are filtered out at serialization
   * time via `getCommittedEntries` so we only persist stable rows.
   */
  private _persistChat(): void {
    if (!this._call) return;
    writeChat(this.widgetId, this._call.id, this._chat.getCommittedEntries());
  }

  /**
   * Serialize the insertion-ordered content history so rehydration
   * preserves the chip order the user saw before reload.
   */
  private _persistContent(): void {
    if (!this._call) return;
    const entries = this._contentOrder
      .map((id) => {
        const payload = this._contentHistory.get(id);
        return payload ? { id, payload } : null;
      })
      .filter((x): x is { id: string; payload: DisplayContentPayload } => x !== null);
    writeContent(this.widgetId, this._call.id, entries);
  }

  /**
   * Show a status banner. When `autoDismissMs` is set, clears itself
   * after that many ms; otherwise sticks until the user or a later
   * call replaces it.
   */
  private _showBanner(message: BannerMessage, autoDismissMs?: number): void {
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = undefined;
    }
    this._banner = message;
    if (autoDismissMs && autoDismissMs > 0) {
      this._bannerTimer = setTimeout(() => {
        this._banner = null;
        this._bannerTimer = undefined;
      }, autoDismissMs);
    }
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
    if (this._recoveryEventSub) {
      try {
        this._recoveryEventSub.unsubscribe();
      } catch {
        /* noop */
      }
      this._recoveryEventSub = undefined;
    }
    for (const sub of this._firehoseSubs) {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    }
    this._firehoseSubs = [];
    const localVideoEl = this._localVideoRef.value;
    if (localVideoEl) localVideoEl.srcObject = null;
    const remoteVideoEl = this._remoteVideoRef.value;
    if (remoteVideoEl) remoteVideoEl.srcObject = null;
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
    // Chat is always stacked: the sidebar shape exists to sit beside a video
    // frame, and in text mode there isn't one. Left as a sidebar the
    // transcript would hold its narrow column with dead space where the
    // video used to be. Switching to voice brings the frame back and the
    // transcript returns to the sidebar it was.
    return this.layout === 'stacked' || !this.video || this._activeMedium === 'chat';
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
      self_preview: this.video && this.showLocalVideo,
      /**
       * This caller can be moved to text chat mid-call. Gates sigmond3's
       * `switch_to_chat` tool: the agent only learns the tool exists when
       * this is true, so a PSTN caller is never offered a browser it does
       * not have. Requires a configured gateway, not just `mode`.
       */
      chat_handoff: this._chatEnabled()
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

    // Two parallel chat surfaces, one panel. The `<ai>` agent flow
    // drives _chat; live-transcribe / ai_sidecar drives _transcribeChat.
    // Mode switches mid-call are real (a transcribe call can get
    // transferred to an AI agent), so we resolve which to render on
    // every paint.
    //
    // Priority: AI mode is "active" iff _chat has at least one
    // dialogue *bubble* (user/ai utterance). Insights / tool notes
    // / content chips are pushed into both chats so they survive a
    // mode swap, so their presence alone shouldn't flip us into AI
    // mode and wipe the transcribe-side dialogue.
    const aiEntries = this._chat.getHistory();
    const transcribeEntries = this._transcribeChat.getHistory();
    const aiHasBubble = aiEntries.some((e) => e.kind === 'bubble');
    const entries = aiHasBubble ? aiEntries : transcribeEntries;
    const hasChat = entries.length > 0;
    const openContent =
      this._openContentId !== null
        ? this._contentHistory.get(this._openContentId) ?? null
        : null;
    const hasContent = openContent !== null;

    return html`
      ${renderConsentBadge({
        show: this.consentRequired && this._consent !== null,
        // Camera-on means video is flowing AND therefore being
        // recorded server-side (we just don't analyze/train on it).
        camera: this.video && (this._consent?.camera ?? false)
      })}
      ${renderBanner({
        message: this._banner,
        onDismiss: () => {
          this._banner = null;
          if (this._bannerTimer) {
            clearTimeout(this._bannerTimer);
            this._bannerTimer = undefined;
          }
        }
      })}
      ${this._picking
        ? renderMediumPicker({
            voiceAvailable: !!this.token && !!this.destination,
            chatAvailable: this._chatEnabled(),
            onVoice: () => void this._chooseVoice(),
            onChat: () => void this._chooseChat()
          })
        : html`
      ${this._activeMedium === 'voice'
        ? // Chat has no media, so it must not wear a call's surface. Left
          // unconditional this rendered the pre-call poster and its
          // "Connecting call" state behind a text conversation that was
          // already underway — describing something that was never going to
          // happen.
          renderVideoFrame({
            call: this._call,
            ring: this._ring,
            audioRef: this._audioRef,
            remoteVideoRef: this._remoteVideoRef,
            localVideoRef: this._localVideoRef,
            videoEnabled: this.video,
            poster: this.poster,
            showLocalVideo: this.showLocalVideo
          })
        : nothing}
      ${this._activeMedium === 'voice'
        ? renderControls({
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
            onSelectVideoDevice: (d) => this._selectVideoDevice(d),
            // Undefined rather than a no-op when unavailable, so the button
            // is absent instead of present-but-dead.
            onSwitchToChat: this._canSwitchToChat()
              ? () => void this.switchToChat()
              : undefined
          })
        : nothing}
      <div class="chat-region" data-stacked=${String(this._isStacked())}>
        ${hasChat
          ? renderTranscript({
              entries,
              visible: true,
              stacked: this._isStacked(),
              scrollRef: this._transcriptRef,
              avatarUrl: this._avatarBroken ? null : this.avatarUrl,
              onAvatarError: () => {
                this._avatarBroken = true;
              },
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
      ${this._activeMedium === 'chat'
        ? renderComposer({
            placeholder: this.chatPlaceholder,
            busy: this._chatBusy,
            onSend: (text) => this._sendChatMessage(text),
            inputRef: this._composerRef,
            // Absent unless voice is genuinely available and this widget is
            // allowed to use it — mode="chat" has nothing to escalate to.
            onSwitchToVoice:
              this.mode === 'both' && !!this.token && !!this.destination
                ? () => void this.switchToVoice()
                : undefined,
            onEnd: () => void this._endChat()
          })
        : this._typeToTalkAvailable()
          ? // Alongside the controls dock, not instead of it — the call is
            // still a call, and taking the mute and hangup buttons away
            // because someone typed once would be hostile.
            renderComposer({
              placeholder: this.typeToTalkPlaceholder,
              busy: false,
              onSend: (text) => void this._sendTypedMessage(text),
              inputRef: this._composerRef
            })
          : nothing}
        `}
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
            presentation: this.presentation,
            position: this.position,
            ariaLabel: `Call ${this.destination || 'SignalWire address'}`,
            body: this._renderBody()
          })
        : nothing}
      ${this.consentRequired
        ? renderConsentModal({
            open: this._consentModalOpen,
            draft: this._consentDraft,
            showCameraOption: this.video,
            audioDevices: this._consentAudioDevices,
            videoDevices: this._consentVideoDevices,
            dialogRef: this._consentModalRef,
            onDraftChange: (field, value) => {
              this._consentDraft = {
                ...this._consentDraft,
                [field]: value as never
              };
            },
            onAccept: () => {
              void this._acceptConsent();
            },
            onCancel: () => this._cancelConsentModal()
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
