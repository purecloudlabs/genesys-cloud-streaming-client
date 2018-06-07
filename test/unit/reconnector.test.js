'use strict';

const test = require('ava');
const WildEmitter = require('wildemitter');
const Reconnector = require('../../src/reconnector');
const sinon = require('sinon');

let clock;

// controls whether clients can reconnect or not
let SIMULTATE_ONLINE = false;

class Client extends WildEmitter {
  constructor () {
    super();
    this.connected = false;
    this.connectAttempts = 0;
  }

  connect () {
    this.connectAttempts++;
    setTimeout(() => {
      if (SIMULTATE_ONLINE) {
        this.emit('connected');
        this.connected = true;
      } else {
        this.emit('disconnected');
        this.connected = false;
      }
    }, 10);
  }
}

test.beforeEach(() => {
  SIMULTATE_ONLINE = false;
  clock = sinon.useFakeTimers();
});

test.afterEach(() => {
  clock.restore();
});

test('when started it reconnects on backoff', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);

  SIMULTATE_ONLINE = true;
  clock.tick(1100);
  t.is(client.connectAttempts, 4);
  t.is(client.connected, true);

  // make sure it didn't keep trying
  clock.tick(10000);
  t.is(client.connectAttempts, 4);
});

test('when stopped it will cease the backoff', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);

  reconnect.stop();
  clock.tick(1100);
  t.is(client.connectAttempts, 3);
  t.is(client.connected, false);

  // make sure it didn't keep trying
  clock.tick(10000);
  t.is(client.connectAttempts, 3);
});
