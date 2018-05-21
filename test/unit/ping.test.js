'use strict';

const test = require('ava');
const sinon = require('sinon');

let standardOptions, clientStanza, clock, createPing;
let pingCallCount = 0;

// we have to reset the doubles for every test.
test.beforeEach(() => {
  standardOptions = {
    jid: 'anon@anon.lance.im'
  };

  clock = sinon.useFakeTimers();
  createPing = require('../../src/ping.js');
  clientStanza = {
    ping: (options, cb) => {
      pingCallCount++;
      return cb(options);
    },
    sendStreamError: sinon.stub()
  };
});

test.afterEach(() => {
  pingCallCount = 0;
  clientStanza = null;
  clock.restore();
});

test('accepts null options', t => {
  createPing(null);
  t.pass('made it');
});

test('when started it sends a ping on an interval', t => {
  let ping = createPing(clientStanza, standardOptions);

  ping.start();

  // move forward in time to where two pings should have been sent.
  clock.tick(21000);

  // verify we got two pings sent.
  clientStanza.ping(standardOptions, (val, error) => val);
  t.is(pingCallCount, 2);
});

test('when no pings it closes the connection', t => {
  let ping = createPing(clientStanza, standardOptions);
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  clientStanza.ping(standardOptions, (val) => val);

  // move forward again
  clock.tick(21000);
  clientStanza.ping(standardOptions, (val) => val);

  // verify it sends a stream error
  t.is(clientStanza.sendStreamError.called, true);
  t.is(clientStanza.sendStreamError.getCall(0).args[0].condition, 'connection-timeout');
  t.is(clientStanza.sendStreamError.getCall(0).args[0].text, 'too many missed pongs');
});

test('receiving a ping response resets the failure mechanism', t => {
  let ping = createPing(clientStanza, standardOptions);
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  clientStanza.ping(standardOptions, (val) => val);

  // move forward again
  clock.tick(21000);
  clientStanza.ping(standardOptions, (val) => val);

  // move forward again
  clock.tick(21000);
  standardOptions = {
    jid: 'anon@anon.lance.im'
  };
  clientStanza.ping(standardOptions, val => val);

  // verify it doesn't send a stream error a third time
  t.is(clientStanza.sendStreamError.callCount, 2);
});

test('allows ping interval override', t => {
  const options = {
    jid: 'anon@anon.lance.im',
    pingInterval: 60000
  };
  let ping = createPing(clientStanza, options);
  ping.start();

  // move forward in time to the standard ping interval
  clock.tick(21000);

  // verify there have been no calls yet
  t.is(pingCallCount, 0, 'no calls yet');

  // now move out further
  clock.tick(40000);

  clientStanza.ping(standardOptions, val => val);
});

test('allows failure number override', t => {
  const options = {
    jid: 'anon@anon.lance.im',
    failedPingsBeforeDisconnect: 2
  };
  let ping = createPing(clientStanza, options);
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  clientStanza.ping(standardOptions, val => val);
  t.is(pingCallCount, 2);

  // move forward again
  clock.tick(21000);
  clientStanza.ping(standardOptions, val => val);
  t.is(pingCallCount, 4);

  // make sure sendStreamError event not sent
  t.is(clientStanza.sendStreamError.notCalled, true);

  // move forward again
  clock.tick(21000);
  clientStanza.ping(standardOptions, val => val);
  t.is(pingCallCount, 6);

  // verify it sends a stream error
  t.truthy(clientStanza.sendStreamError.called);
});

test('stop should cause no more pings', t => {
  let ping = createPing(clientStanza, standardOptions);
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);

  ping.stop();

  // now step forward and make sure only one ping ever gets sent.
  clock.tick(60000);

  t.is(pingCallCount, 1);
});

test('more than one stop is okay', t => {
  let ping = createPing(standardOptions);
  ping.start();

  ping.stop();
  ping.stop();
  t.is(pingCallCount, 0);
});
