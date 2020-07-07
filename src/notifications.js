import { requestApi, splitIntoIndividualTopics } from './utils';
const debounce = require('debounce-promise');

const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';
const MAX_SUBSCRIBABLE_TOPICS = 1000;
const DROPPED_TOPICS_DISPLAY_COUNT = 20;
const DEFAULT_PRIORITY = 0;

function mergeAndDedup (arr1, arr2) {
  return [...arr1, ...arr2].filter((t, i, arr) => arr.indexOf(t) === i);
}

export default class Notification {
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

  topicHandlers (topic) {
    if (!this.subscriptions[topic]) {
      this.subscriptions[topic] = [];
    }
    return this.subscriptions[topic];
  }

  pubsubEvent (msg) {
    const topic = msg.event.updated.node;
    const payload = msg.event.updated.published[0].json;
    const handlers = this.topicHandlers(topic);

    this.client._stanzaio.emit('notify', { topic: topic, data: payload });
    this.client._stanzaio.emit(`notify:${topic}`, payload);
    handlers.forEach((handler) => {
      handler(payload);
    });
  }

  xmppSubscribe (topic, callback) {
    if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
      return callback();
    }
    const subscribe = () => this.client._stanzaio.subscribeToNode(this.pubsubHost, topic, callback);
    if (this.client.connected) {
      subscribe();
    } else {
      this.client.once('connected', () => {
        subscribe();
      });
    }
  }

  xmppUnsubscribe (topic, callback) {
    if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
      return callback();
    }
    const unsubscribe = () => this.client._stanzaio.unsubscribeFromNode(this.pubsubHost, topic, callback);
    if (this.client.connected) {
      unsubscribe();
    } else {
      this.client.once('connected', () => {
        unsubscribe();
      });
    }
  }

  mapCombineTopics (topics) {
    const prefixes = {};
    const precombinedTopics = [];
    const uncombinedTopics = [];

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
        prefixes[t.prefix] = [ t.postfix ];
      }
    });

    let combinedTopics = [];

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

  prioritizeTopicList (topics) {
    topics.sort((topicA, topicB) => {
      return (this.getTopicPriority(topicB.id) - this.getTopicPriority(topicA.id));
    });

    return topics;
  }

  getTopicPriority (topic, returnDefault = true) {
    const { prefix, postfixes } = this.getTopicParts(topic);
    const oldPriorities = this.topicPriorities[prefix];
    const matches = oldPriorities && Object.keys(oldPriorities).filter(p => postfixes.includes(p)).map(p => oldPriorities[p]);
    const priority = matches && matches.length && matches.reduce((max, current) => current > max ? current : max);
    return returnDefault ? priority || DEFAULT_PRIORITY : priority;
  }

  truncateTopicList (topics) {
    const keptTopics = topics.slice(0, MAX_SUBSCRIBABLE_TOPICS);
    if (topics.length > MAX_SUBSCRIBABLE_TOPICS) {
      let droppedTopics = topics.slice(MAX_SUBSCRIBABLE_TOPICS);
      if (droppedTopics.length > DROPPED_TOPICS_DISPLAY_COUNT) {
        const length = droppedTopics.length - DROPPED_TOPICS_DISPLAY_COUNT;
        droppedTopics = droppedTopics.slice(DROPPED_TOPICS_DISPLAY_COUNT);
        droppedTopics.push(`...and ${length} more`);
      }
      this.client.logger.warn('Too many topics to subscribe to; truncating extra topics', { droppedTopics });
    }
    return keptTopics;
  }

  bulkSubscribe (topics, options) {
    const requestOptions = {
      method: options.replace ? 'put' : 'post',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      data: JSON.stringify(this.mapCombineTopics(topics)),
      logger: this.client.logger
    };
    const channelId = this.client.config.channelId;
    return requestApi(`notifications/channels/${channelId}/subscriptions`, requestOptions);
  }

  createSubscription (topic, handler) {
    const topics = splitIntoIndividualTopics(topic);

    topics.forEach(t => {
      let handlers = this.topicHandlers(t);
      if (!handlers.includes(handler)) {
        handlers.push(handler);
      }
    });
  }

  removeSubscription (topic, handler) {
    const topics = splitIntoIndividualTopics(topic);

    topics.forEach(t => {
      let handlers = this.topicHandlers(t);
      let handlerIndex = handlers.indexOf(handler);
      if (handlerIndex > -1) {
        handlers.splice(handlerIndex, 1);
      }
    });
  }

  removeTopicPriority (topic) {
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

  getActiveIndividualTopics () {
    const activeTopics = [];
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

  resubscribe () {
    let topicsToResubscribe = mergeAndDedup(Object.keys(this.bulkSubscriptions), this.getActiveIndividualTopics());
    if (topicsToResubscribe.length === 0) {
      return Promise.resolve();
    }
    return this.bulkSubscribe(topicsToResubscribe, { replace: true });
  }

  subscriptionsKeepAlive () {
    const topic = 'streaming-subscriptions-expiring';
    if (this.topicHandlers(topic).length === 0) {
      this.createSubscription(topic, () => {
        this.client.logger.info(`${topic} - Triggering resubscribe.`);
        this.resubscribe().catch((err) => {
          const msg = 'Error resubscribing to topics';
          this.client.logger.error(msg, err);
          this.client._stanzaio.emit('pubsub:error', { msg, err });
        });
      });
    }
  }

  getTopicParts (topic) {
    const isCombined = topic.includes('?');
    const separator = isCombined ? '?' : '.';
    const split = topic.split(separator);
    const postfix = isCombined ? split[1] : split.splice(split.length - 1);
    const prefix = isCombined ? split[0] : split.join('.');
    let postfixes = [];
    if (isCombined) {
      postfixes = postfix.split('&');
    } else {
      postfixes = postfix;
    }
    return { prefix, postfixes };
  }

  setTopicPriorities (priorities = {}) {
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

  get expose () {
    return {
      subscribe: function (topic, handler, immediate, priority) {
        if (priority) {
          this.setTopicPriorities({ [topic]: priority });
        }

        let promise;
        if (!immediate) {
          // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
          promise = this.debouncedResubscribe();
        } else {
          promise = new Promise((resolve, reject) => {
            this.xmppSubscribe(topic, (err, ...args) => {
              if (err) { reject(err); } else { resolve(...args); }
            });
          });
        }
        if (handler) {
          this.createSubscription(topic, handler);
        } else {
          this.bulkSubscriptions[topic] = true;
        }
        return promise;
      }.bind(this),

      unsubscribe: function (topic, handler, immediate) {
        if (handler) {
          this.removeSubscription(topic, handler);
        } else {
          delete this.bulkSubscriptions[topic];
        }

        this.removeTopicPriority(topic);

        if (!immediate) {
          // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
          return this.debouncedResubscribe();
        }
        return new Promise((resolve, reject) => {
          this.xmppUnsubscribe(topic, (err, ...args) => {
            if (err) { reject(err); } else { resolve(...args); }
          });
        });
      }.bind(this),

      bulkSubscribe: function (topics, options = { replace: false, force: false }, priorities = {}) {
        this.setTopicPriorities(priorities);

        let toSubscribe = mergeAndDedup(topics, []);

        if (options.replace && !options.force) {
          // if this is a bulk subscription, but not a forcible one, keep all individual subscriptions
          toSubscribe = mergeAndDedup(toSubscribe, this.getActiveIndividualTopics());
        } else if (options.force) {
          // if it's a forcible bulk subscribe, wipe out individual subscriptions
          this.subscriptions = {};
        }
        return this.bulkSubscribe(toSubscribe, options).then(() => {
          if (options.replace) {
            this.bulkSubscriptions = {};
          }
          topics.forEach(topic => {
            this.bulkSubscriptions[topic] = true;
          });
        });
      }.bind(this)
    };
  }
}
