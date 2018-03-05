'use strict';

const XMPP = require('./stanzaio-light');
const notifications = require('./notifications');
const webrtcSessions = require('firehose-webrtc-sessions');
const {TokenBucket} = require('limiter');
const uuid = require('uuid');

let extensions = {
  notifications,
  webrtcSessions
};

function mergeOptions (destination, provided) {
  for (var key in provided) {
    let value = provided[key];
    if (typeof value === 'object') {
      if (!destination[key]) {
        destination[key] = {};
      }
      mergeOptions(destination[key], value);
    } else {
      destination[key] = provided[key];
    }
  }

  return destination;
}

function stanzaioOptions (pcOptions) {
  let wsHost = pcOptions.host.replace(/\/$/, '');
  let stanzaOptions = {
    jid: pcOptions.jid,
    credentials: {
      username: pcOptions.jid,
      password: `authKey:${pcOptions.authToken}`
    },
    wsURL: `${wsHost}/stream`,
    transport: 'websocket'
  };

  return stanzaOptions;
}

function client (clientOptions) {
  let stanzaioOpts = stanzaioOptions(clientOptions);
  let stanzaClient = XMPP.createClient(stanzaioOpts);
  let subscribedTopics = [];
  let ping = require('./ping')(stanzaClient, stanzaioOpts);
  let pendingIqs = {};

  let client = {
    _stanzaio: stanzaClient,
    connected: false,
    subscribedTopics: subscribedTopics,
    on: stanzaClient.on.bind(stanzaClient),
    off: stanzaClient.off.bind(stanzaClient),
    disconnect: stanzaClient.disconnect.bind(stanzaClient),
    connect (connectionOptions) {
      let options = mergeOptions(clientOptions, connectionOptions);
      stanzaClient.connect(stanzaioOptions(options));
    }
  };

  client.on('connected', function () {
    client.connected = true;
  });

  client.on('disconnected', function () {
    client.connected = false;
    ping.stop();
  });

  client.on('session:started', function (event) {
    client.streamId = event.resource;
    ping.start();
  });

  client.on('session:end', function (event) {
    ping.stop();
  });

  Object.keys(extensions).forEach((extensionName) => {
    const extension = new extensions[extensionName](stanzaClient, clientOptions[extensionName] || {});

    if (typeof extension.handleIq === 'function') {
      stanzaClient.on('iq', extension.handleIq.bind(extension));
    }
    if (typeof extension.handleMessage === 'function') {
      stanzaClient.on('message', extension.handleMessage.bind(extension));
    }

    // stanza.io uses an object called 'callbacks' to determine if some extension is registered
    // to handle the stanzaevent (in the form `iq:get:jingle` as an example).
    // See https://github.com/legastero/stanza.io/blob/f7cc3ff3264d15d3ee03a20de939f5afb15aae33/lib/client.js#L156
    if (typeof extension.stanzaEvents === 'object' && Array.isArray(extension.stanzaEvents)) {
      extension.stanzaEvents.forEach(e => {
        stanzaClient.callbacks[e] = true;
      });
    }

    extension.on('send', function (data, message = false) {
      let stanzaLimiter = extension.tokenBucket || new TokenBucket(20, 25, 1000);
      stanzaLimiter.content = 20;

      return stanzaLimiter.removeTokens(1, () => {
        if (['get', 'set'].includes(data.type)) {
          data.id = uuid.v4();
          pendingIqs[data.id] = data;
        }
        if (message === true) {
          return stanzaClient.sendMessage(data);
        }
        return stanzaClient.sendIq(data);
      });
    });

    client[extensionName] = extension.expose;
    client[`_${extensionName}`] = extension;
  });

  return client;
}

module.exports = {

  client: client,

  extend (namespace, extender) {
    if (extensions[namespace]) {
      /* eslint no-throw-literal: "off" */
      throw `Cannot register already existing namespace ${namespace}`;
    }
    extensions[namespace] = extender;
  }

};
