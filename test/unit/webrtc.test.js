'use strict';

const test = require('tap').test;
const td = require('../helpers').td;
const mockSocket = require('mock-socket');
td.replace('faye-websocket', {Client: mockSocket.WebSocket});

let expectedMessages = [
  {client: '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" version="1.0" xml:lang="en" to="example.com"/>'},
  {server:
    "<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' from='im.example.com' id='stream-id' version='1.0' xml:lang='en' xmlns:stream='http://etherx.jabber.org/streams'>"},
  {server:
    "<stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>ANONYMOUS</mechanism><mechanism>PLAIN</mechanism></mechanisms></stream:features>"},
  {client: 'foo'}
];

function messageMatch (messageEntry) {
  return true;
}

function messageHandler (server, messages, resolve, reject) {
  let msgSeq = messages;
  return function (message) {
    console.log('Server recived:', message);
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

test('jitsi', t => {
  let mockServer;

  return t.test('connect', t => {
    return new Promise((resolve, reject) => {
      const client = require('../../src/client.js');
      mockServer = new mockSocket.Server('ws://localhost/stream');

      mockServer.on('connection', server => {
        console.log('Client connected.');
      });

      mockServer.on('message', messageHandler(mockServer, expectedMessages, resolve, reject));

      let con = client.connection('ws://localhost', 'test@example.com', 'password');
      con.on('raw:incoming', (data) => {
        console.log('Client recieved:', data);
      });

      // do all the stuff
      con.connect();
    });
  });
});

