'use strict';

import createPing from '../../src/ping';

// const test = require('ava');
// const sinon = require('sinon');

const DEFAULT_PING_INTERVAL = 10 * 1000;
const PING_INTERVAL_WITH_BUFFER = DEFAULT_PING_INTERVAL + 100;

let standardOptions, client;
let pingCallCount = 0;

describe('Ping', () => {
  // we have to reset the doubles for every test.
  beforeEach(() => {
    standardOptions = {
      jid: 'anon@example.mypurecloud.com'
    };

    jest.useFakeTimers();

    client = {
      logger: { warn () { }, error () { } },
      _stanzaio: {
        ping: (jid, cb) => {
          pingCallCount++;
          return cb(null, { to: 'you' });
        },
        sendStreamError: jest.fn()
      }
    };
  });

  afterEach(() => {
    pingCallCount = 0;
    client = null;
    jest.clearAllTimers();
  });

  test('accepts null options', () => {
    createPing(null);
    expect('made it').toBeTruthy();
  });

  test('when started it sends a ping on an interval', () => {
    let ping = createPing(client, standardOptions);

    ping.start();
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(pingCallCount).toBe(1);
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(pingCallCount).toBe(2);
  });

  test('when started multiple times it sends a ping on a single interval', () => {
    let ping = createPing(client, standardOptions);

    ping.start();
    ping.start();
    ping.start();
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(pingCallCount).toBe(1);
    ping.start();
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(pingCallCount).toBe(2);
  });

  test('when no pings it closes the connection', () => {
    const jid = 'myfulljid';
    const channelId = 'somechannel';
    const client = {
      config: {
        channelId
      },
      logger: { warn: jest.fn(), error: jest.fn() },
      _stanzaio: {
        ping: (jid, cb) => {
          cb(new Error('Missed pong'));
        },
        jid: {
          full: jid
        },
        sendStreamError: jest.fn()
      }
    };
    let ping = createPing(client, standardOptions);
    ping.start();

    // move forward in time to one ping
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);

    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);

    // verify it sends a stream error
    expect(client._stanzaio.sendStreamError).toHaveBeenCalled();
    expect(client._stanzaio.sendStreamError.mock.calls[0][0].condition).toBe('connection-timeout');
    expect(client._stanzaio.sendStreamError.mock.calls[0][0].text).toBe('too many missed pongs');

    const last = client.logger.warn.mock.calls.length - 1;
    const infoChannelId = client.logger.warn.mock.calls[last][1].channelId;
    const infoJid = client.logger.warn.mock.calls[last][1].jid;

    expect(infoChannelId).toBe(channelId);
    expect(infoJid).toBe(jid);
  });

  test('receiving a ping response resets the failure mechanism', () => {
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
        ping: (jid, cb) => {
          pingCount++;
          if (pingCount === 1) {
            // fail first ping
            return cb(new Error('missed pong'));
          }
          return cb(null, { to: 'your@jid' });
        },
        sendStreamError: jest.fn()
      }
    };
    let ping = createPing(client, standardOptions);
    ping.start();

    // move forward in time to one missed
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    // verify it doesn't send a stream error
    expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
  });

  test('allows ping interval override', () => {
    const options = {
      jid: 'anon@example.mypurecloud.com',
      pingInterval: 60000
    };
    let ping = createPing(client, options);
    ping.start();

    // move forward in time to the standard ping interval
    jest.advanceTimersByTime(21000);

    // verify there have been no calls yet
    expect(pingCallCount).toBe(0, 'no calls yet');

    // now move out further
    jest.advanceTimersByTime(40000);

    client._stanzaio.ping(standardOptions, val => val);
  });

  test('allows failure number override', () => {
    const jid = 'myfulljid';
    const channelId = 'somechannel';
    const client = {
      logger: { warn: jest.fn(), error: jest.fn() },
      config: {
        channelId
      },
      _stanzaio: {
        jid: {
          full: jid
        },
        ping: (jid, cb) => {
          cb(new Error('Missed pong'));
        },
        sendStreamError: jest.fn()
      }
    };
    let ping = createPing(client, {
      jid: 'aonon@example.mypurecloud.com',
      failedPingsBeforeDisconnect: 4
    });
    ping.start();

    // move forward in time to one ping
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(client._stanzaio.sendStreamError).not.toHaveBeenCalled();
    // move forward again
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);
    expect(client._stanzaio.sendStreamError).toHaveBeenCalled();
  });

  test('stop should cause no more pings', () => {
    let ping = createPing(client, standardOptions);
    ping.start();

    // move forward in time to one ping
    jest.advanceTimersByTime(PING_INTERVAL_WITH_BUFFER);

    ping.stop();

    // now step forward and make sure only one ping ever gets sent.
    jest.advanceTimersByTime(60000);

    expect(pingCallCount).toBe(1);
  });

  test('more than one stop is okay', () => {
    let ping = createPing(standardOptions);
    ping.start();

    ping.stop();
    ping.stop();
    expect(pingCallCount).toBe(0);
  });
});
