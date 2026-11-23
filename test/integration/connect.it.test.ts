/* eslint @typescript-eslint/no-explicit-any: "off" */
import { Client } from '../../src/client';
import { StreamingClientErrorTypes } from '../../src/types/interfaces';
import { xmpp } from './support/fake-xmpp';
import { buildClient, installHttpMockServer, once, seedConnect } from './support/harness';

jest.mock('stanza', () => require('./support/fake-xmpp').stanzaModuleMock());

/**
 * BLACK-BOX tests for connecting. The real `Client` runs against a real mock
 * HTTP server (platform API) and a fake XMPP peer (websocket). Only those two
 * outward boundaries are faked.
 */
describe('Client.connect', () => {
  const api = installHttpMockServer();
  let client: Client;

  afterEach(async () => {
    await client?.disconnect();
  });

  it('creates a channel with the caller\'s bearer token, then opens the websocket on that channel', async () => {
    const seeded = seedConnect(api);
    client = buildClient(api, seeded.authToken);

    const connected = once(client, 'connected');
    await client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 1 });
    await connected;

    const channelRequest = api.received('post', /\/notifications\/channels$/)[0];
    expect(channelRequest.query).toBe('connectionType=streaming');
    expect(channelRequest.headers.authorization).toBe(`Bearer ${seeded.authToken}`);

    expect(xmpp.instances).toHaveLength(1);
    expect(xmpp.last!.config.transports.websocket).toBe(`wss://streaming.example.com/stream/channels/${seeded.channelId}`);
    expect(xmpp.last!.config.jid).toBe(seeded.jid);
    expect(xmpp.last!.config.credentials.password).toBe(`authKey:${seeded.authToken}`);
    expect(client.connected).toBe(true);
  });

  it('rejects with the 401 and never opens a websocket when the token is not accepted', async () => {
    const seeded = seedConnect(api);
    api.stub('post', /\/notifications\/channels$/, { status: 401, body: { code: 'bad.credentials' } });
    client = buildClient(api, seeded.authToken);
    const onConnected = jest.fn();
    client.on('connected', onConnected);

    await expect(client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 3 }))
      .rejects.toHaveProperty('type', StreamingClientErrorTypes.invalid_token);

    expect(api.received('post', /\/notifications\/channels$/)).toHaveLength(1); // 401 is not retried
    expect(xmpp.instances).toHaveLength(0);
    expect(onConnected).not.toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it('rejects and closes the websocket when the server refuses the credentials', async () => {
    const seeded = seedConnect(api);
    xmpp.connectBehavior = 'sasl-failure';
    xmpp.saslCondition = 'not-authorized';
    client = buildClient(api, seeded.authToken);

    await expect(client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 3 }))
      .rejects.toHaveProperty('type', StreamingClientErrorTypes.invalid_token);

    expect(xmpp.instances).toHaveLength(1); // not-authorized is not retried
    expect(xmpp.last!.disconnectCalls).toBeGreaterThan(0);
    expect(client.connected).toBe(false);
  });
});
