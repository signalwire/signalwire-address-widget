import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatState } from './chat-state';

describe('ChatState', () => {
  let state: ChatState;

  beforeEach(() => {
    state = new ChatState();
  });

  it('starts empty', () => {
    expect(state.getHistory()).toEqual([]);
    expect(state.hasAny).toBe(false);
    expect(state.lastSpoken).toBeNull();
  });

  it('fires onUpdate on every transition', () => {
    const spy = vi.fn();
    state.onUpdate = spy;
    state.onUserPartial('hello', false);
    state.onUserComplete('hello', false);
    state.onAiChunk('hi there', false);
    state.onAiComplete('hi there', false);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('renders a user partial bubble then promotes it to complete', () => {
    state.onUserPartial('hell', false);
    let hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({ kind: 'bubble', speaker: 'user', text: 'hell', state: 'partial' });

    state.onUserPartial('hello world', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    const first = hist[0];
    expect(first.kind).toBe('bubble');
    if (first.kind === 'bubble') expect(first.text).toBe('hello world');

    state.onUserComplete('hello world.', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    // Committed bubbles carry `medium` and `ts`; partials do not, since a
    // timestamp on something still being said is meaningless.
    expect(hist[0]).toMatchObject({
      kind: 'bubble',
      speaker: 'user',
      text: 'hello world.',
      state: 'complete',
      medium: 'voice'
    });
    expect((hist[0] as { ts?: number }).ts).toBeTypeOf('number');
    expect(state.lastSpoken).toBe('user');
  });

  it('accumulates AI chunks into one partial until completion', () => {
    state.onAiChunk('Welcome', false);
    state.onAiChunk('to SignalWire.', false);
    let hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({
      kind: 'bubble',
      speaker: 'ai',
      text: 'Welcome to SignalWire.',
      state: 'partial'
    });

    state.onAiComplete('Welcome to SignalWire.', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    const entry = hist[0];
    expect(entry.kind).toBe('bubble');
    if (entry.kind === 'bubble') expect(entry.state).toBe('complete');
    expect(state.lastSpoken).toBe('ai');
  });

  it('renders both partials when user barges into AI and orders by lastSpoken', () => {
    state.onAiChunk('Please hold while', false);
    state.onUserPartial('stop', false);
    const hist = state.getHistory();

    // Two live partials — user was most recent, so user shows last.
    expect(hist).toHaveLength(2);
    const [a, b] = hist;
    expect(a.kind).toBe('bubble');
    expect(b.kind).toBe('bubble');
    if (a.kind === 'bubble' && b.kind === 'bubble') {
      expect(a.speaker).toBe('ai');
      expect(a.state).toBe('partial');
      expect(b.speaker).toBe('user');
      expect(b.state).toBe('partial');
    }
    expect(state.lastSpoken).toBe('user');
  });

  it('handles barged AI completion by flipping lastSpoken to user', () => {
    state.onAiChunk('One moment', false);
    state.onUserPartial('actually', false);
    state.onAiComplete('One moment', true); // barged
    expect(state.lastSpoken).toBe('user');

    // AI partial is promoted to a complete entry, user partial still live.
    const hist = state.getHistory();
    expect(hist).toHaveLength(2);
    const bubbles = hist.filter((e): e is Extract<typeof e, { kind: 'bubble' }> => e.kind === 'bubble');
    const aiEntries = bubbles.filter((e) => e.speaker === 'ai');
    const userEntries = bubbles.filter((e) => e.speaker === 'user');
    expect(aiEntries).toHaveLength(1);
    expect(aiEntries[0].state).toBe('complete');
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0].state).toBe('partial');
  });

  it('records a user_complete even if no prior partial existed', () => {
    state.onUserComplete('hi there', false);
    const hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      kind: 'bubble',
      speaker: 'user',
      text: 'hi there',
      state: 'complete'
    });
  });

  it('records an ai_complete without a prior chunk if text is non-empty', () => {
    state.onAiComplete('Hello!', false);
    const hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      kind: 'bubble',
      speaker: 'ai',
      text: 'Hello!',
      state: 'complete'
    });
  });

  it('ignores an ai_complete with empty text and no prior chunk', () => {
    state.onAiComplete('', false);
    expect(state.getHistory()).toEqual([]);
  });

  it('drops empty user partials silently', () => {
    state.onUserPartial('', false);
    expect(state.getHistory()).toEqual([]);
    expect(state.hasAny).toBe(false);
  });

  it('drops empty user completions and clears any lingering partial', () => {
    state.onUserPartial('hell', false);
    expect(state.hasAny).toBe(true);
    state.onUserComplete('', false);
    expect(state.getHistory()).toEqual([]);
    expect(state.hasAny).toBe(false);
  });

  it('drops empty AI chunks without creating a blank partial', () => {
    state.onAiChunk('', false);
    expect(state.getHistory()).toEqual([]);
    expect(state.hasAny).toBe(false);
  });

  it('keeps prior AI chunks intact when a later chunk is empty', () => {
    state.onAiChunk('hello there', false);
    state.onAiChunk('', false);
    state.onAiChunk('friend', false);
    const hist = state.getHistory();
    expect(hist).toHaveLength(1);
    if (hist[0].kind === 'bubble') expect(hist[0].text).toBe('hello there friend');
  });

  it('preserves order across multiple turns', () => {
    // Turn 1: user says something
    state.onUserPartial('hello', false);
    state.onUserComplete('hello.', false);
    // Turn 1 reply: AI answers
    state.onAiChunk('Hi,', false);
    state.onAiChunk('how can I help?', false);
    state.onAiComplete('Hi, how can I help?', false);
    // Turn 2: user asks
    state.onUserPartial('wha', false);
    state.onUserComplete("what's the time?", false);
    // Turn 2 reply: AI answers
    state.onAiChunk("It's 3 PM.", false);
    state.onAiComplete("It's 3 PM.", false);

    const hist = state.getHistory();
    const summary = hist.map((e) =>
      e.kind === 'bubble' ? `${e.speaker}:${e.state}:${e.text}` : `content:${e.id}`
    );
    expect(summary).toEqual([
      'user:complete:hello.',
      'ai:complete:Hi, how can I help?',
      "user:complete:what's the time?",
      "ai:complete:It's 3 PM."
    ]);
  });

  it('tags committed bubbles with the active medium', () => {
    state.onUserComplete('by voice', false);
    state.medium = 'chat';
    state.onUserComplete('by text', false);

    const bubbles = state
      .getHistory()
      .filter((e): e is Extract<typeof e, { kind: 'bubble' }> => e.kind === 'bubble');
    expect(bubbles.map((b) => b.medium)).toEqual(['voice', 'chat']);
  });

  it('does not tag partials with a timestamp', () => {
    state.onUserPartial('still talking', false);
    const partial = state.getHistory()[0] as { ts?: number };
    expect(partial.ts).toBeUndefined();
  });

  it('appends a notice without disturbing turn order', () => {
    state.onUserComplete('hello', false);
    state.pushNotice('This conversation timed out.');
    const hist = state.getHistory();
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ kind: 'notice', text: 'This conversation timed out.' });
    // A notice is not a turn — it must not claim the floor.
    expect(state.lastSpoken).toBe('user');
  });

  it('ignores an empty notice', () => {
    state.pushNotice('');
    expect(state.getHistory()).toEqual([]);
  });

  it('replaceWithTranscript replaces rather than appends, and marks chat', () => {
    state.onUserComplete('from a previous life', false);
    state.replaceWithTranscript([
      { role: 'assistant', text: 'Hi there', ts: 1000 },
      { role: 'user', text: 'hello', ts: 2000 },
      { role: 'assistant', text: '   ', ts: 3000 } // blank turns dropped
    ]);
    const hist = state.getHistory();
    expect(hist).toHaveLength(2);
    expect(hist.map((e) => (e.kind === 'bubble' ? e.text : ''))).toEqual([
      'Hi there',
      'hello'
    ]);
    expect(hist.every((e) => e.kind === 'bubble' && e.medium === 'chat')).toBe(true);
    // Server timestamps are preserved, not restamped with the reload's clock.
    expect((hist[0] as { ts?: number }).ts).toBe(1000);
  });

  it('loadSnapshot keeps notices alongside bubbles and chips', () => {
    state.loadSnapshot([
      { kind: 'bubble', speaker: 'user', text: 'hi', state: 'complete' },
      { kind: 'notice', text: 'timed out', ts: 1 },
      { kind: 'bubble', speaker: 'ai', text: '', state: 'complete' } // dropped
    ]);
    expect(state.getHistory().map((e) => e.kind)).toEqual(['bubble', 'notice']);
  });

  it('reset() clears all state', () => {
    state.onAiChunk('hi', false);
    state.onUserPartial('hey', false);
    state.onAiComplete('hi', false);
    expect(state.hasAny).toBe(true);

    state.reset();
    expect(state.hasAny).toBe(false);
    expect(state.getHistory()).toEqual([]);
    expect(state.lastSpoken).toBeNull();
  });
});
