'use strict';

const Notifications = require('../../src/notifications');
const test = require('ava');
const sinon = require('sinon');
const WildEmitter = require('wildemitter');
const nock = require('nock');

class Client extends WildEmitter {
  constructor (config) {
    super();
    this.config = config;

    this.logger = {
      warn () {},
      info () {}
    };

    this._stanzaio = new WildEmitter();
    this._stanzaio.subscribeToNode = () => {};
    this._stanzaio.unsubscribeFromNode = () => {};
  }
}

test('pubsubHost', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);
  t.is(notification.pubsubHost, 'notifications.inindca.com');
  client.config.apiHost = 'inintca.com';
  t.is(notification.pubsubHost, 'notifications.inintca.com');
  client.config.apiHost = 'mypurecloud.com';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com');
  client.config.apiHost = 'mypurecloud.com.au';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com.au');
  client.config.apiHost = 'mypurecloud.jp';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.jp');
  client.config.apiHost = 'mypurecloud.de';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.de');
  client.config.apiHost = 'mypurecloud.ie';
  t.is(notification.pubsubHost, 'notifications.mypurecloud.ie');

  client.config.apiHost = 'someone.elses.website';
  t.is(notification.pubsubHost, 'notifications.someone.elses.website');

  client.config = null;
  t.is(notification.pubsubHost, 'notifications.mypurecloud.com');
});

test('subscribe and unsubscribe do their jobs', async t => {
  const client = new Client({
    apiHost: 'example.com',
    channelId: 'notification-test-channel'
  });
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c) => c());
  const handler = sinon.stub();
  const firstSubscription = notification.expose.subscribe('test', handler);

  // not subscribed yet, client is not connected
  sinon.assert.notCalled(notification.client._stanzaio.subscribeToNode);

  client.emit('connected');
  client.connected = true;
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  await firstSubscription;
  t.is(notification.subscriptions.test.length, 1);
  t.is(notification.subscriptions.test[0], handler);

  // subscribe again to the same topic with the same handler
  await notification.expose.subscribe('test', handler);
  t.is(notification.subscriptions.test.length, 1, 'handler not added again');

  const handler2 = sinon.stub();
  await notification.expose.subscribe('test', handler2);
  // don't resubscribe on the server
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
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
  sinon.spy(notification.client._stanzaio, 'emit');
  client.emit('pubsub:event', pubsubMessage);
  sinon.assert.calledTwice(notification.client._stanzaio.emit);
  sinon.assert.calledWith(notification.client._stanzaio.emit, 'notify', { topic: 'test', data: { the: 'payload' } });
  sinon.assert.calledWith(notification.client._stanzaio.emit, 'notify:test', { the: 'payload' });

  sinon.assert.calledOnce(handler);
  sinon.assert.calledWith(handler, { the: 'payload' });
  sinon.assert.calledOnce(handler2);
  sinon.assert.calledWith(handler2, { the: 'payload' });

  const apiRequest = nock('https://api.example.com')
    .post('/api/v2/notifications/channels/notification-test-channel/subscriptions', () => true)
    .reply(200, { id: 'streaming-someid' });
  await notification.expose.bulkSubscribe(['test', 'topic.one', 'topic.two']);
  // didn't subscribe via xmpp any more (was once previously)
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  apiRequest.done();

  // unsubscribing
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c) => c());
  await notification.expose.unsubscribe('test', handler2);
  // there are still more subscriptions
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  await notification.expose.unsubscribe('test');
  // unsubscribing without a handler won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  await notification.expose.unsubscribe('test');
  // unsubscribing when there's record of a bulk subscription won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  delete notification.bulkSubscriptions.test;
  client.connected = false;
  const unsubscribe = notification.expose.unsubscribe('test', handler);
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  client.emit('connected');
  await unsubscribe;
  sinon.assert.calledOnce(notification.client._stanzaio.unsubscribeFromNode);
  sinon.assert.calledWith(notification.client._stanzaio.unsubscribeFromNode, 'notifications.example.com', 'test', sinon.match.func);
});

test('subscribe and unsubscribe reject on failures', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  client.connected = true;
  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c) => c(new Error('test')));
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c(new Error('test')));
  const handler = sinon.stub();
  t.plan(2);
  await notification.expose.subscribe('test', handler).catch(() => t.pass());
  await notification.expose.unsubscribe('test', handler).catch(() => t.pass());
});

test('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c = () => {}) => c());
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c());
  client.emit('connected');
  client.connected = true;
  sinon.assert.notCalled(notification.client._stanzaio.subscribeToNode);
  const handler = sinon.stub();
  const handler2 = sinon.stub();
  const handler3 = sinon.stub();
  const handler4 = sinon.stub();
  await notification.expose.subscribe('test', handler);
  await notification.expose.subscribe('test', handler2);
  await notification.expose.subscribe('test2', handler3);
  await notification.expose.subscribe('test3', handler4);
  notification.bulkSubscriptions.test3 = true;
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  await notification.expose.unsubscribe('test2', handler3);
  sinon.stub(notification, 'bulkSubscribe');
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
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  sinon.assert.calledOnce(notification.bulkSubscribe);
});
