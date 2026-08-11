/**
 * Chat conversation state machine.
 *
 * Ported from the standalone chat widget's `useChat` hook, minus React. The
 * semantics are preserved deliberately and in detail — several of them are
 * load-bearing in ways that are invisible when they break:
 *
 *   - Two separate one-shot guards, not one. `_restored` means "the free read
 *     already happened"; `_started` means "a conversation exists, do not pay
 *     for another". Collapsing them re-introduces billing on page load.
 *   - Restoring must never be able to create a conversation. `log` is a read
 *     and the service does not bill it; `start` produces a greeting, and a
 *     greeting is a turn.
 *   - The idle clock is bootstrapped from the SERVICE's last turn, not from
 *     `Date.now()`. Getting that wrong is silent: everything looks fine and
 *     the timeout notice just never fires at the right moment.
 *   - The timeout notice *acts*. It drops the handle so the next message
 *     genuinely opens a new conversation, rather than predicting something it
 *     then fails to make true.
 *
 * What is persisted is the **handle**, not a conversation id: signed, carrying
 * its own expiry, so the browser holds something it cannot forge or point at
 * someone else's conversation. It lives in `sessionStorage`, not
 * `localStorage` — per TAB. A reload keeps the conversation, a second tab
 * starts its own, closing the tab ends it.
 */

import { ChatClient, GatewayError } from './chat-client';
import type { VisibleMessage } from './chat-client';
import { DEFAULT_TIMEOUT_SECONDS, EXPIRY_POLL_MS, isIdleExpired } from './expiry';

export const DEFAULT_TIMEOUT_NOTICE =
  'This conversation timed out. Your next message will start a new one.';

export interface ChatSessionOptions {
  gatewayUrl: string;
  key: string;
  debug?: boolean;
  /** sessionStorage key for the handle. */
  storageKey?: string;
  /** Persist the handle across reloads. Default true. */
  persistence?: boolean;
  /** Ignore any stored handle and always open fresh. */
  alwaysNew?: boolean;
  /** Fallback idle timeout; the gateway's reported value wins. */
  timeoutSeconds?: number;
  /** Copy for the injected timeout notice. */
  timeoutNotice?: string;
  /** Substituted for restore/start failures only — NOT for send failures. */
  connectionError?: string;
}

export interface ChatSessionCallbacks {
  /** A committed assistant turn (greeting, or a reply). */
  onAssistant(text: string, userEvent?: Record<string, unknown>): void;
  /** The visitor's own turn, echoed optimistically before the round trip. */
  onUser(text: string): void;
  /** A whole transcript replayed from the server. Replaces, does not append. */
  onRestored(messages: Array<{ role: string; text: string; ts: number }>): void;
  /** A status line about the conversation — currently only the timeout notice. */
  onNotice(text: string): void;
  /** In-flight indicator. Covers restore, start and send alike. */
  onLoading(loading: boolean): void;
  /** Error text for the banner, or null to clear it. */
  onError(message: string | null): void;
  /** Fired once when a stored handle successfully replayed a conversation. */
  onResumed(): void;
}

export class ChatSession {
  private opts: ChatSessionOptions;
  private cb: ChatSessionCallbacks;
  private client: ChatClient | null = null;

  // Two phases, two guards: restoring is free and happens on load; starting
  // costs a turn and waits for the visitor to show intent.
  private _restored = false;
  private _started = false;

  private _resumed = false;
  private _expired = false;
  private _active = false;

  /** Last time this conversation saw traffic — mirrors the service's clock. */
  private _lastActivityMs = Date.now();
  /** Reported by the gateway, which is what actually set the timeout. */
  private _reportedTimeout: number | null = null;

  private _pollTimer: number | null = null;
  private _boundCheck = () => this._checkExpiry();

  constructor(opts: ChatSessionOptions, cb: ChatSessionCallbacks) {
    this.opts = opts;
    this.cb = cb;
    if (opts.gatewayUrl && opts.key) {
      this.client = new ChatClient({
        gatewayUrl: opts.gatewayUrl,
        key: opts.key,
        debug: opts.debug
      });
    }
  }

  get isActive(): boolean {
    return this._active;
  }

  get resumed(): boolean {
    return this._resumed;
  }

  get expired(): boolean {
    return this._expired;
  }

  /**
   * Whether an "End conversation" affordance should be offered. Hidden when
   * persistence is off (there is nothing to end that outlives the page) and
   * in end-on-close mode (closing already ends it).
   */
  get showEndButton(): boolean {
    return this.opts.persistence !== false;
  }

  /** True when the gateway is configured; false means chat is unavailable. */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * The live handle, for carrying this conversation into another transport.
   *
   * Null when no conversation is open, which is what stops a cold voice call
   * from seeding itself off a stale one. Still opaque to us — the widget
   * hands it to the agent, which verifies the signature and recovers the
   * conversation id server-side.
   */
  get currentHandle(): string | null {
    return this._active ? this.client?.getHandle() ?? null : null;
  }

  // ── Handle persistence ────────────────────────────────────────────────

  private get storageKey(): string {
    return this.opts.storageKey || 'sw-chat-handle';
  }

  private readHandle(): string | null {
    if (this.opts.persistence === false) return null;
    try {
      return sessionStorage.getItem(this.storageKey);
    } catch {
      // Private browsing / storage disabled. Not fatal: the conversation just
      // will not survive a reload.
      return null;
    }
  }

  private writeHandle(handle: string | null): void {
    if (this.opts.persistence === false) return;
    try {
      if (handle) sessionStorage.setItem(this.storageKey, handle);
      else sessionStorage.removeItem(this.storageKey);
    } catch {
      // Same as above — nothing the visitor can do about it.
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Load-time work, and deliberately the ONLY load-time work: try to restore a
   * stored conversation, and stop.
   *
   * Restoring is a `chat_log` read, which the service does not bill. Opening a
   * conversation is `create_conversation`, which does. Doing that on mount
   * would charge every page view whether or not the visitor ever opened the
   * widget, so a page that bounces still bills.
   */
  async restore(): Promise<void> {
    if (!this.client || this._restored) return;
    this._restored = true;

    const stored = this.opts.alwaysNew ? null : this.readHandle();
    if (!stored) return; // nothing to restore, and nothing to pay for

    this.cb.onLoading(true);
    this.cb.onError(null);
    try {
      if (await this.resumeWith(stored)) return;
      // The handle outlived its conversation. Drop it and wait — do NOT open
      // a replacement here, or we are back to billing on load.
      this.writeHandle(null);
      this.cb.onLoading(false);
    } catch (error) {
      this._restored = false; // allow a retry
      this.cb.onLoading(false);
      this.cb.onError(
        this.opts.connectionError ||
          (error instanceof Error ? error.message : 'Failed to restore conversation')
      );
    }
  }

  /**
   * Redraw a stored conversation. Returns false when the handle is gone —
   * expired, revoked, or a conversation the service no longer has — so the
   * caller can open a fresh one. An expired handle is a normal event, not an
   * error: the TTL is finite, so every resumed conversation eventually hits it.
   */
  private async resumeWith(handle: string): Promise<boolean> {
    const client = this.client!;
    client.setHandle(handle);
    try {
      const { messages: visible, timeout, lastActivityMs } = await client.log();
      this._reportedTimeout = timeout;
      // An empty transcript means the handle outlived its conversation. Treat
      // it as gone rather than resuming into a blank window.
      if (visible.length === 0) return false;

      this._resumed = true;
      this._started = true;
      // Bootstrap the idle clock from the SERVICE's last turn, not from now.
      // Restarting at zero here would mean a tab closed for 55 minutes of a
      // 60-minute timeout waits another full hour before warning, while the
      // conversation actually dies in five.
      this._lastActivityMs = lastActivityMs ?? Date.now();
      this._expired = false;
      this._active = true;

      this.cb.onRestored(
        visible.map((m: VisibleMessage) => ({
          role: m.role,
          text: m.content,
          // The turn's own time, not the reload's. Stamping these with `now`
          // makes a restored transcript show every message as having just
          // arrived, all in the same minute, in an order the clock contradicts.
          ts: m.timestamp ? m.timestamp * 1000 : Date.now()
        }))
      );
      this.cb.onLoading(false);
      this.cb.onResumed();
      this.startExpiryWatch();
      return true;
    } catch (error) {
      if (error instanceof GatewayError && error.isAuthFailure) return false;
      throw error;
    }
  }

  /**
   * Open a conversation if there is not one already. Called when the visitor
   * opens the widget — the first moment they have shown intent, and therefore
   * the first moment it is fair to charge for a turn.
   */
  async ensureStarted(): Promise<void> {
    if (!this.client || this._started) return;
    this._started = true;

    this.cb.onLoading(true);
    this.cb.onError(null);
    try {
      await this.openConversation(false);
    } catch (error) {
      this._started = false; // let them try again
      this.cb.onLoading(false);
      this.cb.onError(
        this.opts.connectionError ||
          (error instanceof Error ? error.message : 'Failed to start conversation')
      );
    }
  }

  /**
   * Adopt a handle minted server-side for an existing conversation, then open
   * it — the voice→chat handoff.
   *
   * `keepHandle` is the whole point: a normal start clears the handle first so
   * it cannot accidentally ride an old conversation, but here continuing that
   * exact conversation is precisely what we want. sigmond3 minted this handle
   * against the voice call's conversation_id, so the chat service's config
   * fetch carries that id and the agent is seeded with the voice segments
   * before it greets. The greeting therefore acknowledges the switch instead
   * of starting over.
   */
  async adoptHandle(handle: string): Promise<void> {
    if (!this.client) return;
    // Nothing to restore — the widget already has the voice transcript on
    // screen, and the model's context arrives server-side.
    this._restored = true;
    this._started = true;
    this.client.setHandle(handle);
    this.writeHandle(handle);

    this.cb.onLoading(true);
    this.cb.onError(null);
    try {
      await this.openConversation(true);
    } catch (error) {
      this._started = false;
      this.cb.onLoading(false);
      this.cb.onError(
        this.opts.connectionError ||
          (error instanceof Error ? error.message : 'Failed to open chat')
      );
    }
  }

  /** Shared body of start-a-conversation, with or without an existing handle. */
  private async openConversation(keepHandle: boolean): Promise<void> {
    const client = this.client!;
    if (!keepHandle) {
      // Without this an "always new" start would ride an existing handle and
      // silently continue the old conversation.
      client.setHandle(null);
    }

    const { greeting, timeout } = await client.start();
    this._reportedTimeout = timeout;
    this.writeHandle(client.getHandle());
    this._resumed = false;
    this._lastActivityMs = Date.now();
    this._expired = false;
    this._active = true;

    this.cb.onLoading(false);
    if (greeting) this.cb.onAssistant(greeting);
    this.startExpiryWatch();
  }

  /** Send a turn. */
  async send(text: string): Promise<void> {
    const client = this.client;
    const trimmed = text.trim();
    if (!client || !trimmed) return;

    this.cb.onUser(trimmed);
    this.cb.onLoading(true);
    this.cb.onError(null);

    try {
      const response = await client.chat(trimmed);
      // The turn may have opened the conversation, so persist either way.
      this.writeHandle(client.getHandle());
      this._lastActivityMs = Date.now();
      this._expired = false;
      this._active = true;

      this.cb.onLoading(false);
      this.cb.onAssistant(response.text, response.user_event);
      this.startExpiryWatch();
    } catch (error) {
      // A handle that died mid-conversation is recoverable: drop it so the
      // next message starts clean instead of failing forever on a dead handle.
      if (error instanceof GatewayError && error.isAuthFailure) {
        this.writeHandle(null);
        client.setHandle(null);
        this._started = false;
        this._restored = true; // nothing left to restore
      }
      this.cb.onLoading(false);
      // NOTE: `connectionError` is deliberately NOT substituted here. Restore
      // and start are opaque to the visitor, but a send failure has a specific
      // cause worth showing.
      this.cb.onError(error instanceof Error ? error.message : 'Failed to send message');
    }
  }

  /** End the conversation server-side and reset. Best-effort by design. */
  async end(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.end();
    } catch {
      // The conversation times out server-side anyway, and refusing to clear
      // the UI over a failed `end` would strand the visitor.
    } finally {
      this.writeHandle(null);
      this._started = false;
      this._restored = true;
      this._resumed = false;
      this._expired = false;
      this._active = false;
      this.stopExpiryWatch();
    }
  }

  /** Called when the overlay closes; honours end-on-close. */
  async handleClose(endOnClose: boolean): Promise<void> {
    if (endOnClose) await this.end();
  }

  /**
   * Release this conversation locally WITHOUT ending it server-side.
   *
   * Used when handing off to voice. The agent ends the chat conversation
   * itself, as part of restoring it — it fetches the transcript first and
   * then closes it, in that order. If we ended it here the agent's fetch
   * could find nothing, and the call would open with no memory of the chat
   * that led to it.
   *
   * Local state is still cleared, so the widget cannot post into a
   * conversation it has just handed away.
   */
  detach(): void {
    this.writeHandle(null);
    this.client?.setHandle(null);
    this._started = false;
    this._restored = true;
    this._resumed = false;
    this._expired = false;
    this._active = false;
    this.stopExpiryWatch();
  }

  // ── Idle clock ────────────────────────────────────────────────────────

  /**
   * Watch the idle clock and tell the visitor when their next message would
   * start a new conversation.
   *
   * Polling AND visibilitychange AND focus, because none alone is enough:
   * timers are throttled or frozen in a background tab, so a laptop asleep for
   * two hours fires no interval — but does fire a visibility change on wake,
   * which is exactly the moment the check matters most.
   */
  startExpiryWatch(): void {
    this.stopExpiryWatch();
    const timeoutSeconds = this.effectiveTimeout();
    if (!timeoutSeconds || timeoutSeconds <= 0) return;
    if (!this._active || this._expired) return;

    this._pollTimer = window.setInterval(this._boundCheck, EXPIRY_POLL_MS);
    document.addEventListener('visibilitychange', this._boundCheck);
    window.addEventListener('focus', this._boundCheck);
    this._boundCheck();
  }

  stopExpiryWatch(): void {
    if (this._pollTimer !== null) {
      window.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    document.removeEventListener('visibilitychange', this._boundCheck);
    window.removeEventListener('focus', this._boundCheck);
  }

  /** Gateway first — it is the thing that chose the number. Config is a fallback. */
  private effectiveTimeout(): number {
    return (
      this._reportedTimeout ?? this.opts.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    );
  }

  private _checkExpiry(): void {
    if (!this._active || this._expired) return;
    const timeoutSeconds = this.effectiveTimeout();
    if (!isIdleExpired(this._lastActivityMs, timeoutSeconds, Date.now())) return;

    this._expired = true;
    // Make the notice true: forget the handle, so the next turn mints a new
    // conversation rather than reviving this one. A warning that merely
    // predicted would be wrong in the worse direction — saying "this starts
    // fresh" and then silently appending to an hour-old conversation.
    this.writeHandle(null);
    this.client?.setHandle(null);
    this._started = false;
    this.stopExpiryWatch();

    this.cb.onNotice(this.opts.timeoutNotice || DEFAULT_TIMEOUT_NOTICE);
  }

  /** Release timers and listeners. Does NOT end the conversation. */
  destroy(): void {
    this.stopExpiryWatch();
  }
}
