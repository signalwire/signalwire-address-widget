/**
 * The visitor id: one random id per browser, sent as `metadata.visitor_id`
 * on every call and chat so an agent can recognise a returning caller.
 *
 * What matters is that it is STABLE — the same across reloads, across the
 * voice and chat halves of one visit, and across widgets on one site — and
 * that it stays out of storage entirely when the host has turned
 * auto-identify off. An id that drifts is worse than none: it reads as a new
 * caller every time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';
import { mount, unmount } from './index';
import { getVisitorId, newVisitorId, _resetVisitorIdCache } from './lib/visitor';

const KEY = 'swaw:visitor';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Bag = Record<string, any>;
type Internals = {
  _buildAutoVariables(medium: 'voice' | 'chat'): Bag;
  _buildChatVariables(): Bag;
};

async function make(markup: string): Promise<AddressWidget> {
  document.body.innerHTML = markup;
  const el = document.body.querySelector('signalwire-address') as AddressWidget;
  await el.updateComplete;
  return el;
}

function voiceBag(el: AddressWidget): Bag {
  return (el as unknown as Internals)._buildAutoVariables('voice');
}

function chatBag(el: AddressWidget): Bag {
  return (el as unknown as Internals)._buildChatVariables();
}

beforeEach(() => {
  localStorage.clear();
  _resetVisitorIdCache();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('newVisitorId', () => {
  it('produces distinct v4 UUIDs', () => {
    const a = newVisitorId();
    const b = newVisitorId();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('still produces a v4 UUID where randomUUID is unavailable', () => {
    // randomUUID throws outside a secure context, i.e. any plain-http page.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('insecure context');
    });
    expect(newVisitorId()).toMatch(UUID_V4);
  });
});

describe('getVisitorId', () => {
  it('mints and stores an id on the first visit', () => {
    const id = getVisitorId();
    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  it('returns the same id on a later page load', () => {
    const first = getVisitorId();
    _resetVisitorIdCache(); // what a reload does to module state
    expect(getVisitorId()).toBe(first);
  });

  it('replaces a stored value that is not a UUID', () => {
    // Anything on the origin can write this key; a junk value must not be
    // forwarded to agents as if it were ours.
    localStorage.setItem(KEY, 'not-an-id');
    const id = getVisitorId();
    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  // Both replace the global rather than spying on Storage.prototype: happy-dom's
  // localStorage passes `instanceof Storage` but doesn't dispatch through the
  // prototype, so a prototype spy blocks nothing and the test passes on
  // working storage.

  it('stays stable for the page when storage refuses reads and writes', () => {
    const denied = (): never => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied });
    const id = getVisitorId();
    expect(id).toMatch(UUID_V4);
    expect(getVisitorId()).toBe(id);
  });

  it('stays stable for the page when merely touching storage throws', () => {
    // Safari with site data blocked throws on the property access itself.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      }
    });
    try {
      const id = getVisitorId();
      expect(id).toMatch(UUID_V4);
      expect(getVisitorId()).toBe(id);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('metadata.visitor_id in the widget', () => {
  it('sends the same id on voice and chat', async () => {
    // The point of the field: an agent seeing both halves of one visit
    // across a medium switch must see one visitor, not two.
    const el = await make(
      '<signalwire-address mode="both" gateway-url="https://gw.test/chat/" chat-key="pk"></signalwire-address>'
    );
    const voice = voiceBag(el).metadata.visitor_id;
    const chat = chatBag(el).metadata.visitor_id;
    expect(voice).toMatch(UUID_V4);
    expect(chat).toBe(voice);
    expect(voice).toBe(localStorage.getItem(KEY));
  });

  it('is shared by every widget on the page', async () => {
    document.body.innerHTML =
      '<signalwire-address id="a"></signalwire-address><signalwire-address id="b"></signalwire-address>';
    const a = document.getElementById('a') as AddressWidget;
    const b = document.getElementById('b') as AddressWidget;
    await Promise.all([a.updateComplete, b.updateComplete]);
    expect(voiceBag(a).metadata.visitor_id).toBe(voiceBag(b).metadata.visitor_id);
  });

  it('uses the host-supplied id instead, and stores nothing', async () => {
    const el = await make('<signalwire-address visitor-id="user-123"></signalwire-address>');
    expect(voiceBag(el).metadata.visitor_id).toBe('user-123');
    expect(chatBag(el).metadata.visitor_id).toBe('user-123');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('accepts a numeric id assigned from script', async () => {
    const el = await make('<signalwire-address></signalwire-address>');
    (el as unknown as { visitorId: unknown }).visitorId = 42;
    expect(voiceBag(el).metadata.visitor_id).toBe('42');
  });

  it('falls back to the browser id when the host value is blank', async () => {
    const el = await make('<signalwire-address visitor-id="   "></signalwire-address>');
    expect(voiceBag(el).metadata.visitor_id).toMatch(UUID_V4);
  });

  it('is not sent, or stored, when auto-identify is off', async () => {
    // A host that opted out of auto-identify must not find a long-lived id
    // written into its visitors' storage anyway.
    const el = await make('<signalwire-address auto-identify="false"></signalwire-address>');
    expect(voiceBag(el)).toEqual({});
    expect(chatBag(el)).toEqual({});
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is forwarded by mount()', async () => {
    document.body.innerHTML = '<div id="t"></div>';
    const el = mount('#t', { token: 't', destination: '/d', visitorId: 'user-9' });
    await el.updateComplete;
    expect(el.visitorId).toBe('user-9');
    expect(voiceBag(el).metadata.visitor_id).toBe('user-9');
    await unmount(el);
  });
});
