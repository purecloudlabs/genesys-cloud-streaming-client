'use strict';

const Notifications = require('../../src/notifications');
const test = require('ava');
const sinon = require('sinon');
const WildEmitter = require('wildemitter');

class Client extends WildEmitter {
  subscribeToNode () {}
  unsubscribeFromNode () {}
}

test('pubsubHost', t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);
  t.is(notification.pubsubHost, 'notifications.inindca.com');
  notification.stanzaio.config.wsURL = 'ws://streaming.inintca.com/something-else';
  t.is(notification.pubsubHost, 'notifications.inintca.com');
  notification.stanzaio.config.wsURL = 'ws://streaming.mypurecloud.com/something-else';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com');
  notification.stanzaio.config.wsURL = 'ws://streaming.mypurecloud.com.au/something-else';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com.au');
  notification.stanzaio.config.wsURL = 'ws://streaming.mypurecloud.jp/something-else';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.jp');
  notification.stanzaio.config.wsURL = 'ws://streaming.mypurecloud.de/something-else';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.de');
  notification.stanzaio.config.wsURL = 'ws://streaming.mypurecloud.ie/something-else';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.ie');

  notification.stanzaio.config.wsURL = 'ws://someone.elses.website/something-else';
  t.is(notification.pubsubHost, 'notifications.elses.website');

  notification.stanzaio.config.wsURL = 'ws://uhoh';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com');
});

test('subscribe and unsubscribe do their jobs', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.stanzaio, 'subscribeToNode').callsFake((a, b, c) => c());
  const handler = sinon.stub();
  const firstSubscription = notification.expose.subscribe('test', handler);

  // not subscribed yet, client is not connected
  sinon.assert.notCalled(notification.stanzaio.subscribeToNode);

  client.emit('session:started');
  client.transport = { authenticated: true };
  sinon.assert.calledOnce(notification.stanzaio.subscribeToNode);
  await firstSubscription;
  t.is(notification.subscriptions.test.length, 1);
  t.is(notification.subscriptions.test[0], handler);

  // subscribe again to the same topic with the same handler
  await notification.expose.subscribe('test', handler);
  t.is(notification.subscriptions.test.length, 1, 'handler not added again');

  const handler2 = sinon.stub();
  await notification.expose.subscribe('test', handler2);
  // don't resubscribe on the server
  sinon.assert.calledOnce(notification.stanzaio.subscribeToNode);
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
  sinon.spy(notification, 'emit');
  client.emit('pubsub:event', pubsubMessage);
  sinon.assert.calledOnce(notification.emit);
  sinon.assert.calledWith(notification.emit, 'notify', { topic: 'test', data: { the: 'payload' } });

  sinon.assert.calledOnce(handler);
  sinon.assert.calledWith(handler, { the: 'payload' });
  sinon.assert.calledOnce(handler2);
  sinon.assert.calledWith(handler2, { the: 'payload' });

  // unsubscribing
  sinon.stub(notification.stanzaio, 'unsubscribeFromNode').callsFake((a, b, c) => c());
  await notification.expose.unsubscribe('test', handler2);
  // there are still more subscriptions
  sinon.assert.notCalled(notification.stanzaio.unsubscribeFromNode);

  await notification.expose.unsubscribe('test');
  // unsubscribing without a handler won't trigger any unsubscribe
  sinon.assert.notCalled(notification.stanzaio.unsubscribeFromNode);

  client.transport = { authenticated: false };
  const unsubscribe = notification.expose.unsubscribe('test', handler);
  sinon.assert.notCalled(notification.stanzaio.unsubscribeFromNode);

  client.emit('session:started');
  await unsubscribe;
  sinon.assert.calledOnce(notification.stanzaio.unsubscribeFromNode);
  sinon.assert.calledWith(notification.stanzaio.unsubscribeFromNode, 'notifications.inindca.com', 'test', sinon.match.func);
});

test('subscribe and unsubscribe reject on failures', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  client.transport = { authenticated: true };
  sinon.stub(notification.stanzaio, 'subscribeToNode').callsFake((a, b, c) => c(new Error('test')));
  sinon.stub(notification.stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c(new Error('test')));
  const handler = sinon.stub();
  t.plan(2);
  await notification.expose.subscribe('test', handler).catch(() => t.pass());
  await notification.expose.unsubscribe('test', handler).catch(() => t.pass());
});

test('notifications should resubscribe to existing topics after streaming-subscriptions-expiring event', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.stanzaio, 'subscribeToNode').callsFake((a, b, c = () => {}) => c());
  sinon.stub(notification.stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c());
  client.emit('session:started');
  client.transport = { authenticated: true };
  sinon.assert.notCalled(notification.stanzaio.subscribeToNode);
  const handler = sinon.stub();
  const handler2 = sinon.stub();
  const handler3 = sinon.stub();
  await notification.expose.subscribe('test', handler);
  await notification.expose.subscribe('test', handler2);
  await notification.expose.subscribe('test2', handler3);
  sinon.assert.calledTwice(notification.stanzaio.subscribeToNode);
  await notification.expose.unsubscribe('test2', handler3);
  client.emit('pubsub:event', {
    event: {
      updated: {
        node: 'streaming-subscriptions-expiring',
        published: [
          { json: {expiring: 60} }
        ]
      }
    }
  });
  sinon.assert.calledThrice(notification.stanzaio.subscribeToNode);
});
