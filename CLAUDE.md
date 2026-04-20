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
- Shadow parts: `launcher`, `overlay`, `video-frame`, `transcript`, `bubble`, `bubble-ai`, `bubble-user`, `content-drawer`, `content-drawer-header`, `content-drawer-body`, `hangup`, `close`

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

## Security

- Token is passed at mount and never persisted by the widget
- `display_content` events with `format: html` go through DOMPurify allowlist
- Markdown parsed with a safe subset (no raw HTML pass-through)
- Code highlighted after escaping

## Build

- `npm run dev` — vite serves demo/index.html with HMR
- `npm run build` — outputs `dist/address-widget.umd.js` + `.mjs` + `.d.ts`
- UMD is self-contained; consumer pastes the built file on any URL (localhost, CDN, wherever) and it works
