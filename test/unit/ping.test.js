'use strict';

import createPing from '../../src/ping';

const test = require('ava');
const sinon = require('sinon');

const DEFAULT_PING_INTERVAL = 10 * 1000;
const PING_INTERVAL_WITH_BUFFER = DEFAULT_PING_INTERVAL + 100;

let standardOptions, client, clock;
let pingCallCount = 0;

// we have to reset the doubles for every test.
test.beforeEach(() => {
  standardOptions = {
    jid: 'anon@example.mypurecloud.com'
  };

  clock = sinon.useFakeTimers();
  client = {
    logger: { warn () {}, error () {} },
    _stanzaio: {
      ping: (jid, cb) => {
        pingCallCount++;
        return cb(null, { to: 'you' });
      },
      sendStreamError: sinon.stub()
    }
  };
});

test.afterEach(() => {
  pingCallCount = 0;
  client = null;
  clock.restore();
});

test.serial('accepts null options', t => {
  createPing(null);
  t.pass('made it');
});

test.serial('when started it sends a ping on an interval', t => {
  let ping = createPing(client, standardOptions);

  ping.start();
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(pingCallCount, 1);
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(pingCallCount, 2);
});

test.serial('when started multiple times it sends a ping on a single interval', t => {
  let ping = createPing(client, standardOptions);

  ping.start();
  ping.start();
  ping.start();
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(pingCallCount, 1);
  ping.start();
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(pingCallCount, 2);
});

test.serial('when no pings it closes the connection', t => {
  const jid = 'myfulljid';
  const channelId = 'somechannel';
  const client = {
    config: {
      channelId
    },
    logger: { warn: sinon.stub(), error: sinon.stub() },
    _stanzaio: {
      ping: (jid, cb) => {
        cb(new Error('Missed pong'));
      },
      jid: {
        full: jid
      },
      sendStreamError: sinon.stub()
    }
  };
  let ping = createPing(client, standardOptions);
  ping.start();

  // move forward in time to one ping
  clock.tick(PING_INTERVAL_WITH_BUFFER);

  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);

  // verify it sends a stream error
  t.is(client._stanzaio.sendStreamError.called, true);
  t.is(client._stanzaio.sendStreamError.getCall(0).args[0].condition, 'connection-timeout');
  t.is(client._stanzaio.sendStreamError.getCall(0).args[0].text, 'too many missed pongs');
  const { channelId: infoChannelId, jid: infoJid } = client.logger.warn.lastCall.args[1];
  t.is(infoChannelId, channelId);
  t.is(infoJid, jid);
});

test.serial('receiving a ping response resets the failure mechanism', t => {
  const jid = 'myfulljid';
  const channelId = 'somechannel';
  let pingCount = 0;
  const client = {
    logger: { warn: sinon.stub(), error: sinon.stub() },
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
      sendStreamError: sinon.stub()
    }
  };
  let ping = createPing(client, standardOptions);
  ping.start();

  // move forward in time to one missed
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  // verify it doesn't send a stream error
  t.is(client._stanzaio.sendStreamError.callCount, 0);
});

test.serial('allows ping interval override', t => {
  const options = {
    jid: 'anon@example.mypurecloud.com',
    pingInterval: 60000
  };
  let ping = createPing(client, options);
  ping.start();

  // move forward in time to the standard ping interval
  clock.tick(21000);

  // verify there have been no calls yet
  t.is(pingCallCount, 0, 'no calls yet');

  // now move out further
  clock.tick(40000);

  client._stanzaio.ping(standardOptions, val => val);
});

test.serial('allows failure number override', t => {
  const jid = 'myfulljid';
  const channelId = 'somechannel';
  const client = {
    logger: { warn: sinon.stub(), error: sinon.stub() },
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
      sendStreamError: sinon.stub()
    }
  };
  let ping = createPing(client, {
    jid: 'aonon@example.mypurecloud.com',
    failedPingsBeforeDisconnect: 4
  });
  ping.start();

  // move forward in time to one ping
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(client._stanzaio.sendStreamError.called, false);
  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(client._stanzaio.sendStreamError.called, false);
  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(client._stanzaio.sendStreamError.called, false);
  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(client._stanzaio.sendStreamError.called, false);
  // move forward again
  clock.tick(PING_INTERVAL_WITH_BUFFER);
  t.is(client._stanzaio.sendStreamError.called, true);
});

test.serial('stop should cause no more pings', t => {
  let ping = createPing(client, standardOptions);
  ping.start();

  // move forward in time to one ping
  clock.tick(PING_INTERVAL_WITH_BUFFER);

  ping.stop();

  // now step forward and make sure only one ping ever gets sent.
  clock.tick(60000);

  t.is(pingCallCount, 1);
});

test.serial('more than one stop is okay', t => {
  let ping = createPing(standardOptions);
  ping.start();

  ping.stop();
  ping.stop();
  t.is(pingCallCount, 0);
});
