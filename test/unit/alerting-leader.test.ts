import { AlertingLeaderExtension } from '../../src/alerting-leader';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import Client, { HttpClient, IClientOptions } from '../../src';
import { EventEmitter } from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { StreamingClientErrorTypes, StreamingClientError } from '../../src';
import { Transport } from 'stanza';

class FakeClient extends EventEmitter {
  connected = true;
  http: HttpClient;

  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  _notifications = {};

  constructor (public config: any) {
    super();

    this.http = new HttpClient();
  }
}

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return instance as NamedAgent;
}

describe('AlertingLeader', () => {
  describe('handleStanzaInstanceChange', () => {
    it('should update the connectionId and set up alerting leader', () => {
      const connectionId = 'connection123';
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const setupSpy = jest.fn();
      alertingLeader['setupAlertingLeader'] = setupSpy;

      const newStanza = getFakeStanzaClient();
      newStanza.transport = {
        stream: {
          id: connectionId
        }
      } as Transport;

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['connectionId']).toBe(connectionId);
      expect(setupSpy).toHaveBeenCalled();
    });

    it('should handle non-existent transport or stream', () => {
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const newStanza = getFakeStanzaClient();

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['connectionId']).toBeUndefined();
    });
  });

  describe('setupAlertingLeader', () => {
    it('should mark the connection as alertable if configured for voice', async () => {
      const clientOptions = { alertableInteractions: { voice: true } };
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, clientOptions as IClientOptions);
      const subscribeSpy = jest.fn();
      alertingLeader['subscribeToAlertingLeader'] = subscribeSpy;
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;
      const getLeaderSpy = jest.fn();
      alertingLeader['getAlertingLeader'] = getLeaderSpy;

      await alertingLeader['setupAlertingLeader']();

      expect(subscribeSpy).toHaveBeenCalled();
      expect(markAlertableSpy).toHaveBeenCalled();
      expect(getLeaderSpy).toHaveBeenCalled();
    });

    it('should emit as alerting leader but not configured if any errors occur', async () => {
      const clientOptions = { alertableInteractions: { voice: true } };
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      const expectedPayload = { voice: { alerting: true, configured: false } };

      expect.assertions(4);
      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedPayload);
      });

      alertingLeader['subscribeToAlertingLeader'] = jest.fn().mockRejectedValue({});
      alertingLeader['markAsAlertable'] = jest.fn();
      alertingLeader['getAlertingLeader'] = jest.fn();
      await alertingLeader['setupAlertingLeader']();

      alertingLeader['subscribeToAlertingLeader'] = jest.fn();
      alertingLeader['markAsAlertable'] = jest.fn().mockRejectedValue({});
      alertingLeader['getAlertingLeader'] = jest.fn();
      await alertingLeader['setupAlertingLeader']();

      alertingLeader['subscribeToAlertingLeader'] = jest.fn();
      alertingLeader['markAsAlertable'] = jest.fn();
      alertingLeader['getAlertingLeader'] = jest.fn().mockRejectedValue({});
      await alertingLeader['setupAlertingLeader']();

      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedPayload);
    });

    it('should emit as not the alerting leader if any errors occur and the client is not connected', async () => {
      const clientOptions = { alertableInteractions: { voice: true } };
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['subscribeToAlertingLeader'] = jest.fn().mockRejectedValue({});
      fakeClient.connected = false;
      const expectedPayload = { voice: { alerting: false, configured: false } };

      expect.assertions(2);
      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedPayload);
      });

      await alertingLeader['setupAlertingLeader']();
      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedPayload);
    });

    it('should not setup alerting leader if not configured', async () => {
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const subscribeSpy = jest.fn();
      alertingLeader['subscribeToAlertingLeader'] = subscribeSpy;
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;
      const getLeaderSpy = jest.fn();
      alertingLeader['getAlertingLeader'] = getLeaderSpy;

      await alertingLeader['setupAlertingLeader']();

      expect(subscribeSpy).not.toHaveBeenCalled();
      expect(markAlertableSpy).not.toHaveBeenCalled();
      expect(getLeaderSpy).not.toHaveBeenCalled();
    });

    it('should not mark the connection as alertable if not configured for voice', async () => {
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;

      await alertingLeader['setupAlertingLeader']();

      expect(markAlertableSpy).not.toHaveBeenCalled();
    });

    it('should emit once as not the alerting leader if a disconnect occurs', async () => {
      const clientOptions = { alertableInteractions: { voice: true } };
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['subscribeToAlertingLeader'] = jest.fn();
      alertingLeader['markAsAlertable'] = jest.fn();
      alertingLeader['getAlertingLeader'] = jest.fn();
      jest.spyOn(alertingLeader, 'emit');
      const expectedPayload = { voice: { alerting: false, configured: false } };

      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedPayload);
      });

      await alertingLeader['setupAlertingLeader']();
      fakeClient.emit('disconnected', { reconnecting: true });
      fakeClient.emit('disconnected', { reconnecting: false });
      expect(alertingLeader.emit).toHaveBeenCalledTimes(1);

      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedPayload);
    });
  });

  describe('subscribeToAlertingLeader', () => {
    it('should subscribe to the right topic', async () => {
      const userId = 'abc123';
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      const subscribeSpy = jest.fn();
      fakeClient._notifications._subscribeInternal = subscribeSpy;

      await alertingLeader['subscribeToAlertingLeader']();

      expect(subscribeSpy).toHaveBeenCalledWith(`v2.users.${userId}.alertingleader`);
    });

    it('should emit its own event for the alerting change', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;
      fakeClient._notifications._subscribeInternal = jest.fn().mockResolvedValue({});
      const payload = {
        eventBody: {
          userId,
          connectionId
        }
      };
      const expectedEventPayload = { voice: { alerting: true, configured: true } };

      expect.assertions(2);
      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedEventPayload);
      });

      await alertingLeader['subscribeToAlertingLeader']();
      fakeClient.emit(`notify:v2.users.${userId}.alertingleader`, payload);

      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedEventPayload);
    });

    it('should cancel the GET if an event arrives first', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;
      fakeClient._notifications._subscribeInternal = jest.fn().mockResolvedValue({});
      const payload = {
        eventBody: {
          userId,
          connectionId,
          clientType: 'desktop'
        }
      };

      const alertingLeaderUrl = 'https://api.example.com/api/v2/users/alertingleader';
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onGet(alertingLeaderUrl).reply(200, { connectionId });
      const eventSpy = jest.fn();
      alertingLeader.on('alertingLeaderChanged', eventSpy);

      await alertingLeader['subscribeToAlertingLeader']();
      const getLeaderPromise = alertingLeader['getAlertingLeader']();
      fakeClient.emit(`notify:v2.users.${userId}.alertingleader`, payload);

      expect(await getLeaderPromise).toBeUndefined();
      expect(eventSpy).toHaveBeenCalledTimes(1);
      axiosMock.restore();
    });
  });

  describe('markAsAlertable', () => {
    it('should mark the connection as alertable', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertableUrl = `https://api.example.com/api/v2/apps/users/${userId}/connections/${connectionId}`;
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      let patchData = { alertable: false };
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertableUrl).reply((config) => {
        patchData = JSON.parse(config.data);
        return [204, {}];
      });

      const result = await alertingLeader['markAsAlertable']();

      expect(result).toBeTruthy();
      expect(patchData['alertable']).toBeTruthy();
      axiosMock.restore();
    });

    it('should retry if an error occurs', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertableUrl = `https://api.example.com/api/v2/apps/users/${userId}/connections/${connectionId}`;
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertableUrl).replyOnce(404).onPatch(markAlertableUrl).replyOnce(200, {});

      const result = await alertingLeader['markAsAlertable']();

      expect(result).toBeTruthy();
      axiosMock.restore();
    });

    it('should log a warning if the max retries are reached', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertableUrl = `https://api.example.com/api/v2/apps/users/${userId}/connections/${connectionId}`;
      const warnSpy = jest.fn();
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      fakeClient.logger.warn = warnSpy;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertableUrl).reply(404);

      const result = await alertingLeader['markAsAlertable']();

      expect(result).toBeFalsy();
      expect(warnSpy).toHaveBeenCalled();
      axiosMock.restore();
    });
  });

  describe('getAlertingLeader', () => {
    it('should get alerting leader and emit when client is the alerting leader', async () => {
      const connectionId = 'connection123';
      const alertingLeaderUrl = 'https://api.example.com/api/v2/users/alertingleader';
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onGet(alertingLeaderUrl).reply(200, { connectionId });
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['connectionId'] = connectionId;
      const expectedPayload = { voice: { alerting: true, configured: true } };

      expect.assertions(2);
      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedPayload);
      });
      await alertingLeader['getAlertingLeader']();

      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedPayload);
      axiosMock.restore();
    });

    it('should emit when client is not the alerting leader', async () => {
      const connectionId = 'connection123';
      const alertingLeaderUrl = 'https://api.example.com/api/v2/users/alertingleader';
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onGet(alertingLeaderUrl).reply(200, { connectionId: 'differentConnection' });
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['connectionId'] = connectionId;
      const expectedPayload = { voice: { alerting: false, configured: true } };

      expect.assertions(2);
      alertingLeader.on('alertingLeaderChanged', (event) => {
        expect(event).toMatchObject(expectedPayload);
      });
      await alertingLeader['getAlertingLeader']();

      expect(alertingLeader.expose.leaderStatus).toMatchObject(expectedPayload);
      axiosMock.restore();
    });

    it('should throw if an error occurs', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const alertingLeaderUrl = 'https://api.example.com/api/v2/users/alertingleader';
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onGet(alertingLeaderUrl).reply(404);
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      expect.assertions(1);
      try {
        await alertingLeader['getAlertingLeader']();
      } catch (err) {
        expect(err).toBeTruthy();
      }

      axiosMock.restore();
    });
  });

  describe('claimAlertingLeader', () => {
    it('should claim alerting leader', () => {
      const connectionId = 'connection123';
      const alertingLeaderPath = 'users/alertingleader';
      const httpSpy = jest.fn().mockResolvedValue({});
      const fakeClient = new FakeClient({}) as unknown as Client;
      fakeClient.http.requestApi = httpSpy;
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      alertingLeader.expose.claimAlertingLeader();

      expect(httpSpy.mock.calls[0][0]).toBe(alertingLeaderPath);
      expect(httpSpy.mock.calls[0][1]).toMatchObject({ data: { connectionId: connectionId } });
    });

    it('should throw generic StreamingClientError if client is not configured for any alertable interactions', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const httpSpy = jest.fn().mockResolvedValue({});
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      fakeClient.http.requestApi = httpSpy;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      try {
        await alertingLeader.expose.claimAlertingLeader();
      } catch (err) {
        expect(err).toBeInstanceOf(StreamingClientError);
        expect((err as any)['type']).toBe(StreamingClientErrorTypes.generic);
        expect(httpSpy).not.toHaveBeenCalled();
      }
    });

    it('should throw generic StreamingClientError if alerting leader cannot be claimed', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertablePath = `apps/users/${userId}/connections/${connectionId}`;
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertablePath).reply(404);
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const requestApiSpy = jest.spyOn(fakeClient.http, 'requestApi');
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension(fakeClient, clientOptions as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      try {
        await alertingLeader.expose.claimAlertingLeader();
      } catch (err) {
        expect(err).toBeInstanceOf(StreamingClientError);
        expect((err as any)['type']).toBe(StreamingClientErrorTypes.generic);
        expect(requestApiSpy).toHaveBeenCalled();
      }

      axiosMock.restore();
    });
  });
});
