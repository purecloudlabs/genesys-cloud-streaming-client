'use strict';

import Reconnector from '../../src/reconnector';

const test = require('ava');
const WildEmitter = require('wildemitter');
const sinon = require('sinon');

let clock;

// controls whether clients can reconnect or not
let SIMULTATE_ONLINE = false;

class MockStanzaIo extends WildEmitter {
  constructor (connectTimeout, client) {
    super();
    this.connectTimeout = connectTimeout;
    this.client = client;
  }
  get disco () {
    return {
      addFeature () {}
    };
  }
  get stanzas () {
    return {
      define () {},
      utils: {
        textSub () {}
      },
      extendIQ () {}
    };
  }

  connect () {
    this.client.connectAttempts++;
    setTimeout(() => {
      if (SIMULTATE_ONLINE) {
        this.emit('connected');
        this.client.connected = true;
      } else {
        this.emit('disconnected');
        this.client.connected = false;
      }
    }, this.connectTimeout || 10);
  }
}

class Client {
  constructor (connectTimeout) {
    this.connectTimeout = connectTimeout;
    this.connected = false;
    this.connectAttempts = 0;

    this.logger = {
      warn () {},
      error () {},
      debug () {},
      info () {}
    };

    this._stanzaio = new MockStanzaIo(connectTimeout, this);
  }

  on () {
    this._stanzaio.on(...arguments);
  }

  connect () {
    this.connectAttempts = 0;
  }
  reconnect () {}
}

test.beforeEach(() => {
  SIMULTATE_ONLINE = false;
  clock = sinon.useFakeTimers();
});

test.afterEach(() => {
  clock.restore();
});

// all tests in this module are serial because we're messing with time

test.serial('when started it reconnects on backoff', async t => {
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

test.serial('when started it reconnects on backoff (long reconnect)', async t => {
  const client = new Client(400);
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(200);
  client._stanzaio.transport = { conn: { readyState: 0 } };
  clock.tick(350);
  t.is(client.connectAttempts, 1);

  client._stanzaio.transport = { conn: { readyState: 1 } };
  clock.tick(450);
  t.is(client.connectAttempts, 1);

  clock.tick(1100);
  t.is(client.connectAttempts, 1);
  client._stanzaio.transport = { conn: { readyState: 3 } };

  clock.tick(3000);
  t.is(client.connectAttempts, 2);

  SIMULTATE_ONLINE = true;
  clock.tick(6000);
  t.is(client.connectAttempts, 3);
  t.is(client.connected, true);

  // make sure it didn't keep trying
  clock.tick(10000);
  t.is(client.connectAttempts, 3);
});

test.serial('when started a second time it will not immediately retry the backoff', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  // Will not throw an error
  reconnect.start();
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);
});

test.serial('when stopped it will cease the backoff', async t => {
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

test.serial('will attempt a full reconnection after 10 failures', async t => {
  const client = new Client();
  sinon.stub(client, 'connect');
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  sinon.assert.notCalled(client.connect);

  // Fail a lot more
  clock.tick(50000);
  t.is(client.connectAttempts > 10, true);

  // make sure client connect was called
  sinon.assert.calledOnce(client.connect);
});

test.serial('when an auth failure occurs it will cease the backoff', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);

  client._stanzaio.emit('sasl:failure', { condition: 'not-authorized' });
  clock.tick(1100);
  t.is(client.connectAttempts, 3);
  t.is(client.connected, false);

  // make sure it didn't keep trying
  clock.tick(10000);
  t.is(client.connectAttempts, 3);
});

test.serial('when a temporary auth failure occurs it will not cease the backoff', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);

  client._stanzaio.emit('sasl:failure', { condition: 'temporary-auth-failure' });
  clock.tick(1100);
  t.is(client.connectAttempts, 4);
  t.is(client.connected, false);

  clock.tick(2500);
  t.is(client.connectAttempts, 5);

  client._stanzaio.emit('sasl:failure');
});

test.serial('will reconnect if an authorization error occurs after a connection has connected previously', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  reconnect.start();

  // move forward in time to where two connections should have been attempted.
  clock.tick(350);
  t.is(client.connectAttempts, 2);

  clock.tick(600);
  t.is(client.connectAttempts, 3);

  reconnect._hasConnected = true;
  client._stanzaio.emit('sasl:failure', { condition: 'not-authorized' });
  clock.tick(250);
  reconnect.start();
  clock.tick(30);
  t.is(client.connectAttempts, 1);
  t.is(client.connected, false);

  clock.tick(10);
  client._stanzaio.emit('sasl:failure'); // now fail permanently to stop tests

  // make sure it didn't keep trying
  clock.tick(10000);
  t.is(client.connectAttempts, 1);
});

test.serial('when a connection transfer request comes in, will emit a reconnect request to the consuming application', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  sinon.stub(client, 'reconnect').callsFake(() => {
    client._stanzaio.emit('reconnected');
  });

  client.on('requestReconnect', (handler) => {
    setTimeout(() => handler({ done: true }), 1);
  });

  const reconnected = new Promise(resolve => {
    client.on('reconnected', resolve);
  });

  reconnect.client._stanzaio.emit('iq:set:cxfr', {
    cxfr: {
      domain: 'asdf.example.com',
      server: 'streaming.us-east-1.example.com'
    }
  });

  clock.tick(10);

  await reconnected;
});

test.serial('will wait to reconnect if called back with pending', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  sinon.stub(client, 'reconnect').callsFake(() => {
    client._stanzaio.emit('reconnected');
  });

  client.on('requestReconnect', (handler) => {
    setTimeout(() => handler({ pending: true }), 1);
    setTimeout(() => handler({ done: true }), 200);
  });

  const reconnected = new Promise(resolve => {
    client.on('reconnected', resolve);
  });

  reconnect.client._stanzaio.emit('iq:set:cxfr', {
    cxfr: {
      domain: 'asdf.example.com',
      server: 'streaming.us-east-1.example.com'
    }
  });

  clock.tick(10);
  sinon.assert.notCalled(client.reconnect);
  clock.tick(500);
  sinon.assert.calledOnce(client.reconnect);

  await reconnected;
});

test.serial('will wait no longer than 1 hour after pending callback to reconnect', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  sinon.stub(client, 'reconnect').callsFake(() => {
    client._stanzaio.emit('reconnected');
  });

  client.on('requestReconnect', (handler) => {
    setTimeout(() => handler({ pending: true }), 1);
  });

  const reconnected = new Promise(resolve => {
    client.on('reconnected', resolve);
  });

  reconnect.client._stanzaio.emit('iq:set:cxfr', {
    cxfr: {
      domain: 'asdf.example.com',
      server: 'streaming.us-east-1.example.com'
    }
  });

  clock.tick(10);
  sinon.assert.notCalled(client.reconnect);
  clock.tick(10 * 60 * 1000);
  sinon.assert.calledOnce(client.reconnect);

  await reconnected;
});

test.serial('will reconnect after a second if no pending or done response is received', async t => {
  const client = new Client();
  const reconnect = new Reconnector(client);
  sinon.stub(client, 'reconnect').callsFake(() => {
    client._stanzaio.emit('reconnected');
  });

  client.on('requestReconnect', (handler) => {
    setTimeout(() => handler({ pending: true }), 2000); // too late
  });

  const reconnected = new Promise(resolve => {
    client.on('reconnected', resolve);
  });

  reconnect.client._stanzaio.emit('iq:set:cxfr', {
    cxfr: {
      domain: 'asdf.example.com',
      server: 'streaming.us-east-1.example.com'
    }
  });

  clock.tick(10);
  sinon.assert.notCalled(client.reconnect);
  clock.tick(1000);
  sinon.assert.calledOnce(client.reconnect);

  await reconnected;
});
