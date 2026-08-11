/**
 * The medium picker renders, and — more importantly — nothing starts behind
 * it. The whole reason it is a screen rather than two launcher buttons is
 * that opening a medium costs a billable turn, so "it appeared" is only half
 * the assertion worth making.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';

const TOKEN = 'fake-sat';
const DEST = '/public/sigmond';

function makeWidget(props: Partial<Record<string, unknown>> = {}): AddressWidget {
  const el = document.createElement('signalwire-address') as AddressWidget;
  el.token = TOKEN;
  el.destination = DEST;
  el.mode = 'both';
  el.defaultMode = 'ask';
  el.gatewayUrl = '/sigmond/chat/';
  el.chatKey = 'pk_test';
  // The picker must precede the consent gate, but leaving consent on would
  // make these tests about the modal instead.
  el.consentRequired = false;
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

function pickerText(el: AddressWidget): string {
  return el.shadowRoot?.querySelector('.picker')?.textContent ?? '';
}

describe('medium picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders on open when mode=both and default-mode=ask', async () => {
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.picker')).toBeTruthy();
    expect(pickerText(el)).toContain('How do you want to talk');
    expect(el.shadowRoot?.querySelector('[part="picker-voice"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[part="picker-chat"]')).toBeTruthy();
  });

  it('starts nothing while the picker is up', async () => {
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    // No call, and no controls dock — the overlay must not wear a call's
    // chrome while it is still asking which medium to use.
    expect((el as unknown as { _call: unknown })._call).toBeNull();
    expect(el.shadowRoot?.querySelector('[part="controls"]')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('[part="composer"]')).toBeFalsy();
  });

  it('does NOT ask when default-mode names a medium', async () => {
    const el = makeWidget({ defaultMode: 'voice' });
    await el.updateComplete;
    await el.open();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
  });

  it('does NOT ask when chat is unconfigured', async () => {
    // Asking someone to choose between two things when one cannot work is
    // worse than silently doing the one that can.
    const el = makeWidget({ chatKey: '' });
    await el.updateComplete;
    await el.open();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
  });

  it('asks BEFORE the consent gate, as the demo is configured', async () => {
    // The demo leaves consent-required on (the default). The picker has to
    // come first: consent is about recording a call, and at this point we do
    // not yet know the visitor wants a call at all. Asking to record before
    // they have chosen a medium would be asking about something that may
    // never happen.
    const el = makeWidget({ consentRequired: true });
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.picker')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('dialog.consent')).toBeFalsy();
  });

  it('chat mode renders no call surface, and offers a way back to voice', async () => {
    // Both halves were shipped broken: the video frame rendered
    // unconditionally, so a text conversation sat next to a poster saying
    // "Connecting call" about a call that was never going to happen; and
    // switchToVoice existed with no button anywhere to reach it.
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="picker-chat"]')?.click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[part="video-frame"]')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('[part="controls"]')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('[part="composer"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[part="switch-to-voice"]')).toBeTruthy();
    // Full width rather than the sidebar column that exists to flank a video.
    expect(el.shadowRoot?.querySelector('.chat-region')?.getAttribute('data-stacked')).toBe('true');

    // Control for the four assertions above. Those selectors have to be able
    // to match, or "absent in chat mode" proves nothing — a typo'd part name
    // would pass every one of them. Flipping the medium back is the narrowest
    // way to show it: same DOM, same render, only _activeMedium changed.
    // (Going through open() cannot demonstrate this — the dial fails without
    // a network and an error replaces the whole overlay body.)
    const internal = el as unknown as { _activeMedium: string; _error: string | null };
    internal._activeMedium = 'voice';
    internal._error = null;
    el.requestUpdate();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[part="video-frame"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[part="controls"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[part="composer"]')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('.chat-region')?.getAttribute('data-stacked')).toBe('false');
  });

  it('a chat_handoff does not close the overlay', async () => {
    // Regression: _teardown() hangs up, call.status$ goes 'disconnected',
    // and the call-ended subscriber closed the whole widget — so pressing
    // the chat button made everything vanish instead of switching.
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    const internal = el as unknown as {
      _switchingMedium: boolean;
      _overlayState: string;
      _handleChatHandoff: (p: { type: string; handle: string }) => Promise<void>;
    };

    // Drive the handoff; the gateway call will fail (no server here), which
    // is fine — what matters is the overlay surviving the teardown, and the
    // flag being cleared afterwards even on that failure.
    await internal._handleChatHandoff({ type: 'chat_handoff', handle: 'h' });
    await el.updateComplete;

    expect(internal._overlayState).not.toBe('closed');
    expect(internal._switchingMedium).toBe(false);
  });

  it('keeps the chat transcript across a close/reopen', async () => {
    // Regression: close() reset the transcript unconditionally, but a chat
    // conversation is still live server-side and restore()'s one-shot guard
    // has already fired — so reopening showed a blank panel attached to a
    // conversation the agent still remembered.
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    const internal = el as unknown as {
      _chat: { onUserComplete: (t: string, b: boolean) => void; hasAny: boolean };
      _chatSession: { isActive: boolean } | null;
      _activeMedium: string;
    };

    // Simulate a live chat with something in it.
    internal._activeMedium = 'chat';
    internal._chat.onUserComplete('what are oranges?', false);
    expect(internal._chat.hasAny).toBe(true);
    // Minimal stand-in for a live session. Every method the widget calls on
    // it has to exist, including the teardown ones — an incomplete stub
    // throws inside disconnectedCallback and pollutes the NEXT test.
    Object.defineProperty(internal, '_chatSession', {
      value: {
        isActive: true,
        handleClose: async () => {},
        ensureStarted: async () => {},
        restore: async () => {},
        destroy: () => {}
      },
      configurable: true
    });

    await el.close();
    await el.updateComplete;

    expect(internal._chat.hasAny).toBe(true); // survived the close
    await el.open();
    await el.updateComplete;
    // Straight back into the conversation, not the picker.
    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
  });

  it('restores chat when gateway-url is set as a property AFTER mount', async () => {
    // The demo — and the documented pattern, since the gateway URL is only
    // known at runtime — does `el.gatewayUrl = ...` from a script after the
    // element is in the DOM. connectedCallback has already run by then, so a
    // restore attempted there sees an unconfigured widget and silently never
    // happens: reload a live chat and it comes back blank.
    const el = document.createElement('signalwire-address') as AddressWidget;
    el.token = TOKEN;
    el.destination = DEST;
    el.mode = 'both';
    el.consentRequired = false;
    document.body.appendChild(el);
    await el.updateComplete;

    const internal = el as unknown as { _chatRestoreAttempted: boolean };
    expect(internal._chatRestoreAttempted).toBe(false); // nothing to restore into yet

    // Host configures us late, exactly as the demo page does.
    el.gatewayUrl = '/sigmond/chat/';
    el.chatKey = 'pk_test';
    await el.updateComplete;

    expect(internal._chatRestoreAttempted).toBe(true);
  });

  it('does NOT ask when mode is not both', async () => {
    const el = makeWidget({ mode: 'chat' });
    await el.updateComplete;
    await el.open();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
  });

  it('choosing does not bounce back to the picker', async () => {
    // The choice handlers re-enter open() so the dial keeps its consent gate
    // and beforedial event. Without the bypass latch that is an infinite loop.
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    const voiceBtn = el.shadowRoot?.querySelector<HTMLButtonElement>('[part="picker-voice"]');
    expect(voiceBtn).toBeTruthy();
    voiceBtn!.click();
    await el.updateComplete;
    // Give the re-entered open() a turn to settle.
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
    expect((el as unknown as { _picking: boolean })._picking).toBe(false);
  });
});

describe('agent avatar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function widgetWithChat(avatar: string | null) {
    const el = document.createElement('signalwire-address') as AddressWidget;
    el.token = TOKEN;
    el.destination = DEST;
    el.mode = 'both';
    el.gatewayUrl = '/sigmond/chat/';
    el.chatKey = 'pk_test';
    el.consentRequired = false;
    el.avatarUrl = avatar;
    document.body.appendChild(el);
    return el;
  }

  async function withReply(el: AddressWidget) {
    const internal = el as unknown as {
      _chat: { medium: string; onAiComplete: (t: string, b: boolean) => void };
      _overlayState: string;
    };
    internal._overlayState = 'open';
    internal._chat.medium = 'chat';
    internal._chat.onAiComplete('hello there', false);
    el.requestUpdate();
    await el.updateComplete;
  }

  it('renders beside an agent reply, not a user turn', async () => {
    const el = widgetWithChat('https://example.com/siggy.png');
    await el.updateComplete;
    await withReply(el);

    const imgs = el.shadowRoot?.querySelectorAll('.avatar img');
    expect(imgs?.length).toBe(1);
    expect(imgs?.[0].getAttribute('src')).toContain('siggy.png');
    // aria-hidden with empty alt: it repeats on every reply and carries no
    // information a screen reader needs.
    expect(el.shadowRoot?.querySelector('.avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(imgs?.[0].getAttribute('alt')).toBe('');
  });

  it('renders nothing when no avatar is configured', async () => {
    const el = widgetWithChat(null);
    await el.updateComplete;
    await withReply(el);
    expect(el.shadowRoot?.querySelector('.avatar')).toBeFalsy();
  });

  it('retires the avatar after one load failure', async () => {
    const el = widgetWithChat('https://example.com/broken.png');
    await el.updateComplete;
    await withReply(el);

    const img = el.shadowRoot?.querySelector('.avatar img') as HTMLImageElement;
    expect(img).toBeTruthy();
    img.dispatchEvent(new Event('error'));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.avatar')).toBeFalsy();
  });
});

describe('presentation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to immersive and honours panel + position', async () => {
    // Both attributes were declared, documented, and never read — the
    // overlay rendered full-viewport no matter what you set.
    const el = makeWidget();
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    const dlg = () => el.shadowRoot?.querySelector('dialog.overlay');
    expect(dlg()?.getAttribute('data-presentation')).toBe('immersive');

    el.presentation = 'panel';
    el.position = 'top-left';
    await el.updateComplete;
    expect(dlg()?.getAttribute('data-presentation')).toBe('panel');
    expect(dlg()?.getAttribute('data-position')).toBe('top-left');
  });
});
