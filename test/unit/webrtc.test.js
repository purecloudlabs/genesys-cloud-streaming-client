'use strict';

const test = require('ava');
const sinon = require('sinon');
const mockSocket = require('mock-socket');
sinon.stub(require('faye-websocket'), {Client: mockSocket.WebSocket});

let mockServer, expectedMessages;
test.before(() => {
  expectedMessages = [
    {client: '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" version="1.0" xml:lang="en" to="example.com"/>'},
    {server:
      "<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' from='im.example.com' id='stream-id' version='1.0' xml:lang='en' xmlns:stream='http://etherx.jabber.org/streams'>"},
    {server:
      "<stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>ANONYMOUS</mechanism><mechanism>PLAIN</mechanism></mechanisms></stream:features>"},
    {client: 'foo'}
  ];
});

function messageMatch (messageEntry) {
  return true;
}

function messageHandler (server, messages, resolve, reject) {
  let msgSeq = messages;
  return function (message) {
    console.log('Server received:', message);
    if (messageMatch(message, msgSeq.shift())) {
      while (msgSeq[0] && msgSeq[0].server) {
        let msg = msgSeq.shift().server;
        console.log('Server sending:', msg);
        server.send(msg);
      }
      if (msgSeq.length === 0) {
        console.log('Resolving in 1s');
        setTimeout(resolve, 1000);
      }
    } else {
      reject('Unexpected Message: ' + message);
    }
  };
}

test('connect', t => {
  t.plan(0);
  const client = require('../../src/client.js');
  mockServer = new mockSocket.Server('ws://localhost/stream');

  mockServer.on('connection', server => {
    console.log('Client connected.');
  });

  mockServer.on('message', messageHandler(mockServer, expectedMessages));

  let con = client.client({
    host: 'ws://localhost',
    credentials: {
      username: 'test@example.com',
      password: 'password'
    },
    wsURL: 'wss://example.com/test/stream',
    transport: 'websocket'
  });
  con.on('raw:incoming', (data) => {
    console.log('Client recieved:', data);
  });

  // do all the stuff
  con.connect();
});
