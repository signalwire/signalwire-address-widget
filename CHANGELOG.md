# Changelog

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
