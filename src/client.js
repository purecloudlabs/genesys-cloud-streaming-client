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
  const DEFAULT_PING_INTERVAL = 20000;
  const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;
  let wsHost = pcOptions.host.replace(/\/$/, '');
  let stanzaOptions = {
    jid: pcOptions.jid,
    credentials: {
      username: pcOptions.jid,
      password: `authKey:${pcOptions.authToken}`
    },
    wsURL: `${wsHost}/stream`,
    transport: 'websocket',
    pingInterval: pcOptions.pingInterval === undefined ? DEFAULT_PING_INTERVAL : pcOptions.pingInterval, 
    failedPingsBeforeDisconnect: pcOptions.failedPingsBeforeDisconnect === undefined 
      ? DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT 
      : pcOptions.failedPingsBeforeDisconnect
  };

  return stanzaOptions;
}

function client(clientOptions) {
  let stanzaioOpts = stanzaioOptions(clientOptions);
  let stanzaClient = XMPP.createClient(stanzaioOpts)
  let subscribedTopics = [];

  let xmppPingClient = {
    pingIntervalId: null,
    numberOfFailedPings: 0,
    start() {
      if(xmppPingClient.pingIntervalId === null) {
        xmppPingClient.pingIntervalId = setInterval(xmppPingClient.performPing, stanzaioOpts.pingInterval);
      }
    },
    performPing() {
      stanzaClient.ping(stanzaioOpts.jid, xmppPingClient.pingCallback);
    },
    stop() {
      if(xmppPingClient.pingIntervalId !== null) {
        clearInterval(xmppPingClient.pingIntervalId);
        xmppPingClient.pingIntervalId = null;
      }
    },
    pingCallback(error, response) {
      if(response && !error) {
        console.debug("Ping received");
        xmppPingClient.numberOfFailedPings = 0;
      } else if(error) {
        console.warn("Missed a ping.")
        if(++xmppPingClient.numberOfFailedPings > stanzaioOpts.failedPingsBeforeDisconnect) {
          console.error("Missed "+xmppPingClient.numberOfFailedPings+" pings, disconnecting");
          stanzaClient.sendStreamError("too many missed pongs");
        }
      }
    }
  };

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
    xmppPingClient.stop();
  });

  client.on('session:started', function (event) {
    client.streamId = event.resource;
    xmppPingClient.start();
  });

  client.on('session:end', function (event) {
    xmppPingClient.stop();
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
