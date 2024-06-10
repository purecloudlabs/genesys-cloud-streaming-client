'use strict';

import { Ping } from '../../src/ping';

const DEFAULT_PING_INTERVAL = 14 * 1000 + 10;
const PING_INTERVAL_WITH_BUFFER = DEFAULT_PING_INTERVAL + 100;

let standardOptions;
let client;
let fakeStanzaInstance;
let pingCallCount = 0;
let count = 0;

const flushPromises = () => new Promise(setImmediate);

describe('Ping', () => {
  // we have to reset the doubles for every test.
  beforeEach(() => {
    standardOptions = {
      jid: 'anon@example.mypurecloud.com'
    };

    jest.useFakeTimers();

    fakeStanzaInstance = {
      ping: async (jid) => {
        pingCallCount++;
      },
      sendStreamError: jest.fn()
    };

    client = {
      logger: { warn () { }, error () { } },
      count: count++,
      config: {}
    };
  });

  afterEach(() => {
    pingCallCount = 0;
    client = null;
    jest.clearAllTimers();
  });

  describe('constructor()', () => {
    it('accepts null options', () => {
      const ping = new Ping({} as any, fakeStanzaInstance);
      expect(ping).toBeTruthy();
    });
  });

  describe('start()', () => {
    it('when started it sends a ping on an interval', async () => {
      let ping = new Ping(client, fakeStanzaInstance, standardOptions);

      ping.start();
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(pingCallCount).toBe(1);
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(pingCallCount).toBe(2);
    });

    it('when started multiple times it sends a ping on a single interval', async () => {
      let ping = new Ping(client, fakeStanzaInstance, standardOptions);

      ping.start();
      ping.start();
      ping.start();
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(pingCallCount).toBe(1);
      ping.start();
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(pingCallCount).toBe(2);
    });

    it('when no pings it closes the connection', async () => {
      const jid = 'myfulljid';
      const channelId = 'somechannel';
      const client = {
        config: {
          channelId
        },
        logger: { warn: jest.fn(), error: jest.fn() },
      };
      fakeStanzaInstance.ping = jest.fn().mockRejectedValue(new Error('missed ping'));
      fakeStanzaInstance.jid = jid;

      const disconnectSpy = jest.fn();
      fakeStanzaInstance.transport = {
        disconnect: disconnectSpy
      };

      let ping = new Ping(client as any, fakeStanzaInstance, standardOptions);
      ping.start();

      // move forward in time to one ping
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();

      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();

      // verify it sends a stream error
      expect(fakeStanzaInstance.sendStreamError).toHaveBeenCalled();
      expect(fakeStanzaInstance.sendStreamError.mock.calls[0][0].condition).toBe('connection-timeout');
      expect(fakeStanzaInstance.sendStreamError.mock.calls[0][0].text).toBe('too many missed pongs');

      const last = client.logger.warn.mock.calls.length - 1;
      const infoChannelId = client.logger.warn.mock.calls[last][1].channelId;
      const infoJid = client.logger.warn.mock.calls[last][1].jid;

      expect(infoChannelId).toBe(channelId);
      expect(infoJid).toBe(jid);

      // verify it forcefully disconnects the transport
      expect(disconnectSpy).toHaveBeenCalledWith(false);
    });

    it('receiving a ping response resets the failure mechanism', () => {
      const jid = 'myfulljid';
      const channelId = 'somechannel';
      let pingCount = 0;
      const client = {
        logger: { warn: jest.fn(), error: jest.fn() },
        config: {
          channelId
        },
        _stanzaio: {
          jid: {
            full: jid
          },
          ping: jest.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('missed pong')),
          sendStreamError: jest.fn()
        }
      };
      let ping = new Ping(client as any, fakeStanzaInstance, standardOptions);
      ping.start();

      // move forward in time to one missed
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      // verify it doesn't send a stream error
      expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
    });

    it('allows ping interval override', () => {
      const options = {
        jid: 'anon@example.mypurecloud.com',
        pingInterval: 60000
      };
      let ping = new Ping(client, fakeStanzaInstance, options);
      ping.start();

      // move forward in time to the standard ping interval
      jest.advanceTimersByTime(21000);

      // verify there have been no calls yet
      expect(pingCallCount).toBe(0);

      // now move out further
      jest.advanceTimersByTime(40000);
      expect(pingCallCount).toBe(1);
    });

    it('allows failure number override', async () => {
      const jid = 'myfulljid';
      const channelId = 'somechannel';
      const client = {
        logger: { warn: jest.fn(), error: jest.fn() },
        config: {
          channelId
        }
      };
      fakeStanzaInstance.ping = jest.fn().mockRejectedValue(new Error('missed pong'));
      let ping = new Ping(client as any, fakeStanzaInstance, {
        jid: 'aonon@example.mypurecloud.com',
        failedPingsBeforeDisconnect: 4
      });
      ping.start();

      // move forward in time to one ping
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(fakeStanzaInstance.sendStreamError).not.toHaveBeenCalled();
      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(fakeStanzaInstance.sendStreamError).not.toHaveBeenCalled();
      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(fakeStanzaInstance.sendStreamError).not.toHaveBeenCalled();
      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(fakeStanzaInstance.sendStreamError).not.toHaveBeenCalled();
      // move forward again
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
      await flushPromises();
      expect(fakeStanzaInstance.sendStreamError).toHaveBeenCalled();
    });

    it('more than one start is okay', () => {
      let ping = new Ping(client, fakeStanzaInstance, standardOptions);
      ping.start();
      jest.advanceTimersByTime(16000);
      ping.start();

      ping.stop();
      expect(pingCallCount).toBe(1);
    });
  });

  describe('stop()', () => {
    it('stop should cause no more pings', () => {
      let ping = new Ping(client, fakeStanzaInstance, standardOptions);
      ping.start();

      // move forward in time to one ping
      jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);

      ping.stop();

      // now step forward and make sure only one ping ever gets sent.
      jest.advanceTimersByTime(60000);

      expect(pingCallCount).toBe(1);
    });

    it('more than one stop is okay', () => {
      let ping = new Ping(client, fakeStanzaInstance, standardOptions);
      ping.start();

      ping.stop();
      ping.stop();
      expect(pingCallCount).toBe(0);
    });
  });
});
