import { PubsubEvent, PubsubSubscription, PubsubSubscriptionWithOptions } from 'stanza/protocol';
const debounce = require('debounce-promise');

import { Client } from './client';
import { RequestApiOptions } from './types/interfaces';
import { splitIntoIndividualTopics } from './utils';

const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';
const MAX_SUBSCRIBABLE_TOPICS = 1000;
const DROPPED_TOPICS_DISPLAY_COUNT = 20;
const DEFAULT_PRIORITY = 0;

function mergeAndDedup (arr1, arr2) {
  return [...arr1, ...arr2].filter((t, i, arr) => arr.indexOf(t) === i);
}

export class Notifications {
  client: Client;
  subscriptions: any;
  bulkSubscriptions: any;
  topicPriorities: any;
  debouncedResubscribe: any;

  constructor (client) {
    this.subscriptions = {};
    this.bulkSubscriptions = {};
    this.topicPriorities = {};

    this.client = client;

    client.on('pubsub:event', this.pubsubEvent.bind(this));
    client.on('connected', this.subscriptionsKeepAlive.bind(this));
    this.debouncedResubscribe = debounce(this.resubscribe.bind(this), 100);
  }

  get pubsubHost () {
    try {
      const host = this.client.config.apiHost.replace(/http(s?):\/\//, '');
      return `notifications.${host}`;
    } catch (e) {
      return PUBSUB_HOST_DEFAULT;
    }
  }

  topicHandlers (topic: string): Array<(obj?: any) => void> {
    if (!this.subscriptions[topic]) {
      this.subscriptions[topic] = [];
    }
    return this.subscriptions[topic];
  }

  pubsubEvent ({ pubsub }: { pubsub: PubsubEvent }) {
    let topic = pubsub.items!.node;
    if (topic.includes('no_longer_subscribed')) {
      topic = 'no_longer_subscribed';
    }

    const payload = (pubsub.items!.published![0].content as any).json;
    const handlers = this.topicHandlers(topic);

    this.client._stanzaio.emit('notify' as any, { topic: topic, data: payload });
    this.client._stanzaio.emit(`notify:${topic}` as any, payload);
    handlers.forEach((handler) => {
      handler(payload);
    });
  }

  async xmppSubscribe (topic: string): Promise<PubsubSubscriptionWithOptions | void> {
    if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
      return Promise.resolve();
    }
    const subscribe = () => this.client._stanzaio.subscribeToNode(this.pubsubHost, topic);
    if (this.client.connected) {
      return subscribe();
    } else {
      return new Promise((resolve, reject) => {
        this.client.once('connected', () => {
          return subscribe().then(resolve, reject);
        });
      });
    }
  }

  xmppUnsubscribe (topic: string): Promise<PubsubSubscription | void> {
    if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
      return Promise.resolve();
    }
    const unsubscribe = () => this.client._stanzaio.unsubscribeFromNode(this.pubsubHost, topic);
    if (this.client.connected) {
      return unsubscribe();
    } else {
      return new Promise((resolve, reject) => {
        this.client.once('connected', () => {
          return unsubscribe().then(resolve, reject);
        });
      });
    }
  }

  mapCombineTopics (topics: string[]): Array<{ id: string }> {
    const prefixes = {};
    const precombinedTopics: Array<{ id: string }> = [];
    const uncombinedTopics: string[] = [];

    topics.forEach(t => {
      if (t.includes('?')) {
        precombinedTopics.push({ id: t });
      } else {
        uncombinedTopics.push(t);
      }
    });

    uncombinedTopics.map(t => {
      const split = t.split('.');
      const postfix = split.splice(split.length - 1);
      const prefix = split.join('.');
      return { prefix, postfix };
    }).forEach(t => {
      if (prefixes[t.prefix]) {
        prefixes[t.prefix].push(t.postfix);
      } else {
        prefixes[t.prefix] = [t.postfix];
      }
    });

    let combinedTopics: Array<{ id: string }> = [];

    // Max length of 200 in topic names
    // so recursively break them up if the combined length exceeds 200
    const combineTopics = (prefix, postFixes) => {
      const delimiter = postFixes.length === 1 ? '.' : '?';
      const id = `${prefix}${delimiter}${postFixes.join('&')}`;
      if (id.length < 200) {
        combinedTopics.push({ id });
      } else if (postFixes.length === 1) {
        this.client.logger.error('Refusing to attempt topic with length > 200', id);
      } else {
        combineTopics(prefix, postFixes.slice(0, postFixes.length / 2));
        combineTopics(prefix, postFixes.slice(postFixes.length / 2));
      }
    };
    Object.keys(prefixes).forEach(prefix => {
      const postFixes = prefixes[prefix];
      combineTopics(prefix, postFixes);
    });

    const allTopics = combinedTopics.concat(precombinedTopics);
    return this.truncateTopicList(this.prioritizeTopicList(allTopics));
  }

  prioritizeTopicList (topics: Array<{ id: string }>): Array<{ id: string }> {
    topics.sort((topicA, topicB) => {
      return (this.getTopicPriority(topicB.id) - this.getTopicPriority(topicA.id));
    });

    return topics;
  }

  getTopicPriority (topic: string, returnDefault = true): number {
    const { prefix, postfixes } = this.getTopicParts(topic);
    const oldPriorities = this.topicPriorities[prefix];
    const matches = oldPriorities && Object.keys(oldPriorities).filter(p => postfixes.includes(p)).map(p => oldPriorities[p]);
    const priority = matches && matches.length && matches.reduce((max, current) => current > max ? current : max);
    return returnDefault ? priority || DEFAULT_PRIORITY : priority;
  }

  truncateTopicList (topics: Array<{ id: string }>): Array<{ id: string }> {
    const keptTopics = topics.slice(0, MAX_SUBSCRIBABLE_TOPICS);
    if (topics.length > MAX_SUBSCRIBABLE_TOPICS) {
      let droppedTopics = topics.slice(MAX_SUBSCRIBABLE_TOPICS);
      if (droppedTopics.length > DROPPED_TOPICS_DISPLAY_COUNT) {
        const length = droppedTopics.length - DROPPED_TOPICS_DISPLAY_COUNT;
        droppedTopics = droppedTopics.slice(DROPPED_TOPICS_DISPLAY_COUNT);
        droppedTopics.push(`...and ${length} more` as any);
      }
      this.client.logger.warn('Too many topics to subscribe to; truncating extra topics', { droppedTopics });
    }
    return keptTopics;
  }

  makeBulkSubscribeRequest (topics: string[], options): Promise<any> {
    const requestOptions: RequestApiOptions = {
      method: options.replace ? 'put' : 'post',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      data: JSON.stringify(this.mapCombineTopics(topics)),
      logger: this.client.logger
    };
    const channelId = this.client.config.channelId;
    return this.client.http.requestApi(`notifications/channels/${channelId}/subscriptions`, requestOptions);
  }

  createSubscription (topic: string, handler: (obj?: any) => void): void {
    const topics = splitIntoIndividualTopics(topic);

    topics.forEach(t => {
      let handlers = this.topicHandlers(t);
      if (!handlers.includes(handler)) {
        handlers.push(handler);
      }
    });
  }

  removeSubscription (topic: string, handler: (obj?: any) => void): void {
    const topics = splitIntoIndividualTopics(topic);

    topics.forEach(t => {
      let handlers = this.topicHandlers(t);
      let handlerIndex = handlers.indexOf(handler);
      if (handlerIndex > -1) {
        handlers.splice(handlerIndex, 1);
      }
      if (!handlers.length) {
        this.subscriptions[t] = [];
        delete this.bulkSubscriptions[t];
      }
    });
  }

  removeTopicPriority (topic: string): void {
    if (this.getTopicPriority(topic, false)) {
      const { prefix, postfixes } = this.getTopicParts(topic);
      postfixes.forEach(postfix => {
        delete this.topicPriorities[prefix][postfix];
      });
      if (!Object.keys(this.topicPriorities[prefix]).length) {
        delete this.topicPriorities[prefix];
      }
    }
  }

  getActiveIndividualTopics (): string[] {
    const activeTopics: string[] = [];
    const topics = Object.keys(this.subscriptions);
    topics.forEach(topic => {
      if (topic === 'streaming-subscriptions-expiring') {
        return; // this doesn't need subscribed
      }
      const handlers = this.topicHandlers(topic);
      if (handlers.length > 0) {
        activeTopics.push(topic);
      }
    });
    return activeTopics;
  }

  resubscribe (): Promise<any> {
    let topicsToResubscribe = mergeAndDedup(Object.keys(this.bulkSubscriptions), this.getActiveIndividualTopics());
    if (topicsToResubscribe.length === 0) {
      return Promise.resolve();
    }
    return this.bulkSubscribe(topicsToResubscribe, { replace: true });
  }

  subscriptionsKeepAlive (): void {
    const topic = 'streaming-subscriptions-expiring';
    if (this.topicHandlers(topic).length === 0) {
      this.createSubscription(topic, () => {
        this.client.logger.info(`${topic} - Triggering resubscribe.`);
        this.resubscribe().catch((err) => {
          const msg = 'Error resubscribing to topics';
          this.client.logger.error(msg, err);
          this.client._stanzaio.emit('pubsub:error' as any, { msg, err });
        });
      });
    }
  }

  getTopicParts (topic: string): { prefix: string, postfixes: string[] } {
    const isCombined = topic.includes('?');
    const separator = isCombined ? '?' : '.';
    const split = topic.split(separator);
    const postfix = isCombined ? split[1] : split.splice(split.length - 1);
    const prefix = isCombined ? split[0] : split.join('.');
    let postfixes: string[] = [];
    if (isCombined) {
      postfixes = (postfix as string).split('&');
    } else {
      postfixes = postfix as string[];
    }
    return { prefix, postfixes };
  }

  setTopicPriorities (priorities = {}): void {
    Object.keys(priorities).forEach(priority => {
      const topicParts = this.getTopicParts(priority);
      const oldPriorities = this.topicPriorities[topicParts.prefix];
      const newPriority = priorities[priority];
      if (oldPriorities) {
        topicParts.postfixes.forEach(postfix => {
          const oldPriority = oldPriorities[postfix];
          if ((oldPriority && oldPriority < newPriority) || !oldPriority) {
            oldPriorities[postfix] = newPriority;
          }
        });
      } else {
        const newTopics = topicParts.postfixes.reduce((newTopics, p) => {
          newTopics[p] = newPriority;
          return newTopics;
        }, {});
        this.topicPriorities[topicParts.prefix] = newTopics;
      }
    });
  }

  subscribe (topic: string, handler?: (..._: any[]) => void, immediate?: boolean, priority?: number): Promise<any> {
    if (priority) {
      this.setTopicPriorities({ [topic]: priority });
    }

    let promise;
    if (!immediate) {
      // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
      promise = this.debouncedResubscribe();
    } else {
      promise = this.xmppSubscribe(topic);
    }
    if (handler) {
      this.createSubscription(topic, handler);
    } else {
      this.bulkSubscriptions[topic] = true;
    }
    return promise;
  }

  unsubscribe (topic: string, handler?: (..._: any[]) => void, immediate?: boolean): Promise<any> {
    if (handler) {
      this.removeSubscription(topic, handler);
    } else {
      delete this.bulkSubscriptions[topic];
      delete this.subscriptions[topic];
    }

    this.removeTopicPriority(topic);

    if (!immediate) {
      // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
      return this.debouncedResubscribe();
    }
    return this.xmppUnsubscribe(topic);
  }

  async bulkSubscribe (
    topics: string[],
    options: BulkSubscribeOpts = { replace: false, force: false },
    priorities: { [topicName: string]: number } = {}
  ): Promise<any> {
    this.setTopicPriorities(priorities);

    let toSubscribe = mergeAndDedup(topics, []);

    if (options.replace && !options.force) {
      // if this is a bulk subscription, but not a forcible one, keep all individual subscriptions
      toSubscribe = mergeAndDedup(toSubscribe, this.getActiveIndividualTopics());
    } else if (options.force) {
      // if it's a forcible bulk subscribe, wipe out individual subscriptions
      this.subscriptions = {};
    }
    await this.makeBulkSubscribeRequest(toSubscribe, options);
    if (options.replace) {
      this.bulkSubscriptions = {};
    }
    topics.forEach(topic => {
      this.bulkSubscriptions[topic] = true;
    });
  }

  get expose (): NotificationsAPI {
    return {
      subscribe: this.subscribe.bind(this),
      unsubscribe: this.unsubscribe.bind(this),
      bulkSubscribe: this.bulkSubscribe.bind(this)
    };
  }
}

export interface NotificationsAPI {
  subscribe (topic: string, handler?: (..._: any[]) => void, immediate?: boolean, priority?: number): Promise<any>;
  unsubscribe (topic: string, handler?: (..._: any[]) => void, immediate?: boolean): Promise<any>;
  bulkSubscribe (
    topics: string[],
    options?: BulkSubscribeOpts,
    priorities?: { [topicName: string]: number }
  ): Promise<any>;
}

export interface BulkSubscribeOpts {
  replace?: boolean;
  force?: boolean;
}
