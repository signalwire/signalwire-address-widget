# Chat events — internals

A code-oriented walkthrough of how the widget consumes the AI-agent call
events and turns them into the transcript UI. Meant for contributors
extending the widget itself. For the server-side agent-authoring view
(what to emit from SWML / Python SDK), see [`EVENTS.md`](./EVENTS.md).

## The five event types

After `call = await client.dial(...)` resolves, the widget wires one
RxJS subscription per event type via the SDK's
`call.subscribe(eventType)`. Each `subscribe` call sends a
`verto.subscribe` frame for that exact type, so the server doesn't need
a default-subscription list on its side.

| Event type | Verto source | FSM handler | UI effect |
|---|---|---|---|
| `ai.partial_result` | running ASR while the user is still talking | `ChatState.onUserPartial` | user bubble, `state: 'partial'`, italic + pulsing dot |
| `ai.speech_detect` | final ASR commit for the user turn | `ChatState.onUserComplete` | promotes partial → `state: 'complete'` |
| `ai.response_utterance` | AI speaking, arrives as chunks | `ChatState.onAiChunk` + `_startAiSpeakingRing()` | AI bubble partial that space-joins each chunk; turquoise pulsing ring around video |
| `ai.completion` | AI turn ends (optionally `type: 'barged'`) | `ChatState.onAiComplete` + `_stopAiSpeakingRing()` | promotes AI partial → complete; flips `lastSpoken` to `user` if barged |
| `user_event` | custom server push (`result.swml_user_event(...)`) | `_handleUserEvent` | `display_content` opens drawer + drops chip; other types forwarded via `onEvent` / `signalwire-address:event` |

The full subscription list lives in `src/lib/events.ts` as
`EVENT_TYPES`. Any new event type added there automatically gets the
subscribe + route plumbing.

## Subscribe → route → handle pipeline

Three files participate:

```
lib/events.ts           wireCallEvents(call, handlers)   ← subscribes, extracts params, routes
components/chat-state.ts ChatState                        ← FSM over bubbles + content chips
AddressWidget.ts         _wireCallStateObservables        ← instantiates the plumbing for a live Call
```

### `src/lib/events.ts`

- `wireCallEvents(call, handlers)` returns a teardown fn that
  unsubscribes all five subscriptions.
- Each inbound envelope has the shape
  `{ event_type, event_channel, timestamp, params: { call_id, ...payload } }`.
  `extractParams()` pulls out `.params` so handlers receive the raw
  payload the server sent.
- `routeEvent()` is a plain switch over `EventType`. For each type it:
  1. Coerces `params.text` / `params.utterance` safely through `asString`.
  2. Decides the `barged` boolean — for `ai.partial_result` / `ai.completion`
     it's the explicit field; for `ai.speech_detect` the convention is
     `type !== 'normal'` means barged.
  3. Strips `{confidence=0.95}` markers the backend appends to ASR
     finals (`stripConfidence`).
  4. Invokes the corresponding `handlers.onXxx(text, barged)`.
- For `user_event`, if `params.type` is missing at the top level we
  unwrap one more layer (`params.params`) because some SWML helpers
  nest the payload.

### `src/components/chat-state.ts`

Small FSM with three fields of significance:

```ts
private _entries: ChatEntry[] = [];     // committed (bubbles + content chips)
private _aiPartial: BubbleEntry | null; // in-flight AI utterance, accumulates chunks
private _userPartial: BubbleEntry | null; // in-flight user speech partial
private _lastSpoken: 'ai' | 'user' | null;
```

`ChatEntry` is a tagged union:

```ts
type ChatEntry = BubbleEntry | ContentChipEntry;

interface BubbleEntry {
  kind: 'bubble';
  speaker: 'ai' | 'user';
  text: string;
  state: 'partial' | 'complete';
}

interface ContentChipEntry {
  kind: 'content';
  id: string;          // minted by AddressWidget on display_content
  title: string;
  preview: string;
  format: 'text' | 'markdown' | 'code' | 'html';
  language?: string;
}
```

`getHistory()` is the render-time read. It returns
`[...committed, ...partials]`, where partials are ordered by
`lastSpoken` — the most recently speaking party's partial shows last.
This is how the UI renders both partials simultaneously during a barge.

Every mutator calls `this.onUpdate()`. `AddressWidget` points that at
`() => { this._chatVersion++; this._persistChat(); }` — bumping a state
field forces a Lit re-render, and writing the snapshot to
sessionStorage keeps the reattach path warm.

#### Partial → complete promotion rules

- `onUserPartial(text)` replaces `_userPartial` each call (ASR returns
  full running transcript, not chunks).
- `onUserComplete(text)` pushes a `BubbleEntry` with `state: 'complete'`
  to `_entries`, clears `_userPartial`. A race where `speech_detect`
  arrives without a preceding partial still records the final turn.
- `onAiChunk(text)` appends to `_aiPartial.text` with whitespace
  collapse (`/\s+/g`, single-space join). No partial → a new one is
  created.
- `onAiComplete(text, barged)` prefers the server's final `text` over
  the accumulated chunks (finals are usually cleaner). Sets
  `_lastSpoken` to `'user'` if barged (so the user's partial that
  caused the barge renders after the AI's promoted bubble).
- `pushContent(entry)` appends a `ContentChipEntry` to `_entries` with
  no partial concept — content chips are always committed.

#### Rehydration

`loadSnapshot(entries)` replaces `_entries` with the persisted snapshot
(partials filtered out — they're never serialized) and zeroes
`_aiPartial` / `_userPartial` / `_lastSpoken`. Called from the reattach
path before live subscriptions fire so first paint shows history.
`getCommittedEntries()` is the serialization read path — it mirrors
`_entries` but skips any partial that somehow snuck in.

### `src/AddressWidget.ts`

Wiring happens inside `_startCall` (fresh dial) and `_attemptReattach`
(page-reload restore):

```ts
this._unwireEvents = wireCallEvents(call, {
  onUserPartial: (text, barged) => this._chat.onUserPartial(text, barged),
  onUserComplete: (text, barged) => this._chat.onUserComplete(text, barged),
  onAiChunk: (text, barged) => {
    this._chat.onAiChunk(text, barged);
    this._startAiSpeakingRing();
  },
  onAiComplete: (text, barged) => {
    this._chat.onAiComplete(text, barged);
    this._stopAiSpeakingRing();
  },
  onUserEvent: (payload) => this._handleUserEvent(payload)
});
```

`_startAiSpeakingRing()` / `_stopAiSpeakingRing()` toggle the video
frame's turquoise pulse during AI speech — an optimistic visual so the
user sees activity even before the first utterance chunk paints. A
1.5s debounce timer auto-clears the ring if chunks stop arriving
without a `completion`.

`_handleUserEvent(payload)` has two responsibilities:

1. If `payload.type === 'display_content'`, extract/normalize the body
   (tolerant of `data` / `payload` / `body` nesting), mint a stable id,
   store in `this._contentHistory: Map<string, DisplayContentPayload>`,
   push to `this._contentOrder: string[]`, push a `ContentChipEntry`
   via `this._chat.pushContent(...)`, and set `this._openContentId` so
   the drawer opens. `_persistContent()` writes the snapshot.
2. Always forward the raw payload to the host via `this.onEvent?.(payload)`
   and the `signalwire-address:event` CustomEvent.

## Persistence and reattach integration

The transcript survives page reloads when `autoReattach` is true
(default). Keys in sessionStorage:

```
swaw:last                          → { widgetId, callId, destination, savedAt }
swaw:chat/<widgetId>/<callId>      → ChatEntry[]   (committed only, see getCommittedEntries)
swaw:content/<widgetId>/<callId>   → [{ id, payload }]
```

Write cadence:
- `swaw:last`: once on `call-joined`, cleared on `close()` / `hangup()` /
  `max_attempts_reached`.
- `swaw:chat`: on every `ChatState.onUpdate` (i.e., every mutator fires
  a write). Partials are filtered at serialization so the write is
  stable across the chunk stream of a single utterance.
- `swaw:content`: on each `display_content` push, using `_contentOrder`
  to preserve chip sequence.

Read + validate on mount (`connectedCallback` → `_attemptReattach`):
`readValidLast()` enforces shape + TTL (`reconnectCallsTimeout` +
60s margin). `sweepOrphans(widgetId)` purges any `swaw:chat/...` or
`swaw:content/...` keys whose `callId` no longer matches `swaw:last`.

Cleanup is symmetric: successful reattach immediately rewrites a fresh
baseline of all three keys so a second reload during the same call
still has data. Reattach miss / recovery failure (`max_attempts_reached`,
`call_recovery_failed`) calls `clearCall(widgetId, callId)` which drops
all three.

## What to do in the code — cheatsheet

### Add a new event type the widget listens to

1. Append the type string to `EVENT_TYPES` in
   `src/lib/events.ts:43`.
2. Add a matching `onXxx` field to `EventHandlers` in the same file.
3. Add a `case` to `routeEvent()` that coerces payload fields and calls
   the handler.
4. Plug the handler into the object literal passed to `wireCallEvents`
   in `AddressWidget._startCall` *and* `_attemptReattach` (both sites
   use the same shape — keep them in sync).

### Change how a bubble renders

- Entry structure: `src/components/chat-state.ts` (`ChatEntry` union).
- Rendering: `src/components/transcript.ts` (`renderBubble` and
  `renderContentChip`).
- Per-entry CSS: `transcriptStyles` at the top of the same file. Use
  `part` attributes (`bubble`, `bubble-ai`, `bubble-user`,
  `content-chip`) so host pages can theme via `::part()`.

### Add a new speaker (e.g., `system`)

1. Extend `type Speaker = 'ai' | 'user'` in `chat-state.ts`.
2. Add corresponding CSS rule in `transcript.ts`
   (`.bubble[data-speaker='system']`).
3. Add a mutator (`onSystemNote(text)`) if the entry is committed
   immediately, or partial-aware helpers if it follows the
   partial-then-complete lifecycle.
4. Decide where in `getHistory()` it fits relative to `_lastSpoken`.
5. Update `loadSnapshot()`'s filter if the new kind should survive
   reload.

### Bake a new `user_event` subtype into the widget

If `display_content` isn't enough (e.g., you want a built-in "share
location" card), handle it in `_handleUserEvent` before the pass-through
fork. Otherwise keep it as a host-side concern — the raw payload
already reaches `onEvent` / `signalwire-address:event`.

### Debug a missing transcript

1. Confirm the server actually emits the event: look for `ai.*` /
   `user_event` lines in the call signaling log.
2. Confirm the widget subscribed: the SDK logs
   `verto.subscribe` frames per type in `debug: { logWsTraffic: true }`.
3. Log from `routeEvent()` — a single `console.debug` at the top of
   the switch proves the subscription is alive and tells you what
   `params` shape arrived.
4. Log from `ChatState.onUpdate` to confirm mutators fired and state
   changed.

### Persistence keys to know when touching this code

| Key | Written from | Read from |
|---|---|---|
| `swaw:last` | `_startCall`, `_attemptReattach` (baseline rewrite) | `connectedCallback` → `readValidLast()` |
| `swaw:chat/<w>/<c>` | `ChatState.onUpdate` → `_persistChat` | `_attemptReattach` → `readChat` → `ChatState.loadSnapshot` |
| `swaw:content/<w>/<c>` | `_handleUserEvent` → `_persistContent` | `_attemptReattach` → `readContent` → rehydrate `_contentHistory` + `_contentOrder` |

All three are scoped by `this.widgetId` (default: `address-widget-<N>`
by document-order index). If you change the scoping rules, update
`sweepOrphans` in `src/lib/persistence.ts` accordingly — it also reads
that naming convention to decide what to delete.

## Barge handling, in detail

The interesting case is "AI is mid-utterance, user starts talking":

1. `ai.response_utterance` chunks land → `_aiPartial` grows, ring pulses.
2. User begins talking. `ai.partial_result` fires → `_userPartial` set,
   `_lastSpoken = 'user'`.
3. `getHistory()` returns `[...committed, _aiPartial, _userPartial]`
   because `lastSpoken === 'user'`. Both bubbles visible simultaneously.
4. Server decides the barge is real → `ai.completion` arrives with
   `type === 'barged'`. `_aiPartial` is promoted to `_entries` with
   whatever text the server sent (or the accumulated chunks),
   `_lastSpoken` stays `'user'`.
5. User finishes → `ai.speech_detect` → `_userPartial` promoted.
6. Committed order: `[...older, ai_complete, user_complete]`.

No special coordination is needed from the agent side; emit events as
they occur and the FSM reconciles.
