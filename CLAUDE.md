# CLAUDE.md

Dev notes for future Claude sessions working on `@signalwire/address-widget`.

## What this is

Embeddable call widget. Consumer pastes a `<script>` tag + one JS expression and a `<div>` on their page becomes a launcher that opens a full-viewport video/audio call to a SignalWire address.

Built on the new SDK at `../signalwire-typescript-web` (package `@signalwire/js` v3.30.x) plus `@signalwire/web-components` (Lit components for video + controls).

## Public API shapes (all three)

```html
<!-- 1. Programmatic mount -->
<div id="t"></div>
<script src=".../address-widget.umd.js"></script>
<script>SignalWireAddressWidget.mount('#t', { token, destination });</script>

<!-- 2. Declarative -->
<signalwire-address token="..." destination="/public/agent" label="Call">

<!-- 3. ESM -->
import { mount } from '@signalwire/address-widget';
```

## Naming (locked)

- Package: `@signalwire/address-widget`
- Element: `<signalwire-address>`
- UMD global: `SignalWireAddressWidget`
- CSS var prefix: `--sw-address-*`
- Shadow parts: `launcher`, `overlay`, `close`, `video-frame`, `local-preview`, `controls`, `hangup`, `transcript`, `bubble`, `bubble-ai`, `bubble-user`, `content-drawer`, `content-drawer-header`, `content-drawer-body`

## Event subscription rule

Use `call.subscribe(eventType)` for each server event type we care about (`ai.partial_result`, `ai.speech_detect`, `ai.response_utterance`, `ai.completion`, `user_event`). This sends `verto.subscribe` for that type. Do **not** filter the general `callEvent$`/`signalingEvent$` stream.

Reference: `packages/main/src/core/entities/Call.ts:1078` in the SDK.

## Brand rules (non-negotiable)

- Colors locked: Blue #044EF4, Fuchsia #F72A72, Purple #601BE6, Turquoise #40E0D0, Gold #FFD700
- Fonts: Instrument Sans (headings), Lexend (body), JetBrains Mono (code)
- Dark-mode-first, neutral headings, 60-30-10
- Fuchsia for emphasis only (launcher, content-drawer edge), turquoise for positive active states only, gold for warnings only
- Mobile-first, 48px min touch targets

## Progressive disclosure

The transcript panel and content drawer are **hidden until the first relevant event arrives**. Non-AI destinations stay clean (just video + controls); AI destinations reveal the UI as events flow.

## Local self-preview

Rendered by us directly in `src/components/video-frame.ts`, NOT via `<sw-self-media>`. The web-component variant relies on `call.layoutLayers$` (MCU positioning data) which 1:1 calls without a mixed layout never populate, so it draws nothing in our typical case. We bind our own `<video>` element to `call.localStream$` via a Lit `ref` and position it as a picture-in-picture overlay in the bottom-right of the video frame.

`<sw-call-media>` is still used for the remote stream.

## Mute fallback

`self.mute()` in the SDK attempts the server-side `call.mute` RPC first. If the token lacks the scope (403) the SDK's `finally` block still disables the local audio track via `vertoManager.muteMainAudioInputDevice()`. But `audioMuted$` only emits on server-side acceptance, so relying on it alone leaves the UI stuck.

Our toggles flip `_audioMuted` / `_videoMuted` optimistically on click. The observable subscription still runs; if it fires later it just re-asserts the same value.

## Controls

We own `src/components/controls.ts` — a three-button dock (mic, camera, end) with native Popover API device pickers. Do **not** switch back to `<sw-call-controls>`: it forces mute via `call.mute` RPC only, which breaks on 403, and its screen-share button isn't useful for calls to AI agents.

## Layout logic

`_isStacked() = layout === 'stacked' || !video`. When true, overlay-body is flex-column (video/poster on top, transcript below, controls dock absolute at the bottom). When false, overlay-body is flex-row on desktop (video + transcript sidebar) and still column on mobile via media query.

Transcript is **not** absolute-positioned anymore — it's a flex sibling so it pushes the video frame narrower instead of overlaying it.

## Security

- Token is passed at mount and never persisted by the widget
- `display_content` events with `format: html` go through DOMPurify allowlist
- Markdown parsed with a safe subset (no raw HTML pass-through)
- Code highlighted after escaping

## Build

- `npm run dev` — vite serves demo/index.html with HMR
- `npm run build` — outputs `dist/address-widget.umd.js` + `.mjs` + `.d.ts`
- UMD is self-contained; consumer pastes the built file on any URL (localhost, CDN, wherever) and it works
