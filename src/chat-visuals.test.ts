/**
 * The two chat visual affordances added for discoverability and "it's
 * thinking" feedback:
 *   - a typing indicator (three bouncing dots) while the agent composes;
 *   - labelled turquoise pills for the voice<->text medium switch, which
 *     stay ABSENT (not disabled) when the switch isn't possible.
 *
 * These render the view functions in isolation rather than through the whole
 * element+overlay, so they pin the markup contract — parts, labels, presence
 * — without standing up a call or a gateway.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { createRef } from 'lit/directives/ref.js';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';
import { renderTranscript } from './components/transcript';
import { renderComposer } from './components/composer';
import { renderControls } from './components/controls';

function mount(tpl: unknown): HTMLDivElement {
  const d = document.createElement('div');
  render(tpl as never, d);
  return d;
}

describe('typing indicator', () => {
  const base = {
    entries: [],
    visible: true,
    stacked: false,
    scrollRef: createRef<HTMLDivElement>(),
    openContentId: null,
    onContentClick: () => {}
  };

  it('renders three bouncing dots while a reply is awaited', () => {
    const d = mount(renderTranscript({ ...base, awaiting: true }));
    expect(d.querySelector('[part="typing"]')).toBeTruthy();
    expect(d.querySelectorAll('.typing-dot').length).toBe(3);
    // It is a status region for assistive tech, not silent decoration.
    expect(d.querySelector('[part="typing"]')?.getAttribute('role')).toBe('status');
  });

  it('is absent when not awaiting — no idle animation', () => {
    const d = mount(renderTranscript({ ...base, awaiting: false }));
    expect(d.querySelector('[part="typing"]')).toBeFalsy();
  });

  it('sits under the agent avatar when one is configured', () => {
    const d = mount(renderTranscript({ ...base, awaiting: true, avatarUrl: 'https://x/a.png' }));
    const row = d.querySelector('.bubble-row');
    expect(row?.querySelector('.avatar')).toBeTruthy();
    expect(row?.querySelector('[part="typing"]')).toBeTruthy();
  });
});

describe('switch-to-voice pill (composer)', () => {
  const base = {
    placeholder: '',
    busy: false,
    onSend: () => {},
    inputRef: createRef<HTMLTextAreaElement>()
  };

  it('is a labelled "Call" pill when voice is available', () => {
    const d = mount(renderComposer({ ...base, onSwitchToVoice: () => {} }));
    const btn = d.querySelector('[part="switch-to-voice"]');
    expect(btn).toBeTruthy();
    expect(btn?.querySelector('.composer-call-label')?.textContent).toBe('Call');
    // Label is visible text; the aria-label stays the fuller phrasing.
    expect(btn?.getAttribute('aria-label')).toBe('Switch to a voice call');
  });

  it('is absent (not disabled) when voice is not available', () => {
    const d = mount(renderComposer({ ...base }));
    expect(d.querySelector('[part="switch-to-voice"]')).toBeFalsy();
  });

  it('sits at the far right — after the input and the send button', () => {
    const d = mount(renderComposer({ ...base, onSwitchToVoice: () => {}, onEnd: () => {} }));
    const order = Array.from(d.querySelectorAll('[part]')).map((e) => e.getAttribute('part'));
    const call = order.indexOf('switch-to-voice');
    expect(call).toBeGreaterThan(order.indexOf('composer-input'));
    expect(call).toBeGreaterThan(order.indexOf('composer-send'));
    expect(call).toBeGreaterThan(order.indexOf('composer-end'));
  });

  it('carries a custom tooltip (data-tooltip) and no slow native title', () => {
    const d = mount(renderComposer({ ...base, onSwitchToVoice: () => {} }));
    const btn = d.querySelector('[part="switch-to-voice"]');
    expect(btn?.getAttribute('data-tooltip')).toMatch(/voice call/i);
    // The native title is deliberately gone — it is what we replaced.
    expect(btn?.getAttribute('title')).toBeNull();
  });
});

describe('switch-to-chat pill (controls)', () => {
  const base = {
    call: null,
    client: null,
    audioMuted: false,
    videoMuted: false,
    videoEnabled: true,
    audioInputDevices: [],
    videoInputDevices: [],
    selectedAudioInputId: null,
    selectedVideoInputId: null,
    onToggleAudio: () => {},
    onToggleVideo: () => {},
    onHangup: () => {},
    onSelectAudioDevice: () => {},
    onSelectVideoDevice: () => {}
  };

  it('is a labelled "Chat" pill with a custom tooltip when switching is available', () => {
    const d = mount(renderControls({ ...base, onSwitchToChat: () => {} }));
    const btn = d.querySelector('[part="switch-to-chat"]');
    expect(btn).toBeTruthy();
    expect(btn?.querySelector('.btn-switch-label')?.textContent).toBe('Chat');
    expect(btn?.getAttribute('data-tooltip')).toMatch(/chat/i);
    expect(btn?.getAttribute('title')).toBeNull();
  });

  it('is absent when switching is unavailable', () => {
    const d = mount(renderControls({ ...base }));
    expect(d.querySelector('[part="switch-to-chat"]')).toBeFalsy();
  });
});

describe('medium-switch transition screen', () => {
  function switchingFor(target: 'voice' | 'chat'): HTMLDivElement {
    const el = document.createElement('signalwire-address') as unknown as AddressWidget & {
      _switchTarget: 'voice' | 'chat' | null;
      _renderSwitching(): unknown;
    };
    el._switchTarget = target;
    const d = document.createElement('div');
    render(el._renderSwitching() as never, d);
    return d;
  }

  it('names the voice target and exposes a themeable part', () => {
    const d = switchingFor('voice');
    expect(d.querySelector('[part="switching"]')).toBeTruthy();
    expect(d.querySelector('.switching-label')?.textContent).toMatch(/voice call/i);
    // A status region so a screen reader announces the change of medium.
    expect(d.querySelector('[part="switching"]')?.getAttribute('role')).toBe('status');
  });

  it('names the chat target', () => {
    const d = switchingFor('chat');
    expect(d.querySelector('.switching-label')?.textContent).toMatch(/text chat/i);
  });
});
