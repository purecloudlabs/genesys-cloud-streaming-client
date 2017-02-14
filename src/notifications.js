const PUBSUB_HOST = 'firehose.inindca.com';

module.exports = function (client) {
  let subscriptions = {};

  function topicHandlers (topic) {
    if (!subscriptions[topic]) {
      subscriptions[topic] = [];
    }
    return subscriptions[topic];
  }

  client.on('pubsub:event', function (msg) {
    const topic = msg.event.updated.node;
    const payload = msg.event.updated.published[0].json;
    const handlers = topicHandlers(topic);

    client.emit('notifications:notify', {topic: topic, data: payload});
    handlers.forEach((handler) => {
      handler(payload);
    });
  });

  function xmppSubscribe (topic, callback) {
    if (topicHandlers(topic).length === 0) {
      client.subscribeToNode(PUBSUB_HOST, topic, callback);
    }
  }

  function createSubscription (topic, handler) {
    let handlers = topicHandlers(topic);
    if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  return {
    subscribe (topic, handler, callback) {
      xmppSubscribe(topic, callback);
      createSubscription(topic, handler);
    },

    unsubscribe (topic, handler) {
      let handlers = topicHandlers(topic);
      let handlerIndex = handlers.indexOf(handler);
      if (handlerIndex > -1) {
        handlers.splice(handlerIndex, 1);
      }
    }
  };
};
