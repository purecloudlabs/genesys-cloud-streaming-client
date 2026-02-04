import { AlertingLeaderExtension } from '../../src/alerting-leader';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import Client, { HttpClient, IClientOptions } from '../../src';
import { EventEmitter } from 'events';
import { flushPromises } from '../helpers/testing-utils';
import { NamedAgent } from '../../src/types/named-agent';
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
    it('should mark the connection as alertable', () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertablePath = `apps/users/${userId}/connections/${connectionId}`;
      const httpSpy = jest.fn().mockResolvedValue({});
      const fakeClient = new FakeClient({}) as unknown as Client;
      fakeClient.config.userId = userId;
      fakeClient.http.requestApi = httpSpy;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      alertingLeader['markAsAlertable']();

      expect(httpSpy.mock.calls[0][0]).toBe(markAlertablePath);
      expect(httpSpy.mock.calls[0][1]).toMatchObject({ data: { alertable: true } });
    });

    it('should log a warning if an error occurs', async () => {
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertablePath = `apps/users/${userId}/connections/${connectionId}`;
      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertablePath).reply(404);
      const warnSpy = jest.fn();
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      fakeClient.logger.warn = warnSpy;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      alertingLeader['markAsAlertable']();

      await flushPromises();

      expect(warnSpy).toHaveBeenCalled();
      axiosMock.restore();
    });
  });

  it('should handle non-existent transport or stream', () => {
    const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
    const newStanza = getFakeStanzaClient();

    alertingLeader.handleStanzaInstanceChange(newStanza);

    expect(alertingLeader['connectionId']).toBeUndefined();
  });
});
