# Changelog

## 0.2.0

Minor rather than patch: this adds public API, not only fixes.

### Added

- **Text chat transport** with live voice/chat switching — `mode`,
  `default-mode`, `gateway-url`, `chat-key`, `presentation`, `position`,
  `type-to-talk` and the `chat-*` family. Off by default: `mode` is `voice`,
  and chat additionally requires BOTH `gateway-url` and `chat-key`, so an
  existing `token` + `destination` embed reaches none of it.
- **`mic-check`** (default true) — a live level meter on the pre-call setup
  screen. A microphone that is present but silent satisfies `getUserMedia`
  completely, so the only way to reveal one is to show the samples. Set
  `mic-check="false"` to keep the permission prompt at dial time instead of
  the setup screen.
- Mid-call dead-microphone warning after five seconds of silence while
  unmuted.

### Fixed

- **A remembered device is now applied to the DeviceController**, not just
  used to shape the track. Previously `selectedAudioInputDevice$` stayed null
  and the picker highlighted "default" while a different microphone was live.
- **Mid-call device changes persist**, so a switch away from a bad device
  survives to the next call instead of being silently reverted.
- The dial constraint is a preference rather than `{ exact: … }`. An unplugged
  headset no longer fails the whole call with `OverconstrainedError`; a stored
  id that no longer resolves is dropped rather than retried forever.
- The device chevrons are no longer disabled when the list is empty — it is
  usually empty only because enumeration ran before permission was granted,
  and disabling it there strands the caller with no way to reach the picker.

## Unreleased

### Fixed

- **`video="false"` / `audio="false"` now actually turn those off.** Both
  properties used Lit's built-in Boolean converter, where any attribute
  presence resolves to `true` — so the audio-only mode documented since 0.1.0
  silently kept the camera on for anyone configuring it declaratively. They now
  use the same `boolDefaultTrue` converter every other default-true boolean on
  the element already used, accepting `"false"` and `"0"` as opt-outs while
  leaving bare presence (`video`) and `video=""` meaning on. Consumers who set
  `video: false` programmatically were never affected.
- **`mount()` accepts every option again.** `WidgetOptions` and `mount()` had
  drifted behind the element: the entire chat surface (`mode`, `gatewayUrl`,
  `chatKey`, `defaultMode`, `presentation`, `position`, `typeToTalk`, and the
  `chat*` family) plus `widgetId` and `autoReattach` were declared on
  `<signalwire-address>` but neither typed nor forwarded, so a programmatic
  consumer could only reach them by assigning properties after mounting.
- `token` and `destination` are now optional in `WidgetOptions`. They are still
  required for voice, but `mode: 'chat'` never dials, and requiring them made a
  chat-only `mount()` call a type error.

### Documentation

- README rewritten as a comprehensive usage guide: all three modes, the full
  option reference, medium switching, type-to-talk, persistence and reattach,
  consent, troubleshooting. Twenty-one previously undocumented options added,
  along with the complete CSS custom property and shadow part lists.
- EVENTS.md gained the agent-side contract for medium switching (the
  `handoff_nonce` / `chat_handle` userVariables, the three gateway routes, and
  the `chat_handoff` event) and the `capabilities` / `metadata` payloads sent
  at dial time.
- Corrected stale JSDoc: `consentRequired` defaults to `true` (not `false`),
  `consentVersion` to `2` (not `1`), and `hangup()` closes the overlay and ends
  any chat session rather than "keeping the overlay open".

## 0.1.0 — initial release

First scaffold of `@signalwire/address-widget`. Embeddable call widget that
attaches to any `<div>` and opens a full-viewport overlay to a SignalWire
address.

### Included

- `<signalwire-address>` custom element plus `mount()` / `unmount()` APIs
- Self-contained UMD + ESM bundles (`address-widget.umd.js`, `address-widget.mjs`)
- Full-viewport overlay with entry/exit motion anchored to the launcher
- Video frame wrapping `<sw-call-media>` with pre-call poster and live-state rings
- Mobile layout: video anchored top, transcript below, controls dock floating
- Custom controls dock: split mic + camera buttons (toggle mute + device picker)
  and a destructive end-call pill
- Transcript panel driven by a partial-reconciliation FSM covering AI and user
  speech events (`ai.partial_result`, `ai.speech_detect`, `ai.response_utterance`,
  `ai.completion`)
- Content drawer for `display_content` user events with text, markdown, code
  (Prism highlighter), and sanitized HTML formats
- Outbound CustomEvents: `signalwire-address:beforedial` (cancelable with
  `setUserVariables`), `:call-joined`, `:call-left`, `:event`
- Brand tokens mapped to `--sw-address-*` CSS custom properties; shadow parts
  for launcher, overlay, video frame, controls, transcript, bubbles, content
  drawer, close, hangup
- Dark mode default; opt-in light mode via `theme="light"` attribute
- Audio-only mode via `video="false"` / `video: false`: camera control hidden,
  video area collapses entirely unless a `poster` image URL is provided
- New `layout` option accepting `"auto"` (default) or `"stacked"` — stacked
  forces a top-to-bottom layout on every screen size with a capped smaller
  video above and transcript flowing beneath
- New `showLocalVideo` option (attribute `show-local-video`, default true) to
  suppress the local self-view overlay inside the video frame
- Local self-preview is rendered by the widget directly (own `<video>` bound
  to `call.localStream$`) rather than via `<sw-self-media>`; the web-component
  variant relies on MCU `layoutLayers$` that 1:1 calls don't populate, so the
  previous implementation never drew anything on ordinary direct calls
- Mute / unmute click flips state optimistically so the UI reflects the
  intended mute even when the server rejects `call.mute` (e.g. 403 Permission
  denied on tokens without the scope). The SDK's own local-track fallback
  handles actually disabling the track; the widget just keeps the icon in sync
- Desktop overlay uses a flex-row layout so the transcript pushes the video
  frame narrower when it appears, instead of overlaying the right edge of
  the video and clipping the self-preview
- Audio-processing options exposed at mount time: `echoCancellation`,
  `noiseSuppression`, `autoGainControl` (all default `true`, applied via
  `getUserMedia` constraints at dial), plus `inputVolume` (0–100, applied
  via `self.setAudioInputVolume` once the call has joined). Demo pages
  default to `autoGainControl: false, inputVolume: 75`.
- New `autoIdentify` option (default `true`): page-context fields
  (`page_url`, `referrer`, `page_title`, `user_agent`, `widget_opened_at`)
  are merged into `userVariables` at dial time. Consumer-supplied values
  override auto values; `beforedial.setUserVariables` wins last. Set
  `auto-identify="false"` / `autoIdentify: false` to opt out.
- In stacked layout, the content drawer now overlays the transcript area
  (absolute inset:0 inside a `.chat-region` wrapper) until the user closes
  it, instead of splitting the column with the transcript.
