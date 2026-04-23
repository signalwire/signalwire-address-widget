/**
 * SignalWire client wrapper.
 *
 * Thin adapter over @signalwire/js that matches the shape of our widget's
 * needs. Holds the client instance, exposes a `dial` that merges user
 * variables into the call's preferences before inviting, and cleans up on
 * disconnect.
 *
 * Token lifetime: passed at construction, used once to construct the
 * credential provider, then held only by that provider (not by the widget).
 * The token string is never persisted anywhere.
 */

import { SignalWire, StaticCredentialProvider } from '@signalwire/js';
import type { Call } from '@signalwire/js';

export interface ClientDialOptions {
  /** Destination address to dial, e.g. `/public/agent`. */
  destination: string;
  /** Enable outgoing audio. Defaults to true. */
  audio?: boolean;
  /** Enable outgoing video. Defaults to true. */
  video?: boolean;
  /**
   * Audio-processing constraints fed through to `getUserMedia` via the
   * SDK's `inputAudioDeviceConstraints` option. Typical fields:
   * `echoCancellation`, `noiseSuppression`, `autoGainControl`.
   */
  inputAudioDeviceConstraints?: MediaTrackConstraints;
  /**
   * User variables merged into the client's preferences before dial.
   * The destination receives them on the session (SWML `result.user_data`).
   */
  userVariables?: Record<string, unknown>;
}

export interface ConnectedClient {
  /** The underlying SignalWire client instance. */
  readonly client: SignalWire;
  /** Place a call. Resolves when the call session is created and ringing. */
  dial(options: ClientDialOptions): Promise<Call>;
  /** Tear down the client and release resources. Idempotent. */
  disconnect(): void;
}

/**
 * Connect a SignalWire client with a SAT.
 *
 * Constructs a {@link StaticCredentialProvider} from the token and wires it
 * into a new {@link SignalWire} instance. Caller receives a `dial` helper
 * that applies our widget's defaults and a `disconnect` helper to unwind.
 *
 * @throws If the token is empty. Network/auth errors surface on the first
 *         `dial` call, not at construction.
 */
export async function connectClient(token: string): Promise<ConnectedClient> {
  if (!token) {
    throw new Error('[address-widget] token is required');
  }

  const provider = new StaticCredentialProvider({ token });
  // `reconnectAttachedCalls` + `persistSession` together let the SDK
  // reattach to an active call after a page reload: it stores active
  // call IDs in sessionStorage and, when the same session comes back,
  // waits for the server-pushed `verto.attach`. `client.session.calls`
  // then exposes the reattached Call. Our own AddressWidget is the thing
  // that maps that Call → "reopen the overlay for widget <widgetId>".
  const client = new SignalWire(provider, {
    reconnectAttachedCalls: true,
    persistSession: true
  });

  async function dial({
    destination,
    audio = true,
    video = true,
    inputAudioDeviceConstraints,
    userVariables
  }: ClientDialOptions): Promise<Call> {
    if (!destination) {
      throw new Error('[address-widget] destination is required');
    }

    // Seed userVariables via client preferences before creating the call —
    // this is the public-API path into the verto.invite envelope in the new
    // SDK. (Older SDK accepted userVariables on dial directly; in the new
    // one preferences are the sanctioned source and the Call picks them up
    // at creation time.)
    if (userVariables && Object.keys(userVariables).length > 0) {
      const prefs = client.preferences as unknown as {
        userVariables?: Record<string, unknown>;
      };
      prefs.userVariables = {
        ...(prefs.userVariables ?? {}),
        ...userVariables
      };
    }

    const call = await client.dial(destination, {
      audio,
      video,
      receiveAudio: true,
      receiveVideo: video,
      // Only pass constraints when audio is actually enabled; passing them
      // alongside audio:false is a no-op but keeps the log cleaner.
      ...(audio && inputAudioDeviceConstraints
        ? { inputAudioDeviceConstraints }
        : {})
    });

    return call;
  }

  function disconnect(): void {
    // Destroyable exposes destroy() on the SignalWire class. Guard so an
    // unexpected SDK rename doesn't crash us on teardown.
    try {
      (client as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      /* noop */
    }
  }

  return { client, dial, disconnect };
}
