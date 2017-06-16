'use strict';

const tap = require('tap');
const td = require('../helpers').td;
const timers = require('testdouble-timers').default;

let standardOptions, clientStanza, clock;

function createPing(options) {
  return require('../../src/ping.js')(clientStanza, options);
}

// we have to reset the doubles for every test.
function test(message, test) {
  standardOptions = {
    jid: 'anon@anon.lance.im',
  };

  timers.use(td);
  clock = td.timers();
  clientStanza = td.object(['ping', 'sendStreamError'])

  tap.test(message, t=> {
    test(t);
  });

  td.reset();
}

test('accepts null options', t=> {
  let ping = createPing(null);
  tap.pass('made it');
  t.end();
});

test('when started it sends a ping on an interval', t => {
  let ping = createPing(standardOptions);

  ping.start();

  // move forward in time to where two pings should have been sent.
  clock.tick(41000);

  // verify we got two pings sent.
  td.verify(clientStanza.ping('anon@anon.lance.im', td.matchers.anything()), {times: 2});

  t.end();
});

test('when no pings it closes the connection', t => {
  let ping = createPing(standardOptions);
  var captor = td.matchers.captor();
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  captor.value({}, null);

  // move forward again
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  captor.value({}, null);

  // verify it sends a stream error
  td.verify(clientStanza.sendStreamError(td.matchers.anything()));

  t.end();
});

test('receiving a ping response resets the failure mechanism', t => {
  let ping = createPing(standardOptions);
  var captor = td.matchers.captor();
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  captor.value({}, null);

  // move forward again
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  captor.value(null, {});

  // move forward again and fail
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  captor.value({}, null);

  // verify it doesn't send a stream error
  tap.equal(td.explain(clientStanza.sendStreamError).callCount, 0, 'no stream errors sent');

  t.end();
});

test('allows ping interval override', t => {
  const options = {
    jid: 'anon@anon.lance.im',
    pingInterval: 60000
  };
  let ping = createPing(options);
  ping.start();

  // move forward in time to the standard ping interval
  clock.tick(21000);

  // verify there have been no calls yet
  tap.equal(td.explain(clientStanza.ping).callCount, 0, 'no calls yet');

  // now move out further
  clock.tick(40000);
  
  td.verify(clientStanza.ping(td.matchers.anything(), td.matchers.anything()));

  t.end();
});

test('allows failure number override', t => {
  const options = {
    jid: 'anon@anon.lance.im',
    failedPingsBeforeDisconnect: 2
  };
  let ping = createPing(options);
  var captor = td.matchers.captor();
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  tap.equal(td.explain(clientStanza.ping).callCount, 1, 'single ping sent');
  captor.value({}, null);

  // move forward again
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  tap.equal(td.explain(clientStanza.ping).callCount, 2, 'pings sent');
  captor.value({}, null);

  // make sure it isn't using the default interval 
  tap.equal(td.explain(clientStanza.sendStreamError).callCount, 0, 'no calls yet');

  // move forward again
  clock.tick(21000);
  td.verify(clientStanza.ping(td.matchers.anything(), captor.capture()));
  tap.equal(td.explain(clientStanza.ping).callCount, 3, 'pings sent');
  captor.value({}, null);

  // verify it sends a stream error
  td.verify(clientStanza.sendStreamError(td.matchers.anything()));

  t.end();
});

test('stop should cause no more pings', t => {
  let ping = createPing(standardOptions);
  var captor = td.matchers.captor();
  ping.start();

  // move forward in time to one ping
  clock.tick(21000);

  ping.stop();

  // now step forward and make sure only one ping ever gets sent.
  clock.tick(60000);

  tap.equal(td.explain(clientStanza.ping).callCount, 1, 'only one ping, Vasily');

  t.end();
});

test('more than one stop is okay', t => {
  let ping = createPing(standardOptions);
  ping.start();

  ping.stop();
  ping.stop();

  t.end();
});
