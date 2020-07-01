'use strict';

import WildEmitter from 'wildemitter';
import nock from 'nock';

import Notifications from '../../src/notifications';

const exampleTopics = require('../helpers/example-topics.json');

class Client extends WildEmitter {
  constructor (config) {
    super();
    this.config = config;

    this.logger = {
      warn () { },
      info () { },
      error () { }
    };

    this._stanzaio = new WildEmitter();
    this._stanzaio.subscribeToNode = () => { };
    this._stanzaio.unsubscribeFromNode = () => { };
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

describe('Notifications', () => {
  test('pubsubHost', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    expect(notification.pubsubHost).toBe('notifications.inindca.com');
    client.config.apiHost = 'https://localhost:3000';
    expect(notification.pubsubHost).toBe('notifications.localhost:3000');
    client.config.apiHost = 'inintca.com';
    expect(notification.pubsubHost).toBe('notifications.inintca.com');
    client.config.apiHost = 'mypurecloud.com';
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.com');
    client.config.apiHost = 'mypurecloud.com.au';
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.com.au');
    client.config.apiHost = 'mypurecloud.jp';
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.jp');
    client.config.apiHost = 'mypurecloud.de';
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.de');
    client.config.apiHost = 'mypurecloud.ie';
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.ie');

    client.config.apiHost = 'someone.elses.website';
    expect(notification.pubsubHost).toBe('notifications.someone.elses.website');

    client.config = null;
    expect(notification.pubsubHost).toBe('notifications.mypurecloud.com');
  });

  test('subscribe and unsubscribe do their jobs', async () => {
    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);

    // subscribing
    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c) => c());
    const handler = jest.fn();
    const firstSubscription = notification.expose.subscribe('topic.test', handler, true);

    // not subscribed yet, client is not connected
    expect(notification.client._stanzaio.subscribeToNode).not.toHaveBeenCalled();

    client.emit('connected');
    client.connected = true;
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(1);
    await firstSubscription;
    expect(notification.subscriptions['topic.test'].length).toBe(1);
    expect(notification.subscriptions['topic.test'][0]).toBe(handler);

    // subscribe again to the same topic with the same handler
    await notification.expose.subscribe('topic.test', handler, true);
    expect(notification.subscriptions['topic.test'].length).toBe(1, 'handler not added again');

    const handler2 = jest.fn();
    await notification.expose.subscribe('topic.test', handler2, true);
    // don't resubscribe on the server
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(1);
    expect(notification.subscriptions['topic.test'][1]).toBe(handler2);

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
    jest.spyOn(notification.client._stanzaio, 'emit').mockReturnValue(null);
    client.emit('pubsub:event', pubsubMessage);
    expect(notification.client._stanzaio.emit).toHaveBeenCalledTimes(2);
    expect(notification.client._stanzaio.emit).toHaveBeenCalledWith('notify', { topic: 'topic.test', data: { the: 'payload' } });
    expect(notification.client._stanzaio.emit).toHaveBeenCalledWith('notify:topic.test', { the: 'payload' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ the: 'payload' });
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith({ the: 'payload' });

    const apiRequest = nock('https://api.example.com')
      .post('/api/v2/notifications/channels/notification-test-channel/subscriptions', () => true)
      .reply(200, { id: 'streaming-someid' });
    await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two', 'topic.three']);
    // didn't subscribe via xmpp any more (was once previously)
    console.warn('subscribeToNode 4');
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(1);
    apiRequest.done();
    expect(notification.bulkSubscriptions['topic.three']).toBe(true);

    const apiRequest2 = nock('https://api.example.com')
      .put('/api/v2/notifications/channels/notification-test-channel/subscriptions', () => true)
      .reply(200, { id: 'streaming-someid' });
    await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two'], { replace: true });
    // didn't subscribe via xmpp any more (was once previously)
    console.warn('subscribeToNode 5');
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(1);
    apiRequest2.done();
    expect(notification.bulkSubscriptions['topic.three']).toBe(undefined);

    // unsubscribing
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c) => c());
    await notification.expose.unsubscribe('topic.test', handler2, true);
    // there are still more subscriptions
    expect(notification.client._stanzaio.unsubscribeFromNode).not.toHaveBeenCalled();

    await notification.expose.unsubscribe('topic.test', () => { }, true);
    // unsubscribing with an unused handler won't trigger any unsubscribe
    expect(notification.client._stanzaio.unsubscribeFromNode).not.toHaveBeenCalled();

    await notification.expose.unsubscribe('topic.test', handler, true);
    // unsubscribing when there's record of a bulk subscription won't trigger any unsubscribe
    expect(notification.client._stanzaio.unsubscribeFromNode).not.toHaveBeenCalled();

    client.connected = false;
    // unsubscribing without a handler removes the bulkScubscription handler
    const unsubscribe = notification.expose.unsubscribe('topic.test', null, true);
    // well, not until we reconnect
    expect(notification.client._stanzaio.unsubscribeFromNode).not.toHaveBeenCalled();

    client.emit('connected');
    await unsubscribe;
    expect(notification.client._stanzaio.unsubscribeFromNode).toHaveBeenCalledTimes(1);
    expect(notification.client._stanzaio.unsubscribeFromNode).toHaveBeenCalledWith('notifications.example.com', 'topic.test', expect.any(Function));
  });

  test('subscribe and unsubscribe work when debounced', async () => {
    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);

    // subscribing
    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c) => c());
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);
    const handler = jest.fn();
    const firstSubscription = notification.expose.subscribe('topic.test', handler);

    await timeout(150);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(1);
    await firstSubscription;
    expect(notification.subscriptions['topic.test'].length).toBe(1);
    expect(notification.subscriptions['topic.test'][0]).toBe(handler);

    let promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(notification.expose.subscribe(`topic.test${i}`, handler));
    }

    await Promise.all(promises);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(2);

    promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(notification.expose.unsubscribe(`topic.test${i}`, handler));
    }

    await Promise.all(promises);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(3);
  });

  test('subscribe and unsubscribe reject on failures', async () => {
    const client = new Client();
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);

    client.connected = true;
    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c) => c(new Error('test')));
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c = () => { }) => c(new Error('test')));
    const handler = jest.fn();
    expect.assertions(2);
    await notification.expose.subscribe('test', handler, true).catch(() => expect(true).toBe(true));
    await notification.expose.unsubscribe('test', handler, true).catch(() => expect(true).toBe(true));
  });

  test('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event', async () => {
    const client = new Client();
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);

    // subscribing
    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c = () => { }) => c());
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c = () => { }) => c());
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.bulkSubscribe).not.toHaveBeenCalled();
    expect(notification.client._stanzaio.subscribeToNode).not.toHaveBeenCalled();
    const handler = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();
    await notification.expose.subscribe('test', handler, true);
    await notification.expose.subscribe('test', handler2, true);
    await notification.expose.subscribe('test2', handler3, true);
    await notification.expose.subscribe('test3', null, true);
    notification.bulkSubscriptions.test3 = true;
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(3);
    await notification.expose.unsubscribe('test2', handler3, true);
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(3);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(1);
  });

  test('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event and emit an error on failure', async () => {
    const client = new Client();
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);

    // subscribing
    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c = () => { }) => c());
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c = () => { }) => c());
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'bulkSubscribe').mockRejectedValue(new Error('intentional test error'));
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.bulkSubscribe).not.toHaveBeenCalled();
    expect(notification.client._stanzaio.subscribeToNode).not.toHaveBeenCalled();
    const handler = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();
    const handler4 = jest.fn();
    await notification.expose.subscribe('test', handler, true);
    await notification.expose.subscribe('test', handler2, true);
    await notification.expose.subscribe('test2', handler3, true);
    await notification.expose.subscribe('test3', handler4, true);
    notification.bulkSubscriptions.test3 = true;
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(3);
    await notification.expose.unsubscribe('test2', handler3, true);
    const errorEvent = new Promise((resolve) => {
      client._stanzaio.on('pubsub:error', err => {
        expect(err.err.message).toBe('intentional test error');
        resolve();
      });
    });
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.client._stanzaio.subscribeToNode).toHaveBeenCalledTimes(3);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(1);
    await errorEvent;
  });

  test('notifications bulk subscribe should maintain individual subscriptions when bulk subscribing with replace', async () => {
    const client = new Client();
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);

    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c = () => { }) => c());
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c = () => { }) => c());
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);

    const handler = jest.fn();
    const handler2 = jest.fn();
    notification.expose.subscribe('topicA.test', handler, true);
    notification.expose.subscribe('topicB.test2', handler2, true);

    notification.expose.bulkSubscribe(['topicC.test3', 'topicB.test2'], { replace: true, force: false });
    expect(notification.subscriptions['topicA.test'][0]).toBe(handler);
    expect(notification.bulkSubscribe).toHaveBeenCalledWith(['topicC.test3', 'topicB.test2', 'topicA.test'], expect.any(Object));
  });

  test('notifications should not resubscribe to something different than bulk subscribe', async () => {
    const client = new Client();
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);

    jest.spyOn(notification.client._stanzaio, 'subscribeToNode').mockImplementation((a, b, c = () => { }) => c());
    jest.spyOn(notification.client._stanzaio, 'unsubscribeFromNode').mockImplementation((a, b, c = () => { }) => c());
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);

    const handler = jest.fn();
    const handler2 = jest.fn();
    notification.expose.subscribe('test', handler, true);
    notification.expose.subscribe('test2', handler2, true);

    notification.expose.bulkSubscribe(['test3'], { replace: true, force: true });
    expect(notification.subscriptions['test']).toBe(undefined);
  });

  test('notifications | mapCombineTopics should reduce multiple topics to combined topics', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    const reducedTopics = notification.mapCombineTopics(exampleTopics);
    expect(reducedTopics.length).toBe(exampleTopics.length / 5);
  });

  test('notifications | mapCompineTopics should correctly reduce topics', () => {
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
    expect(reducedTopics.length).toBe(3);
    expect(reducedTopics[0].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&routingStatus&conversationsummary&outofoffice&presence');
    expect(reducedTopics[1].id).toBe('v2.users.testuser.thisIsAReallyLongTopicForThePurposeOfExceeding200CharsinCombinedTopicNames');
    expect(reducedTopics[2].id).toBe('v2.users.testuser?InRealityTheseWouldBeALotOfDisparateTopicsThatWhenJoinedExceed200Chars&athirdreallylongtopicathirdreallylongtopicathird');
  });

  test('notifications | mapCompineTopics should not combine already combined topics', () => {
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
    expect(reducedTopics.length).toBe(3);
    expect(reducedTopics[0].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&routingStatus&conversationsummary&outofoffice&presence');
    expect(reducedTopics[1].id).toBe('v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary&outofoffice');
    expect(reducedTopics[2].id).toBe('v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7?geolocation&presence&conversations');
  });

  test('notifications | createSubscription should correctly register handlers for precombined topics', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    const topic = 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary';
    const singleTopic = 'v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7.presence';
    const noPosfixTopic = 'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?';
    const handler = jest.fn();

    notification.createSubscription(topic, handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation'][0]).toBe(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence'][0]).toBe(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.routingStatus'][0]).toBe(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.conversationsummary'][0]).toBe(handler);

    notification.createSubscription(singleTopic, handler);
    expect(notification.subscriptions['v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7.presence'][0]).toBe(handler);

    notification.createSubscription(noPosfixTopic, handler);
    expect(notification.subscriptions['v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99']).toBe(undefined);
  });

  test('notifications | truncateTopicList should return a topic list of the correct length', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    const topicList = [];
    for (let i = 0; i < 1030; i++) {
      topicList.push(`v2.users.${i}.presence`);
    }

    let truncatedTopicList = notification.truncateTopicList(topicList);
    expect(truncatedTopicList.length).toBe(1000);

    const truncatedTopicListLogAll = topicList.slice(0, 1010);
    truncatedTopicList = notification.truncateTopicList(truncatedTopicListLogAll);
    expect(truncatedTopicList.length).toBe(1000);

    const shortTopicList = topicList.slice(0, 20);
    truncatedTopicList = notification.truncateTopicList(shortTopicList);
    expect(truncatedTopicList.length).toBe(20);
  });

  test('notifications | mapCombineTopics should return a topic list of the correct length', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    const topicList = [];
    for (let i = 0; i < 1030; i++) {
      topicList.push(`v2.users.${i}.presence`, `v2.users.${i}.geolocation`);
    }

    let truncatedTopicList = notification.mapCombineTopics(topicList);
    expect(truncatedTopicList.length).toBe(1000);

    const shortTopicList = topicList.slice(0, 20);
    truncatedTopicList = notification.mapCombineTopics(shortTopicList);
    expect(truncatedTopicList.length).toBe(10);
  });

  test('notifications | prioritizeTopicList orders topics correctly', () => {
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
      'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&presence&routingStatus&conversationsummary&outofoffice',
      'v2.users.660b6ba5-5e69-4f55-a487-d44cee0f7ce7?geolocation&presence&conversations'
    ];

    const topicList = topics.map(t => ({ id: t }));

    let prioritizedTopicList = notification.prioritizeTopicList(topicList);
    expect(prioritizedTopicList[0].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation');
    expect(prioritizedTopicList[1].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.routingStatus');

    notification.setTopicPriorities({
      'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.outofoffice': 2,
      'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation': -10
    });

    prioritizedTopicList = notification.prioritizeTopicList(topicList);
    expect(prioritizedTopicList[0].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.outofoffice');
    expect(prioritizedTopicList[1].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&presence&routingStatus&conversationsummary&outofoffice');
    expect(prioritizedTopicList[2].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.routingStatus');
    expect(prioritizedTopicList[6].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation');

    notification.setTopicPriorities({
      'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&routingStatus&conversationsummary&outofoffice': 5,
      'v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.presence': 2
    });

    prioritizedTopicList = notification.prioritizeTopicList(topicList);
    expect(prioritizedTopicList[0].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.outofoffice');
    expect(prioritizedTopicList[1].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99?geolocation&presence&routingStatus&conversationsummary&outofoffice');
    expect(prioritizedTopicList[3].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.conversationsummary');
    expect(prioritizedTopicList[4].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.geolocation');
    expect(prioritizedTopicList[5].id).toBe('v2.users.8b67e4d1-9758-4285-8c45-b49fedff3f99.presence');
  });

  test('notifications | getTopicPriorities does its job', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    notification.setTopicPriorities({ 'test.topic': 2, 'test.topic2': 1, 'test.topic3': 5, 'test.topic4': -1 });
    expect(notification.getTopicPriority('test.topic')).toBe(2);
    expect(notification.getTopicPriority('test.defaulttopicpriority')).toBe(0);
    expect(notification.getTopicPriority('test?topic&topic3&topic4')).toBe(5);

    notification.setTopicPriorities({ 'test.negative1': -1, 'test.negative2': -2, 'test.negative3': -3 });
    expect(notification.getTopicPriority('test.negative1')).toBe(-1);
    expect(notification.getTopicPriority('test?negative1&negative2')).toBe(-1);
    expect(notification.getTopicPriority('test?negative1&topic3')).toBe(5);
  });

  test('notifications | setTopicPriorities adds topicPriorities to list', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    notification.setTopicPriorities({ 'test.topic': 2 });
    expect(notification.topicPriorities.test.topic).toBe(2);

    notification.setTopicPriorities({ 'test.topic': 3 });
    expect(notification.topicPriorities.test.topic).toBe(3);

    notification.setTopicPriorities({ 'test.topic': 1 });
    expect(notification.topicPriorities.test.topic).toBe(3);

    notification.setTopicPriorities({ 'test?topic&topic2': 5 });
    expect(notification.topicPriorities.test.topic).toBe(5);
    expect(notification.topicPriorities.test.topic2).toBe(5);

    notification.setTopicPriorities({ 'test?topic&topic2': -1 });
    expect(notification.topicPriorities.test.topic).toBe(5);
    expect(notification.topicPriorities.test.topic2).toBe(5);
  });

  test('notifications | removeTopicPriority removes topic priorities from list', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    notification.setTopicPriorities();
    notification.setTopicPriorities({ 'test.topic': 2, 'test.topic2': 5 });
    expect(notification.topicPriorities.test.topic).toBe(2);
    notification.removeTopicPriority('test.topic');
    expect(notification.topicPriorities.test.topic).toBe(undefined);
    notification.removeTopicPriority('test.topic2');
    expect(notification.topicPriorities.test).toBe(undefined);
  });

  test('notifications | subscribe registers topic priorities if supplied', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);

    const handler = jest.fn();
    notification.expose.subscribe('topic.test', handler, true, 1);
    expect(notification.topicPriorities.topic.test).toBe(1);
    notification.expose.subscribe('topic.test2', handler, true);
    expect(notification.topicPriorities.topic.test2).toBe(undefined);
  });

  test('notifications | bulkSubscribe registers topic priorities if supplied', async () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);

    const priorities = {
      'topic.test.one': 1,
      'topic.test.two': 2,
      'topic.test.three': 3
    };
    await notification.expose.bulkSubscribe(['topic.test.one', 'topic.test.two', 'topic.test.three'], { replace: false, force: false }, priorities);
    expect(notification.topicPriorities['topic.test'].one).toBe(1);
    expect(notification.topicPriorities['topic.test'].two).toBe(2);
    expect(notification.topicPriorities['topic.test'].three).toBe(3);
  });
});
