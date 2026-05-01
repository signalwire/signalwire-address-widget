/**
 * Event multiplexer
 *
 * Wires `call.subscribe(eventType)` for each server event we care about
 * (one `verto.subscribe` per type, per the new SDK convention) and routes
 * each to a named handler.
 *
 * Shape of what `call.subscribe` emits (verified in
 * `@signalwire/js/core/entities/Call.subscribe.test.ts`):
 *
 *   {
 *     event_type: 'ai.partial_result',
 *     event_channel: '...',
 *     timestamp, project_id, node_id,
 *     params: { call_id, ...payload }   // <- actual event data
 *   }
 *
 * Handlers receive `params` with the call_id stripped, so what they see is
 * the raw payload the server sent.
 */

import type { Subscription } from 'rxjs';
import type { Call } from '@signalwire/js';
import type { UserEventPayload } from '../types';

/**
 * Handlers the widget provides. All optional so consumers can opt in.
 */
export interface EventHandlers {
  /** `ai.partial_result` — user speech partial. `barged` true if the user barged AI. */
  onUserPartial?(text: string, barged: boolean): void;
  /** `ai.speech_detect` — user speech completed. */
  onUserComplete?(text: string, barged: boolean): void;
  /** `ai.response_utterance` — AI spoken-response chunk. */
  onAiChunk?(text: string, barged: boolean): void;
  /** `ai.completion` — AI final response (or barged-then-resolved). */
  onAiComplete?(text: string, barged: boolean): void;
  /** Anything on `user_event` — dispatched raw with `params.type` as a discriminator. */
  onUserEvent?(payload: UserEventPayload): void;
  /**
   * Anything on `calling.ai.sidecar` — the AI-sidecar coaching topic.
   * Each event carries a `type` field (`insight`, `skip`, `tool_call`,
   * `error`, `final`, ...). Handler receives the whole `params` body.
   */
  onSidecarEvent?(payload: UserEventPayload): void;
  /**
   * `calling.ai.transcribe.utterance` — per-utterance live transcribe
   * events. Distinct from the `<ai>` agent stream: these come from
   * `live_transcribe` / `ai_sidecar` mode and represent the actual
   * audio being said on each leg of a bridged call.
   */
  onTranscribeUtterance?(
    role: 'local-caller' | 'remote-caller' | string,
    text: string
  ): void;
}

/** Event types we always subscribe to. */
const EVENT_TYPES = [
  'ai.partial_result',
  'ai.speech_detect',
  'ai.response_utterance',
  'ai.completion',
  'user_event',
  // `ai_sidecar` coaching events. The wire `event_type` is the bare
  // `ai.sidecar` (the `calling.` prefix is the relay-topic name, not
  // what the SDK matches on — `Call.subscribe()` does strict equality
  // against `event_type`). Sub-shape lives in `params.type`
  // (`insight`, `skip`, `tool_call`, ...) and routes through
  // `onSidecarEvent`.
  'ai.sidecar',
  // `live_transcribe` / `ai_sidecar` (with `live_events: true`)
  // per-utterance transcripts. Each event carries
  // `params.utterance.{role, content}`.
  'ai.transcribe.utterance'
] as const;

type EventType = (typeof EVENT_TYPES)[number];

/** Sanitize `{confidence=0.95}` style markers the backend sometimes appends. */
function stripConfidence(text: string): string {
  return text.replace(/\s*\{confidence=[\d.]+\}\s*/g, '').trim();
}

/**
 * A normalized "params" block. `call.subscribe` delivers the full signaling
 * envelope; we pull `.params` out for handlers.
 */
interface CallEventEnvelope {
  event_type?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

function extractParams(event: Record<string, unknown>): Record<string, unknown> {
  const env = event as CallEventEnvelope;
  if (env.params && typeof env.params === 'object') {
    return env.params;
  }
  return event;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

function routeEvent(
  eventType: EventType,
  params: Record<string, unknown>,
  handlers: EventHandlers
): void {
  switch (eventType) {
    case 'ai.partial_result': {
      // User was interrupted mid-speech to produce partial result; always
      // treat as a user-side partial. "barged" flag on server indicates the
      // user barged the AI — carried through so the chat FSM can decide
      // how to render.
      handlers.onUserPartial?.(asString(params.text), asBool(params.barged));
      break;
    }
    case 'ai.speech_detect': {
      // User speech considered complete. Text may carry a confidence tag.
      const text = stripConfidence(asString(params.text));
      const barged = params.type !== undefined && params.type !== 'normal';
      handlers.onUserComplete?.(text, barged);
      break;
    }
    case 'ai.response_utterance': {
      handlers.onAiChunk?.(asString(params.utterance ?? params.text), false);
      break;
    }
    case 'ai.completion': {
      handlers.onAiComplete?.(asString(params.text), params.type === 'barged');
      break;
    }
    case 'user_event': {
      const payload = params as UserEventPayload;
      if (typeof payload.type !== 'string') {
        // Some SWML helpers wrap the payload one level deeper.
        const inner = (payload as { params?: unknown }).params;
        if (inner && typeof inner === 'object' && typeof (inner as UserEventPayload).type === 'string') {
          handlers.onUserEvent?.(inner as UserEventPayload);
          return;
        }
      }
      handlers.onUserEvent?.(payload);
      break;
    }
    case 'ai.sidecar': {
      // Sidecar events are wrapped under `sidecar_event` when the relay
      // delivers the webhook envelope; some envelopes deliver `params`
      // directly. Try both shapes so the consumer always sees an object
      // with a `type` field at the top level.
      let payload = params as UserEventPayload & { sidecar_event?: unknown };
      if (
        payload.sidecar_event &&
        typeof payload.sidecar_event === 'object' &&
        typeof (payload.sidecar_event as UserEventPayload).type === 'string'
      ) {
        payload = payload.sidecar_event as UserEventPayload;
      }
      handlers.onSidecarEvent?.(payload as UserEventPayload);
      break;
    }
    case 'ai.transcribe.utterance': {
      // params.utterance.{role, content} is the canonical shape per
      // the sidecar/live_transcribe events doc. We hand the raw role
      // through so the consumer can route it into a separate transcript
      // (this is a different conversation from `<ai>` events — bridged
      // human-to-human or human-to-bridge calls, not AI-agent dialogue).
      const utt = (params as { utterance?: { role?: unknown; content?: unknown } }).utterance;
      if (!utt || typeof utt.content !== 'string') break;
      const text = stripConfidence(utt.content);
      if (!text) break;
      const role = typeof utt.role === 'string' ? utt.role : '';
      handlers.onTranscribeUtterance?.(role, text);
      break;
    }
  }
}

/**
 * Subscribe to all five event types on the given call and route payloads to
 * the provided handlers. Returns a function that unsubscribes everything.
 */
export function wireCallEvents(call: Call, handlers: EventHandlers): () => void {
  const subs: Subscription[] = [];

  for (const eventType of EVENT_TYPES) {
    const sub = call.subscribe(eventType).subscribe({
      next: (event) => {
        try {
          routeEvent(eventType, extractParams(event), handlers);
        } catch (err) {
          console.warn(`[address-widget] handler for ${eventType} threw`, err);
        }
      },
      error: (err) => {
        console.warn(`[address-widget] subscription error on ${eventType}`, err);
      }
    });
    subs.push(sub);
  }

  return () => {
    for (const sub of subs) {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    }
  };
}
