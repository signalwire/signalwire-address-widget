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
  /** SignalWire Subscriber Access Token (SAT). Required. */
  token: string;
  /** Address to dial, e.g. `/public/my-agent` or a full fabric address. Required. */
  destination: string;
  /** Launcher label text when the attached div has no content of its own. */
  label?: string;
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
   * boosts up to 2× at 200 (the SDK's cap). Clamped to [0, 200].
   *
   * Applied locally via `call.setLocalMicrophoneGain` (Web Audio
   * GainNode in front of the RTCRtpSender) once getUserMedia delivers
   * a local stream. No server round-trip and no scope requirements —
   * works on any token. Not to be confused with
   * `participant.setAudioInputVolume`, which is FreeSWITCH-side channel
   * mix volume and was the wrong API for client-side gain control.
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
