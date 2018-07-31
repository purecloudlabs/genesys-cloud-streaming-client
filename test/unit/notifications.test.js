'use strict';

const Notifications = require('../../src/notifications');
const test = require('ava');
const sinon = require('sinon');
const WildEmitter = require('wildemitter');

class Client extends WildEmitter {
  subscribeToNode () {}
  unsubscribeFromNode () {}
}

test('subscribe and unsubscribe do their jobs', t => {
  const client = new Client();
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.client, 'subscribeToNode').callsFake((a, b, c) => c());
  const handler = sinon.stub();
  const callback = () => {};
  notification.expose.subscribe('test', handler, callback);
  sinon.assert.calledOnce(notification.client.subscribeToNode);
  t.is(notification.subscriptions.test.length, 1);
  t.is(notification.subscriptions.test[0], handler);

  // subscribe again to the same topic with the same handler
  notification.expose.subscribe('test', handler, callback);
  t.is(notification.subscriptions.test.length, 1, 'handler not added again');

  const handler2 = sinon.stub();
  notification.expose.subscribe('test', handler2, callback);
  // don't resubscribe on the server
  sinon.assert.calledOnce(notification.client.subscribeToNode);
  t.is(notification.subscriptions.test[1], handler2);

  // eventing
  const pubsubMessage = {
    event: {
      updated: {
        node: 'test',
        published: [
          { json: { the: 'payload' } }
        ]
      }
    }
  };
  sinon.spy(client, 'emit');
  client.emit('pubsub:event', pubsubMessage);
  sinon.assert.calledTwice(client.emit);
  sinon.assert.calledWith(client.emit, 'notifications:notify', { topic: 'test', data: { the: 'payload' } });

  sinon.assert.calledOnce(handler);
  sinon.assert.calledWith(handler, { the: 'payload' });
  sinon.assert.calledOnce(handler2);
  sinon.assert.calledWith(handler2, { the: 'payload' });

  // unsubscribing
  sinon.stub(notification.client, 'unsubscribeFromNode').callsFake((a, b, c) => c());
  notification.expose.unsubscribe('test', handler2);
  // there are still more subscriptions
  sinon.assert.notCalled(notification.client.unsubscribeFromNode);

  notification.expose.unsubscribe('test');
  // unsubscribing without a handler won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client.unsubscribeFromNode);

  notification.expose.unsubscribe('test', handler);
  sinon.assert.calledOnce(notification.client.unsubscribeFromNode);
  sinon.assert.calledWith(notification.client.unsubscribeFromNode, 'firehose.inindca.com', 'test', sinon.match.func);

  t.deepEqual(notification.exposeEvents, [ 'notifications:notify' ]);
});
