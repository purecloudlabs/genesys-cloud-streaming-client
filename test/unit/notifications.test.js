'use strict';

const test = require('tap').test;
const notifications = require('../../src/notifications');

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

  const notification = notifications(client);
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
  t.equal(notification.subscribe(...args), undefined);
  t.end();
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
    unsubscribeFromNode: (subscription) => {
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
  const notification = notifications(client);
  const args = [{ topic: [() => {}, () => {}] }, () => {}];
  t.equal(notification.unsubscribe.call(...args, undefined));
  t.end();
});
