'use strict';

const test = require('tap').test;
const td = require('../helpers').td;

let client, xmppInfo, XMPP, extendObject, clientStanza;
test('setup', t => {
  xmppInfo = [
    'anon@anon.lance.im',
    'websocket',
    'wss://lance.im/xmpp-websocket'
  ];
  XMPP = {
    createClient: () => {
      return xmppInfo;
    }
  };
  clientStanza = {
    on: (str, cb) => {},
    disconnect: () => {},
    subscribedTopics: [],
    connected: false,
    createClient: () => {
      return {
        on: {
          bind: (client) => client
        },
        on: () => {},
        connect: () => {
          return {
            bind: (client) => client
          };
        },
        disconnect: () => {
          return {
            bind: (client) => client
          };
        }
      };
    }
  };
  td.replace('stanza.io', clientStanza);
  client = require('../../src/client.js');
  t.end();
});

test('client should return a module', t => {
  t.plan(1);
  t.ok(client, 'should return client stub module');
});

test('connect event', t => {
  t.plan(1);
  t.ok(client.connection(...XMPP.createClient()));
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
