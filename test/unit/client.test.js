'use strict';

const test = require('tap').test;
const td = require('../helpers').td;

let pcStream, xmppInfo, extendObject, clientStanza, stanzaioInstance;
test('setup', t => {
  xmppInfo = {
    jid: 'anon@anon.lance.im',
    authToken: 'AuthToken',
    host: 'wss://example.com/test'
  };

  //Stub stanzaio connection
  stanzaioInstance = {
    on: td.function('.on'),
    connect: td.function('.connect'),
    disconnect: td.function('.disconnect'),
  };

  //Stup stanzaio library
  clientStanza = {
    createClient: td.function('.createClient')
  };

  td.when(clientStanza.createClient(td.matchers.anything()))
    .thenReturn(stanzaioInstance);

  td.replace('stanza.io', clientStanza);

  pcStream = require('../../src/client.js');
  t.end();
});

test('client should return a module', t => {
  t.plan(1);
  t.ok(pcStream, 'should return client stub module');
});

test('client creation', t => {
  pcStream.client(xmppInfo);
  td.verify(clientStanza.createClient({
      jid: 'anon@anon.lance.im',
      credentials: {
        username: 'anon@anon.lance.im',
        password: 'authKey:AuthToken'
      },
      transport: 'websocket',
      wsURL: 'wss://example.com/test/stream'
  }));
  t.end();
});

test('connect jid override', t => {
  let con = pcStream.client(xmppInfo);
  con.connect({
    jid: 'anonAlt@anon.lance.im',
  });

  td.verify(stanzaioInstance.connect({
      jid: 'anonAlt@anon.lance.im',
      credentials: {
        username: 'anonAlt@anon.lance.im',
        password: 'authKey:AuthToken'
      },
      transport: 'websocket',
      wsURL: 'wss://example.com/test/stream'
  }));

  t.end();
});

test('connect full override', t => {
  let con = pcStream.client(xmppInfo);
  con.connect({
    jid: 'anonAlt@anon.lance.im',
    authToken: 'AuthTokenAlt',
    host: 'wss://example.com/testAlt'
  });

  td.verify(stanzaioInstance.connect({
      jid: 'anonAlt@anon.lance.im',
      credentials: {
        username: 'anonAlt@anon.lance.im',
        password: 'authKey:AuthTokenAlt'
      },
      transport: 'websocket',
      wsURL: 'wss://example.com/testAlt/stream'
  }));

  t.end();
});

test('extend should return an extendObject', t => {
  t.plan(1);
  const actual = pcStream.extend(false);
  t.deepEqual(actual, extendObject);
});

test('teardown', t => {
  td.reset();
  t.end();
});
