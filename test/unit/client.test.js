'use strict';

const test = require('ava');
const sinon = require('sinon');

const pcStream = require('../../src/client');
const { TokenBucket } = require('limiter');
const WildEmitter = require('wildemitter');

let xmppInfo, extendObject, client, stanzaioInstance;
test.beforeEach(() => {
  xmppInfo = {
    jid: 'anon@example.mypurecloud.com',
    authToken: 'AuthToken',
    host: 'wss://example.com/test'
  };

  // Stub stanzaio connection
  stanzaioInstance = {
    on: () => {
      return {
        bind: sinon.stub()
      };
    },
    connect: () => {
      return {
        bind: sinon.stub()
      };
    },
    disconnect: () => {
      return {
        bind: sinon.stub()
      };
    },
    emit: () => {
      return {
        bind: sinon.stub()
      };
    }
  };

  client = {
    createClient: sinon.stub()
  };

  client.createClient.withArgs(sinon.match.any).returns(stanzaioInstance);
});

test('client creation', t => {
  pcStream.client(xmppInfo);
  const clientOptions = {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    transport: 'websocket',
    wsURL: 'wss://example.com/test/stream'
  };
  client.createClient(clientOptions);
  const expectedPayload = {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    transport: 'websocket',
    wsURL: 'wss://example.com/test/stream'
  };
  t.deepEqual(client.createClient.args[0][0], expectedPayload);
});

test('connect jid override', t => {
  t.plan(0);
  let con = pcStream.client(xmppInfo);
  con.connect({
    jid: 'anon@example.mypurecloud.com'
  });
  const connectPayload = {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    transport: 'websocket',
    wsURL: 'wss://example.com/test/stream'
  };
  stanzaioInstance.connect(connectPayload);
});

test('connect full override', t => {
  t.plan(0);
  let con = pcStream.client(xmppInfo);
  con.connect({
    jid: 'anon@example.mypurecloud.com',
    authToken: 'AuthTokenAlt',
    test: { foo: 'bar' },
    host: 'wss://example.com/testAlt'
  });
  const connectPayload = {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    wsURL: 'wss://example.com/test/stream',
    transport: 'websocket'
  };
  stanzaioInstance.connect(connectPayload);
});

test('connect override of clientOptions', t => {
  t.plan(0);
  xmppInfo.test = {};
  let con = pcStream.client(xmppInfo);
  con.connect({
    jid: 'anon@example.mypurecloud.com',
    authToken: 'AuthTokenAlt',
    test: { foo: 'bar' },
    host: 'wss://example.com/testAlt'
  });
  const connectPayload = {
    jid: 'anon@example.mypurecloud.com',
    credentials: {
      username: 'anon@example.mypurecloud.com',
      password: 'authKey:AuthToken'
    },
    wsURL: 'wss://example.com/test/stream',
    transport: 'websocket'
  };
  stanzaioInstance.connect(connectPayload);
});

test('extend should return an extendObject', t => {
  class TestExtension {
    on () {}
    off () {}
  }
  t.plan(1);
  const actual = pcStream.extend('test1234', TestExtension);
  t.deepEqual(actual, extendObject);
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
  const client = pcStream.client(xmppInfo);
  client._stanzaio.emit('iq', testIq);
  client._stanzaio.emit('message', testMessage);
});

test('Should see callbacks set when an iq callback is explicitly registered', t => {
  const client = pcStream.client(xmppInfo);
  client._stanzaio.on('iq:set:myTestTopic', () => {});

  t.is(client._stanzaio.callbacks['iq:set:myTestTopic'].length, 1);
});

test('Should begin to reconnect when it becomes disconnected', t => {
  const client = pcStream.client(xmppInfo);
  client._stanzaio.emit('disconnected');

  return new Promise(resolve => {
    client._stanzaio.connect = sinon.stub().callsFake(() => {
      client._stanzaio.emit('connected');
      resolve();
    });
  });
});

test('Should not begin to reconnect when it becomes disconnected if autoReconnect is off', async t => {
  const client = pcStream.client(xmppInfo);
  client.autoReconnect = false;
  client._stanzaio.emit('disconnected');
  sinon.stub(client._stanzaio, 'emit');
  await new Promise(resolve => setTimeout(resolve, 100));
  sinon.assert.notCalled(client._stanzaio.emit);
});

test('Disconnecting explicitly will set autoReconnect to false', t => {
  const client = pcStream.client(xmppInfo);
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub();
  client.disconnect();
  t.is(client.autoReconnect, false);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('reconnect should disconnect but allow autoReconnect', t => {
  const client = pcStream.client(xmppInfo);
  t.is(client.autoReconnect, true);
  client._stanzaio.disconnect = sinon.stub();
  client.reconnect();
  t.is(client.autoReconnect, true);
  sinon.assert.calledOnce(client._stanzaio.disconnect);
});

test('session:started event sets the client streamId', t => {
  const client = pcStream.client(xmppInfo);
  client._stanzaio.emit('session:started', { resource: 'foobar' });
  t.is(client.streamId, 'foobar');
  client._stanzaio.emit('session:end');
  t.pass(); // session end stops ping, no observable behavior on the client
});

test('extension.on(send) will send a stanza', async t => {
  const client = pcStream.client(xmppInfo);
  sinon.stub(client._stanzaio, 'sendIq');
  client._webrtcSessions.emit('send', { some: 'stanza' });
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendIq);
});

test('extension.on(send) will send a message stanza', async t => {
  const client = pcStream.client(xmppInfo);
  sinon.stub(client._stanzaio, 'sendIq');
  sinon.stub(client._stanzaio, 'sendMessage');
  client._webrtcSessions.emit('send', { some: 'stanza' }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  sinon.assert.calledOnce(client._stanzaio.sendMessage);
  sinon.assert.notCalled(client._stanzaio.sendIq);
});

test('it will rate limit extensions sending stanzas', async t => {
  const client = pcStream.client(xmppInfo);
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
  const client = pcStream.client(xmppInfo);
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
