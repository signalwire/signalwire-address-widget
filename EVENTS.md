# Events reference

Document written for AI-agent authors on the server side. This widget listens for specific event types on the SignalWire call and surfaces them as UI behaviours. Knowing the conventions lets your agent drive transcript, content pushes, and custom pass-through events.

## How the widget subscribes

After dial, the widget calls `call.subscribe(eventType)` on the Call for each of the event types below. That sends a `verto.subscribe` for the exact type to the server, so the server doesn't need to have the type in any default subscription list — just emit it.

## Transcript events (automatic)

These four events drive the chat transcript panel that auto-reveals when the first event arrives. They're the same AI lifecycle events the older widget consumed; if your agent already emits them, the transcript will "just work".

| Event type | Payload | Meaning |
|---|---|---|
| `ai.partial_result` | `{ text, barged }` | User speech partial (running ASR). Replaces the current user bubble each emit. |
| `ai.speech_detect` | `{ text, type }` | User speech complete. `type !== "normal"` indicates a barge. |
| `ai.response_utterance` | `{ utterance }` or `{ text }` | An AI-speech chunk. Appended to the current AI bubble. |
| `ai.completion` | `{ text, type }` | AI finished. `type === "barged"` flips lastSpoken to user. |

No configuration is needed on the widget side. If your destination does not emit these events (e.g. a plain WebRTC endpoint), the transcript stays hidden.

## Content-push events

The widget listens for `user_event` and dispatches by the `type` field inside. Any `type` you define is forwarded to the host page as a `signalwire-address:event` CustomEvent (and via the `onEvent` callback if the host provides one). One `type` is treated specially:

### `display_content`

Opens the content drawer that slides in over the video. Use this to push text, markdown, code, or sanitized HTML to the caller mid-call.

**Schema:**
```json
{
  "type": "display_content",
  "title": "optional eyebrow label",
  "content": "<string>",
  "format": "text" | "markdown" | "code" | "html",
  "language": "python"
}
```

- `title` (optional) — rendered as an uppercase eyebrow at the top of the drawer
- `content` (required) — the body to render
- `format` (required) — how to render the body:
  - `text` renders as plain text, preserving whitespace (monospaced)
  - `markdown` renders via `marked` then sanitized via DOMPurify allowlist
  - `code` renders in a syntax-highlighted block (Prism); set `language`
  - `html` is sanitized via DOMPurify allowlist (no scripts, iframes, event handlers, or inline styles)
- `language` (required when `format === "code"`) — Prism language name (e.g. `javascript`, `typescript`, `python`, `bash`, `json`, `css`, `html`, `yaml`, `sql`, `markdown`)

**Python agent example** (signalwire-agents SDK):
```python
result.swml_user_event({
    "type": "display_content",
    "title": "Sample code",
    "content": "print('hello from Sigmond')",
    "format": "code",
    "language": "python"
})
```

**Markdown example:**
```python
result.swml_user_event({
    "type": "display_content",
    "title": "Here's what I found",
    "content": "## Top results\n\n- Item A\n- Item B\n- Item C",
    "format": "markdown"
})
```

**Behaviour:**
- Drawer slides in from the right on desktop, up from the bottom on mobile
- Includes copy-to-clipboard + close buttons
- A new `display_content` push replaces the current drawer content
- Closing the drawer doesn't end the call

## Custom `user_event` pass-through

Any other `type` you send on `user_event` is forwarded to the host:

```python
result.swml_user_event({
    "type": "cart_updated",
    "items": [...],
    "total": 42.50
})
```

The host page receives:
```js
widget.addEventListener('signalwire-address:event', (e) => {
  if (e.detail.type === 'cart_updated') {
    updateCartDisplay(e.detail.items, e.detail.total);
  }
});
```

Or via the `onEvent` callback passed at mount:
```js
SignalWireAddressWidget.mount('#target', {
  token, destination,
  onEvent: (event) => {
    if (event.type === 'cart_updated') { ... }
  }
});
```

Use this to drive host-page UI from the agent side without modifying the widget.

## What the widget tells you at dial time

Unless the host page sets `auto-identify="false"`, every dial carries two nested objects in userVariables (`result.user_data` in SWML). Read them rather than guessing what the caller can see.

`capabilities` is the contract — what this client can actually render:

```json
{
  "widget": "signalwire-address",
  "version": "<widget version>",
  "display_content": { "formats": ["text", "markdown", "code", "html"], "persistent": true, "copyable": true },
  "transcript": true,
  "video": true,
  "audio": true,
  "self_preview": true,
  "chat_handoff": true
}
```

Two fields are worth branching on:

- **`transcript`** — the caller can *see* your words, not just hear them. Markdown and code pushes are worth sending; on a PSTN call they would be wasted.
- **`chat_handoff`** — this caller can be moved to text. Gate your `switch_to_chat` tool on it so the model never offers a browser the caller doesn't have.

`metadata` carries session context in three buckets (`page`, `client`, `widget`) — URL, referrer, platform, locale, timezone, viewport, accessibility preferences, widget version and theme. When the host page collects recording consent, `metadata.consent` and a top-level `metadata.no_training` flag ride along with it. Full shape in [README.md](./README.md#auto-populated-payloads).

## Medium switching (voice ↔ text)

A widget configured for both mediums can move a conversation between them without losing context. The agent side owns the continuity; the widget deliberately never learns its own conversation id.

Continuity rides on **opaque, HMAC-signed handles** minted server-side. The browser holds one and hands it back but never parses it, so a stolen publishable key plus a guessed conversation id cannot resume someone else's conversation.

### What the widget sends you

| userVariable | When | Meaning |
|---|---|---|
| `handoff_nonce` | every dial, when chat is configured | Single-use random id for *this call*. Store it against the call. It is how the browser later proves which call it is on without naming a conversation. |
| `chat_handle` | text → voice only | Handle of the chat conversation being continued. Verify it with your own gateway and recover the conversation to seed the call. |

### Routes your gateway must expose

| Route | Body | Returns | Called when |
|---|---|---|---|
| `POST /handoff` | `{ nonce }` | `{ handle }` | Caller pressed **Switch to text**. Redeem the nonce (single-use), end the call server-side so its post-prompt fires immediately, mint a chat handle for the same conversation. |
| `POST /escalate` | `{ handle }` | any 2xx | Caller pressed **Start a call** from chat. End the chat leg and write its record *before returning* — the widget blocks on this before dialing, so the new call's SWML fetch doesn't race a summary that is still seconds away. |
| `POST /say` | `{ nonce, text }` | any 2xx | Caller typed during a voice call (`type-to-talk`). Inject the text into the live conversation via `client.calling.ai_message`. Authorizes on the nonce, not the publishable key. |

### `chat_handoff` — model-initiated voice → text

```python
result.swml_user_event({
    "type": "chat_handoff",
    "handle": "<signed handle from your gateway>"
})
```

**Do not hang up when you emit this.** A server-side hangup can beat the event to the browser, and then the handoff is lost with no way to recover it. Mint and announce; the widget owns the teardown ordering — it receives the handle, tears the call down itself, then adopts the handle.

The widget does **not** replay the transcript to you. The turns already on the caller's screen stay there for visual continuity, but the model's context arrives server-side only — a browser-supplied conversation history would be a prompt-injection vector, since a malicious host page could hand you a fabricated exchange.

If a `chat_handoff` reaches a widget with no chat configured, it warns in the console and shows the caller a "Text chat is not available here" banner rather than silently dropping the call.

## Event ordering and barge handling

The chat state machine handles partial-reconciliation across both speakers, including barges:

- If the AI is speaking and the user barges, both partials render simultaneously in the order implied by `lastSpoken`
- When `ai.completion` arrives with `type === "barged"`, the widget promotes the AI partial to complete but flips `lastSpoken` to user, so the user partial renders after it
- `ai.speech_detect` with `type !== "normal"` also indicates a barged user completion

You don't need to order events specially — emit them as they occur and the widget reconciles.
