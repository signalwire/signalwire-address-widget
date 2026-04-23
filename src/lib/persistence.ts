/**
 * sessionStorage persistence for reattach across page reloads.
 *
 * Layout:
 *   swaw:last                              → LastEntry         (pointer: "which widget had the active call")
 *   swaw:chat/<widgetId>/<callId>          → ChatSnapshot      (full transcript for rehydration)
 *   swaw:content/<widgetId>/<callId>       → ContentSnapshot   (display_content history for rehydration)
 *
 * Every helper swallows Storage errors (quota exceeded, privacy mode)
 * because none of this is load-bearing — reattach is a nice-to-have;
 * the widget functions fine without any of these entries.
 */

import type { ChatEntry } from '../components/chat-state';
import type { DisplayContentPayload } from '../types';

const KEY_LAST = 'swaw:last';
const KEY_CHAT_PREFIX = 'swaw:chat/';
const KEY_CONTENT_PREFIX = 'swaw:content/';

/**
 * Max age (ms) for a "last" pointer before we treat it as stale and
 * sweep. Matches the SDK's default `reconnectCallsTimeout` (300s) plus
 * a 60s margin so we're not racing expiry from the caller's side.
 */
const STALE_MS = (300 + 60) * 1000;

/** Pointer entry written once per live call. */
export interface LastEntry {
  widgetId: string;
  callId: string;
  destination: string;
  savedAt: number;
}

/** Snapshot of the chat transcript — exactly what ChatState returns. */
export type ChatSnapshot = ChatEntry[];

/** Snapshot of display_content history in chip-order. */
export interface ContentSnapshotEntry {
  id: string;
  payload: DisplayContentPayload;
}
export type ContentSnapshot = ContentSnapshotEntry[];

function safeStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    /* privacy mode / disabled cookies — getter throws */
  }
  return null;
}

function safeRead<T>(key: string): T | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Malformed JSON — treat as absent so the caller can sweep it.
    return null;
  }
}

function safeWrite(key: string, value: unknown): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded, serialize cycle — persistence is best-effort */
  }
}

function safeRemove(key: string): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* noop */
  }
}

/**
 * Validate a LastEntry. Returns the entry when it passes; null when it's
 * malformed, missing fields, or stale past STALE_MS. Callers should
 * sweep on a null return.
 */
export function readValidLast(): LastEntry | null {
  const raw = safeRead<Partial<LastEntry>>(KEY_LAST);
  if (!raw) return null;
  const { widgetId, callId, destination, savedAt } = raw;
  if (
    typeof widgetId !== 'string' ||
    typeof callId !== 'string' ||
    typeof destination !== 'string' ||
    typeof savedAt !== 'number'
  ) {
    return null;
  }
  if (Date.now() - savedAt > STALE_MS) return null;
  return { widgetId, callId, destination, savedAt };
}

export function writeLast(entry: Omit<LastEntry, 'savedAt'>): void {
  safeWrite(KEY_LAST, { ...entry, savedAt: Date.now() });
}

export function clearLast(): void {
  safeRemove(KEY_LAST);
}

export function chatKey(widgetId: string, callId: string): string {
  return `${KEY_CHAT_PREFIX}${widgetId}/${callId}`;
}

export function contentKey(widgetId: string, callId: string): string {
  return `${KEY_CONTENT_PREFIX}${widgetId}/${callId}`;
}

export function readChat(widgetId: string, callId: string): ChatSnapshot | null {
  return safeRead<ChatSnapshot>(chatKey(widgetId, callId));
}

export function writeChat(widgetId: string, callId: string, entries: ChatSnapshot): void {
  safeWrite(chatKey(widgetId, callId), entries);
}

export function readContent(widgetId: string, callId: string): ContentSnapshot | null {
  return safeRead<ContentSnapshot>(contentKey(widgetId, callId));
}

export function writeContent(
  widgetId: string,
  callId: string,
  entries: ContentSnapshot
): void {
  safeWrite(contentKey(widgetId, callId), entries);
}

/**
 * Delete all three keys for a specific call. Called on hangup, reattach
 * failure, and terminal recovery failure.
 */
export function clearCall(widgetId: string, callId: string): void {
  safeRemove(chatKey(widgetId, callId));
  safeRemove(contentKey(widgetId, callId));
  // Only clear `last` if it still points at this call — another widget
  // on the same page might have written a newer pointer.
  const last = safeRead<Partial<LastEntry>>(KEY_LAST);
  if (last?.widgetId === widgetId && last?.callId === callId) {
    safeRemove(KEY_LAST);
  }
}

/**
 * Sweep orphaned chat/content entries for a given widgetId. An entry is
 * orphaned when:
 *   - it belongs to this widget, AND
 *   - the current `swaw:last` pointer doesn't reference its callId
 *     (either because `last` is missing / for a different call / for a
 *     different widget)
 *
 * Scoped per-widget so a sibling widget's active state isn't affected.
 */
export function sweepOrphans(widgetId: string): void {
  const store = safeStorage();
  if (!store) return;
  const last = readValidLast();
  const activeCallId = last?.widgetId === widgetId ? last.callId : null;
  const chatPrefix = `${KEY_CHAT_PREFIX}${widgetId}/`;
  const contentPrefix = `${KEY_CONTENT_PREFIX}${widgetId}/`;
  const toDelete: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key) continue;
    if (key.startsWith(chatPrefix) || key.startsWith(contentPrefix)) {
      const callIdInKey = key.slice(key.lastIndexOf('/') + 1);
      if (callIdInKey !== activeCallId) toDelete.push(key);
    }
  }
  for (const key of toDelete) safeRemove(key);
}
