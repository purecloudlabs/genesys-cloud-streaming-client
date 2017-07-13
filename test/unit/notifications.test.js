'use strict';

const test = require('ava');

test('subscribe should subscribeToNode', t => {
  const client = {
    subscribeToNode: (subscription) => {
      return {
        type: 'set',
        to: '123456',
        pubsub: {
          subscribe: {}
        }
      };
    },
    on: () => {},
    createSubscription: () => {}
  };

  const notification = require('../../src/notifications')(client);
  const args = [
    'ournode',
    { topic: [() => {}, () => {}] },
    (err) => {
      if (!err) {
        t.truthy('subscribed');
        t.end();
      }
    }
  ];
  t.is(notification.subscribe(...args), undefined);
});

test('unsubscribe should unsubscribe', t => {
  const client = {
    createClient: (client) => {
      return {
        jid: 'codecraftsmanships@gitter.im',
        transport: 'websocket',
        wsURL: 'wss://gitter.im/xmpp-websocket',
        credentials: {
          auth: 'auth'
        }
      };
    },
    unsubscribe: (subscription) => {
      return {
        type: 'set',
        to: '123456',
        pubsub: {
          subscribe: {}
        }
      };
    },
    on: () => {},
    createSubscription: () => {}
  };
  const notification = require('../../src/notifications')(client);
  t.is(notification.unsubscribe.call({ topic: [() => {}, () => {}] }, () => {}), undefined);
});
