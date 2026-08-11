/**
 * Chat gateway client.
 *
 * Ported from the standalone React chat widget's `api/ChatClient.ts`. The
 * transport is unchanged on purpose — it is the contract with
 * `signalwire.ai_chat.ChatGateway` in the Python SDK, and the widget it came
 * from is the reference implementation of that contract.
 *
 * One endpoint, one POST, four methods. Everything that would let a caller
 * widen its own access is decided server-side: the conversation comes from an
 * HMAC-signed handle the browser cannot forge, and `config_url` is the
 * gateway's, so a stolen key still reaches only the agent it was issued for.
 *
 * The handle IS the conversation — id plus expiry, signed. We hold one
 * opaquely and hand it back; we never parse it, and there is no conversation
 * id in the browser to leak or tamper with. That property is what makes the
 * voice<->chat handoff safe: the widget carries the handle between mediums
 * without ever learning what it refers to.
 *
 * Token lifetime note, for parity with `client.ts`: the publishable key is a
 * public credential by design (it is pasted into the host page), unlike the
 * SAT the voice path uses.
 */

/** Options for constructing a {@link ChatClient}. */
export interface ChatClientOptions {
  /**
   * The gateway's URL — a `ChatGateway` mounted by the Python SDK. Staging vs
   * prod is the gateway's choice, not ours: it holds the credential and the
   * upstream service URL.
   */
  gatewayUrl: string;
  /** Publishable key, sent as `Authorization: Bearer`. Safe in the page. */
  key: string;
  /** Mirror of the widget's `debug` attribute — traces each call direction. */
  debug?: boolean;
}

/** One turn's reply. */
export interface ChatResponse {
  text: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  /**
   * Server-pushed event riding along with a reply — the chat transport's
   * equivalent of the voice path's `user_event` signaling event. Same
   * payloads (`display_content` and friends), so both mediums feed the same
   * handler in AddressWidget.
   */
  user_event?: Record<string, unknown>;
}

/** A transcript entry as the gateway hands it back. */
export interface VisibleMessage {
  role: 'user' | 'assistant' | string;
  content: string;
  /** Epoch SECONDS. Callers must multiply by 1000. */
  timestamp?: number;
}

/**
 * A gateway call that failed. `status` is 0 when the request never reached the
 * gateway at all.
 */
export class GatewayError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }

  /** 401/403 — key refused, or a handle that is invalid, forged or expired. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

interface JsonRpcResponse {
  error?: { message?: string };
  result?: {
    response?: string;
    server_time?: string;
    metadata?: Record<string, unknown>;
    user_event?: Record<string, unknown>;
  };
}

export class ChatClient {
  private gatewayUrl: string;
  private key: string;
  private debug: boolean;
  private handle: string | null = null;

  constructor(options: ChatClientOptions) {
    // No trailing-slash strip: the gateway's route IS "/", so a bare origin
    // must keep it. new URL() normalises the rest.
    this.gatewayUrl = options.gatewayUrl;
    this.key = options.key;
    this.debug = options.debug || false;
  }

  /** The current handle, for persisting. Null until a conversation opens. */
  getHandle(): string | null {
    return this.handle;
  }

  /**
   * Adopt a stored handle. Invalid or expired ones surface on first use.
   *
   * Also the entry point for a voice->chat handoff: the `chat_handoff`
   * user_event carries a handle minted server-side against the voice call's
   * conversation, and setting it here is what makes the chat side continue
   * that conversation rather than opening a new one.
   */
  setHandle(handle: string | null): void {
    this.handle = handle;
  }

  private trace(...args: unknown[]): void {
    if (this.debug) console.log('[address-widget][chat]', ...args);
  }

  /**
   * POST one gateway call.
   *
   * A minted handle rides back in `X-Chat-Handle` — sent before the body,
   * which is what lets `chat` stream. We capture it on every response rather
   * than only on `start`, because the gateway mints on whichever call opens
   * the conversation.
   *
   * A cross-origin gateway MUST send
   * `Access-Control-Expose-Headers: X-Chat-Handle` or the header is invisible
   * to us and persistence silently never works — no error, just a fresh
   * conversation on every reload.
   */
  private async post(body: Record<string, unknown>): Promise<Response> {
    const payload = this.handle ? { ...body, handle: this.handle } : body;
    this.trace('->', body.method, this.handle ? '(with handle)' : '(new)');

    let response: Response;
    try {
      response = await fetch(this.gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key}`
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // fetch() rejects on network/CORS/mixed-content, all of which look
      // identical here. Status 0 marks "never reached the gateway".
      throw new GatewayError(0, err instanceof Error ? err.message : 'network error');
    }

    const minted = response.headers.get('X-Chat-Handle');
    if (minted) {
      this.handle = minted;
      this.trace('<- minted handle');
    }

    if (!response.ok) {
      let reason = `HTTP ${response.status}`;
      try {
        // Note the shape difference: a transport-level error body is
        // `{error: "<string>"}`, while a JSON-RPC error inside a 200 is
        // `{error: {message}}` and is handled in chat() instead.
        const errBody = (await response.json()) as { error?: string };
        if (errBody && errBody.error) reason = errBody.error;
      } catch {
        // Non-JSON error body (a proxy's HTML 502, say) — keep the status.
      }
      throw new GatewayError(response.status, reason);
    }

    return response;
  }

  /**
   * Open the conversation without sending a message, so the agent greets
   * first. Separate from `chat` because the auto-create path needs a message
   * to ride on, and a widget wants the greeting before the visitor types.
   *
   * This is the billable call: opening a conversation costs a turn, because
   * the greeting is a turn. Nothing else in this class does.
   */
  async start(): Promise<{ greeting: string | null; status: string; timeout: number | null }> {
    const response = await this.post({ method: 'start' });
    const data = await response.json();
    return {
      greeting: data.greeting ?? null,
      status: data.status,
      // The gateway sets conversation_timeout on create and reports it back,
      // so the page never has to be told the same number separately.
      timeout: typeof data.timeout === 'number' ? data.timeout : null
    };
  }

  /**
   * Send a turn.
   *
   * The gateway streams the service's JSON-RPC body through unbuffered so its
   * keepalive whitespace keeps intermediaries from severing a slow turn.
   * `response.json()` tolerates that padding — it is whitespace between
   * tokens, which JSON parsers ignore — so we do not need to strip it, but we
   * must not assume the body arrived in one chunk. Read the whole body; never
   * take a single chunk off the stream.
   */
  async chat(message: string): Promise<ChatResponse> {
    const response = await this.post({ method: 'chat', message });
    const data: JsonRpcResponse = await response.json();

    if (data.error) {
      // HTTP 200 with a JSON-RPC error. Status 200 means isAuthFailure is
      // false, so callers keep the handle — correct, since the conversation
      // itself is fine and only this turn failed.
      throw new GatewayError(200, data.error.message || 'chat failed');
    }

    const result = data.result || {};
    return {
      text: result.response || '',
      timestamp: result.server_time || new Date().toISOString(),
      metadata: result.metadata,
      user_event: result.user_event
    };
  }

  /**
   * The transcript for the handle's conversation — user and assistant turns
   * only. The gateway filters the system prompt and tool traffic out before
   * it reaches us, so a handle cannot be used to read the developer's prompt.
   *
   * A pure read: this must never be able to create a conversation, or a page
   * load would start billing.
   */
  async log(): Promise<{
    messages: VisibleMessage[];
    timeout: number | null;
    /** Epoch MILLISECONDS of the last turn, for bootstrapping an idle clock. */
    lastActivityMs: number | null;
  }> {
    const response = await this.post({ method: 'log' });
    const data = await response.json();
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      timeout: typeof data.timeout === 'number' ? data.timeout : null,
      // The gateway sends epoch seconds; everything in the browser wants ms.
      // A unit slip here is silent — it reads as "always fresh" and the
      // timeout notice simply never fires.
      lastActivityMs:
        typeof data.last_activity === 'number' ? data.last_activity * 1000 : null
    };
  }

  /** End the conversation server-side and drop the handle. */
  async end(): Promise<boolean> {
    if (!this.handle) return false;
    try {
      const response = await this.post({ method: 'end' });
      const data = await response.json();
      return data.status === 'ended';
    } finally {
      // Cleared even when the call throws: a failed `end` must still detach
      // this client, or it keeps presenting a handle to a conversation the
      // server may already have closed.
      this.handle = null;
    }
  }
}
