import { AlertingLeaderExtension } from '../../src/alerting-leader';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import Client, { HttpClient, IClientOptions } from '../../src';
import { EventEmitter } from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { StreamingClientErrorTypes, StreamingClientError } from '../../src';
import { Transport } from 'stanza';

class FakeClient {
  http: HttpClient;

  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  constructor (public config: any) {
    this.http = new HttpClient();
  }
}

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return instance as NamedAgent;
}

describe('AlertingLeader', () => {
  describe('handleStanzaInstanceChange', () => {
    it('should update the connectionId', () => {
      const connectionId = 'connection123';
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);

      const newStanza = getFakeStanzaClient();
      newStanza.transport = {
        stream: {
          id: connectionId
        }
      } as Transport;

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['connectionId']).toBe(connectionId);
    });

    it('should handle non-existent transport or stream', () => {
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const newStanza = getFakeStanzaClient();

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['connectionId']).toBeUndefined();
    });

    it('should mark the connection as alertable if configured for voice', () => {
      const clientOptions = { alertableInteractions: { voice: true } };
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, clientOptions as IClientOptions);
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;

      const newStanza = getFakeStanzaClient();
      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(markAlertableSpy).toHaveBeenCalled();
    });

    it('should not mark the connection as alertable if not configured', () => {
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;

      const newStanza = getFakeStanzaClient();
      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(markAlertableSpy).not.toHaveBeenCalled();
    });

    it('should not mark the connection as alertable if not configured for voice', () => {
      const clientOptions = { alertableInteractions: {} };
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
      const markAlertableSpy = jest.fn();
      alertingLeader['markAsAlertable'] = markAlertableSpy;

      const newStanza = getFakeStanzaClient();
      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(markAlertableSpy).not.toHaveBeenCalled();
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
