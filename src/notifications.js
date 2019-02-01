import { requestApi } from './utils';

const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';

class Notification {
  constructor (client) {
    this.subscriptions = {};
    this.bulkSubscriptions = {};

    this.client = client;

    client.on('pubsub:event', this.pubsubEvent.bind(this));
    client.on('connected', this.subscriptionsKeepAlive.bind(this));
  }

  get pubsubHost () {
    try {
      return `notifications.${this.client.config.apiHost}`;
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
    if (this.client.connected) {
      this.client._stanzaio.subscribeToNode(this.pubsubHost, topic, callback);
    } else {
      this.client.once('connected', () => {
        this.client._stanzaio.subscribeToNode(this.pubsubHost, topic, callback);
      });
    }
  }

  xmppUnsubscribe (topic, callback) {
    if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
      return callback();
    }
    if (this.client.connected) {
      this.client._stanzaio.unsubscribeFromNode(this.pubsubHost, topic, callback);
    } else {
      this.client.once('connected', () => {
        this.client._stanzaio.unsubscribeFromNode(this.pubsubHost, topic, callback);
      });
    }
  }

  bulkSubscribe (topics) {
    const requestOptions = {
      method: 'post',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      data: JSON.stringify(topics.map(t => ({ id: t })))
    };
    const channelId = this.client.config.channelId;
    return requestApi(`notifications/channels/${channelId}/subscriptions`, requestOptions);
  }

  createSubscription (topic, handler) {
    let handlers = this.topicHandlers(topic);
    if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  removeSubscription (topic, handler) {
    let handlers = this.topicHandlers(topic);
    let handlerIndex = handlers.indexOf(handler);
    if (handlerIndex > -1) {
      handlers.splice(handlerIndex, 1);
    }
  }

  resubscribe () {
    const topicsToResubscribe = Object.keys(this.bulkSubscriptions);
    const topics = Object.keys(this.subscriptions);
    topics.forEach(topic => {
      if (topic === 'streaming-subscriptions-expiring') {
        return; // this doesn't need subscribed
      }
      const handlers = this.topicHandlers(topic);
      if (handlers.length > 0) {
        if (topicsToResubscribe.indexOf(topic) === -1) {
          topicsToResubscribe.push(topic);
        }
      }
    });
    return this.bulkSubscribe(topicsToResubscribe);
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

  get expose () {
    return {
      subscribe: function (topic, handler) {
        return new Promise((resolve, reject) => {
          this.xmppSubscribe(topic, (err, ...args) => {
            if (err) { reject(err); } else { resolve(...args); }
          });
          this.createSubscription(topic, handler);
        });
      }.bind(this),

      unsubscribe: function (topic, handler) {
        return new Promise((resolve, reject) => {
          this.removeSubscription(topic, handler);
          this.xmppUnsubscribe(topic, (err, ...args) => {
            if (err) { reject(err); } else { resolve(...args); }
          });
        });
      }.bind(this),

      bulkSubscribe: function (topics) {
        return this.bulkSubscribe(topics).then(() => {
          topics.forEach(topic => {
            this.bulkSubscriptions[topic] = true;
          });
        });
      }.bind(this)
    };
  }
}

module.exports = Notification;
