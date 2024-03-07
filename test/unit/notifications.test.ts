'use strict';

import WildEmitter from 'wildemitter';
import nock from 'nock';

import { Notifications } from '../../src/notifications';
import { Agent } from 'stanza';
import { HttpClient } from '../../src/http-client';
import { EventEmitter } from 'stream';
import { NamedAgent } from '../../src/types/named-agent';
import { v4 } from 'uuid';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';

const exampleTopics = require('../helpers/example-topics.json');

const channelId = 'notification-test-channel';

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      id: v4(),
      subscribeToNode: jest.fn(),
      unsubscribeFromNode: jest.fn(),
      channelId
    }
  ) as unknown as NamedAgent;
}

class Client extends WildEmitter {
  connected = false;
  emit!: (event: string, ...data: any) => void;
  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  activeStanzaInstance: WildEmitter & Agent = new WildEmitter() as any;
  http: HttpClient;

  constructor (public config: any) {
    super();

    this.http = new HttpClient();
    this.activeStanzaInstance!.subscribeToNode = jest.fn();
    this.activeStanzaInstance!.unsubscribeFromNode = jest.fn();
  }
}

const SUBSCRIPTIONS_EXPIRING = {
  pubsub: {
    items: {
      node: 'streaming-subscriptions-expiring',
      published: [
        {
          content: { json: { expiring: 60 } }
        }
      ]
    }
  }
};

function timeout (t) {
  return new Promise(resolve => setTimeout(resolve, t));
}

describe('Notifications', () => {
  describe('handleStanzaInstanceChange', () => {
    let client: Client;
    let notification: Notifications;
    let stanzaInstance: NamedAgent;

    let resubSpy: jest.Mock;

    beforeEach(() => {
      client = new Client({
        apiHost: 'example.com',
        channelId: 'notification-test-channel'
      });
      notification = new Notifications(client);
      stanzaInstance = notification.stanzaInstance = getFakeStanzaClient();
      resubSpy = notification.debouncedResubscribe = jest.fn();
    });

    it('should not resub if same channelId', () => {
      notification.handleStanzaInstanceChange(stanzaInstance);
      expect(resubSpy).not.toHaveBeenCalled();
    });

    it('should resub if new channel', () => {
      const newInstance = getFakeStanzaClient();
      newInstance.channelId = 'newChannel';

      notification.handleStanzaInstanceChange(newInstance);
      expect(resubSpy).toHaveBeenCalled();
    });

    it('should not resub if new channel but no existing stanzaInstance', () => {
      const newInstance = getFakeStanzaClient();
      newInstance.channelId = 'newChannel';

      notification.stanzaInstance = undefined;
      notification.handleStanzaInstanceChange(newInstance);
      expect(resubSpy).not.toHaveBeenCalled();
    });
  });

  test('pubsubHost', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

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

  it('subscribe and unsubscribe do their jobs', async () => {
    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    // subscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    const handler = jest.fn();
    const firstSubscription = notification.expose.subscribe('topic.test', handler, true);

    // not subscribed yet, client is not connected
    expect(notification.stanzaInstance!.subscribeToNode).not.toHaveBeenCalled();

    client.emit('connected');
    client.connected = true;
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(1);
    await firstSubscription;
    expect(notification.subscriptions['topic.test'].length).toBe(1);
    expect(notification.subscriptions['topic.test'][0]).toBe(handler);

    // subscribe again to the same topic with the same handler
    await notification.expose.subscribe('topic.test', handler, true);
    expect(notification.subscriptions['topic.test'].length).toBe(1);

    const handler2 = jest.fn();
    await notification.expose.subscribe('topic.test', handler2, true);
    // don't resubscribe on the server
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(1);
    expect(notification.subscriptions['topic.test'][1]).toBe(handler2);

    // eventing
    const pubsubMessage = {
      pubsub: {
        items: {
          node: 'topic.test',
          published: [
            {
              content: { json: { the: 'payload' } }
            }
          ]
        }
      }
    };
    jest.spyOn(notification.stanzaInstance!, 'emit').mockReturnValue(undefined);
    const clientEmitSpy = jest.spyOn(client, 'emit');
    client.emit('pubsub:event', pubsubMessage);
    expect(clientEmitSpy).toHaveBeenCalledTimes(3);
    expect(clientEmitSpy).toHaveBeenCalledWith('notify', { topic: 'topic.test', data: { the: 'payload' } });
    expect(clientEmitSpy).toHaveBeenCalledWith('notify:topic.test', { the: 'payload' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ the: 'payload' });
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith({ the: 'payload' });

    const axiosMock = new AxiosMockAdapter(axios);
    const url = `https://api.example.com/api/v2/notifications/channels/${channelId}/subscriptions`;
    axiosMock
      .onPost(url).reply(200, { id: 'streaming-someid' })
      .onPut(url).reply(200, { id: 'streaming-someid' });

    await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two', 'topic.three']);
    // didn't subscribe via xmpp any more (was once previously)
    console.warn('subscribeToNode 4');
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(1);
    expect(notification.bulkSubscriptions['topic.three']).toBe(true);

    await notification.expose.bulkSubscribe(['topic.test', 'topic.one', 'topic.two'], { replace: true });
    // didn't subscribe via xmpp any more (was once previously)
    console.warn('subscribeToNode 5');
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(1);
    expect(notification.bulkSubscriptions['topic.three']).toBe(undefined);

    // unsubscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockResolvedValue({});
    await notification.expose.unsubscribe('topic.test', handler2, true);
    // there are still more subscriptions
    expect(notification.stanzaInstance!.unsubscribeFromNode).not.toHaveBeenCalled();

    await notification.expose.unsubscribe('topic.test', () => { }, true);
    // unsubscribing with an unused handler won't trigger any unsubscribe
    expect(notification.stanzaInstance!.unsubscribeFromNode).not.toHaveBeenCalled();

    await notification.expose.unsubscribe('topic.test', handler, true);
    // unsubscribing when there's record of a bulk subscription won't trigger any unsubscribe
    expect(notification.stanzaInstance!.unsubscribeFromNode).not.toHaveBeenCalled();

    client.connected = false;
    // unsubscribing without a handler removes the bulkScubscription handler
    const unsubscribe = notification.expose.unsubscribe('topic.test', undefined, true);
    // well, not until we reconnect
    expect(notification.stanzaInstance!.unsubscribeFromNode).not.toHaveBeenCalled();

    client.emit('connected');
    await unsubscribe;
    expect(notification.stanzaInstance!.unsubscribeFromNode).toHaveBeenCalledTimes(1);
    expect(notification.stanzaInstance!.unsubscribeFromNode).toHaveBeenCalledWith('notifications.example.com', 'topic.test');
  });

  it('subscribe and unsubscribe work when debounced', async () => {
    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    // subscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);
    const handler = jest.fn();
    const firstSubscription = notification.expose.subscribe('topic.test', handler);

    await timeout(150);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(1);
    await firstSubscription;
    expect(notification.subscriptions['topic.test'].length).toBe(1);
    expect(notification.subscriptions['topic.test'][0]).toBe(handler);

    let promises: Promise<any>[] = [];
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

  test('notifications | unsubscribe should not remove subs when they are shared by a bulk subscribe', async () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    jest.spyOn(notification, 'makeBulkSubscribeRequest').mockResolvedValue(undefined);

    const topic1 = 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation'
    const topic2 = 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence';
    const handler = () => { };

    await notification.subscribe(topic1, handler);
    await notification.subscribe(topic2, handler);

    /* adds individual subs */
    expect(notification.subscriptions).toEqual({
      [topic1]: [handler],
      [topic2]: [handler]
    });

    /* only bulkSub to topic2 */
    await notification.bulkSubscribe([topic2]);
    expect(notification.bulkSubscriptions).toEqual({
      [topic2]: true
    });

    /* unsub from individual topic2 should not remove it from bulkSub list but remove it from individual sub list */
    await notification.unsubscribe(topic2, handler);
    expect(notification.subscriptions).toEqual({
      [topic1]: [handler]
    });
    expect(notification.bulkSubscriptions).toEqual({
      [topic2]: true
    });
  });

  test('unsubscribe should remove all handlers if a handler is not passed in', async () => {
    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    // subscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);
    await Promise.all([
      notification.expose.subscribe('topic.test', jest.fn()),
      notification.expose.subscribe('topic.test', jest.fn()),
      notification.expose.subscribe('topic.test', jest.fn())
    ]);

    expect(notification.subscriptions['topic.test'].length).toBe(3);

    await notification.expose.unsubscribe(`topic.test`);

    // make sure handlers were cleaned up
    expect(notification.subscriptions['topic.test']).toBeUndefined();

    notification.expose.subscribe('topic.test', jest.fn());
    await timeout(150);

    // make sure we didn't ressurrect only handlers
    expect(notification.subscriptions['topic.test'].length).toBe(1);
  });

  test('subscribe and unsubscribe reject on failures', async () => {
    const client = new Client({});
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    client.connected = true;
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockRejectedValue(new Error('test'));
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockRejectedValue(new Error('test'));
    const handler = jest.fn();
    expect.assertions(2);
    await notification.expose.subscribe('test', handler, true).catch(() => expect(true).toBe(true));
    await notification.expose.unsubscribe('test', handler, true).catch(() => expect(true).toBe(true));
  });

  it('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event', async () => {
    jest.useFakeTimers();
    const client = new Client({});
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    // subscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockResolvedValue({});
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'bulkSubscribe').mockResolvedValue(undefined);
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.bulkSubscribe).not.toHaveBeenCalled();
    expect(notification.stanzaInstance!.subscribeToNode).not.toHaveBeenCalled();
    const handler = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();
    await notification.expose.subscribe('test', handler, true);
    await notification.expose.subscribe('test', handler2, true);
    await notification.expose.subscribe('test2', handler3, true);
    await notification.expose.subscribe('test3', undefined, true);
    notification.bulkSubscriptions.test3 = true;
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(3);
    await notification.expose.unsubscribe('test2', handler3, true);
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    jest.advanceTimersByTime(500);
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(3);
    expect(notification.bulkSubscribe).toHaveBeenCalledTimes(1);
  });

  it('notifications should resubscribe (bulk subscribe) to existing topics after streaming-subscriptions-expiring event and emit an error on failure', async () => {
    jest.useFakeTimers();
    const client = new Client({});
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    // subscribing
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockResolvedValue({});
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'makeBulkSubscribeRequest').mockRejectedValue(new Error('intentional test error'));
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    expect(notification.makeBulkSubscribeRequest).not.toHaveBeenCalled();
    expect(notification.stanzaInstance!.subscribeToNode).not.toHaveBeenCalled();
    const handler = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();
    const handler4 = jest.fn();
    await notification.expose.subscribe('test', handler, true);
    await notification.expose.subscribe('test', handler2, true);
    await notification.expose.subscribe('test2', handler3, true);
    await notification.expose.subscribe('test3', handler4, true);
    notification.bulkSubscriptions.test3 = true;
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(3);
    await notification.expose.unsubscribe('test2', handler3, true);
    const errorEvent = new Promise<void>((resolve) => {
      (client as unknown as EventEmitter).on('pubsub:error', err => {
        expect(err.err.message).toBe('intentional test error');
        resolve();
      });
    });
    client.emit('pubsub:event', SUBSCRIPTIONS_EXPIRING);
    jest.advanceTimersByTime(500);
    expect(notification.stanzaInstance!.subscribeToNode).toHaveBeenCalledTimes(3);
    expect(notification.makeBulkSubscribeRequest).toHaveBeenCalledTimes(1);
    await errorEvent;
  });

  it('notifications bulk subscribe should maintain individual subscriptions when bulk subscribing with replace', async () => {
    const client = new Client({});
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockResolvedValue({});
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'makeBulkSubscribeRequest').mockResolvedValue(undefined);

    const handler = jest.fn();
    const handler2 = jest.fn();
    await notification.expose.subscribe('topicA.test', handler, true);
    await notification.expose.subscribe('topicB.test2', handler2, true);

    await notification.expose.bulkSubscribe(['topicC.test3', 'topicB.test2'], { replace: true, force: false });
    expect(notification.subscriptions['topicA.test'][0]).toBe(handler);
    expect(notification.makeBulkSubscribeRequest).toHaveBeenCalledWith(['topicC.test3', 'topicB.test2', 'topicA.test'], expect.any(Object));
  });

  test('notifications should not resubscribe to something different than bulk subscribe', async () => {
    const client = new Client({});
    client.config = {
      wsURL: 'ws://streaming.inindca.com/something-else'
    };
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    (notification.stanzaInstance as jest.Mocked<NamedAgent>).subscribeToNode.mockResolvedValue({});
    (notification.stanzaInstance as jest.Mocked<NamedAgent>).unsubscribeFromNode.mockResolvedValue({});
    client.emit('connected');
    client.connected = true;
    jest.spyOn(notification, 'makeBulkSubscribeRequest').mockResolvedValue(undefined);

    const handler = jest.fn();
    const handler2 = jest.fn();
    await notification.expose.subscribe('test', handler, true);
    await notification.expose.subscribe('test2', handler2, true);

    await notification.expose.bulkSubscribe(['test3'], { replace: true, force: true });
    expect(notification.subscriptions['test']).toBe(undefined);
  });

  test('notifications | mapCombineTopics should reduce multiple topics to combined topics', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const reducedTopics = notification.mapCombineTopics(exampleTopics);
    expect(reducedTopics.length).toBe(exampleTopics.length / 5);
  });

  test('notifications | mapCompineTopics should correctly reduce topics', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


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
    notification.stanzaInstance = getFakeStanzaClient();


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
    notification.stanzaInstance = getFakeStanzaClient();


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

  test('notifications | removeSubscription should correctly remove handlers for precombined topics', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const topic = 'v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7?geolocation&presence&routingStatus&conversationsummary';
    const handler = jest.fn();

    notification.createSubscription(topic, handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation'][0]).toEqual(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence'][0]).toEqual(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.routingStatus'][0]).toEqual(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.conversationsummary'][0]).toEqual(handler);

    notification.removeSubscription(topic, handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation']).toBe(undefined);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence']).toBe(undefined);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.routingStatus']).toBe(undefined);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.conversationsummary']).toBe(undefined);

    // Subscribe to precombined topic, then remove one individually
    notification.createSubscription(topic, handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation'][0]).toEqual(handler);
    notification.removeSubscription('v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation', handler);

    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.geolocation']).toBe(undefined);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.presence'][0]).toEqual(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.routingStatus'][0]).toEqual(handler);
    expect(notification.subscriptions['v2.users.731c4a20-e6c2-443a-b361-39bcb9e087b7.conversationsummary'][0]).toEqual(handler);
  });

  test('notifications | truncateTopicList should return a topic list of the correct length', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const topicList: string[] = [];
    for (let i = 0; i < 1030; i++) {
      topicList.push(`v2.users.${i}.presence`);
    }

    let truncatedTopicList = notification.truncateTopicList(topicList as any);
    expect(truncatedTopicList.length).toBe(1000);

    const truncatedTopicListLogAll = topicList.slice(0, 1010);
    truncatedTopicList = notification.truncateTopicList(truncatedTopicListLogAll as any);
    expect(truncatedTopicList.length).toBe(1000);

    const shortTopicList = topicList.slice(0, 20);
    truncatedTopicList = notification.truncateTopicList(shortTopicList as any);
    expect(truncatedTopicList.length).toBe(20);
  });

  test('notifications | mapCombineTopics should return a topic list of the correct length', () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const topicList: string[] = [];
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
    notification.stanzaInstance = getFakeStanzaClient();


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
    notification.stanzaInstance = getFakeStanzaClient();


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
    notification.stanzaInstance = getFakeStanzaClient();


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
    notification.stanzaInstance = getFakeStanzaClient();


    notification.setTopicPriorities();
    notification.setTopicPriorities({ 'test.topic': 2, 'test.topic2': 5 });
    expect(notification.topicPriorities.test.topic).toBe(2);
    notification.removeTopicPriority('test.topic');
    expect(notification.topicPriorities.test.topic).toBe(undefined);
    notification.removeTopicPriority('test.topic2');
    expect(notification.topicPriorities.test).toBe(undefined);
  });

  test('notifications | subscribe registers topic priorities if supplied', async () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    jest.spyOn(notification, 'xmppSubscribe').mockResolvedValue(undefined);

    const handler = jest.fn();
    await notification.expose.subscribe('topic.test', handler, true, 1);
    expect(notification.topicPriorities.topic.test).toBe(1);
    await notification.expose.subscribe('topic.test2', handler, true);
    expect(notification.topicPriorities.topic.test2).toBe(undefined);
  });

  it('notifications | bulkSubscribe registers topic priorities if supplied', async () => {
    const client = new Client({
      apiHost: 'inindca.com'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();

    jest.spyOn(notification, 'makeBulkSubscribeRequest').mockResolvedValue(undefined);

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

  it('should change the topic to no_longer_subscribed', () => {
    const payload = { channelId: 'streaming-sdklnena98w4' };
    const noLongerSubscribed = {
      pubsub: {
        items: {
          node: `system.v2.no_longer_subscribed.${payload.channelId}`,
          published: [
            {
              content: { json: payload }
            }
          ]
        }
      }
    };

    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const spy = jest.spyOn(client, 'emit');
    (client as any).emit('pubsub:event', noLongerSubscribed);

    expect(spy).toHaveBeenCalledWith('notify', { topic: 'no_longer_subscribed', data: payload });
    expect(spy).toHaveBeenCalledWith('notify:no_longer_subscribed', payload);
  });

  it('should change the topic to duplicate_id', () => {
    const payload = { channelId: 'streaming-sdklnena98w4' };
    const duplicateId = {
      pubsub: {
        items: {
          node: `system.v2.duplicate_id.${payload.channelId}`,
          published: [
            {
              content: { json: payload }
            }
          ]
        }
      }
    };

    const client = new Client({
      apiHost: 'example.com',
      channelId: 'notification-test-channel'
    });
    const notification = new Notifications(client);
    notification.stanzaInstance = getFakeStanzaClient();


    const spy = jest.spyOn(client, 'emit');
    (client as any).emit('pubsub:event', duplicateId);

    expect(spy).toHaveBeenCalledWith('notify', { topic: 'duplicate_id', data: payload });
    expect(spy).toHaveBeenCalledWith('notify:duplicate_id', payload);
  });
});
