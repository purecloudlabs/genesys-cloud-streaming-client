'use strict';

import Notifications from '../../src/notifications';

const test = require('ava');
const sinon = require('sinon');
const WildEmitter = require('wildemitter');
const nock = require('nock');

const exampleTopics = require('../helpers/example-topics.json');

class Client extends WildEmitter {
  constructor (config) {
    super();
    this.config = config;

    this.logger = {
      warn () {},
      info () {},
      error () {}
    };

    this._stanzaio = new WildEmitter();
    this._stanzaio.subscribeToNode = () => {};
    this._stanzaio.unsubscribeFromNode = () => {};
  }
}

const SUBSCRIPTIONS_EXPIRING = {
  event: {
    updated: {
      node: 'streaming-subscriptions-expiring',
      published: [
        { json: { expiring: 60 } }
      ]
    }
  }
};

function timeout (t) {
  return new Promise(resolve => setTimeout(resolve, t));
}

test('pubsubHost', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);
  t.is(notification.pubsubHost, 'notifications.inindca.com');
  client.config.apiHost = 'https://localhost:3000';
  t.is(notification.pubsubHost, 'notifications.localhost:3000');
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
  const firstSubscription = notification.expose.subscribe('topic.test', handler, true);

  // not subscribed yet, client is not connected
  sinon.assert.notCalled(notification.client._stanzaio.subscribeToNode);

  client.emit('connected');
  client.connected = true;
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  await firstSubscription;
  t.is(notification.subscriptions['topic.test'].length, 1);
  t.is(notification.subscriptions['topic.test'][0], handler);

  // subscribe again to the same topic with the same handler
  await notification.expose.subscribe('topic.test', handler, true);
  t.is(notification.subscriptions['topic.test'].length, 1, 'handler not added again');

  const handler2 = sinon.stub();
  await notification.expose.subscribe('topic.test', handler2, true);
  // don't resubscribe on the server
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  t.is(notification.subscriptions['topic.test'][1], handler2);

  // eventing
  const pubsubMessage = {
    event: {
      updated: {
        node: 'topic.test',
        published: [
          { json: { the: 'payload' } }
        ]
      }
    }
  };
  sinon.spy(notification.client._stanzaio, 'emit');
  client.emit('pubsub:event', pubsubMessage);
  sinon.assert.calledTwice(notification.client._stanzaio.emit);
  sinon.assert.calledWith(notification.client._stanzaio.emit, 'notify', { topic: 'topic.test', data: { the: 'payload' } });
  sinon.assert.calledWith(notification.client._stanzaio.emit, 'notify:topic.test', { the: 'payload' });

  sinon.assert.calledOnce(handler);
  sinon.assert.calledWith(handler, { the: 'payload' });
  sinon.assert.calledOnce(handler2);
  sinon.assert.calledWith(handler2, { the: 'payload' });

  const apiRequest = nock('https://api.example.com')
    .post('/api/v2/notifications/channels/notification-test-channel/subscriptions', () => true)
    .reply(200, { id: 'streaming-someid' });
  await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two', 'topic.three']);
  // didn't subscribe via xmpp any more (was once previously)
  console.warn('subscribeToNode 4');
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  apiRequest.done();
  t.is(notification.bulkSubscriptions['topic.three'], true);

  const apiRequest2 = nock('https://api.example.com')
    .put('/api/v2/notifications/channels/notification-test-channel/subscriptions', () => true)
    .reply(200, { id: 'streaming-someid' });
  await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two'], { replace: true });
  // didn't subscribe via xmpp any more (was once previously)
  console.warn('subscribeToNode 5');
  sinon.assert.calledOnce(notification.client._stanzaio.subscribeToNode);
  apiRequest2.done();
  t.is(notification.bulkSubscriptions['topic.three'], undefined);

  // unsubscribing
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c) => c());
  await notification.expose.unsubscribe('topic.test', handler2, true);
  // there are still more subscriptions
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  await notification.expose.unsubscribe('topic.test', () => {}, true);
  // unsubscribing with an unused handler won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  await notification.expose.unsubscribe('topic.test', handler, true);
  // unsubscribing when there's record of a bulk subscription won't trigger any unsubscribe
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  client.connected = false;
  // unsubscribing without a handler removes the bulkScubscription handler
  const unsubscribe = notification.expose.unsubscribe('topic.test', null, true);
  // well, not until we reconnect
  sinon.assert.notCalled(notification.client._stanzaio.unsubscribeFromNode);

  client.emit('connected');
  await unsubscribe;
  sinon.assert.calledOnce(notification.client._stanzaio.unsubscribeFromNode);
  sinon.assert.calledWith(notification.client._stanzaio.unsubscribeFromNode, 'notifications.example.com', 'topic.test', sinon.match.func);
});

test('subscribe and unsubscribe work when debounced', async t => {
  const client = new Client({
    apiHost: 'example.com',
    channelId: 'notification-test-channel'
  });
  const notification = new Notifications(client);

  // subscribing
  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c) => c());
  sinon.stub(notification, 'bulkSubscribe').returns(Promise.resolve());
  const handler = sinon.stub();
  const firstSubscription = notification.expose.subscribe('topic.test', handler);

  await timeout(150);
  sinon.assert.calledOnce(notification.bulkSubscribe);
  await firstSubscription;
  t.is(notification.subscriptions['topic.test'].length, 1);
  t.is(notification.subscriptions['topic.test'][0], handler);

  let promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(notification.expose.subscribe(`topic.test${i}`, handler));
  }

  await Promise.all(promises);
  sinon.assert.calledTwice(notification.bulkSubscribe);

  promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(notification.expose.unsubscribe(`topic.test${i}`, handler));
  }

  await Promise.all(promises);
  sinon.assert.calledThrice(notification.bulkSubscribe);
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
  await notification.expose.subscribe('test', handler, true).catch(() => t.pass());
  await notification.expose.unsubscribe('test', handler, true).catch(() => t.pass());
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
  sinon.stub(notification, 'bulkSubscribe').returns(Promise.resolve());
  client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
  sinon.assert.notCalled(notification.bulkSubscribe);
  sinon.assert.notCalled(notification.client._stanzaio.subscribeToNode);
  const handler = sinon.stub();
  const handler2 = sinon.stub();
  const handler3 = sinon.stub();
  await notification.expose.subscribe('test', handler, true);
  await notification.expose.subscribe('test', handler2, true);
  await notification.expose.subscribe('test2', handler3, true);
  await notification.expose.subscribe('test3', null, true);
  notification.bulkSubscriptions.test3 = true;
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  await notification.expose.unsubscribe('test2', handler3, true);
  client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  sinon.assert.calledOnce(notification.bulkSubscribe);
});

test('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event and emit an error on failure', async t => {
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
  sinon.stub(notification, 'bulkSubscribe').returns(Promise.reject(new Error('intentional test error')));
  client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
  sinon.assert.notCalled(notification.bulkSubscribe);
  sinon.assert.notCalled(notification.client._stanzaio.subscribeToNode);
  const handler = sinon.stub();
  const handler2 = sinon.stub();
  const handler3 = sinon.stub();
  const handler4 = sinon.stub();
  await notification.expose.subscribe('test', handler, true);
  await notification.expose.subscribe('test', handler2, true);
  await notification.expose.subscribe('test2', handler3, true);
  await notification.expose.subscribe('test3', handler4, true);
  notification.bulkSubscriptions.test3 = true;
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  await notification.expose.unsubscribe('test2', handler3, true);
  const errorEvent = new Promise((resolve) => {
    client._stanzaio.on('pubsub:error', err => {
      t.is(err.err.message, 'intentional test error');
      resolve();
    });
  });
  client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
  sinon.assert.calledThrice(notification.client._stanzaio.subscribeToNode);
  sinon.assert.calledOnce(notification.bulkSubscribe);
  await errorEvent;
});

test('notifications bulk subscribe should maintain individual subscriptions when bulk subscribing with replace', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c = () => {}) => c());
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c());
  client.emit('connected');
  client.connected = true;
  sinon.stub(notification, 'bulkSubscribe').returns(Promise.resolve());

  const handler = sinon.stub();
  const handler2 = sinon.stub();
  notification.expose.subscribe('topicA.test', handler, true);
  notification.expose.subscribe('topicB.test2', handler2, true);

  notification.expose.bulkSubscribe(['topicC.test3', 'topicB.test2'], { replace: true, force: false });
  t.is(notification.subscriptions['topicA.test'][0], handler);
  sinon.assert.calledWithExactly(notification.bulkSubscribe, [ 'topicC.test3', 'topicB.test2', 'topicA.test' ], sinon.match.typeOf('object'));
});

test('notifications should not resubscribe to something different than bulk subscribe', async t => {
  const client = new Client();
  client.config = {
    wsURL: 'ws://streaming.inindca.com/something-else'
  };
  const notification = new Notifications(client);

  sinon.stub(notification.client._stanzaio, 'subscribeToNode').callsFake((a, b, c = () => {}) => c());
  sinon.stub(notification.client._stanzaio, 'unsubscribeFromNode').callsFake((a, b, c = () => {}) => c());
  client.emit('connected');
  client.connected = true;
  sinon.stub(notification, 'bulkSubscribe').returns(Promise.resolve());

  const handler = sinon.stub();
  const handler2 = sinon.stub();
  notification.expose.subscribe('test', handler, true);
  notification.expose.subscribe('test2', handler2, true);

  notification.expose.bulkSubscribe(['test3'], { replace: true, force: true });
  t.is(notification.subscriptions['test'], undefined);
});

test('notifications | mapCombineTopics should reduce multiple topics to combined topics', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const reducedTopics = notification.mapCombineTopics(exampleTopics);
  t.is(reducedTopics.length, exampleTopics.length / 5);
});

test('notifications | mapCompineTopics should correctly reduce topics', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const topics = [
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.routingStatus',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.conversationsummary',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.outofoffice',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.presence',
    'v2.users.testuser.atopicthatistoolongallonitsownatopicthatistoolongallonitsownatopicthatistoolongallonitsownatopicthatistoolongallonitsownatopicthatistoolongallonitsownatopicthatistoolongallonitsownatopicthatistoolongallonitsown',
    'v2.users.testuser.thisIsAReallyLongTopicForThePurposeOfExceeding200CharsinCombinedTopicNames',
    'v2.users.testuser.InRealityTheseWouldBeALotOfDisparateTopicsThatWhenJoinedExceed200Chars',
    'v2.users.testuser.athirdreallylongtopicathirdreallylongtopicathird'
  ];

  const reducedTopics = notification.mapCombineTopics(topics);
  t.is(reducedTopics.length, 3);
  t.is(reducedTopics[0].id, 'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&routingStatus&conversationsummary&outofoffice&presence');
  t.is(reducedTopics[1].id, 'v2.users.testuser.thisIsAReallyLongTopicForThePurposeOfExceeding200CharsinCombinedTopicNames');
  t.is(reducedTopics[2].id, 'v2.users.testuser?InRealityTheseWouldBeALotOfDisparateTopicsThatWhenJoinedExceed200Chars&athirdreallylongtopicathirdreallylongtopicathird');
});

test('notifications | mapCompineTopics should not combine already combined topics', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const topics = [
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.routingStatus',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.conversationsummary',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.outofoffice',
    'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.presence',
    'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary&outofoffice',
    'v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7?geolocation&presence&conversations'
  ];

  const reducedTopics = notification.mapCombineTopics(topics);
  t.is(reducedTopics.length, 3);
  t.is(reducedTopics[0].id, 'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&routingStatus&conversationsummary&outofoffice&presence');
  t.is(reducedTopics[1].id, 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary&outofoffice');
  t.is(reducedTopics[2].id, 'v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7?geolocation&presence&conversations');
});

test('notifications | createSubscription should correctly register handlers for precombined topics', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const topic = 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary';
  const singleTopic = 'v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7.presence';
  const noPosfixTopic = 'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?';
  const handler = sinon.stub();

  notification.createSubscription(topic, handler);
  t.is(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation'][0], handler);
  t.is(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence'][0], handler);
  t.is(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.routingStatus'][0], handler);
  t.is(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.conversationsummary'][0], handler);

  notification.createSubscription(singleTopic, handler);
  t.is(notification.subscriptions['v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7.presence'][0], handler);

  notification.createSubscription(noPosfixTopic, handler);
  t.is(notification.subscriptions['v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99'], undefined);
});

test('notifications | truncateTopicList should return a topic list of the correct length', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const topicList = [];
  for (let i = 0; i < 1030; i++) {
    topicList.push(`v2.users.${i}.presence`);
  }

  let truncatedTopicList = notification.truncateTopicList(topicList);
  t.is(truncatedTopicList.length, 1000);

  const truncatedTopicListLogAll = topicList.slice(0, 1010);
  truncatedTopicList = notification.truncateTopicList(truncatedTopicListLogAll);
  t.is(truncatedTopicList.length, 1000);

  const shortTopicList = topicList.slice(0, 20);
  truncatedTopicList = notification.truncateTopicList(shortTopicList);
  t.is(truncatedTopicList.length, 20);
});

test('notifications | mapCombineTopics should return a topic list of the correct length', t => {
  const client = new Client({
    apiHost: 'inindca.com'
  });
  const notification = new Notifications(client);

  const topicList = [];
  for (let i = 0; i < 1030; i++) {
    topicList.push(`v2.users.${i}.presence`, `v2.users.${i}.geolocation`);
  }

  let truncatedTopicList = notification.mapCombineTopics(topicList);
  t.is(truncatedTopicList.length, 1000);

  const shortTopicList = topicList.slice(0, 20);
  truncatedTopicList = notification.mapCombineTopics(shortTopicList);
  t.is(truncatedTopicList.length, 10);
});
