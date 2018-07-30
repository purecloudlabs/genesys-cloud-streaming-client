'use strict';

const Notifications = require('../../src/notifications');
const test = require('ava');
const sinon = require('sinon');

test('subscribe and unsubscribe do their jobs', t => {
  const client = {
    on: () => {},
    subscribeToNode () {},
    unsubscribeFromNode () {}
  };
  const notification = new Notifications(client);

  sinon.stub(notification.client, 'subscribeToNode').callsFake((a, b, c) => c());
  const handler = () => {};
  const callback = () => {};
  notification.expose.subscribe('test', handler, callback);
  sinon.assert.calledOnce(notification.client.subscribeToNode);
  t.is(notification.subscriptions.test[0], handler);
  const handler2 = () => {};
  notification.expose.subscribe('test', handler2, callback);
  // don't resubscribe on the server
  sinon.assert.calledOnce(notification.client.subscribeToNode);
  t.is(notification.subscriptions.test[1], handler2);

  sinon.stub(notification.client, 'unsubscribeFromNode').callsFake((a, b, c) => c());
  notification.expose.unsubscribe('test', handler2);
  // there are still more subscriptions
  sinon.assert.notCalled(notification.client.unsubscribeFromNode);

  notification.expose.unsubscribe('test');
  // unsubscribing without a handler won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client.unsubscribeFromNode);

  notification.expose.unsubscribe('test', handler, callback);
  sinon.assert.calledOnce(notification.client.unsubscribeFromNode);
  sinon.assert.calledWith(notification.client.unsubscribeFromNode, 'firehose.inindca.com', 'test', sinon.match.func);

  t.deepEqual(notification.exposeEvents, [ 'notifications:notify' ]);
});
