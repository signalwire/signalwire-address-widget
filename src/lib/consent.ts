/**
 * Consent persistence — origin-wide localStorage record so the user
 * confirms once and all `<signalwire-address>` instances on the site
 * share the same answer until either the widget's `consent-version`
 * is bumped or the user edits their preference.
 *
 * Layout:
 *   swaw:consent → { audio: boolean, video: boolean, ts: ISO, version: int }
 *
 * Storage errors (quota, privacy mode) are swallowed — consent
 * gracefully degrades to "re-prompt every time" rather than crashing.
 */

const KEY = 'swaw:consent';

export interface ConsentRecord {
  /** Consent to share audio. Required for an AI voice call to function. */
  audio: boolean;
  /**
   * Whether the recording may be used to train future AI models.
   * Distinct from `audio` (which gates whether recording happens at
   * all). When false, the agent / server should retain the call for
   * evaluation and debugging only, not training corpora.
   */
  train: boolean;
  /**
   * Per-call PREFERENCE (not consent): whether to start with the
   * camera sending. Receiving the remote video (so the user sees the
   * agent) is independent — that stays on whenever the widget is in
   * video mode. We don't store outgoing video, so it's not a consent
   * surface; this flag just controls the initial mute state of the
   * user's camera track.
   */
  camera: boolean;
  /** Selected microphone deviceId, or null = browser default. */
  audioDeviceId: string | null;
  /** Selected camera deviceId, or null = browser default. */
  videoDeviceId: string | null;
  /** ISO 8601 timestamp of when the user accepted. */
  ts: string;
  /** Schema / policy version the user accepted under. */
  version: number;
}

function safeLocal(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private browsing / disabled storage */
  }
  return null;
}

/**
 * Read the stored consent record, validating shape and matching the
 * provided `expectedVersion`. Returns null when missing, malformed, or
 * outdated — the caller should re-prompt in all three cases.
 */
export function readConsent(expectedVersion: number): ConsentRecord | null {
  const store = safeLocal();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (
      typeof parsed.audio !== 'boolean' ||
      typeof parsed.ts !== 'string' ||
      typeof parsed.version !== 'number'
    ) {
      return null;
    }
    if (parsed.version !== expectedVersion) return null;
    return {
      audio: parsed.audio,
      train: typeof parsed.train === 'boolean' ? parsed.train : true,
      camera: typeof parsed.camera === 'boolean' ? parsed.camera : true,
      audioDeviceId: typeof parsed.audioDeviceId === 'string' ? parsed.audioDeviceId : null,
      videoDeviceId: typeof parsed.videoDeviceId === 'string' ? parsed.videoDeviceId : null,
      ts: parsed.ts,
      version: parsed.version
    };
  } catch {
    return null;
  }
}

/**
 * Write a consent record under the given version. Timestamp is set
 * to "now".
 */
export function writeConsent(
  audio: boolean,
  version: number,
  train: boolean = true,
  camera: boolean = true,
  audioDeviceId: string | null = null,
  videoDeviceId: string | null = null
): ConsentRecord {
  const record: ConsentRecord = {
    audio,
    train,
    camera,
    audioDeviceId,
    videoDeviceId,
    ts: new Date().toISOString(),
    version
  };
  const store = safeLocal();
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(record));
    } catch {
      /* quota — record still returned for in-memory use */
    }
  }
  return record;
}

/** Drop any stored consent. Used when the user explicitly resets. */
export function clearConsent(): void {
  const store = safeLocal();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* noop */
  }
}
