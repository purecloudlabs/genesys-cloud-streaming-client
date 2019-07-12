'use strict';

const test = require('ava');
const sinon = require('sinon');
const nock = require('nock');

global.window = global;
global.self = global;

const Client = require('../../src/client');
const { TokenBucket } = require('limiter');
const WildEmitter = require('wildemitter');

const atob = require('atob');
const btoa = require('btoa');

const defaultOptions = {
  jid: 'anon@example.mypurecloud.com',
  authToken: 'AuthToken',
  host: 'wss://streaming.example.com',
  logger: {
    warn () {},
    error () {},
    debug () {},
    info () {}
  }
};
Object.freeze(defaultOptions);

global.window.btoa = btoa;
global.window.atob = atob;

const crypto = require('crypto');
global.crypto = {
  getRandomValues: function (rawBytes) {
    return {
      buffer: crypto.randomBytes(rawBytes.length)
    };
  }
};

function getDefaultOptions () {
  return Object.assign({}, defaultOptions);
}

class TestExtension extends WildEmitter {}

Client.extend('testExtension', TestExtension);

function mockApi () {
  nock.restore();
  nock.cleanAll();
  nock.activate();
  const api = nock('https://api.example.com');
  const channel = api
    .post('/api/v2/notifications/channels', () => true)
    .query(true)
    .reply(200, { id: 'streaming-someid' });
  const me = api
    .get('/api/v2/users/me')
    .reply(200, { chat: { jabberId: defaultOptions.jid } });
  const subscriptions = api
    .post('/api/v2/notifications/channels/streaming-someid/subscriptions', () => true)
    .reply(202);
  return { api, channel, me, subscriptions };
}

test('client creation', t => {
  const client = new Client(getDefaultOptions());
  t.is(typeof client.on, 'function');
  t.is(typeof client.connect, 'function');
  t.truthy(client.notifications);
});

test.serial('connect will reject if the session:started event is never emitted', t => {
  t.plan(1);
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'connect').callsFake(() => client._stanzaio.emit('session:error', {}));
  mockApi();
  return client.connect()
    .catch(() => {
      t.pass();
    });
});

test.serial('connect will not fetch the jid if it was provided in client options', t => {
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'connect').callsFake(() => client._stanzaio.emit('session:started', {}));
  const apis = mockApi();
  return client.connect()
    .then(() => {
      t.false(apis.me.isDone());
    });
});

test.serial('connect will fetch the jid if not provided', t => {
  const client = new Client({
    host: defaultOptions.host,
    authToken: defaultOptions.authToken
  });
  sinon.stub(client._stanzaio, 'connect').callsFake(() => client._stanzaio.emit('session:started', {}));
  const apis = mockApi();
  return client.connect()
    .then(() => {
      return client.notifications.bulkSubscribe(['test']);
    })
    .then(() => {
      apis.api.done();
      t.true(apis.me.isDone());
      t.true(apis.channel.isDone());
    });
});

test.serial('connect will fetch the jid if not provided with a custom api host', t => {
  const client = new Client({
    host: 'wss://localhost:3000',
    apiHost: 'https://api.example.com',
    authToken: defaultOptions.authToken
  });
  sinon.stub(client._stanzaio, 'connect').callsFake(() => client._stanzaio.emit('session:started', {}));
  const apis = mockApi();
  return client.connect()
    .then(() => {
      return client.notifications.bulkSubscribe(['test']);
    })
    .then(() => {
      apis.api.done();
      t.true(apis.me.isDone());
      t.true(apis.channel.isDone());
    });
});

test.serial('Will use anonymous authentication to connect if using a JWT instead of an authToken', t => {
  const client = new Client({
    host: defaultOptions.host,
    jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'acd-asdfasdfkj@conference.example.orgspan.com' } }))
  });
  sinon.stub(client._stanzaio, 'connect').callsFake(opts => {
    t.is(opts.sasl.length, 1);
    t.is(opts.sasl[0], 'anonymous');
    t.is(opts.server, 'example.orgspan.com');
    client._stanzaio.emit('session:started', {});
  });
  return client.connect();
});

test.serial('will throw if jid domain cannot be parsed from jid in jwt', t => {
  const client = new Client({
    host: defaultOptions.host,
    jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'example.orgspan.com' } }))
  });
  return client.connect()
    .then(() => t.fail()) // throws in promise chain, so promise should not succeed
    .catch(() => t.pass()); // it threw, success
});

test('extend add an extension for creating clients', t => {
  class TestExtension {
    on () {}
    off () {}
    get expose () {
      return { foo () {} };
    }
  }
  Client.extend('test1234', TestExtension);
  const client = new Client(getDefaultOptions());
  t.is(typeof client._test1234.on, 'function');
  t.is(typeof client.test1234.foo, 'function');
});

test('should call handleIq or handleMessage on those events, if an extension registered for them', t => {
  t.plan(2);
  const testIq = { to: 'you', from: 'someone' };
  const testMessage = { to: 'you', from: 'someoneElse' };
  class TestExtension {
    on () {}
    off () {}
    handleIq (stanza) {
      t.is(stanza, testIq);
    }
    handleMessage (stanza) {
      t.is(stanza, testMessage);
    }
  }

  Client.extend('testIqAndMessageHandlers', TestExtension);
  const client = new Client(getDefaultOptions());
  client._stanzaio.emit('iq', testIq);
  client._stanzaio.emit('message', testMessage);
});

test('Should see callbacks set when an iq callback is explicitly registered', t => {
  const client = new Client(getDefaultOptions());
  client._stanzaio.on('iq:set:myTestTopic', () => {});

  t.is(client._stanzaio.callbacks['iq:set:myTestTopic'].length, 1);
});

test('Should begin to reconnect when it becomes disconnected', t => {
  const client = new Client(getDefaultOptions());

  return new Promise(resolve => {
    client._stanzaio.connect = sinon.stub().callsFake(() => {
      client._stanzaio.emit('connected');
      resolve();
    });
    client._stanzaio.emit('disconnected');
  });
});

test('Should not begin to reconnect when it becomes disconnected if autoReconnect is off', async t => {
  const client = new Client(getDefaultOptions());
  client.autoReconnect = false;
  client._stanzaio.emit('disconnected');
  sinon.stub(client._stanzaio, 'emit');
  await new Promise(resolve => setTimeout(resolve, 100));
  sinon.assert.notCalled(client._stanzaio.emit);
});

test('Disconnecting explicitly will set autoReconnect to false', t => {
  const client = new Client(getDefaultOptions());
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub().callsFake(() => client._stanzaio.emit('disconnected'));
  client.disconnect();
  t.is(client.autoReconnect, false);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('reconnect should disconnect but allow autoReconnect', t => {
  const client = new Client(getDefaultOptions());
  client._autoReconnect = false;
  client._stanzaio.disconnect = sinon.stub().callsFake(() => client._stanzaio.emit('disconnected'));
  client._stanzaio.connect = sinon.stub().callsFake(() => client._stanzaio.emit('session:started', {}));
  client.reconnect();
  t.is(client.autoReconnect, true);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('sasl:failure should disable autoReconnect and disconnect', t => {
  const client = new Client(getDefaultOptions());
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub().callsFake(() => client._stanzaio.emit('disconnected'));
  client._stanzaio.emit('sasl:failure');
  t.is(client.autoReconnect, false);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('temporary auth failure should not disable autoReconnect and disconnect', t => {
  const client = new Client(getDefaultOptions());
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub().callsFake(() => client._stanzaio.emit('disconnected'));
  client._stanzaio.emit('sasl:failure', { condition: 'temporary-auth-failure' });
  t.is(client.autoReconnect, true);
  sinon.assert.notCalled(client._stanzaio.disconnect);
});

test('session:started event sets the client streamId', t => {
  const client = new Client(getDefaultOptions());
  client._stanzaio.emit('session:started', { resource: 'foobar' });
  t.is(client.streamId, 'foobar');
  client._stanzaio.emit('session:end');
  t.pass(); // session end stops ping, no observable behavior on the client
});

test('extension.on(send) will send a stanza', async t => {
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  client._testExtension.emit('send', { some: 'stanza' });
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendIq);
});

test('extension.on(send) will send a message stanza', async t => {
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  sinon.stub(client._stanzaio, 'sendMessage');
  client._testExtension.emit('send', { some: 'stanza' }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendMessage);
  sinon.assert.notCalled(client._stanzaio.sendIq);
});

test('it will rate limit extensions sending stanzas', async t => {
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  for (let i = 0; i < 100; i++) {
    client._testExtension.emit('send', { some: 'data' });
  }
  await new Promise(resolve => setTimeout(resolve, 1001));

  // because timers in JS are not exact, add a 'within' expectation
  // saying that the value is +/- deviation of target
  function within (value, target, deviation) {
    t.true(Math.abs(target - value) <= deviation);
  }
  within(client._stanzaio.sendIq.callCount, 45, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 70, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 95, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 100, 3);
});

test('it will rate limit extensions with their own tokenBucket', async t => {
  Client.extend('tokenBucket', class CustomExtension extends WildEmitter {
    constructor () {
      super();
      this.tokenBucket = new TokenBucket(40, 50, 1000);
      this.tokenBucket.content = 40;
    }
  });
  const client = new Client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  for (let i = 0; i < 200; i++) {
    client._tokenBucket.emit('send', { some: 'data' });
  }

  // because timers in JS are not exact, add a 'within' expectation
  // saying that the value is +/- deviation of target
  function within (value, target, deviation) {
    t.true(Math.abs(target - value) <= deviation);
  }
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 90, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 140, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 190, 3);
  await new Promise(resolve => setTimeout(resolve, 1001));
  within(client._stanzaio.sendIq.callCount, 200, 3);
});

test('extend throws if an extension is already registered to a namespace', t => {
  t.throws(() => {
    Client.extend('testExtension', () => {});
  });
});

test('it will remap some events for our client to the underlying stanza client', async t => {
  const client = new Client(getDefaultOptions());
  const connected = sinon.stub();
  const _connected = sinon.stub();
  const event = sinon.stub();
  // event chaining works, too!
  client
    .on('session:started', connected)
    .on('connected', connected)
    .on('_connected', _connected)
    .once('other:event', event);
  client._stanzaio.emit('session:started', {});
  sinon.assert.calledTwice(connected);
  sinon.assert.notCalled(_connected);
  client._stanzaio.emit('connected', {});
  sinon.assert.calledOnce(_connected);

  // once should only emit once
  client._stanzaio.emit('other:event', {});
  client._stanzaio.emit('other:event', {});
  sinon.assert.calledOnce(event);

  connected.reset();
  _connected.reset();
  client.off('session:started', connected);
  client.off('connected', connected);
  client.off('_connected', _connected);
  client._stanzaio.emit('session:started', {});
  sinon.assert.notCalled(connected);
  sinon.assert.notCalled(_connected);
  client._stanzaio.emit('connected', {});
  sinon.assert.notCalled(_connected);
});

test('it will return the app version', t => {
  t.is(Client.version, '[AIV]{version}[/AIV]');
});
