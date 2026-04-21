# @signalwire/address-widget

Embeddable SignalWire call widget. Attach to any `<div>` on your page; the widget turns it into a launcher button that opens a full-viewport video/audio call to a SignalWire address.

- One script tag, one JS expression, self-contained UMD bundle
- Works on any URL (localhost, CDN, your own static host)
- Mobile-friendly, 16:9 video, full-viewport overlay with ESC + close
- Local self-preview rendered as a picture-in-picture in the bottom-right of the video frame (toggle-able)
- Custom mic + camera controls with built-in device pickers; mute works even when the server rejects `call.mute`
- Reveals a transcript panel if the destination emits AI chat events
- Opens a content drawer if the destination pushes a `display_content` user event
- Theme-compliant to SignalWire brand tokens, overridable via CSS custom properties and `::part()` selectors

## Quick start

### CDN

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

### npm / ESM

```bash
npm install @signalwire/address-widget
```

```ts
import { mount } from '@signalwire/address-widget';

mount('#call', {
  token: sat,
  destination: '/public/my-agent'
});
```

### Declarative custom element

```html
<signalwire-address
  token="<SAT-token>"
  destination="/public/my-agent"
  label="Talk to sales"
></signalwire-address>

<!-- or with slotted content instead of label -->
<signalwire-address token="..." destination="...">
  <span>Book a call</span>
</signalwire-address>
```

## Options

| Option / attribute | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | — | SignalWire Subscriber Access Token. **Required.** Never persisted by the widget. |
| `destination` | `string` | — | Address to dial, e.g. `/public/my-agent`. **Required.** |
| `label` | `string` | `"Start call"` | Launcher label when no slotted content is provided. |
| `theme` | `"dark" \| "light"` | `"dark"` | Color theme for the widget UI. |
| `video` | `boolean` | `true` | Enable outgoing video. When `false`, camera is never requested, the camera control is hidden, and the video area collapses entirely (unless `poster` is provided). |
| `audio` | `boolean` | `true` | Enable outgoing audio. |
| `poster` | `string` (URL) | — | Custom poster image. In video mode it replaces the default SignalWire pre-call image. In audio-only mode (`video=false`) it's the only visual element shown; omit to collapse the video area entirely. |
| `layout` | `"auto" \| "stacked"` | `"auto"` | `auto` = sidebar on desktop when video is on, stacked on mobile/audio-only. `stacked` = always top-to-bottom with a smaller video, transcript flowing beneath, even on desktop. |
| `show-local-video` (attr) / `showLocalVideo` (option) | `boolean` | `true` | Render the local self-view overlay inside the video frame. Set to `"false"` (attribute) or `false` (option) to hide. |
| `echo-cancellation` (attr) / `echoCancellation` (option) | `boolean` | `true` | Browser echo cancellation on the outgoing mic. Set to `"false"` to capture raw audio. Applied to `getUserMedia` at dial time. |
| `noise-suppression` (attr) / `noiseSuppression` (option) | `boolean` | `true` | Browser noise suppression on the outgoing mic. Same semantics as above. |
| `auto-gain-control` (attr) / `autoGainControl` (option) | `boolean` | `true` | Browser automatic gain control. Turn off when the caller's mic level matters (music, raw recordings, keeping levels predictable for downstream processing). |
| `input-volume` (attr) / `inputVolume` (option) | `number` (0–100) | — | Initial microphone input volume. Applied via `self.setAudioInputVolume` once the call has joined. Requires the token to have the `call.microphone.volume.set` scope; without it the server returns 403 and the value is ignored (we log a warning). |
| `auto-identify` (attr) / `autoIdentify` (option) | `boolean` | `true` | Auto-populate `page_url`, `referrer`, `page_title`, `user_agent`, and `widget_opened_at` into `userVariables` at dial time. Consumer-supplied `userVariables` and `beforedial.setUserVariables` both override these by key. Set `"false"` to send nothing without explicit opt-in. |
| `user-variables` (attr) / `userVariables` (option) | JSON string / object | `{}` | Passed to the destination. Accessible server-side in SWML. |
| `onEvent` (option) | `(e) => void` | — | Callback for every `user_event` with an unknown `type`. Programmatic only. |

## Layouts

```html
<!-- Default: sidebar transcript on desktop (when video is on), stacked on mobile. -->
<signalwire-address token="..." destination="..."></signalwire-address>

<!-- Stacked: always top-to-bottom. Video capped smaller on desktop; transcript
     flows below. Useful for narrower embeds or when the host page should read
     more like a chat surface. -->
<signalwire-address layout="stacked" token="..." destination="..."></signalwire-address>
```

```js
SignalWireAddressWidget.mount('#t', { token, destination, layout: 'stacked' });
```

## Hide the self-view

```html
<signalwire-address token="..." destination="..." show-local-video="false"></signalwire-address>
```

```js
SignalWireAddressWidget.mount('#t', { token, destination, showLocalVideo: false });
```

## Audio processing

Three browser audio-processing flags plus an initial input-volume are exposed as mount-time options. The three flags default to on (browser defaults). Set any of them to `false` to capture raw mic input. `inputVolume` is `undefined` by default — omit to leave the destination's default in effect.

```js
SignalWireAddressWidget.mount('#t', {
  token, destination,
  autoGainControl: false,   // keep user's mic level predictable
  inputVolume: 60,          // 0-100, applied after the call joins
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

Notes:
- `echoCancellation`, `noiseSuppression`, `autoGainControl` are applied via `getUserMedia` constraints at dial time; they can't be toggled mid-call without a new `getUserMedia` round.
- `inputVolume` goes through a server RPC (`call.microphone.volume.set`). If the token lacks that scope the server returns 403, the widget logs a warning, and the setting doesn't apply. Unlike mute there's no SDK-side local fallback for volume.

## Audio-only mode

```html
<!-- No camera, no video area — just controls + optional transcript + content drawer. -->
<signalwire-address
  token="..."
  destination="/public/agent"
  video="false"
></signalwire-address>

<!-- Or with a branded avatar/logo image in place of the video area: -->
<signalwire-address
  token="..."
  destination="/public/agent"
  video="false"
  poster="https://example.com/logo.png"
></signalwire-address>
```

```js
SignalWireAddressWidget.mount('#t', {
  token, destination,
  video: false,
  poster: 'https://example.com/logo.png'  // optional
});
```

## Passing page data to the destination

User variables travel on the invite and are readable on the server side (SWML `result.user_data`, or `call.user_data` depending on the agent framework). Three ways to set them, pick whichever matches the data's lifetime:

**1. At mount time** — static values known when the page loads:
```js
SignalWireAddressWidget.mount('#t', {
  token, destination,
  userVariables: { plan: 'pro', accountId: '12345', source: location.pathname }
});
```

Or via the attribute (JSON string):
```html
<signalwire-address
  token="..."
  destination="/public/agent"
  user-variables='{"plan":"pro","accountId":"12345"}'
></signalwire-address>
```

**2. At runtime** — any time before the user clicks the launcher:
```js
const widget = document.querySelector('signalwire-address');
widget.userVariablesAttr = { cart_total: 42.50, currency: 'USD' };
```

Shallow-replaces the current variables bag.

**Auto-populated fields** — by default the widget merges the following into `userVariables` right before dial, so the destination sees the page context without you having to plumb it:

| Key | Source |
|---|---|
| `page_url` | `location.href` |
| `referrer` | `document.referrer` (omitted when empty) |
| `page_title` | `document.title` |
| `user_agent` | `navigator.userAgent` |
| `widget_opened_at` | ISO timestamp of the launcher click |

Anything you pass under one of these keys via `userVariables` or `setUserVariables` overrides the auto value. To turn the auto-populate off entirely, set `autoIdentify: false` (or `auto-identify="false"`).

**3. Just-in-time via `beforedial`** — captured the moment the user clicks, so page state like URL params, cart contents, or the currently-logged-in user are fresh:
```js
widget.addEventListener('signalwire-address:beforedial', (e) => {
  e.detail.setUserVariables({
    page_url: location.href,
    utm_source: new URLSearchParams(location.search).get('utm_source'),
    user_id: window.currentUser?.id,
    cart_total: window.cart?.total
  });
  // Call e.preventDefault() here to abort the dial entirely.
});
```

`setUserVariables()` shallow-merges into whatever was set earlier at mount/runtime, so combining forms 1 or 2 with form 3 is the typical pattern: static defaults plus per-click context.

## Programmatic API

```ts
import { mount, unmount } from '@signalwire/address-widget';

const widget = mount('#call', { token, destination });

// Open / close / hangup
await widget.open();
await widget.close();
await widget.hangup();

// Change options at runtime (attributes reflect where applicable)
widget.destination = '/public/other';
widget.theme = 'light';
widget.layout = 'stacked';
widget.showLocalVideo = false;
widget.poster = 'https://example.com/logo.png';

// Tear down and remove from the DOM
await unmount(widget);
```

### TypeScript exports

```ts
import {
  mount,
  unmount,
  AddressWidget,            // the custom-element class
  VERSION,
  type WidgetOptions,
  type Theme,               // 'dark' | 'light'
  type Layout,              // 'auto' | 'stacked'
  type DisplayContentPayload,
  type UserEventPayload,
  type BeforeDialDetail,    // detail shape on the cancelable beforedial event
  type CallEventDetail      // detail shape on call-joined / call-left events
} from '@signalwire/address-widget';
```

## Events

All events bubble and cross shadow boundaries (`bubbles: true, composed: true`). Listen on the widget element or any ancestor.

| Event | Cancelable | Detail | Fires when |
|---|---|---|---|
| `signalwire-address:beforedial` | yes | `{ setUserVariables(vars) }` | User clicked launcher, about to dial. Call `preventDefault()` to abort. Call `detail.setUserVariables({...})` to merge vars before dial. |
| `signalwire-address:call-joined` | no | `{ call }` | Call has been created and is dialing / connected. |
| `signalwire-address:call-left` | no | `{ call }` | Call ended or overlay closed. |
| `signalwire-address:event` | no | `{ type, ...payload }` | Raw pass-through for any `user_event` the agent emits (see EVENTS.md). |

Example:
```js
const widget = document.querySelector('signalwire-address');

widget.addEventListener('signalwire-address:beforedial', (e) => {
  e.detail.setUserVariables({ plan: 'pro', source: 'docs-page' });
});

widget.addEventListener('signalwire-address:event', (e) => {
  if (e.detail.type === 'cart_updated') updateCart(e.detail);
});
```

## Styling

The widget uses Shadow DOM with brand defaults matching the SignalWire design system. Theme by setting CSS custom properties on the element. Override layout with `::part()` selectors.

### CSS custom properties

| Property | Default (dark) | Description |
|---|---|---|
| `--sw-address-accent` | `#f72a72` | Fuchsia emphasis color (launcher, active-call indicator). |
| `--sw-address-brand-blue` | `#044ef4` | Primary fill for controls. |
| `--sw-address-positive` | `#40e0d0` | Turquoise for AI-speaking / positive states. |
| `--sw-address-warning` | `#ffd700` | Gold for warning states. |
| `--sw-address-danger` | `#ef4444` | Destructive / hangup. |
| `--sw-address-bg-page` | `#0e0e18` | Overlay page background. |
| `--sw-address-bg-surface` | `#181a28` | Transcript, panels. |
| `--sw-address-bg-raised` | `#222436` | Controls dock, content drawer, bubbles. |
| `--sw-address-fg-default` | `#f0f0f4` | Primary text. |
| `--sw-address-fg-muted` | `#a0a0aa` | Secondary text. |
| `--sw-address-border` | `rgba(255,255,255,0.12)` | Separators. |
| `--sw-address-font-heading` | `'Instrument Sans', …` | Heading font family. |
| `--sw-address-font-body` | `'Lexend', …` | Body font family. |
| `--sw-address-font-code` | `'JetBrains Mono', …` | Mono font family. |
| `--sw-address-radius` | `12px` | Primary corner radius. |
| `--sw-address-radius-pill` | `100px` | Pill radius (launcher, buttons). |
| `--sw-address-transcript-width` | `340px` | Desktop transcript sidebar width. |
| `--sw-address-drawer-width` | `440px` | Desktop content drawer width. |
| `--sw-address-z-overlay` | `2147483000` | Overlay stacking index. |

Full list: see `src/brand/tokens.ts` or inspect the element in devtools.

### Shadow parts

| Part | Element |
|---|---|
| `launcher` | The clickable launcher button. |
| `overlay` | Full-viewport overlay root. |
| `close` | Floating X button in the overlay + drawer. |
| `video-frame` | Container around the video area. |
| `local-preview` | Local self-view picture-in-picture inside the video frame. |
| `controls` | Floating button dock. |
| `hangup` | Destructive end-call pill inside the controls dock. |
| `transcript` | Transcript panel. |
| `bubble`, `bubble-ai`, `bubble-user` | Individual chat bubbles. |
| `content-drawer` | Slide-in content panel. |
| `content-drawer-header` | Drawer header (title + actions). |
| `content-drawer-body` | Drawer body. |

Example: restyle the launcher to match your site's button shape:
```css
signalwire-address::part(launcher) {
  border-radius: 4px;
  background: linear-gradient(135deg, #1a1a2e, #0f1022);
  padding: 14px 28px;
}
```

## Theming example

```css
signalwire-address[theme='light'] {
  --sw-address-accent: #c62e5c;
  --sw-address-bg-page: #ffffff;
  --sw-address-fg-default: #111;
}
```

## Server-side events

For the full schema of events the destination can send (transcript, content push, custom pass-through), see [EVENTS.md](./EVENTS.md).

## Development

```bash
npm install
npm run dev       # Vite dev server with HMR on demo/index.html
npm run build     # UMD + ESM + type declarations → dist/
npm test          # Vitest unit tests
npm run type-check
```

Built artifacts:
- `dist/address-widget.umd.js` — CDN bundle. Drops global `SignalWireAddressWidget`.
- `dist/address-widget.mjs` — ESM bundle.
- `dist/address-widget.d.ts` — Type declarations.
- `dist/index.html` — static demo page loading the UMD bundle (serve `dist/` as a web root to preview).

### Local demo defaults

The demo page under `demo/` can prefill its token + destination from a
local-only config so you're not pasting the same values on every reload.

```bash
cp demo/defaults.example.js demo/defaults.local.js
# Edit demo/defaults.local.js with your SAT and destination.
```

`demo/defaults.local.js` is gitignored. If you don't create one, the demo
still works — you'll just see empty inputs on first load. On `npm run build`
the file is copied into `dist/` alongside the bundle, so production previews
you run yourself get the same convenience without shipping credentials in CI.

## Browser support

Modern evergreen browsers with WebRTC support: Chrome/Edge 90+, Firefox 90+, Safari 14.1+. Mobile Safari, Chrome for Android.

## License

MIT
