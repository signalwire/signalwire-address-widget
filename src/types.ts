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
   * User variables passed to the destination. The backend sees them on the
   * session (`result.user_data` in SWML). Use this for plumbing hidden
   * fields without touching attributes each call.
   */
  userVariables?: Record<string, unknown>;
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
