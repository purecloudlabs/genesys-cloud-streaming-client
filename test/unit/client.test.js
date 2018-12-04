'use strict';

const test = require('ava');
const sinon = require('sinon');
const nock = require('nock');

const pcStream = require('../../src/client');
const { TokenBucket } = require('limiter');
const WildEmitter = require('wildemitter');

const defaultOptions = {
  jid: 'anon@example.mypurecloud.com',
  authToken: 'AuthToken',
  host: 'wss://streaming.example.com'
};
Object.freeze(defaultOptions);

function getDefaultOptions () {
  return Object.assign({}, defaultOptions);
}

function mockApi () {
  return nock('https://api.example.com')
    .post('/api/v2/notifications/channels?connectionType=streaming')
    .reply(200, { id: 'streaming-someid' });
}

test('client creation', t => {
  const client = pcStream.client(getDefaultOptions());
  t.is(typeof client.on, 'function');
  t.is(typeof client.connect, 'function');
  t.truthy(client.webrtcSessions);
});

test('connect jid override', async t => {
  t.plan(0);
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'connect');
  const api = mockApi();
  await client.connect({
    jid: 'someone-else@example.mypurecloud.com'
  });
  api.done();
  sinon.assert.calledWithExactly(client._stanzaio.connect, {
    jid: 'someone-else@example.mypurecloud.com',
    credentials: {
      username: 'someone-else@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    transport: 'websocket',
    wsURL: 'wss://streaming.example.com/stream/channels/streaming-someid'
  });
});

test('connect full override', async t => {
  t.plan(0);
  const options = getDefaultOptions();
  options.test = { baz: 'qux' };
  const client = pcStream.client(options);
  sinon.stub(client._stanzaio, 'connect');
  const api = mockApi();
  await client.connect({
    jid: 'anon@example.mypurecloud.com',
    authToken: 'AuthTokenAlt',
    test: { foo: 'bar' },
    host: 'wss://streaming.example.com'
  });
  api.done();
  sinon.assert.calledWithExactly(client._stanzaio.connect, {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthTokenAlt'
    },
    transport: 'websocket',
    wsURL: 'wss://streaming.example.com/stream/channels/streaming-someid'
  });
});

test('connect override of clientOptions', async t => {
  t.plan(0);
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'connect');
  const api = mockApi();
  await client.connect({
    jid: 'anon@example.mypurecloud.com',
    authToken: 'AuthTokenAlt',
    test: { foo: 'bar' },
    host: 'wss://streaming.example.com'
  });
  api.done();
});

test('extend add an extension for creating clients', t => {
  class TestExtension {
    on () {}
    off () {}
    get expose () {
      return { foo () {} };
    }
  }
  pcStream.extend('test1234', TestExtension);
  const client = pcStream.client(getDefaultOptions());
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

  pcStream.extend('testIqAndMessageHandlers', TestExtension);
  const client = pcStream.client(getDefaultOptions());
  client._stanzaio.emit('iq', testIq);
  client._stanzaio.emit('message', testMessage);
});

test('Should see callbacks set when an iq callback is explicitly registered', t => {
  const client = pcStream.client(getDefaultOptions());
  client._stanzaio.on('iq:set:myTestTopic', () => {});

  t.is(client._stanzaio.callbacks['iq:set:myTestTopic'].length, 1);
});

test('Should begin to reconnect when it becomes disconnected', t => {
  const client = pcStream.client(getDefaultOptions());
  client._stanzaio.emit('disconnected');

  return new Promise(resolve => {
    client._stanzaio.connect = sinon.stub().callsFake(() => {
      client._stanzaio.emit('connected');
      resolve();
    });
  });
});

test('Should not begin to reconnect when it becomes disconnected if autoReconnect is off', async t => {
  const client = pcStream.client(getDefaultOptions());
  client.autoReconnect = false;
  client._stanzaio.emit('disconnected');
  sinon.stub(client._stanzaio, 'emit');
  await new Promise(resolve => setTimeout(resolve, 100));
  sinon.assert.notCalled(client._stanzaio.emit);
});

test('Disconnecting explicitly will set autoReconnect to false', t => {
  const client = pcStream.client(getDefaultOptions());
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub();
  client.disconnect();
  t.is(client.autoReconnect, false);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('reconnect should disconnect but allow autoReconnect', t => {
  const client = pcStream.client(getDefaultOptions());
  client._autoReconnect = false;
  client._stanzaio.disconnect = sinon.stub();
  client.reconnect();
  t.is(client.autoReconnect, true);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('auth:failed should disable autoReconnect and disconnect', t => {
  const client = pcStream.client(getDefaultOptions());
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub();
  client._stanzaio.emit('auth:failed');
  t.is(client.autoReconnect, false);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('session:started event sets the client streamId', t => {
  const client = pcStream.client(getDefaultOptions());
  client._stanzaio.emit('session:started', { resource: 'foobar' });
  t.is(client.streamId, 'foobar');
  client._stanzaio.emit('session:end');
  t.pass(); // session end stops ping, no observable behavior on the client
});

test('extension.on(send) will send a stanza', async t => {
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  client._webrtcSessions.emit('send', { some: 'stanza' });
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendIq);
});

test('extension.on(send) will send a message stanza', async t => {
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  sinon.stub(client._stanzaio, 'sendMessage');
  client._webrtcSessions.emit('send', { some: 'stanza' }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendMessage);
  sinon.assert.notCalled(client._stanzaio.sendIq);
});

test('it will rate limit extensions sending stanzas', async t => {
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  for (let i = 0; i < 100; i++) {
    client._webrtcSessions.emit('send', { some: 'data' });
  }
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 45);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 70);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 95);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 100);
});

test('it will rate limit extensions with their own tokenBucket', async t => {
  pcStream.extend('tokenBucket', class CustomExtension extends WildEmitter {
    constructor () {
      super();
      this.tokenBucket = new TokenBucket(40, 50, 1000);
      this.tokenBucket.content = 40;
    }
  });
  const client = pcStream.client(getDefaultOptions());
  sinon.stub(client._stanzaio, 'sendIq');
  for (let i = 0; i < 200; i++) {
    client._tokenBucket.emit('send', { some: 'data' });
  }
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 90);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 140);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 190);
  await new Promise(resolve => setTimeout(resolve, 1001));
  t.is(client._stanzaio.sendIq.callCount, 200);
});

test('extend throws if an extension is already registered to a namespace', t => {
  t.throws(() => {
    pcStream.extend('webrtcSessions', () => {});
  });
});

test('it will remap some events for our client to the underlying stanza client', async t => {
  const client = pcStream.client(getDefaultOptions());
  const connected = sinon.stub();
  const _connected = sinon.stub();
  client.on('session:started', connected);
  client.on('connected', connected);
  client.on('_connected', _connected);
  client._stanzaio.emit('session:started', {});
  sinon.assert.calledTwice(connected);
  sinon.assert.notCalled(_connected);
  client._stanzaio.emit('connected', {});
  sinon.assert.calledOnce(_connected);

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
