/**
 * Visitor identity — one random id per browser, shared by every
 * `<signalwire-address>` on the origin and sent with each call and chat as
 * `metadata.visitor_id`, so an agent can recognise a returning caller.
 *
 * Layout:
 *   swaw:visitor → "<uuid v4>"
 *
 * Random, never derived from the device. Building an id out of screen size,
 * fonts and the like is what browser fingerprinting means: privacy-hostile,
 * and it collides across identical machines anyway. A random id claims only
 * what it can back up — this browser has been here before — and clearing
 * site data resets it.
 *
 * It is browser-authored, so an agent may use it as a hint (greet a returning
 * visitor, stitch transcripts together) but never as authentication: any page
 * can send any value.
 *
 * Storage errors (quota, privacy mode) are swallowed — the id degrades to one
 * that is stable for this page load only, rather than throwing.
 */

const KEY = 'swaw:visitor';

/** What we accept back from storage. Anything else is regenerated. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Held for the life of the page once read. Re-reading storage on every call
 * would let a second tab's first-visit write swap the id under a conversation
 * already in progress, splitting one visit's voice and chat halves across two
 * ids.
 */
let cached: string | null = null;

function safeLocal(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private browsing / disabled storage */
  }
  return null;
}

/** A fresh RFC 4122 version-4 UUID. */
export function newVisitorId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  // randomUUID exists only in secure contexts, so a plain-http page falls
  // through to building one by hand from the same CSPRNG.
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* not a secure context */
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // No crypto at all means no browser. Uniqueness is all an id needs here;
    // nothing about it is secret.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This browser's visitor id: read from storage, or minted and stored on the
 * first visit.
 */
export function getVisitorId(): string {
  if (cached) return cached;
  const store = safeLocal();
  try {
    const stored = store?.getItem(KEY);
    if (stored && UUID_V4.test(stored)) {
      cached = stored;
      return cached;
    }
  } catch {
    /* unreadable storage — mint one below */
  }
  cached = newVisitorId();
  try {
    store?.setItem(KEY, cached);
  } catch {
    /* quota / privacy mode — stable for this page load only */
  }
  return cached;
}

/** Test seam: forget the in-memory copy so the next read goes to storage. */
export function _resetVisitorIdCache(): void {
  cached = null;
}
