/**
 * A consumer who has never heard of the chat features must see exactly what
 * they saw before: token + destination, a call, nothing else. Every chat
 * addition is opt-in, and this pins that rather than trusting it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';

function legacyWidget(): AddressWidget {
  // Exactly the pre-existing public API — nothing chat-related.
  const el = document.createElement('signalwire-address') as AddressWidget;
  el.token = 'fake-sat';
  el.destination = '/public/agent';
  document.body.appendChild(el);
  return el;
}

describe('backward compatibility (voice-only consumer)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults leave every chat feature off', async () => {
    const el = legacyWidget();
    await el.updateComplete;
    expect(el.mode).toBe('voice');
    expect(el.defaultMode).toBe('voice');
    expect(el.presentation).toBe('immersive');
    expect(el.typeToTalk).toBe(false);
    expect(el.gatewayUrl).toBe('');
    expect(el.chatKey).toBe('');
    expect(el.avatarUrl).toBeNull();
    expect((el as unknown as { _chatEnabled(): boolean })._chatEnabled()).toBe(false);
  });

  it('never constructs a chat session or touches its storage', async () => {
    sessionStorage.clear();
    const el = legacyWidget();
    await el.updateComplete;
    const internal = el as unknown as {
      _chatSession: unknown;
      _chatRestoreAttempted: boolean;
    };
    expect(internal._chatSession).toBeNull();
    expect(internal._chatRestoreAttempted).toBe(false);
    expect(sessionStorage.getItem('sw-chat-handle')).toBeNull();
  });

  it('opens straight to the call surface — no picker, no composer', async () => {
    const el = legacyWidget();
    el.consentRequired = false;
    await el.updateComplete;
    await el.open();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.picker')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('[part="composer"]')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('[part="switch-to-chat"]')).toBeFalsy();
    expect((el as unknown as { _activeMedium: string })._activeMedium).toBe('voice');
  });

  it('adds no chat keys to the dialled userVariables', async () => {
    const el = legacyWidget();
    const internal = el as unknown as {
      _takeChatHandoffVars(): Record<string, unknown>;
      _mintHandoffNonceVars(): Record<string, unknown>;
      _buildCapabilities(): Record<string, unknown>;
    };
    expect(internal._takeChatHandoffVars()).toEqual({});
    expect(internal._mintHandoffNonceVars()).toEqual({});
    // capabilities gains one additive boolean, and it reports false.
    expect(internal._buildCapabilities().chat_handoff).toBe(false);
  });

  it('renders voice transcript turns as plain text, not markdown', async () => {
    const el = legacyWidget();
    await el.updateComplete;
    const internal = el as unknown as {
      _chat: { onAiComplete: (t: string, b: boolean) => void };
      _overlayState: string;
    };
    internal._overlayState = 'open';
    // A spoken line containing characters markdown would eat.
    internal._chat.onAiComplete('costs *about* 2 cents_per_minute', false);
    el.requestUpdate();
    await el.updateComplete;

    const bubble = el.shadowRoot?.querySelector('.bubble');
    expect(bubble?.textContent).toContain('*about*');
    expect(bubble?.querySelector('em')).toBeFalsy();
    expect(el.shadowRoot?.querySelector('.bubble-md')).toBeFalsy();
  });

  it('keeps the overlay full-viewport by default', async () => {
    const el = legacyWidget();
    el.consentRequired = false;
    await el.updateComplete;
    await el.open();
    await el.updateComplete;
    const dlg = el.shadowRoot?.querySelector('dialog.overlay');
    expect(dlg?.getAttribute('data-presentation')).toBe('immersive');
  });
});
