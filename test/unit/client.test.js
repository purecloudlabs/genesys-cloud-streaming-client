'use strict';

const EventEmitter = require('events').EventEmitter;

const test = require('tap').test;
const td = require('../helpers').td;

let client, xmppInfo, connectionInfo, emitter, extendObject;
test('setup', t => {
  xmppInfo = {
    jid: 'anon@anon.lance.im',
    transport: 'websocket',
    wsURL: 'wss://lance.im/xmpp-websocket'
  };
  const XMPP = {
    createClient: () => {
      return xmppInfo;
    }
  };
  td.replace('stanza.io', XMPP);
  client = td.replace('../../src/client.js');
  connectionInfo = {
    connected: false,
    subscribedTopics: [],
    on: () => {},
    connect: () => {},
    disconnect: () => {}
  };
  emitter = new EventEmitter();
  emitter.on('connected', () => { return true; });
  emitter.on('disconnected', () => { return false; });
  td.when(client.connection(XMPP.createClient())).thenReturn(connectionInfo);
  td.when(client.connection(emitter.emit('connected'))).thenReturn(true);
  td.when(client.connection(emitter.emit('disconnected'))).thenReturn(false);

  extendObject = {
    namespace: 'stuff',
    name: 'sample'
  };
  td.when(client.extend(true)).thenThrow('Cannot register already existing namespace');
  td.when(client.extend(false)).thenReturn(extendObject);
  t.end();
});

test('client should return a module', t => {
  t.plan(1);
  t.ok(client, 'should return client stub module');
});

test('connection should return a set of properties and functions', t => {
  const actual = client.connection(xmppInfo);
  const expected = connectionInfo;
  t.deepEqual(actual, expected, `should return ${expected}`);
  t.end();
});

test('connected event should be called', t => {
  t.plan(1);
  client.connection(emitter.emit('connected'));
  const actual = td.explain(client.connection);
  const expected = 2;
  t.is(actual.callCount, 2, `should return ${expected}`);
});

test('disconnected event should be called', t => {
  t.plan(1);
  client.connection(emitter.emit('disconnected'));
  const actual = td.explain(client.connection);
  t.is(actual.callCount, 3, `should return ${actual.callCount}`);
});

test('extend should throw an error if gets to conditional block', t => {
  t.throws(() => { client.extend(true); });
  t.end();
});

test('extend should return an extendObject', t => {
  t.plan(1);
  const actual = client.extend(false);
  t.deepEqual(actual, extendObject);
});

test('teardown', t => {
  td.reset();
  t.end();
});
