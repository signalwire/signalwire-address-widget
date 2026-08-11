# @signalwire/address-widget

Embeddable SignalWire conversation widget. Attach it to any `<div>` and that div becomes a launcher that opens a full-viewport (or corner-panel) overlay connecting the visitor to a SignalWire address — by **voice/video call**, by **text chat**, or by both with live switching between them mid-conversation.

- One script tag, one JS expression, self-contained UMD bundle — no build step required
- Works on any URL (localhost, CDN, your own static host)
- Voice/video calls over WebRTC, text chat over a `ChatGateway`, or both in one widget
- Switch medium mid-conversation without losing context
- Reveals a transcript panel, content drawer, and other UI progressively, only when the agent actually uses them
- Mobile-first, 48px touch targets, theme-compliant to SignalWire brand tokens
- Styleable via CSS custom properties and `::part()` selectors

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Modes: voice, chat, both](#modes-voice-chat-and-both)
- [Option reference](#option-reference)
  - [Core](#core)
  - [Media](#media)
  - [Chat](#chat)
  - [Presentation and layout](#presentation-and-layout)
  - [Consent](#consent)
  - [Session and identity](#session-and-identity)
  - [Callbacks](#callbacks-programmatic-only)
- [Layouts and presentation](#layouts-and-presentation)
- [Switching medium mid-conversation](#switching-medium-mid-conversation)
- [Type-to-talk](#type-to-talk)
- [Chat persistence and call reattach](#chat-persistence-and-call-reattach)
- [Recording consent](#recording-consent)
- [Audio processing](#audio-processing)
- [Passing data to the agent](#passing-data-to-the-agent)
- [Programmatic API](#programmatic-api)
- [Events](#events)
- [Styling](#styling)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Install

### CDN (UMD)

```html
<script src="https://<your-host>/address-widget.umd.js"></script>
```

Drops a `SignalWireAddressWidget` global and registers the `<signalwire-address>` custom element as a side effect. The bundle is self-contained — no peer dependencies, no CDN imports at runtime.

### npm (ESM)

```bash
npm install @signalwire/address-widget
```

```ts
import { mount, unmount, VERSION } from '@signalwire/address-widget';
```

Importing anything from the package registers the element.

---

## Quick start

### Voice call (the default)

```html
<div id="call"></div>

<script src="https://<your-host>/address-widget.umd.js"></script>
<script>
  SignalWireAddressWidget.mount('#call', {
    token: '<SAT-token>',
    destination: '/public/my-agent'
  });
</script>
```

`token` is a SignalWire Subscriber Access Token. Mint it server-side and hand it to the page — the widget never persists it.

### Declarative custom element

```html
<signalwire-address
  token="<SAT-token>"
  destination="/public/my-agent"
  label="Talk to sales"
></signalwire-address>

<!-- Slotted content replaces the label entirely -->
<signalwire-address token="..." destination="/public/my-agent">
  <img src="/avatar.png" alt="" /><span>Book a call</span>
</signalwire-address>
```

### Text chat

Chat does not use a SAT or WebRTC. It talks to a `ChatGateway` you mount with the SignalWire Python SDK (`signalwire.ai_chat`), which holds the real credential server-side. The `chat-key` is a *publishable* key — safe to paste into the page.

```html
<signalwire-address
  mode="chat"
  gateway-url="https://your-agent.example.com/chat"
  chat-key="<publishable-key>"
  label="Chat with us"
></signalwire-address>
```

### Both, with the visitor choosing

```html
<signalwire-address
  mode="both"
  default-mode="ask"
  token="<SAT-token>"
  destination="/public/my-agent"
  gateway-url="https://your-agent.example.com/chat"
  chat-key="<publishable-key>"
  label="Get in touch"
></signalwire-address>
```

The overlay opens on a two-choice screen — **Talk** or **Type** — and nothing is spent and no microphone is requested until the visitor picks. Once in either medium, a switch button offers the other.

---

## Modes: voice, chat, and both

`mode` selects which transports the widget offers.

| `mode` | Requires | Behaviour |
|---|---|---|
| `voice` *(default)* | `token` + `destination` | WebRTC audio/video call. No chat code paths run at all. |
| `chat` | `gateway-url` + `chat-key` | Text only. No SAT, no media, no microphone permission. |
| `both` | all four | Offers each; `default-mode` picks what happens on open. |

`default-mode` (only meaningful when `mode="both"`):

| `default-mode` | On launcher click |
|---|---|
| `voice` *(default)* | Dials immediately. |
| `chat` | Opens the chat composer immediately. |
| `ask` | Shows the medium picker and commits to nothing until the visitor chooses. |

A picker option is hidden when its medium isn't actually configured, so a `mode="both"` widget missing a `chat-key` degrades to a voice-only launcher rather than offering a button that fails.

> **Chat is enabled only when `mode` includes chat *and* both `gateway-url` and `chat-key` are set.** Setting `mode="both"` alone changes nothing. This is deliberate — it means a half-configured widget behaves exactly like a voice-only one instead of half-working.

---

## Option reference

Every option is available three ways: as a **kebab-case attribute**, as a **camelCase property**, and as a key in the `mount()` options object. The property name is also the `mount()` key, with one exception noted in the table (`user-variables`).

Boolean attributes accept `="false"` and `="0"` as opt-outs; bare presence (`video`) or an empty value (`video=""`) means on.

### Core

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `token` | `token` | string | — | SignalWire Subscriber Access Token. Required for voice. Never persisted by the widget. Not reflected back to the DOM. |
| `destination` | `destination` | string | — | Address to dial, e.g. `/public/my-agent` or a full fabric address. Required for voice. |
| `label` | `label` | string | `"Start call"` | Launcher text when the host provides no slotted content. |
| `mode` | `mode` | `voice` \| `chat` \| `both` | `voice` | Which transports to offer. See [Modes](#modes-voice-chat-and-both). |
| `default-mode` | `defaultMode` | `voice` \| `chat` \| `ask` | `voice` | Which medium opens first when `mode="both"`. `ask` shows the picker. |
| `theme` | `theme` | `dark` \| `light` | `dark` | Color theme. |
| `debug` | `debug` | boolean | `false` | Verbose diagnostics — sets SDK `logLevel: 'debug'` and logs every WebSocket frame, plus traces chat gateway calls. Noisy; troubleshooting only. |

### Media

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `video` | `video` | boolean | `true` | Enable outgoing video. When off, the camera is never requested, the camera control is hidden, the overlay stacks rather than using a sidebar, and the video area collapses unless `poster` is set. |
| `audio` | `audio` | boolean | `true` | Enable outgoing audio. |
| `poster` | `poster` | string (URL) | — | Image in the video area. In video mode it's the pre-call poster; in audio-only mode it's the only visual element. Omit in audio-only mode to collapse the area entirely. |
| `show-local-video` | `showLocalVideo` | boolean | `true` | Local self-view picture-in-picture inside the video frame. |
| `echo-cancellation` | `echoCancellation` | boolean | `true` | Browser echo cancellation on the outgoing mic. |
| `noise-suppression` | `noiseSuppression` | boolean | `true` | Browser noise suppression. |
| `auto-gain-control` | `autoGainControl` | boolean | `true` | Browser automatic gain control. |
| `input-volume` | `inputVolume` | number (0–200) | — | Outgoing mic gain as a percentage. `100` = unity, `200` = 2× (the SDK cap). Applied locally via a Web Audio `GainNode` — no server round-trip, no token scope needed. |

#### Audio-only mode

```html
<!-- No camera, no video area — controls, transcript, and content drawer only -->
<signalwire-address token="..." destination="/public/agent" video="false"></signalwire-address>

<!-- Or with a branded image standing in for the video area -->
<signalwire-address
  token="..."
  destination="/public/agent"
  video="false"
  poster="https://example.com/logo.png"
></signalwire-address>
```

```js
SignalWireAddressWidget.mount('#t', { token, destination, video: false });
```

### Chat

All chat options are inert unless [chat is enabled](#modes-voice-chat-and-both).

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `gateway-url` | `gatewayUrl` | string | `""` | URL of a `ChatGateway` mounted by the SignalWire Python SDK. Required for chat. |
| `chat-key` | `chatKey` | string | `""` | Publishable key, sent as `Authorization: Bearer`. Safe in the page — the gateway holds the real credential and pins `config_url` server-side. Not reflected to the DOM. |
| `avatar-url` | `avatarUrl` | string | — | Image shown beside each agent reply. Scaled to fit the circle whole rather than cropped, so a logo with its own margins survives. |
| `chat-placeholder` | `chatPlaceholder` | string | `"Type a message..."` | Composer placeholder in chat mode. |
| `type-to-talk` | `typeToTalk` | boolean | `false` | Allow typing during a **voice** call. See [Type-to-talk](#type-to-talk). |
| `type-to-talk-placeholder` | `typeToTalkPlaceholder` | string | `"Or type…"` | Composer placeholder during a voice call when `type-to-talk` is on. |
| `chat-persistence` | `chatPersistence` | boolean | `true` | Resume a chat across a page reload by storing the conversation handle in `sessionStorage`. |
| `chat-auto-open` | `chatAutoOpen` | boolean | `true` | Reopen the widget automatically when a reload resumes a live conversation. Fires once per conversation, so closing it afterwards sticks. |
| `chat-storage-key` | `chatStorageKey` | string | `"sw-chat-handle"` | `sessionStorage` key for the handle. Change only when running two chat widgets on one origin. |
| `chat-always-new` | `chatAlwaysNew` | boolean | `false` | Ignore any stored handle and always start a fresh conversation. |
| `chat-end-on-close` | `chatEndOnClose` | boolean | `false` | End the conversation server-side when the overlay closes, instead of leaving it resumable. |
| `chat-timeout-seconds` | `chatTimeoutSeconds` | number | `3600` | Idle seconds after which the service ends the conversation. Mirror whatever the gateway is configured with — the widget uses it to show an expiry notice and stop offering resume. |

### Presentation and layout

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `presentation` | `presentation` | `immersive` \| `panel` | `immersive` | Full-viewport takeover, or a corner window. See [Layouts](#layouts-and-presentation). |
| `position` | `position` | `bottom-right` \| `bottom-left` \| `top-right` \| `top-left` | `bottom-right` | Corner anchoring for `presentation="panel"`. Ignored when immersive. |
| `layout` | `layout` | `auto` \| `stacked` | `auto` | `auto` = transcript sidebar on desktop when video is on, stacked on mobile/audio-only. `stacked` = always top-to-bottom. |

### Consent

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `consent-required` | `consentRequired` | boolean | `true` | Show a pre-call consent + device-setup modal before each fresh dial. See [Recording consent](#recording-consent). |
| `consent-version` | `consentVersion` | number | `2` | Policy version tag on the stored record. Bump it when your copy or scope materially changes so existing consent invalidates and users see the new prompt. |

### Session and identity

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `auto-identify` | `autoIdentify` | boolean | `true` | Auto-populate `capabilities` and `metadata` into userVariables at dial time. See [Passing data to the agent](#passing-data-to-the-agent). |
| `user-variables` | `userVariablesAttr` | JSON string / object | `{}` | Arbitrary data passed to the destination. Note the property name differs from the attribute. |
| `widget-id` | `widgetId` | string | auto | Stable id scoping this widget's `sessionStorage` entries. Defaults to `address-widget-<N>` by document order. Set it explicitly when the widget's DOM position can shift between reloads (CMS layouts, dynamic lists). |
| `auto-reattach` | `autoReattach` | boolean | `true` | Reattach to a live call after a page reload. See [reattach](#chat-persistence-and-call-reattach). |
| `node-id` | `nodeId` | string | — | Advanced/dev-only. Pin fresh dials to a specific FreeSWITCH node. Leave unset in production. |

### Callbacks (programmatic only)

Assign as properties, or pass to `mount()`. Each has a matching CustomEvent if you'd rather listen than assign.

| Property | Signature | Fires |
|---|---|---|
| `onEvent` | `(event: UserEventPayload) => void` | Every `user_event` the widget doesn't handle itself. |
| `onSidecarEvent` | `(event: UserEventPayload) => void` | Every `calling.ai.sidecar` event, including ones the widget also handles. |
| `onConsentGiven` | `(record) => void` | The user accepted the consent prompt. Receives the persisted record. |

---

## Layouts and presentation

**`presentation`** controls the surface; **`layout`** controls the arrangement inside it.

```html
<!-- Full-viewport takeover (default), for both mediums. -->
<signalwire-address presentation="immersive" ...></signalwire-address>

<!-- Corner window — the familiar support-chat shape. -->
<signalwire-address
  presentation="panel"
  position="bottom-right"
  mode="chat"
  ...
></signalwire-address>
```

Panel size comes from two CSS custom properties:

```css
signalwire-address {
  --sw-address-panel-width: 400px;   /* default */
  --sw-address-panel-height: 640px;  /* default */
}
```

Panels collapse to full-screen below the mobile breakpoint regardless of these values — a 400px window on a phone is not a window. The tokens are inert in `immersive` mode.

**`layout`** picks how video and transcript share the space:

```html
<!-- auto (default): sidebar transcript on desktop when video is on, stacked on mobile -->
<signalwire-address token="..." destination="..."></signalwire-address>

<!-- stacked: always top-to-bottom — smaller video on top, transcript flowing below -->
<signalwire-address layout="stacked" token="..." destination="..."></signalwire-address>
```

The transcript is a flex sibling, not an overlay, so in sidebar mode it makes the video narrower rather than covering it.

---

## Switching medium mid-conversation

With `mode="both"` and both transports configured, the overlay shows a switch affordance: **Switch to text** during a call, **Start a call** during a chat. The visitor stays in the same overlay and the same transcript — the turns already on screen stay on screen.

The model can also initiate a switch (e.g. a `switch_to_chat` tool on the agent side) by emitting a `chat_handoff` user event.

### What your agent needs to implement

The widget never learns its own conversation id. Continuity rides on **opaque, HMAC-signed handles** minted server-side, so a stolen publishable key plus a guessed id can't resume someone else's conversation. That means the agent side owns three HTTP routes on the gateway origin and reads two userVariables.

**userVariables the widget sends on every dial** (when chat is configured):

| Key | When | Meaning |
|---|---|---|
| `handoff_nonce` | every dial | A random single-use id for *this call*. The agent stores it against the call so the browser can later prove which call it's on without naming a conversation. |
| `chat_handle` | chat → voice only | The handle of the chat conversation being continued. The agent verifies it with its own gateway and recovers the conversation to seed the call. |

**Routes on the gateway origin:**

| Route | Body | Returns | Called when |
|---|---|---|---|
| `POST {gateway-url}/handoff` | `{ nonce }` | `{ handle }` | Visitor pressed **Switch to text**. Redeem the nonce (single-use), end the call server-side so its post-prompt fires immediately, and mint a chat handle for the same conversation. |
| `POST {gateway-url}/escalate` | `{ handle }` | any 2xx | Visitor pressed **Start a call** from chat. End the chat leg and write its record **before returning** — the widget waits on this call before dialing, so the new call's SWML fetch doesn't race a summary that's still seconds away. |
| `POST {gateway-url}/say` | `{ nonce, text }` | any 2xx | A typed message during a voice call. See [Type-to-talk](#type-to-talk). |

**`chat_handoff` user event** — for a model-initiated voice → chat switch:

```python
result.swml_user_event({
    "type": "chat_handoff",
    "handle": "<signed handle from your gateway>"
})
```

Deliberately **do not hang up** when emitting this. A server-side hangup can beat the event to the browser and the handoff is lost with no way to recover it. The widget owns the teardown ordering: it receives the handle, tears the call down itself, then adopts the handle.

**Gating the model's tool.** The widget reports `capabilities.chat_handoff` at dial time (see [capabilities](#capabilities)). Use it to decide whether the `switch_to_chat` tool exists at all for a given caller, so a PSTN caller is never offered a browser they don't have.

If a `chat_handoff` arrives at a widget with no chat configured, the widget warns in the console and shows the visitor a "Text chat is not available here" banner rather than silently dropping the call.

---

## Type-to-talk

Lets the caller type during a **voice** call — useful for spelling out an email address, a postcode, or an order number that ASR keeps mangling.

```html
<signalwire-address
  mode="both"
  type-to-talk
  type-to-talk-placeholder="Or type your order number…"
  gateway-url="https://your-agent.example.com/chat"
  token="..."
  destination="..."
></signalwire-address>
```

The typed text is POSTed to `{gateway-url}/say` with the call's `handoff_nonce`, and your agent injects it into the live conversation (in the SignalWire Python SDK, `client.calling.ai_message`).

Two things worth knowing:

- **Needs `gateway-url` but not `chat-key`.** That route authorizes on the per-call nonce, because what it must prove is "you are on this call" — not "you may talk to this agent".
- **The widget does not echo the message locally.** The engine inserts the injected text into the conversation itself and it returns down the same event stream a spoken turn would. Echoing it here rendered every typed message twice.

---

## Chat persistence and call reattach

Two independent mechanisms, one per medium.

**Chat** (`chat-persistence`, default on) stores the signed handle in `sessionStorage` under `chat-storage-key`. On load the widget performs a free `log` read — not a conversation open, which would be billable — and if the conversation is still live it restores the transcript. With `chat-auto-open` (default on) it also reopens the overlay, once per conversation.

**Voice** (`auto-reattach`, default on) records in `sessionStorage` that this `widget-id` had a live call. On reload the widget connects its client, waits for the server-pushed `verto.attach`, and reopens with transcript and content history rehydrated. It honors `document.visibilityState`: if the tab is hidden at reattach time, the auto-open waits until the visitor comes back rather than popping a dialog at a background tab.

Set either to `false` if surprise auto-opens don't suit your page.

```html
<signalwire-address auto-reattach="false" chat-auto-open="false" ...></signalwire-address>
```

Running two widgets on one origin? Give each its own `widget-id` and `chat-storage-key`.

---

## Recording consent

**On by default.** Before each fresh dial the widget shows a single-screen modal that explains the recording in plain language, lets the visitor opt out of video, and doubles as a device picker. The choice is persisted in `localStorage` origin-wide, so they aren't re-prompted on later dials, and a small "Recording" badge stays visible for the duration of the call.

```html
<!-- Turn it off (you are then responsible for obtaining consent yourself) -->
<signalwire-address consent-required="false" ...></signalwire-address>
```

The record is folded into `metadata.consent` on the dial so your agent can audit it:

```json
{
  "metadata": {
    "consent": { "audio": true, "train": false, "given_at": "2026-08-11T…", "version": 2 },
    "no_training": true
  }
}
```

`no_training` is lifted to the top of `metadata` deliberately — policy enforcement shouldn't depend on your SWML reading a nested shape correctly.

Bump `consent-version` whenever your copy or scope materially changes; older records stop counting and visitors see the new prompt.

---

## Audio processing

Three browser processing flags plus an input gain, all applied at dial time.

```js
SignalWireAddressWidget.mount('#t', {
  token, destination,
  autoGainControl: false,   // keep the caller's mic level predictable
  inputVolume: 60,          // 0-200, 100 = unity
  // echoCancellation: true (default)
  // noiseSuppression: true (default)
});
```

```html
<signalwire-address
  token="..."
  destination="/public/agent"
  auto-gain-control="false"
  input-volume="60"
></signalwire-address>
```

- The three flags become `getUserMedia` constraints, so they can't be changed mid-call without a new `getUserMedia` round.
- `inputVolume` is applied locally through a Web Audio `GainNode` in front of the `RTCRtpSender`. No server round-trip and no token scopes involved — it works on any token. (It is *not* `participant.setAudioInputVolume`, which is FreeSWITCH-side mix volume and the wrong API for client-side gain.)

---

## Passing data to the agent

User variables travel on the invite and are readable server-side (`result.user_data` in SWML, or `call.user_data` depending on the agent framework).

### Three ways to set them

**1. At mount time** — static values known at page load:

```js
SignalWireAddressWidget.mount('#t', {
  token, destination,
  userVariables: { plan: 'pro', accountId: '12345' }
});
```

```html
<signalwire-address user-variables='{"plan":"pro","accountId":"12345"}' ...></signalwire-address>
```

**2. At runtime**, any time before the launcher is clicked:

```js
widget.userVariablesAttr = { cart_total: 42.5, currency: 'USD' };
```

**3. Just-in-time via `beforedial`** — captured the moment the visitor clicks, so page state is fresh:

```js
widget.addEventListener('signalwire-address:beforedial', (e) => {
  e.detail.setUserVariables({
    utm_source: new URLSearchParams(location.search).get('utm_source'),
    user_id: window.currentUser?.id
  });
  // e.preventDefault() aborts the dial entirely.
});
```

Precedence, lowest to highest: auto-populated → your `userVariables` → `setUserVariables()` in `beforedial`.

### Auto-populated payloads

With `auto-identify` on (the default), the widget adds two nested objects.

#### `capabilities`

The agent-facing contract: what this widget can actually render. Read it to decide whether to push visual content or offer a handoff.

```json
{
  "capabilities": {
    "widget": "signalwire-address",
    "version": "<widget version>",
    "display_content": {
      "formats": ["text", "markdown", "code", "html"],
      "persistent": true,
      "copyable": true
    },
    "transcript": true,
    "video": true,
    "audio": true,
    "self_preview": true,
    "chat_handoff": false
  }
}
```

#### `metadata`

Session context, in three buckets:

```json
{
  "metadata": {
    "page":   { "url": "…", "title": "…", "referrer": "…" },
    "client": {
      "user_agent": "…", "platform": "macOS", "language": "en-US",
      "languages": ["en-US", "en"], "timezone": "America/New_York",
      "timezone_offset_minutes": -240,
      "viewport": { "width": 1440, "height": 900 },
      "device_pixel_ratio": 2, "touch": false, "online": true,
      "cookies_enabled": true, "hardware_concurrency": 8,
      "prefers_dark": true, "prefers_reduced_motion": false
    },
    "widget": {
      "version": "<widget version>", "opened_at": "2026-08-11T…",
      "theme": "dark", "layout": "auto", "audio_only": false
    }
  }
}
```

Set `auto-identify="false"` to send neither. Consent, when given, is still attached under `metadata.consent`.

---

## Programmatic API

```ts
import { mount, unmount } from '@signalwire/address-widget';

// Every documented option is accepted here, chat included.
const widget = mount('#call', {
  mode: 'both',
  defaultMode: 'ask',
  token,
  destination,
  gatewayUrl: 'https://your-agent.example.com/chat',
  chatKey: '<publishable-key>',
  typeToTalk: true
});

// Chat-only needs no token or destination.
const chatOnly = mount('#help', {
  mode: 'chat',
  gatewayUrl: 'https://your-agent.example.com/chat',
  chatKey: '<publishable-key>',
  presentation: 'panel',
  position: 'bottom-right'
});

// Lifecycle
await widget.open();          // open the overlay (dials, or shows the picker)
await widget.close();         // close the overlay and tear down the transport
await widget.hangup();        // end the whole conversation, then close

// Medium switching
await widget.switchToChat();  // voice → text (needs a live call + configured chat)
await widget.switchToVoice(); // text → voice (needs an active chat + token)

// Change options at runtime; reflecting properties update the DOM attribute
widget.destination = '/public/other';
widget.theme = 'light';
widget.layout = 'stacked';
widget.showLocalVideo = false;
widget.gatewayUrl = 'https://other-agent.example.com/chat';

// Tear down and remove from the DOM
await unmount(widget);
```

`close()` and `hangup()` differ in intent, not just scope. `close()` dismisses the overlay and releases the transport, leaving a chat conversation resumable on the next open or reload. `hangup()` treats the conversation as finished — it ends the chat session server-side too and forgets the last-active medium, so a reload starts fresh rather than resuming something the visitor deliberately ended. The in-call **End** button calls `hangup()`.

`mount()` moves any existing children of the target element into the widget, so a `<div>` that already contains your own icon or label keeps it as launcher content.

### TypeScript exports

```ts
import {
  mount,
  unmount,
  AddressWidget,            // the custom-element class
  VERSION,
  type WidgetOptions,
  type Theme,               // 'dark' | 'light'
  type DisplayContentPayload,
  type UserEventPayload,
  type BeforeDialDetail,    // detail on the cancelable beforedial event
  type CallEventDetail      // detail on call-joined / call-left
} from '@signalwire/address-widget';
```

> `WidgetOptions` covers every option including chat, so `mount()` is fully typed. The `Layout`, `Mode`, `Presentation`, and `PanelPosition` unions are defined in `src/types.ts` but not yet re-exported from the package entry point — you don't need them to call `mount()` (string literals infer correctly), only to name one in your own signatures.

---

## Events

All events bubble and cross shadow boundaries (`bubbles: true, composed: true`), so you can listen on the widget or any ancestor.

| Event | Cancelable | Detail | Fires when |
|---|---|---|---|
| `signalwire-address:beforedial` | yes | `{ setUserVariables(vars) }` | Launcher clicked, about to dial. `preventDefault()` aborts; `setUserVariables({...})` merges vars. |
| `signalwire-address:call-joined` | no | `{ call }` | Call created and dialing/connected. |
| `signalwire-address:call-left` | no | `{ call }` | Call ended or overlay closed. |
| `signalwire-address:consent-given` | no | consent record | Visitor accepted the consent prompt. |
| `signalwire-address:event` | no | `{ type, ...payload }` | Any `user_event` the widget doesn't handle itself. |
| `signalwire-address:sidecar` | no | `{ type, ...payload }` | Every `calling.ai.sidecar` event, including handled ones. |

```js
const widget = document.querySelector('signalwire-address');

widget.addEventListener('signalwire-address:beforedial', (e) => {
  e.detail.setUserVariables({ plan: 'pro', source: 'docs-page' });
});

widget.addEventListener('signalwire-address:event', (e) => {
  if (e.detail.type === 'cart_updated') updateCart(e.detail);
});
```

For the full schema of events your agent can send — transcript events, `display_content`, custom pass-through — see [EVENTS.md](./EVENTS.md). For how the widget consumes them internally, see [CHAT_EVENTS.md](./CHAT_EVENTS.md).

---

## Styling

Shadow DOM with SignalWire brand defaults. Theme with CSS custom properties set on the element; restructure with `::part()`.

### CSS custom properties

**Color**

| Property | Default (dark) | Purpose |
|---|---|---|
| `--sw-address-accent` | `#f72a72` | Fuchsia emphasis — launcher, drawer edge. Emphasis only. |
| `--sw-address-accent-strong` | — | Pressed/hover accent. |
| `--sw-address-accent-glow`, `--sw-address-accent-glow-strong` | — | Accent halos. |
| `--sw-address-brand-blue` | `#044ef4` | Primary control fill. |
| `--sw-address-brand-purple` | `#601be6` | Secondary brand. |
| `--sw-address-positive` | `#40e0d0` | Turquoise — active/AI-speaking states only. |
| `--sw-address-warning` | `#ffd700` | Gold — warnings only. |
| `--sw-address-danger` | `#ef4444` | Hangup / destructive. |

**Surface and text**

| Property | Default (dark) | Purpose |
|---|---|---|
| `--sw-address-bg-page` | `#0e0e18` | Overlay background. |
| `--sw-address-bg-surface` | `#181a28` | Transcript, panels. |
| `--sw-address-bg-raised` | `#222436` | Controls dock, drawer, bubbles. |
| `--sw-address-bg-subtle`, `--sw-address-bg-overlay` | — | Scrims and subtle fills. |
| `--sw-address-fg-default` | `#f0f0f4` | Primary text. |
| `--sw-address-fg-headings` | — | Headings (neutral by brand rule). |
| `--sw-address-fg-secondary`, `--sw-address-fg-muted`, `--sw-address-fg-subtle` | — | Text hierarchy. |
| `--sw-address-fg-on-color` | — | Text on filled buttons. |
| `--sw-address-border`, `--sw-address-border-strong` | `rgba(255,255,255,0.12)` | Separators. |

**Type, shape, motion, sizing**

| Property | Default | Purpose |
|---|---|---|
| `--sw-address-font-heading` | Instrument Sans | Headings. |
| `--sw-address-font-body` | Lexend | Body. |
| `--sw-address-font-code` | JetBrains Mono | Code. |
| `--sw-address-letter-spacing-eyebrow` | — | Eyebrow tracking. |
| `--sw-address-radius`, `--sw-address-radius-sm`, `--sw-address-radius-pill` | `12px`, —, `100px` | Corner radii. |
| `--sw-address-shadow-md`, `--sw-address-shadow-lg` | — | Elevation. |
| `--sw-address-ease`, `--sw-address-duration-fast/-enter/-exit` | — | Motion. |
| `--sw-address-gutter` | — | Overlay padding. |
| `--sw-address-transcript-width` | `340px` | Desktop transcript sidebar. |
| `--sw-address-drawer-width` | `440px` | Desktop content drawer. |
| `--sw-address-panel-width` | `400px` | `presentation="panel"` width. |
| `--sw-address-panel-height` | `640px` | `presentation="panel"` height. |
| `--sw-address-z-overlay` | `2147483000` | Overlay stacking. |
| `--sw-address-z-launcher` | — | Launcher stacking. |

### Shadow parts

| Part | Element |
|---|---|
| `launcher` | The clickable launcher button. |
| `overlay` | Overlay root. Also carries `data-presentation` and `data-position`. |
| `close` | Floating X in the overlay and drawer. |
| `picker`, `picker-voice`, `picker-chat` | Medium-choice screen and its two buttons. |
| `video`, `video-frame` | Video element and its container. |
| `local-preview` | Self-view picture-in-picture. |
| `controls` | Floating button dock. |
| `hangup` | Destructive end-call pill. |
| `transcript` | Transcript panel. |
| `bubble`, `bubble-ai`, `bubble-user` | Individual chat bubbles. |
| `notice` | System notices in the transcript (timeouts, medium switches). |
| `insight` | Sidecar insight rows. |
| `composer`, `composer-input`, `composer-send`, `composer-end` | Text composer and its controls. |
| `switch-to-chat`, `switch-to-voice` | Medium-switch affordances. |
| `content-chip` | Minimized `display_content` chip in the transcript. |
| `content-drawer`, `content-drawer-header`, `content-drawer-body` | Slide-in content panel. |
| `banner` | Transient status banner. |
| `consent-modal`, `consent-badge` | Pre-call consent screen and the in-call recording badge. |

```css
/* Match the launcher to your site's button shape */
signalwire-address::part(launcher) {
  border-radius: 4px;
  background: linear-gradient(135deg, #1a1a2e, #0f1022);
  padding: 14px 28px;
}

/* Light theme overrides */
signalwire-address[theme='light'] {
  --sw-address-accent: #c62e5c;
  --sw-address-bg-page: #ffffff;
  --sw-address-fg-default: #111;
}
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Chat options set but nothing changes | Chat needs `mode` including chat **and** `gateway-url` **and** `chat-key`. Any one missing and the widget stays voice-only, silently and on purpose. |
| No transcript panel appears | It's progressive — it stays hidden until the first AI event arrives. A non-AI destination shows just video and controls, by design. |
| Chat doesn't resume after reload | `chat-persistence` off, `chat-always-new` on, the conversation exceeded `chat-timeout-seconds`, or the handle was stored under a different `chat-storage-key`. |
| Two widgets on a page fight over resume | Give each its own `widget-id` and `chat-storage-key`. |
| Switch-to-text button never appears | It requires all of: `mode="both"`, a live call, chat fully configured, and a `handoff_nonce` on the dial. The nonce is only minted when chat is enabled *at dial time* — configuring chat after the call started is too late for that call. |
| Mute button appears stuck | It isn't — the widget flips mute state optimistically because `audioMuted$` only emits on server-side acceptance, and `call.mute` 403s on tokens without the scope. The local track is still disabled. |
| `input-volume` seems ignored | It's a percentage where `100` is unity, not a 0–100 scale. `100` is a no-op. |

Turn on `debug` for verbose SDK logging, every WebSocket frame, and chat gateway call traces.

---

## Development

```bash
npm install
npm run dev         # Vite dev server with HMR on demo/index.html
npm run build       # UMD + ESM + type declarations → dist/
npm test            # Vitest unit tests
npm run type-check
```

Build outputs:

- `dist/address-widget.umd.js` — CDN bundle, drops the `SignalWireAddressWidget` global
- `dist/address-widget.mjs` — ESM bundle
- `dist/address-widget.d.ts` — type declarations
- `dist/index.html` — static demo page loading the UMD bundle

### Local demo defaults

The demo page can prefill token, destination, and chat config from a local-only file so you're not pasting the same values on every reload:

```bash
cp demo/defaults.example.js demo/defaults.local.js
# edit demo/defaults.local.js
```

`demo/defaults.local.js` is gitignored and copied into `dist/` on build, so your own previews get the same convenience without shipping credentials.

---

## Browser support

Modern evergreen browsers with WebRTC: Chrome/Edge 90+, Firefox 90+, Safari 14.1+, Mobile Safari, Chrome for Android. Chat mode has no WebRTC requirement and works anywhere `fetch` and custom elements do.

## License

MIT
