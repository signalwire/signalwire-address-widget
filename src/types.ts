/**
 * Shared widget types.
 */

import type { Call } from '@signalwire/js';

export type Theme = 'dark' | 'light';

/**
 * Overlay layout.
 *
 *   - `auto` (default): sidebar on desktop when video is enabled; stacked
 *     on mobile and in audio-only mode.
 *   - `stacked`: always top-to-bottom — video (smaller, capped) sits at the
 *     top, transcript fills below. Useful when the host page has its own
 *     branding and wants the overlay to feel narrower on desktop.
 */
export type Layout = 'auto' | 'stacked';

/**
 * Which transports the widget offers.
 *
 *   - `voice` (default): the video/audio call this widget started life as.
 *   - `chat`: text only, over a `ChatGateway`. No SAT, no media.
 *   - `both`: offers each, and allows switching between them mid-conversation
 *     without losing context. `default-mode` picks which one opens first.
 *
 * `chat` and `both` need `gateway-url` and `chat-key`; `voice` and `both`
 * need `token`.
 */
export type Mode = 'voice' | 'chat' | 'both';

/**
 * How the overlay presents itself.
 *
 *   - `immersive` (default, both mediums): full-viewport takeover. What the
 *     widget has always done for calls, and the default for chat too, so a
 *     medium switch is a change of content rather than a change of surface —
 *     the video area collapses, the composer appears, the transcript stays
 *     exactly where it was.
 *   - `panel`: a corner window sized by `--sw-address-panel-width` /
 *     `--sw-address-panel-height`, anchored per `position`. The familiar
 *     support-chat shape, for text-only embeds on a page that shouldn't be
 *     taken over. Collapses to full-screen under the mobile breakpoint
 *     regardless, because a 380px window on a phone is not a window.
 *
 * Panel sizing tokens are inert in `immersive` — deliberately, and unlike the
 * standalone chat widget where they were inert *everywhere* because three
 * media queries of equal specificity overrode them at every viewport width.
 */
export type Presentation = 'immersive' | 'panel';

/** Corner anchoring for `presentation="panel"`. Ignored when immersive. */
export type PanelPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

/**
 * Payload for a `display_content` user_event sent by the backend agent.
 * Documented publicly in EVENTS.md.
 */
export interface DisplayContentPayload {
  type: 'display_content';
  title?: string;
  content: string;
  format: 'text' | 'markdown' | 'code' | 'html';
  /** Required when `format === "code"`, used as the syntax-highlight language. */
  language?: string;
}

/**
 * Options accepted by both `mount()` and the declarative `<signalwire-address>`
 * element (via attributes of the same names in kebab-case).
 */
export interface WidgetOptions {
  /**
   * SignalWire Subscriber Access Token (SAT).
   *
   * Required for voice — i.e. `mode: 'voice'` (the default) or
   * `mode: 'both'`. Optional in the type rather than required because
   * `mode: 'chat'` never dials and has no use for one; a chat-only
   * consumer should not have to invent a token to satisfy the compiler.
   */
  token?: string;
  /**
   * Address to dial, e.g. `/public/my-agent` or a full fabric address.
   * Required for voice, unused in chat-only mode. See `token`.
   */
  destination?: string;
  /** Launcher label text when the attached div has no content of its own. */
  label?: string;
  /**
   * Which transports this widget offers. Default `voice`.
   *
   * `chat` and `both` additionally require `gatewayUrl` and `chatKey` —
   * without both, the widget stays voice-only rather than half-working.
   */
  mode?: Mode;
  /**
   * Which transport opens first when `mode: 'both'`. Ignored otherwise.
   * `ask` presents the medium picker and commits to nothing (and spends
   * nothing) until the visitor chooses. Default `voice`.
   */
  defaultMode?: 'voice' | 'chat' | 'ask';
  /** Overlay presentation — full-viewport or corner panel. Default `immersive`. */
  presentation?: Presentation;
  /** Corner anchoring when `presentation: 'panel'`. Ignored when immersive. */
  position?: PanelPosition;
  /**
   * URL of a `ChatGateway` mounted by the SignalWire Python SDK.
   * Required for chat. Also required — on its own, without `chatKey` —
   * by `typeToTalk`, which authorizes on the per-call nonce instead.
   */
  gatewayUrl?: string;
  /**
   * Publishable key for the chat gateway, sent as `Authorization: Bearer`.
   * A public credential by design: the gateway holds the real one and pins
   * `config_url` server-side, so a leaked key still reaches only the agent
   * it was issued for.
   */
  chatKey?: string;
  /** Image shown beside each agent reply in chat. Scaled to fit, not cropped. */
  avatarUrl?: string;
  /** Composer placeholder in chat mode. */
  chatPlaceholder?: string;
  /**
   * Let the caller type during a VOICE call, delivered via the gateway's
   * `/say` route. Default false. Needs `gatewayUrl`, but deliberately not
   * `chatKey`.
   */
  typeToTalk?: boolean;
  /** Composer placeholder during a voice call when `typeToTalk` is on. */
  typeToTalkPlaceholder?: string;
  /** Resume a chat conversation across a page reload. Default true. */
  chatPersistence?: boolean;
  /**
   * Reopen the widget automatically when a reload resumes a live
   * conversation. Fires once per conversation, so a close afterwards
   * sticks. Default true.
   */
  chatAutoOpen?: boolean;
  /**
   * sessionStorage key for the chat handle. Change only to run two chat
   * widgets on one origin.
   */
  chatStorageKey?: string;
  /** Ignore any stored handle and always open a fresh conversation. Default false. */
  chatAlwaysNew?: boolean;
  /**
   * End the conversation server-side when the overlay closes, instead of
   * leaving it resumable. Default false.
   */
  chatEndOnClose?: boolean;
  /**
   * Idle seconds after which the chat service ends the conversation.
   * Mirror whatever the gateway is configured with — the widget uses it to
   * show an expiry notice and stop offering resume. Default 3600.
   */
  chatTimeoutSeconds?: number;
  /** Enable outgoing video. Default true. */
  video?: boolean;
  /** Enable outgoing audio. Default true. */
  audio?: boolean;
  /** Color theme. Default `dark`. */
  theme?: Theme;
  /**
   * Overlay layout. `auto` keeps the sidebar look on desktop (default);
   * `stacked` puts video on top and transcript below at every size.
   */
  layout?: Layout;
  /** Show the local self-view inside the video frame. Default true. */
  showLocalVideo?: boolean;
  /**
   * Browser audio-processing toggles, applied to `getUserMedia` constraints
   * at dial time. All three default to `true` (the browser defaults).
   * Set to `false` to capture raw mic audio — useful for music, accessibility
   * tools, or when the remote side is doing its own processing.
   */
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  /**
   * Initial microphone input volume as a percentage (0–200). 100 =
   * unchanged (unity); < 100 reduces the outgoing mic level; > 100
   * boosts up to 2× at 200 (the SDK's cap). Clamped to [0, 200] and
   * passed directly to `call.setLocalMicrophoneGain`, which uses the
   * same percentage scale.
   *
   * Applied locally via a Web Audio GainNode in front of the
   * RTCRtpSender once getUserMedia delivers a local stream. No server
   * round-trip and no scope requirements — works on any token. Not to
   * be confused with `participant.setAudioInputVolume`, which is
   * FreeSWITCH-side channel mix volume and was the wrong API for
   * client-side gain control.
   */
  inputVolume?: number;
  /**
   * User variables passed to the destination. The backend sees them on the
   * session (`result.user_data` in SWML). Use this for plumbing hidden
   * fields without touching attributes each call.
   */
  userVariables?: Record<string, unknown>;
  /**
   * Auto-populate `capabilities` and `metadata` into userVariables before
   * dial. When true (the default), the widget injects two nested objects:
   *
   *   - `capabilities` — the agent-facing contract (which `display_content`
   *     formats are supported, whether a transcript is visible, etc.).
   *     Agents should read this to decide whether to emit visual content.
   *   - `metadata` — session context grouped into `page`, `client`, and
   *     `widget` sub-buckets (URL, referrer, OS, locale, timezone,
   *     viewport, a11y prefs, widget version + theme + layout, etc.).
   *
   * Consumer-supplied userVariables with matching keys override the
   * auto-populated values; a `beforedial` handler with `setUserVariables`
   * wins last. Set to `false` for strict control over the userVariables
   * bag.
   */
  autoIdentify?: boolean;
  /**
   * Stable identifier for this widget instance. Scopes the
   * sessionStorage entries the widget uses for reattach across page
   * reloads. When omitted, an auto-id of `address-widget-<N>` is
   * assigned based on the element's zero-based document-order position
   * among `<signalwire-address>` elements — good enough for static
   * pages. Set explicitly when widget order may shift between reloads.
   */
  widgetId?: string;
  /**
   * Reattach to an active call after a page reload. Default true. When
   * on, the widget opens its client on mount if sessionStorage shows
   * this widget-id was the last one with a live call, waits for the
   * server-pushed `verto.attach`, and auto-opens the overlay with the
   * transcript and content history rehydrated. Honors
   * `document.visibilityState`: if the tab is hidden at reattach time,
   * the auto-open waits for the user to return to the tab. Set to
   * `false` to disable surprise dialogs on reload.
   */
  autoReattach?: boolean;
  /**
   * Advanced / dev-only. Pin fresh dials to a specific FreeSWITCH node by
   * id (corresponds to `verto.invite`'s `node_id`). Useful for dev /
   * staging traffic steering — leave undefined in production. Server may
   * ignore the hint if the target node is unhealthy.
   */
  nodeId?: string;
  /**
   * Optional image URL shown in the video area. In video mode it sits as
   * the pre-call poster. In audio-only mode (`video: false`) it becomes
   * the only visual element in place of the video frame. If omitted in
   * audio-only mode, the video area collapses entirely.
   */
  poster?: string;
  /**
   * Optional raw pass-through hook for every `user_event` that doesn't match
   * a known widget handler (e.g. `display_content`). Useful for custom
   * agent-driven UI without us having to bake in support.
   */
  onEvent?: (event: UserEventPayload) => void;
  /**
   * Optional pass-through for every `calling.ai.sidecar` event the call
   * subscribes to. The widget already handles `type: 'insight'` (drops a
   * row into the transcript) and `type: 'error'` (console.warn); this
   * hook fires for every event regardless so consumers can render their
   * own debug log / drive CRM workflows from `tool_call` / `action` /
   * `final` etc. Same payloads also fire as `signalwire-address:sidecar`
   * CustomEvents.
   */
  onSidecarEvent?: (event: UserEventPayload) => void;
  /**
   * Require user consent to call recording before each fresh dial.
   * When on, a single-screen modal explains the recording in plain
   * language and lets the user opt out of video. Choice is persisted
   * in localStorage (origin-wide) so they're not re-prompted on
   * subsequent dials. A small "Recording" badge stays visible during
   * the call. Default true — pass false only if the host page obtains
   * consent itself.
   */
  consentRequired?: boolean;
  /**
   * Schema / policy version tag for the consent record. Bump when
   * copy or scope materially changes so old consent invalidates and
   * users see the new prompt. Defaults to 2.
   */
  consentVersion?: number;
  /**
   * Fired when the user accepts the consent prompt. Receives the
   * persisted record. Same payload also fires as
   * `signalwire-address:consent-given` CustomEvent.
   */
  onConsentGiven?: (record: {
    audio: boolean;
    train: boolean;
    camera: boolean;
    audioDeviceId: string | null;
    videoDeviceId: string | null;
    ts: string;
    version: number;
  }) => void;
  /**
   * Verbose SDK diagnostics. Sets `logLevel: 'debug'` and
   * `debug: { logWsTraffic: true }` on the SignalWire client so every
   * verto frame, state transition, and recovery event prints to the
   * console. Off by default — noisy. Use for troubleshooting only.
   */
  debug?: boolean;
}

/** Any user_event payload. The agent can define any `type` field it wants. */
export interface UserEventPayload {
  type: string;
  [key: string]: unknown;
}

/**
 * Detail shape for the cancelable `signalwire-address:beforedial` CustomEvent.
 * Host calls `setUserVariables(obj)` to merge additional fields into the
 * call's user variables before dial. Host calls `preventDefault()` to abort.
 */
export interface BeforeDialDetail {
  /** Shallow-merged into existing userVariables before dial. */
  setUserVariables: (vars: Record<string, unknown>) => void;
}

/** Detail shape for `signalwire-address:call-joined` and `:call-left`. */
export interface CallEventDetail {
  call: Call;
}
