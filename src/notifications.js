import WildEmitter from 'wildemitter';

const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';

class Notification extends WildEmitter {
  constructor (client, clientOptions = {}) {
    super();
    this.subscriptions = {};

    this.client = client;
    this.logger = clientOptions.logger || console;

    client.on('pubsub:event', this.pubsubEvent.bind(this));
    client.on('connected', this.subscriptionsKeepAlive.bind(this));
  }

  get pubsubHost () {
    try {
      const domain = this.client.config.wsURL.toLowerCase().match(/\.([a-z0-9]+\.[a-z.]+)\//)[1];
      return `notifications.${domain}`;
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

    this.client.emit('notifications:notify', {topic: topic, data: payload});
    handlers.forEach((handler) => {
      handler(payload);
    });
  }

  xmppSubscribe (topic, callback) {
    if (this.topicHandlers(topic).length === 0) {
      if (this.client.connected) {
        this.client.subscribeToNode(this.pubsubHost, topic, callback);
      } else {
        this.client.once('connected', () => {
          this.client.subscribeToNode(this.pubsubHost, topic, callback);
        });
      }
    }
  }

  xmppUnsubscribe (topic, handler, callback) {
    let handlers = this.topicHandlers(topic);
    let handlerIndex = handlers.indexOf(handler);
    if (handlerIndex > -1) {
      handlers.splice(handlerIndex, 1);
    }
    if (handlers.length === 0) {
      if (this.client.connected) {
        this.client.unsubscribeFromNode(this.pubsubHost, topic, callback);
      } else {
        this.client.once('connected', () => {
          this.client.unsubscribeFromNode(this.pubsubHost, topic, callback);
        });
      }
    }
  }

  createSubscription (topic, handler) {
    let handlers = this.topicHandlers(topic);
    if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  resubscribe () {
    const topics = Object.keys(this.subscriptions);
    topics.forEach(topic => {
      if (topic === 'streaming-subscriptions-expiring') {
        return; // this doesn't need subscribed
      }
      const handlers = this.topicHandlers(topic);
      if (handlers.length > 0) {
        this.client.subscribeToNode(this.pubsubHost, topic);
      }
    });
  }

  subscriptionsKeepAlive () {
    const topic = 'streaming-subscriptions-expiring';
    if (this.topicHandlers(topic).length === 0) {
      this.createSubscription(topic, () => {
        this.logger.info(`${topic} - Triggering resubscribe.`);
        this.resubscribe();
      });
    }
  }

  get exposeEvents () { return [ 'notifications:notify' ]; }

  get expose () {
    return {
      subscribe: function (topic, handler, callback) {
        this.xmppSubscribe(topic, callback);
        this.createSubscription(topic, handler);
      }.bind(this),

      unsubscribe: function (topic, handler, callback = () => {}) {
        this.xmppUnsubscribe(topic, handler, callback);
      }.bind(this)
    };
  }
}

module.exports = Notification;
