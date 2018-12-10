import WildEmitter from 'wildemitter';

const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';

class Notification extends WildEmitter {
  constructor (stanzaio, clientOptions = {}) {
    super();
    this.subscriptions = {};

    this.stanzaio = stanzaio;
    this.logger = clientOptions.logger || console;

    stanzaio.on('pubsub:event', this.pubsubEvent.bind(this));
    stanzaio.on('session:started', this.subscriptionsKeepAlive.bind(this));
  }

  get pubsubHost () {
    try {
      const domain = this.stanzaio.config.wsURL.toLowerCase().match(/\.([a-z0-9]+\.[a-z.]+)\//)[1];
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

    this.emit('notify', { topic: topic, data: payload });
    handlers.forEach((handler) => {
      handler(payload);
    });
  }

  xmppSubscribe (topic, callback) {
    if (this.topicHandlers(topic).length !== 0) {
      return callback();
    }
    if (this.stanzaio.transport && this.stanzaio.transport.authenticated) {
      this.stanzaio.subscribeToNode(this.pubsubHost, topic, callback);
    } else {
      this.stanzaio.once('session:started', () => {
        this.stanzaio.subscribeToNode(this.pubsubHost, topic, callback);
      });
    }
  }

  xmppUnsubscribe (topic, callback) {
    if (this.topicHandlers(topic).length !== 0) {
      return callback();
    }
    if (this.stanzaio.transport && this.stanzaio.transport.authenticated) {
      this.stanzaio.unsubscribeFromNode(this.pubsubHost, topic, callback);
    } else {
      this.stanzaio.once('session:started', () => {
        this.stanzaio.unsubscribeFromNode(this.pubsubHost, topic, callback);
      });
    }
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
    const topics = Object.keys(this.subscriptions);
    topics.forEach(topic => {
      if (topic === 'streaming-subscriptions-expiring') {
        return; // this doesn't need subscribed
      }
      const handlers = this.topicHandlers(topic);
      if (handlers.length > 0) {
        this.stanzaio.subscribeToNode(this.pubsubHost, topic);
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
      }.bind(this)
    };
  }
}

module.exports = Notification;
