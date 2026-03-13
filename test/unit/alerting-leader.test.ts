import { AlertingLeaderExtension } from '../../src/alerting-leader';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import Client, { AlertableInteractionTypes, HttpClient, IClientOptions } from '../../src';
import { EventEmitter } from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { Transport } from 'stanza';
import { flushPromises } from '../helpers/testing-utils';

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
      const clientOptions = { alertableInteractionTypes: [ AlertableInteractionTypes.voice ] };
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
      const clientOptions = { alertableInteractionTypes: [] } as unknown as IClientOptions;
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, clientOptions);
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
      jest.useFakeTimers();
      const userId = 'abc123';
      const connectionId = 'connection123';
      const markAlertableUrl = `https://api.example.com/api/v2/apps/users/${userId}/connections/${connectionId}`;
      const fakeClient = new FakeClient({ apiHost: 'example.com' }) as unknown as Client;
      fakeClient.config.userId = userId;
      const alertingLeader = new AlertingLeaderExtension(fakeClient, {} as IClientOptions);
      alertingLeader['connectionId'] = connectionId;

      const axiosMock = new AxiosMockAdapter(axios);
      axiosMock.onPatch(markAlertableUrl).replyOnce(404).onPatch(markAlertableUrl).replyOnce(200, {});

      const resultPromise = alertingLeader['markAsAlertable']();
      await flushPromises();
      jest.advanceTimersByTime(500);

      const result = await resultPromise;

      expect(result).toBeTruthy();
      axiosMock.restore();
      jest.useRealTimers();
    });

    it('should log a warning if the max retries are reached', async () => {
      jest.useFakeTimers();

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

      const resultPromise = alertingLeader['markAsAlertable']();
      for (let i = 0; i < 15; i++) {
        await flushPromises();
        jest.advanceTimersByTime(500);
      }
      const result = await resultPromise;

      expect(result).toBeFalsy();
      expect(warnSpy).toHaveBeenCalled();
      axiosMock.restore();
      jest.useRealTimers();
    });
  });

  it('should handle non-existent transport or stream', () => {
    const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
    const newStanza = getFakeStanzaClient();

    alertingLeader.handleStanzaInstanceChange(newStanza);

    expect(alertingLeader['connectionId']).toBeUndefined();
  });
});
