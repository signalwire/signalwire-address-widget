/**
 * The idle clock, as a pure function so it can be tested without a DOM.
 *
 * Ported verbatim from the standalone chat widget's `hooks/expiry.ts` — the
 * semantics here are load-bearing and unit-tested, so this is deliberately a
 * copy rather than a reinterpretation.
 *
 * The chat service ends a conversation that has been idle longer than its
 * `conversation_timeout`, measured from its own `updated_at`. Nothing in the
 * JSON-RPC result exposes that deadline or the server's clock, so the widget
 * mirrors it locally from the last turn it saw.
 *
 * Voice has no equivalent: a call is either up or it isn't, and the SDK tells
 * us. This applies only to the chat transport.
 */

/** Matches the chat service's DEFAULT_CONVERSATION_TIMEOUT. */
export const DEFAULT_TIMEOUT_SECONDS = 3600;

/** How often to re-check the idle clock while a chat conversation is open. */
export const EXPIRY_POLL_MS = 30_000;

/**
 * Whether the conversation should be treated as timed out.
 *
 * `timeoutSeconds <= 0` disables the check entirely — that is the documented
 * way to turn the notice off, so it must never report expiry.
 *
 * The comparison is `>=`, not `>`: at exactly the timeout the service's own
 * sweep would already consider the conversation eligible to end, and warning
 * a moment early is the safe direction. The opposite error — staying silent
 * while the conversation is actually gone — is the one that misleads someone
 * into thinking their next message continues it.
 */
export function isIdleExpired(
  lastActivityMs: number,
  timeoutSeconds: number,
  nowMs: number
): boolean {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return false;
  if (!Number.isFinite(lastActivityMs)) return false;
  // A clock that jumped backwards (NTP correction, a laptop waking with a
  // stale time) would otherwise produce a negative age and read as "fresh
  // forever". Clamp it: never negative, so the worst case is warning late by
  // the size of the jump rather than never warning at all.
  const idleMs = Math.max(0, nowMs - lastActivityMs);
  return idleMs >= timeoutSeconds * 1000;
}
