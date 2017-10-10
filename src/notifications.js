const WildEmitter = require('wildemitter');

const PUBSUB_HOST = 'firehose.inindca.com';

class Notification extends WildEmitter {
  constructor (client, clientOptions) {
    super();
    this.subscriptions = {};

    this.client = client;

    client.on('pubsub:event', this.pubsubEvent.bind(this));
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
      this.client.subscribeToNode(PUBSUB_HOST, topic, callback);
    }
  }

  xmppUnsubscribe (topic, handler, callback) {
    let handlers = this.topicHandlers(topic);
    let handlerIndex = handlers.indexOf(handler);
    if (handlerIndex > -1) {
      handlers.splice(handlerIndex, 1);
    }
    this.client.unsubscribeFromNode(PUBSUB_HOST, topic, callback);
  }

  createSubscription (topic, handler) {
    let handlers = this.topicHandlers(topic);
    if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  get exposeEvents () { return [ 'notifications:notify' ]; }

  get expose () {
    return {
      subscribe: function (topic, handler, callback) {
        this.xmppSubscribe(topic, callback);
        this.createSubscription(topic, handler);
      }.bind(this),

      unsubscribe: function (topic, handler = () => {}, callback = () => {}) {
        this.xmppUnsubscribe(topic, handler, callback);
      }.bind(this)
    };
  }
}

module.exports = Notification;
