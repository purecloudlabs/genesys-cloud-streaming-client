/* eslint @typescript-eslint/no-explicit-any: "off" */
import { Client } from '../../src/client';
import { AlertableInteractionTypes, ILeaderStatus, StreamingClientErrorTypes } from '../../src/types/interfaces';
import { xmpp } from './support/fake-xmpp';
import { buildClient, installHttpMockServer, seedConnect, SeededUser, uid, waitFor } from './support/harness';

jest.mock('stanza', () => require('./support/fake-xmpp').stanzaModuleMock());

/**
 * BLACK-BOX tests for the alerting leader extension. The caller uses the public
 * `client.alertingLeader` API and listens for `alertingLeaderChanged`. The
 * platform API is a real mock HTTP server, and leader changes pushed by the
 * server arrive as pubsub events from the fake XMPP peer.
 */
describe('Alerting leader', () => {
  const api = installHttpMockServer();
  const leaderPath = /\/api\/v2\/users\/alertingleader$/;
  let client: Client;
  let seeded: SeededUser;
  let statuses: ILeaderStatus[];

  const alertablePath = () => new RegExp(`/apps/users/${seeded.userId}/connections/[^/]+$`);
  const leaderTopic = () => `v2.users.${seeded.userId}.alertingleader`;
  const lastStatus = () => statuses[statuses.length - 1];

  /** Build a client that is configured for voice alerting and record every status it reports. */
  const connect = async (alertable: AlertableInteractionTypes[] = [AlertableInteractionTypes.voice]) => {
    client = buildClient(api, seeded.authToken, { alertableInteractionTypes: alertable });
    client.alertingLeader.on('alertingLeaderChanged', (status: ILeaderStatus) => statuses.push(status));
    await client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 1 });
  };

  beforeEach(() => {
    seeded = seedConnect(api);
    statuses = [];
    api.stub('patch', alertablePath(), { status: 200, body: {} });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('when the client is not configured for alertable interactions', () => {
    it('makes no alerting requests and reports no status', async () => {
      await connect([]);
      await client.alertingLeader.claimAlertingLeader().catch(() => undefined);

      expect(api.received('patch')).toHaveLength(0);
      expect(api.received(undefined, /alertingleader$/)).toHaveLength(0);
      expect(statuses).toHaveLength(0);
      expect(xmpp.last!.subscribedNodes).not.toContain(leaderTopic());
    });

    it('rejects a claim with a generic error and sends no request', async () => {
      await connect([]);

      await expect(client.alertingLeader.claimAlertingLeader())
        .rejects.toHaveProperty('type', StreamingClientErrorTypes.generic);

      expect(api.received('put', leaderPath)).toHaveLength(0);
    });
  });

  describe('on connect', () => {
    it('marks the connection alertable and reports alerting when this connection is the leader', async () => {
      api.stub('get', leaderPath, () => ({ status: 200, body: { connectionId: xmpp.last!.connectionId, clientType: 'web' } }));

      await connect();
      await waitFor(() => statuses.length > 0 && lastStatus().voice?.alerting === true, 'alerting status');

      const patch = api.received('patch', alertablePath())[0];
      expect(patch.path).toBe(`/api/v2/apps/users/${seeded.userId}/connections/${xmpp.last!.connectionId}`);
      expect(patch.headers.authorization).toBe(`Bearer ${seeded.authToken}`);
      expect(patch.body).toEqual({ alertable: true });
      expect(xmpp.last!.subscribedNodes).toContain(leaderTopic());
      expect(lastStatus()).toEqual({ voice: { alerting: true, configured: true, clientType: 'web' } });
      expect(client.alertingLeader.getLeaderStatus()).toEqual(lastStatus());
    });

    it('reports not alerting, with the leader\'s client type, when another connection is the leader', async () => {
      api.stub('get', leaderPath, { status: 200, body: { connectionId: uid('other-connection'), clientType: 'softphone' } });

      await connect();
      await waitFor(() => statuses.length > 0, 'leader status');

      expect(lastStatus()).toEqual({ voice: { alerting: false, configured: true, clientType: 'softphone' } });
    });

    it('acts as the leader, unconfigured, when the org has no alerting leader (400)', async () => {
      api.stub('get', leaderPath, { status: 400, body: { code: 'bad.request' } });

      await connect();
      await waitFor(() => statuses.length > 0, 'fallback status');

      expect(lastStatus()).toEqual({ voice: { alerting: true, configured: false } });
      expect(api.received('get', leaderPath).length).toBeGreaterThan(0);
    });

    it('retries marking the connection alertable until the backend knows the connection', async () => {
      api.stub('get', leaderPath, { status: 200, body: { connectionId: uid('other-connection') } });
      api.stub('patch', alertablePath(), (_req, hits) => hits === 1 ? { status: 404, body: {} } : { status: 200, body: {} });

      await connect();
      await waitFor(() => api.received('patch', alertablePath()).length === 2, 'alertable retry');
      await waitFor(() => statuses.length > 0, 'leader status');

      expect(api.received('patch', alertablePath())).toHaveLength(2);
      expect(lastStatus().voice).toMatchObject({ configured: true });
    });
  });

  describe('when the server pushes a leader change', () => {
    it('switches from not alerting to alerting when this connection becomes the leader', async () => {
      api.stub('get', leaderPath, { status: 200, body: { connectionId: uid('other-connection') } });
      await connect();
      await waitFor(() => lastStatus()?.voice?.alerting === false, 'initial status');

      xmpp.last!.pushPubsub(leaderTopic(), { eventBody: { connectionId: xmpp.last!.connectionId, clientType: 'web' } });

      expect(lastStatus()).toEqual({ voice: { alerting: true, configured: true, clientType: 'web' } });
    });

    it('switches from alerting to not alerting when another connection takes over', async () => {
      api.stub('get', leaderPath, () => ({ status: 200, body: { connectionId: xmpp.last!.connectionId } }));
      await connect();
      await waitFor(() => lastStatus()?.voice?.alerting === true, 'initial status');

      xmpp.last!.pushPubsub(leaderTopic(), { eventBody: { connectionId: uid('other-connection') } });

      expect(lastStatus()).toEqual({ voice: { alerting: false, configured: true } });
    });

    it('ignores a push that has no connection id', async () => {
      api.stub('get', leaderPath, { status: 200, body: { connectionId: uid('other-connection') } });
      await connect();
      await waitFor(() => lastStatus()?.voice?.alerting === false, 'initial status');
      const before = statuses.length;

      xmpp.last!.pushPubsub(leaderTopic(), { eventBody: {} });

      expect(statuses).toHaveLength(before);
    });
  });

  describe('claimAlertingLeader', () => {
    beforeEach(() => {
      api.stub('get', leaderPath, { status: 200, body: { connectionId: uid('other-connection') } });
    });

    it('puts this connection\'s id to the leader endpoint with the bearer token', async () => {
      api.stub('put', leaderPath, { status: 200, body: {} });
      await connect();

      await client.alertingLeader.claimAlertingLeader();

      const put = api.received('put', leaderPath)[0];
      expect(put.body).toEqual({ connectionId: xmpp.last!.connectionId });
      expect(put.headers.authorization).toBe(`Bearer ${seeded.authToken}`);
    });

    it('sends one request for claims made in quick succession', async () => {
      api.stub('put', leaderPath, { status: 200, body: {} });
      await connect();

      await Promise.all([
        client.alertingLeader.claimAlertingLeader(),
        client.alertingLeader.claimAlertingLeader(),
        client.alertingLeader.claimAlertingLeader()
      ]);

      expect(api.received('put', leaderPath)).toHaveLength(1);
    });

    it('rejects with a generic error that wraps the server error when the claim fails', async () => {
      api.stub('put', leaderPath, { status: 403, body: { code: 'forbidden' } });
      await connect();

      const error: any = await client.alertingLeader.claimAlertingLeader().catch(e => e);

      expect(error.type).toBe(StreamingClientErrorTypes.generic);
      expect(error.details).toMatchObject({ status: 403 });
    });
  });
});
