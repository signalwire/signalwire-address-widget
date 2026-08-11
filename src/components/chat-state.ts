/**
 * ChatState
 *
 * Accumulates AI-call transcript events into a renderable chat history.
 * Ported (with tighter types) from the old call-widget's Chat.ts FSM. The
 * FSM semantics are intentionally the same because they've been validated
 * in production for months:
 *
 *   - `ai.response_utterance` → AI is speaking. We buffer chunks into an
 *     "ai partial" bubble and append subsequent chunks.
 *   - `ai.completion` → AI finished. Promote the ai partial to a complete
 *     entry. If `barged`, lastSpoken flips to user (the user interrupted).
 *   - `ai.partial_result` → User is speaking mid-turn. Replace the user
 *     partial each emit (it's a running partial, not chunks).
 *   - `ai.speech_detect` → User finished speaking. Promote the user partial
 *     to a complete entry, replacing its text with the final corrected text.
 *
 * Both partials can coexist (e.g. user barges while AI is responding). When
 * they do, we render them in the order implied by `lastSpoken` — the more
 * recently speaking party's partial shows last.
 */

export type Speaker = 'ai' | 'user';
export type EntryState = 'partial' | 'complete';

/**
 * Which transport produced a turn. One transcript holds both after a medium
 * switch, so each entry has to remember where it came from: voice turns are
 * speech and render as plain text, chat turns are typed or generated and
 * render as markdown. Rendering speech as markdown would let a stray asterisk
 * in a transcription silently italicise half a sentence.
 */
export type Medium = 'voice' | 'chat';

/** A dialogue bubble. */
export interface BubbleEntry {
  kind: 'bubble';
  speaker: Speaker;
  text: string;
  state: EntryState;
  /** Defaults to `voice` when absent, for snapshots written before this existed. */
  medium?: Medium;
  /**
   * Epoch ms, set when the bubble commits. Partials have none — they are in
   * flight, and a timestamp on something still being said is meaningless.
   */
  ts?: number;
}

/**
 * A status line about the conversation rather than a turn in it — currently
 * only the chat idle-timeout notice.
 *
 * Its own kind rather than a styled-down bubble, so it cannot inherit bubble
 * padding, the avatar column, or a speaker alignment. It is centred, has no
 * timestamp, and renders as plain text.
 */
export interface NoticeEntry {
  kind: 'notice';
  text: string;
  ts: number;
}

/**
 * A content-chip entry — a compact placeholder left in the transcript each
 * time a `display_content` user_event is received. Clicking it reopens the
 * full content drawer for that payload. Stored fields are enough to render
 * the chip; the full payload lives on AddressWidget keyed by `id`.
 */
export interface ContentChipEntry {
  kind: 'content';
  id: string;
  title: string;
  preview: string;
  format: 'text' | 'markdown' | 'code' | 'html';
  language?: string;
}

/**
 * A coach-insight row — one-line agent-facing advice from an
 * `ai_sidecar` `insight` event. Rendered inline in the transcript with
 * a distinct visual treatment so it can't be missed mid-call. `tickId`
 * is the sidecar tick that produced it (useful for ordering /
 * deduplication if the server replays).
 */
export interface InsightEntry {
  kind: 'insight';
  text: string;
  /**
   * Eyebrow label rendered above the row. Defaults to "Coach" when
   * undefined; supply something like "Tool" for tool-result notes so
   * the user can tell coach hints from tool output at a glance.
   */
  label?: string;
  tickId?: number;
  ts: number;
}

export type ChatEntry = BubbleEntry | ContentChipEntry | InsightEntry | NoticeEntry;

export class ChatState {
  private _entries: ChatEntry[] = [];
  private _aiPartial: BubbleEntry | null = null;
  private _userPartial: BubbleEntry | null = null;
  private _lastSpoken: Speaker | null = null;

  /**
   * Which transport is currently feeding this transcript. Every committed
   * bubble is tagged with it, so a transcript that spans a medium switch can
   * render each half correctly. The widget flips this when it swaps.
   */
  public medium: Medium = 'voice';

  /** Invoked after any state change. Overridable by consumers. */
  public onUpdate: () => void = () => {
    /* noop */
  };

  /** Complete + any live partials, in render order. */
  public getHistory(): ChatEntry[] {
    const out = [...this._entries];
    if (this._aiPartial && this._userPartial) {
      if (this._lastSpoken === 'user') {
        // AI partial older, user partial latest → user shows last.
        out.push(this._aiPartial, this._userPartial);
      } else {
        out.push(this._userPartial, this._aiPartial);
      }
    } else if (this._aiPartial) {
      out.push(this._aiPartial);
    } else if (this._userPartial) {
      out.push(this._userPartial);
    }
    return out;
  }

  /** True if there is anything to show — the transcript panel reveals when this flips. */
  public get hasAny(): boolean {
    return this._entries.length > 0 || this._aiPartial !== null || this._userPartial !== null;
  }

  public get lastSpoken(): Speaker | null {
    return this._lastSpoken;
  }

  /** Reset to empty state (e.g. between calls). */
  public reset(): void {
    this._entries = [];
    this._aiPartial = null;
    this._userPartial = null;
    this._lastSpoken = null;
    this.onUpdate();
  }

  public onUserPartial(text: string, _barged: boolean): void {
    // Guard: an empty partial has nothing to show and would render as a
    // blank bubble. Backends occasionally emit these when ASR fires without
    // any recognized text (e.g. a stray silence frame). Drop silently.
    if (!text) return;
    this._userPartial = { kind: 'bubble', speaker: 'user', text, state: 'partial' };
    this._lastSpoken = 'user';
    this.onUpdate();
  }

  public onUserComplete(text: string, _barged: boolean): void {
    // Empty finalization: don't record a blank bubble. Clear any lingering
    // partial so the pending UI clears too, and bail. Matches the newer
    // SDK ChatState (packages/web-components/src/context/chat-state.ts).
    if (!text) {
      if (this._userPartial) {
        this._userPartial = null;
        this.onUpdate();
      }
      return;
    }
    // Both branches commit the same entry; the partial is cleared when there
    // was one. A speech_detect with no preceding partial is a race, not an
    // error, and is still recorded so the transcript stays complete.
    this._entries.push({
      kind: 'bubble',
      speaker: 'user',
      text,
      state: 'complete',
      medium: this.medium,
      ts: Date.now()
    });
    this._userPartial = null;
    this._lastSpoken = 'user';
    this.onUpdate();
  }

  public onAiChunk(text: string, _barged: boolean): void {
    // Empty chunk: nothing to append. Guarding here also protects the
    // template-literal concat below from ever producing a literal
    // "undefined" segment if a caller ever passes an unchecked value.
    if (!text) return;
    if (!this._aiPartial) {
      this._aiPartial = { kind: 'bubble', speaker: 'ai', text, state: 'partial' };
    } else {
      // Chunks are space-joined — matches server utterance behavior.
      this._aiPartial.text = `${this._aiPartial.text} ${text}`.replace(/\s+/g, ' ').trim();
    }
    this._lastSpoken = 'ai';
    this.onUpdate();
  }

  public onAiComplete(text: string, barged: boolean): void {
    if (this._aiPartial) {
      // Prefer the server's final text if it provided one; otherwise keep
      // the accumulated chunks.
      const finalText = text.length > 0 ? text : this._aiPartial.text;
      this._entries.push({
        kind: 'bubble',
        speaker: 'ai',
        text: finalText,
        state: 'complete',
        medium: this.medium,
        ts: Date.now()
      });
      this._aiPartial = null;
    } else if (text.length > 0) {
      this._entries.push({
        kind: 'bubble',
        speaker: 'ai',
        text,
        state: 'complete',
        medium: this.medium,
        ts: Date.now()
      });
    }
    // If the completion was due to the user barging the AI, the turn
    // conceptually transferred to the user; otherwise it stays with AI.
    this._lastSpoken = barged ? 'user' : 'ai';
    this.onUpdate();
  }

  /**
   * Append a content-chip entry for a `display_content` push. The chip
   * stays in the transcript once added; the full payload is kept on
   * AddressWidget and looked up by id when the chip is clicked.
   */
  public pushContent(entry: Omit<ContentChipEntry, 'kind'>): void {
    this._entries.push({ kind: 'content', ...entry });
    this.onUpdate();
  }

  /**
   * Append a coach-insight entry. Sidecar events stream in independently
   * of user/AI turns, so this just lands in the transcript at the moment
   * the event arrives. Auto-scroll keeps it visible.
   */
  public pushInsight(entry: Omit<InsightEntry, 'kind'>): void {
    this._entries.push({ kind: 'insight', ...entry });
    this.onUpdate();
  }

  /**
   * Append a status line about the conversation (the chat idle-timeout
   * notice). Not a turn, so it does not touch `_lastSpoken` — a notice
   * arriving mid-exchange must not reorder the live partials around it.
   */
  public pushNotice(text: string): void {
    if (!text) return;
    this._entries.push({ kind: 'notice', text, ts: Date.now() });
    this.onUpdate();
  }

  /**
   * Replace the transcript with a server-side one.
   *
   * Used when a stored chat handle replays an existing conversation: the
   * server's copy is authoritative and complete, so this replaces rather than
   * appends. Content chips and insights are dropped along with everything
   * else — they were delivered to a previous page load and their payloads
   * live in that load's memory.
   */
  public replaceWithTranscript(
    messages: Array<{ role: string; text: string; ts: number }>
  ): void {
    this._entries = messages
      .filter((m) => typeof m.text === 'string' && m.text.trim())
      .map((m) => ({
        kind: 'bubble' as const,
        speaker: m.role === 'user' ? ('user' as const) : ('ai' as const),
        text: m.text,
        state: 'complete' as const,
        medium: 'chat' as const,
        ts: m.ts
      }));
    this._aiPartial = null;
    this._userPartial = null;
    this._lastSpoken = null;
    this.onUpdate();
  }

  /**
   * Bulk-replace the completed entries with a snapshot. Used on reattach
   * to rehydrate from sessionStorage before any live subscriptions fire.
   * Partials are cleared — they're always in-flight, never persisted.
   *
   * Also filters bubbles whose text is missing / non-string / sentinel
   * ("undefined", "null", whitespace-only). This defends against snapshots
   * written by older widget builds that lacked the FSM's empty-text guards,
   * so a stale entry can't resurface as a blank or "undefined" bubble on
   * reload.
   */
  public loadSnapshot(entries: ChatEntry[]): void {
    this._entries = entries.filter((e) => {
      if (e.kind === 'content' || e.kind === 'insight' || e.kind === 'notice') return true;
      if (e.kind !== 'bubble' || e.state !== 'complete') return false;
      if (typeof e.text !== 'string') return false;
      const trimmed = e.text.trim();
      if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return false;
      return true;
    });
    this._aiPartial = null;
    this._userPartial = null;
    this._lastSpoken = null;
    this.onUpdate();
  }

  /** Return the committed (non-partial) entries in insertion order. */
  public getCommittedEntries(): ChatEntry[] {
    return [...this._entries];
  }
}
