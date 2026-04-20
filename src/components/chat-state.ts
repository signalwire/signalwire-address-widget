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

export interface ChatEntry {
  speaker: Speaker;
  text: string;
  state: EntryState;
}

export class ChatState {
  private _entries: ChatEntry[] = [];
  private _aiPartial: ChatEntry | null = null;
  private _userPartial: ChatEntry | null = null;
  private _lastSpoken: Speaker | null = null;

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
    this._userPartial = { speaker: 'user', text, state: 'partial' };
    this._lastSpoken = 'user';
    this.onUpdate();
  }

  public onUserComplete(text: string, _barged: boolean): void {
    if (this._userPartial) {
      this._entries.push({ speaker: 'user', text, state: 'complete' });
      this._userPartial = null;
    } else {
      // Some races: speech_detect without a preceding partial. Still record
      // it so the transcript is complete.
      this._entries.push({ speaker: 'user', text, state: 'complete' });
    }
    this._lastSpoken = 'user';
    this.onUpdate();
  }

  public onAiChunk(text: string, _barged: boolean): void {
    if (!this._aiPartial) {
      this._aiPartial = { speaker: 'ai', text, state: 'partial' };
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
      this._entries.push({ speaker: 'ai', text: finalText, state: 'complete' });
      this._aiPartial = null;
    } else if (text.length > 0) {
      this._entries.push({ speaker: 'ai', text, state: 'complete' });
    }
    // If the completion was due to the user barging the AI, the turn
    // conceptually transferred to the user; otherwise it stays with AI.
    this._lastSpoken = barged ? 'user' : 'ai';
    this.onUpdate();
  }
}
