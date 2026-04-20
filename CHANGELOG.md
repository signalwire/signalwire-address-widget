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
