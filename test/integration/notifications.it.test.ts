/* eslint @typescript-eslint/no-explicit-any: "off" */
import { Client } from '../../src/client';
import { xmpp } from './support/fake-xmpp';
import { buildClient, installHttpMockServer, seedConnect, SeededUser, uid } from './support/harness';

jest.mock('stanza', () => require('./support/fake-xmpp').stanzaModuleMock());

/**
 * BLACK-BOX tests for notification subscriptions. The caller uses the public
 * `client.notifications` API. The platform API is a real mock HTTP server, and
 * server pushes arrive as pubsub events from the fake XMPP peer.
 */
describe('Notifications', () => {
  const api = installHttpMockServer();
  let client: Client;
  let seeded: SeededUser;
  const subscriptionsPath = () => new RegExp(`/notifications/channels/${seeded.channelId}/subscriptions$`);

  beforeEach(async () => {
    seeded = seedConnect(api);
    client = buildClient(api, seeded.authToken);
    await client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 1 });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it('bulk subscribes by posting the topics to the channel and returns the server\'s verdict per topic', async () => {
    const allowed = uid('v2.users.allowed.test');
    const denied = uid('v2.users.denied.test');
    api.stub('post', subscriptionsPath(), {
      status: 200,
      body: {
        entities: [
          { id: allowed, state: 'Permitted' },
          { id: denied, state: 'Rejected', rejectionReason: 'missing permission', missingPermissions: ['users:read'] }
        ]
      }
    });

    const result = await client.notifications.bulkSubscribe([allowed, denied]);

    const request = api.received('post', subscriptionsPath())[0];
    expect(request.headers.authorization).toBe(`Bearer ${seeded.authToken}`);
    expect(request.body).toEqual([{ id: allowed }, { id: denied }]);
    expect(result[allowed].state).toBe('Permitted');
    expect(result[denied]).toMatchObject({ state: 'Rejected', missingPermissions: ['users:read'] });
  });

  it('delivers a pushed notification to the handler registered for that topic only', async () => {
    const topic = uid('v2.users.push.test');
    const otherTopic = uid('v2.users.other.test');
    api.stub('post', subscriptionsPath(), { status: 200, body: { entities: [] } });
    const handler = jest.fn();
    const otherHandler = jest.fn();
    await client.notifications.subscribe(topic, handler, true);
    await client.notifications.subscribe(otherTopic, otherHandler, true);

    const payload = { id: uid('event') };
    xmpp.last!.pushPubsub(topic, payload);

    expect(handler).toHaveBeenCalledWith(payload);
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it('retries a bulk subscribe that gets a 503 and succeeds on the next attempt', async () => {
    const topic = uid('v2.users.retry.test');
    api.stub('post', subscriptionsPath(), (_req, hits) => hits === 1
      ? { status: 503, body: {} }
      : { status: 200, body: { entities: [{ id: topic, state: 'Permitted' }] } });

    const result = await client.notifications.bulkSubscribe([topic]);

    expect(api.received('post', subscriptionsPath())).toHaveLength(2);
    expect(result[topic].state).toBe('Permitted');
  });

  it('rejects a bulk subscribe the server refuses with a 403, without retrying', async () => {
    api.stub('post', subscriptionsPath(), { status: 403, body: { code: 'forbidden' } });

    await expect(client.notifications.bulkSubscribe([uid('v2.users.forbidden.test')]))
      .rejects.toHaveProperty('response.status', 403);

    expect(api.received('post', subscriptionsPath())).toHaveLength(1);
  });
});
