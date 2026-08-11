/**
 * Option plumbing: the two paths a consumer configures the widget through.
 *
 * Both had a hole the docs papered over. `video="false"` resolved to TRUE
 * because those two properties used Lit's built-in Boolean converter, where
 * attribute presence alone means on. And `mount()` forwarded a subset of
 * `WidgetOptions`, so a programmatic consumer could not enable chat at all.
 *
 * These tests pin the fixes from the consumer's side — attributes in, options
 * object in, resolved properties out — rather than from the converter's.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';
import { mount, unmount } from './index';

function fromHtml(markup: string): AddressWidget {
  document.body.innerHTML = markup;
  return document.body.querySelector('signalwire-address') as AddressWidget;
}

describe('boolean attributes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('honors video="false" and audio="false"', async () => {
    const el = fromHtml(
      '<signalwire-address token="t" destination="/d" video="false" audio="false"></signalwire-address>'
    );
    await el.updateComplete;
    expect(el.video).toBe(false);
    expect(el.audio).toBe(false);
  });

  it('honors "0" as an opt-out too', async () => {
    const el = fromHtml('<signalwire-address video="0"></signalwire-address>');
    await el.updateComplete;
    expect(el.video).toBe(false);
  });

  it('still treats bare presence and empty value as on', async () => {
    const el = fromHtml('<signalwire-address video audio=""></signalwire-address>');
    await el.updateComplete;
    // Bare `video` is how a consumer writes "yes", and the default is already
    // true — turning it off here would be a worse bug than the one we fixed.
    expect(el.video).toBe(true);
    expect(el.audio).toBe(true);
  });

  it('defaults both to on when the attribute is absent', async () => {
    const el = fromHtml('<signalwire-address></signalwire-address>');
    await el.updateComplete;
    expect(el.video).toBe(true);
    expect(el.audio).toBe(true);
  });

  it('drives layout from the attribute, not just the property', async () => {
    // `_isStacked()` is `layout === 'stacked' || !video || chat` — so an
    // audio-only widget must stack even on the default `auto` layout. This
    // is the cheapest assertion that proves the attribute reached behaviour
    // rather than merely landing on the property.
    const off = fromHtml('<signalwire-address video="false"></signalwire-address>');
    await off.updateComplete;
    expect((off as unknown as { _isStacked(): boolean })._isStacked()).toBe(true);

    const on = fromHtml('<signalwire-address></signalwire-address>');
    await on.updateComplete;
    expect((on as unknown as { _isStacked(): boolean })._isStacked()).toBe(false);
  });

  it('reports video: false to the agent in capabilities', async () => {
    const el = fromHtml('<signalwire-address video="false"></signalwire-address>');
    await el.updateComplete;
    const caps = (
      el as unknown as { _buildCapabilities(): Record<string, unknown> }
    )._buildCapabilities();
    expect(caps.video).toBe(false);
    expect(caps.self_preview).toBe(false);
  });
});

describe('mount() option forwarding', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="t"></div>';
  });

  it('forwards the chat configuration', async () => {
    const el = mount('#t', {
      mode: 'both',
      defaultMode: 'ask',
      token: 'fake-sat',
      destination: '/public/agent',
      gatewayUrl: 'https://gw.example.com/chat',
      chatKey: 'pk_test',
      avatarUrl: 'https://example.com/a.png',
      chatPlaceholder: 'Ask away…',
      typeToTalk: true,
      typeToTalkPlaceholder: 'Or type…',
      chatPersistence: false,
      chatAutoOpen: false,
      chatStorageKey: 'custom-handle-key',
      chatAlwaysNew: true,
      chatEndOnClose: true,
      chatTimeoutSeconds: 900
    });
    await el.updateComplete;

    expect(el.mode).toBe('both');
    expect(el.defaultMode).toBe('ask');
    expect(el.gatewayUrl).toBe('https://gw.example.com/chat');
    expect(el.chatKey).toBe('pk_test');
    expect(el.avatarUrl).toBe('https://example.com/a.png');
    expect(el.chatPlaceholder).toBe('Ask away…');
    expect(el.typeToTalk).toBe(true);
    expect(el.typeToTalkPlaceholder).toBe('Or type…');
    expect(el.chatPersistence).toBe(false);
    expect(el.chatAutoOpen).toBe(false);
    expect(el.chatStorageKey).toBe('custom-handle-key');
    expect(el.chatAlwaysNew).toBe(true);
    expect(el.chatEndOnClose).toBe(true);
    expect(el.chatTimeoutSeconds).toBe(900);

    // Forwarding is only worth anything if it actually turns chat on.
    expect((el as unknown as { _chatEnabled(): boolean })._chatEnabled()).toBe(true);
    await unmount(el);
  });

  it('forwards presentation, position, widgetId and autoReattach', async () => {
    const el = mount('#t', {
      token: 'fake-sat',
      destination: '/public/agent',
      presentation: 'panel',
      position: 'top-left',
      widgetId: 'support-1',
      autoReattach: false
    });
    await el.updateComplete;

    expect(el.presentation).toBe('panel');
    expect(el.position).toBe('top-left');
    expect(el.widgetId).toBe('support-1');
    expect(el.autoReattach).toBe(false);
    await unmount(el);
  });

  it('mounts chat-only without a token or destination', async () => {
    // The reason `token` had to become optional: this used to be a type error.
    const el = mount('#t', {
      mode: 'chat',
      gatewayUrl: 'https://gw.example.com/chat',
      chatKey: 'pk_test'
    });
    await el.updateComplete;

    expect(el.token).toBe('');
    expect(el.destination).toBe('');
    expect((el as unknown as { _chatEnabled(): boolean })._chatEnabled()).toBe(true);
    await unmount(el);
  });

  it('leaves element defaults alone for options that were omitted', async () => {
    const el = mount('#t', { token: 'fake-sat', destination: '/public/agent' });
    await el.updateComplete;

    // Guarding on `!== undefined` must not have turned into "assign
    // undefined", which would clobber every default with a falsy value.
    expect(el.mode).toBe('voice');
    expect(el.chatPlaceholder).toBe('Type a message...');
    expect(el.chatTimeoutSeconds).toBe(3600);
    expect(el.chatPersistence).toBe(true);
    expect(el.video).toBe(true);
    expect(el.label).toBe('Start call');
    await unmount(el);
  });

  it('forwards video: false through the options object', async () => {
    const el = mount('#t', { token: 'fake-sat', destination: '/public/agent', video: false });
    await el.updateComplete;
    expect(el.video).toBe(false);
    await unmount(el);
  });
});
