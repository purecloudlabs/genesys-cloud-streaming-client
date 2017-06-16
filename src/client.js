'use strict';
const XMPP = require('./stanzaio-light');
const notifications = require('./notifications');

let extensions = {
  notifications: notifications
};

function mergeOptions(destination, provided) {
  for ( var key in provided ) {
    let value = provided[key]
    if (typeof value === "object" ) {
      if (! destination[key]) {
        destination[key] = {}
      }
      mergeOptions(destination[key], value);
    } else {
      destination[key] = provided[key];
    }
  }

  return destination;
}

function stanzaioOptions(pcOptions) {
  let wsHost = pcOptions.host.replace(/\/$/, '');
  let stanzaOptions = {
    jid: pcOptions.jid,
    credentials: {
      username: pcOptions.jid,
      password: `authKey:${pcOptions.authToken}`
    },
    wsURL: `${wsHost}/stream`,
    transport: 'websocket',
  };

  return stanzaOptions;
}

function client(clientOptions) {
  let stanzaioOpts = stanzaioOptions(clientOptions);
  let stanzaClient = XMPP.createClient(stanzaioOpts);
  let subscribedTopics = [];
  let ping = require('./ping')(stanzaClient, stanzaioOpts);

  let client = {
    connected: false,
    subscribedTopics: subscribedTopics,
    on: stanzaClient.on.bind(stanzaClient),
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
    client[extensionName] = extensions[extensionName](stanzaClient);
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
