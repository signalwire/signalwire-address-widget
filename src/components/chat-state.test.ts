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
    expect(hist[0]).toEqual({ speaker: 'user', text: 'hell', state: 'partial' });

    state.onUserPartial('hello world', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].text).toBe('hello world');

    state.onUserComplete('hello world.', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({ speaker: 'user', text: 'hello world.', state: 'complete' });
    expect(state.lastSpoken).toBe('user');
  });

  it('accumulates AI chunks into one partial until completion', () => {
    state.onAiChunk('Welcome', false);
    state.onAiChunk('to SignalWire.', false);
    let hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({
      speaker: 'ai',
      text: 'Welcome to SignalWire.',
      state: 'partial'
    });

    state.onAiComplete('Welcome to SignalWire.', false);
    hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].state).toBe('complete');
    expect(state.lastSpoken).toBe('ai');
  });

  it('renders both partials when user barges into AI and orders by lastSpoken', () => {
    state.onAiChunk('Please hold while', false);
    state.onUserPartial('stop', false);
    const hist = state.getHistory();

    // Two live partials — user was most recent, so user shows last.
    expect(hist).toHaveLength(2);
    expect(hist[0].speaker).toBe('ai');
    expect(hist[0].state).toBe('partial');
    expect(hist[1].speaker).toBe('user');
    expect(hist[1].state).toBe('partial');
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
    const aiEntries = hist.filter((e) => e.speaker === 'ai');
    const userEntries = hist.filter((e) => e.speaker === 'user');
    expect(aiEntries).toHaveLength(1);
    expect(aiEntries[0].state).toBe('complete');
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0].state).toBe('partial');
  });

  it('records a user_complete even if no prior partial existed', () => {
    state.onUserComplete('hi there', false);
    const hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({ speaker: 'user', text: 'hi there', state: 'complete' });
  });

  it('records an ai_complete without a prior chunk if text is non-empty', () => {
    state.onAiComplete('Hello!', false);
    const hist = state.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({ speaker: 'ai', text: 'Hello!', state: 'complete' });
  });

  it('ignores an ai_complete with empty text and no prior chunk', () => {
    state.onAiComplete('', false);
    expect(state.getHistory()).toEqual([]);
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
    expect(hist.map((e) => `${e.speaker}:${e.state}:${e.text}`)).toEqual([
      'user:complete:hello.',
      'ai:complete:Hi, how can I help?',
      "user:complete:what's the time?",
      "ai:complete:It's 3 PM."
    ]);
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
