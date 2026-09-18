/**
 * Page context on the chat transport.
 *
 * An agent that learned to greet a visitor from `metadata.page.title` on a
 * voice dial got nothing at all on chat — the chat path sent `{method,
 * message, handle}` and stopped there. These tests pin the two halves of the
 * fix from the outside: that the same bag reaches the wire, at the same paths,
 * and that a widget which sends nothing still sends a clean body.
 *
 * The gateway's half (accepting `user_meta_data` and forwarding it upstream)
 * is pinned in signalwire-python's `tests/unit/ai_chat/test_gateway.py`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';
import { ChatClient } from './lib/chat-client';

type Body = Record<string, unknown>;

/** Captures every POST body the client sends. */
function captureFetch(): Body[] {
  const sent: Body[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ greeting: 'hi', status: 'created', result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    })
  );
  return sent;
}

describe('ChatClient user_meta_data', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends it on start and on every chat turn', async () => {
    const sent = captureFetch();
    const client = new ChatClient({
      gatewayUrl: 'https://gw.test/chat/',
      key: 'pk',
      userMetadata: () => ({ metadata: { page: { title: 'Pricing' } } })
    });

    await client.start();
    await client.chat('hello');

    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body.user_meta_data).toEqual({ metadata: { page: { title: 'Pricing' } } });
    }
  });

  it('reads the provider per call, not once per client', async () => {
    // Only the call that CREATES the conversation is read by the service, and
    // that may be the greeting or a first typed message. Capturing at
    // construction would hand the creating call whatever page happened to be
    // open when the widget was built, which on an SPA need not be this one.
    const sent = captureFetch();
    let path = '/pricing';
    const client = new ChatClient({
      gatewayUrl: 'https://gw.test/chat/',
      key: 'pk',
      userMetadata: () => ({ metadata: { page: { url: path } } })
    });

    await client.start();
    path = '/docs';
    await client.chat('and now?');

    expect((sent[0].user_meta_data as any).metadata.page.url).toBe('/pricing');
    expect((sent[1].user_meta_data as any).metadata.page.url).toBe('/docs');
  });

  it('leaves the key off bookkeeping calls the agent never sees', async () => {
    const sent = captureFetch();
    const client = new ChatClient({
      gatewayUrl: 'https://gw.test/chat/',
      key: 'pk',
      userMetadata: () => ({ metadata: { page: { title: 'Pricing' } } })
    });
    client.setHandle('h.sig');

    await client.log();
    await client.end();

    expect(sent.map((b) => b.method)).toEqual(['log', 'end']);
    for (const body of sent) expect(body).not.toHaveProperty('user_meta_data');
  });

  it('omits the key entirely when there is nothing to say', async () => {
    // Absent beats present-and-empty: the gateway drops an empty bag anyway,
    // and `user_meta_data: {}` on the wire reads as "we looked and found
    // nothing" rather than "this widget does not send it".
    const sent = captureFetch();
    for (const provider of [undefined, () => null, () => ({})]) {
      const client = new ChatClient({
        gatewayUrl: 'https://gw.test/chat/',
        key: 'pk',
        userMetadata: provider as never
      });
      await client.start();
    }
    expect(sent).toHaveLength(3);
    for (const body of sent) expect(body).not.toHaveProperty('user_meta_data');
  });

  it('does not let a throwing provider take the turn down', async () => {
    const sent = captureFetch();
    const client = new ChatClient({
      gatewayUrl: 'https://gw.test/chat/',
      key: 'pk',
      userMetadata: () => {
        throw new Error('document is not defined');
      }
    });

    const started = await client.start();
    expect(started.greeting).toBe('hi');
    expect(sent[0]).not.toHaveProperty('user_meta_data');
  });
});

describe('the bag the widget builds', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Pricing — Example';
  });

  function build(el: AddressWidget): Record<string, any> {
    return (el as unknown as { _buildChatVariables(): Record<string, any> })._buildChatVariables();
  }

  function make(markup: string): Promise<AddressWidget> {
    document.body.innerHTML = markup;
    const el = document.body.querySelector('signalwire-address') as AddressWidget;
    return el.updateComplete.then(() => el);
  }

  it('puts page context where the voice path already puts it', async () => {
    // The contract with the agent: one parse, both transports.
    const el = await make(
      '<signalwire-address mode="both" gateway-url="https://gw.test/chat/" chat-key="pk"></signalwire-address>'
    );
    const chat = build(el);
    const voice = (
      el as unknown as { _buildAutoVariables(m: string): Record<string, any> }
    )._buildAutoVariables('voice');

    expect(chat.metadata.page.title).toBe('Pricing — Example');
    expect(chat.metadata.page.title).toBe(voice.metadata.page.title);
    expect(Object.keys(chat.metadata).sort()).toEqual(Object.keys(voice.metadata).sort());
  });

  it('marks which transport the payload came from', async () => {
    const el = await make('<signalwire-address></signalwire-address>');
    expect(build(el).capabilities.medium).toBe('chat');
    expect(
      (
        el as unknown as { _buildAutoVariables(m: string): Record<string, any> }
      )._buildAutoVariables('voice').capabilities.medium
    ).toBe('voice');
  });

  it('carries no dial-time handoff plumbing', async () => {
    // `chat_handle` and `handoff_nonce` belong to a dial. A chat session
    // already holds its own handle, and sending a stale one here would seed a
    // conversation from something the session had already moved past.
    const el = await make('<signalwire-address></signalwire-address>');
    const chat = build(el);
    expect(chat).not.toHaveProperty('chat_handle');
    expect(chat).not.toHaveProperty('handoff_nonce');
  });

  it('lets consumer userVariables win, same as on voice', async () => {
    const el = await make('<signalwire-address></signalwire-address>');
    el.userVariablesAttr = { account_id: 'acct_1', capabilities: { mine: true } };
    await el.updateComplete;
    const chat = build(el);
    expect(chat.account_id).toBe('acct_1');
    expect(chat.capabilities).toEqual({ mine: true });
  });

  it('sends nothing when auto-identify is off and no consent was given', async () => {
    const el = await make('<signalwire-address auto-identify="false"></signalwire-address>');
    expect(build(el)).toEqual({});
  });
});
