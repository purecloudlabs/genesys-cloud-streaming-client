'use strict';

import XMPP from './stanzaio-light';
import notifications from './notifications';
import Reconnector from './reconnector';
import webrtcSessions from 'purecloud-streaming-client-webrtc-sessions';

import {TokenBucket} from 'limiter';
import request from 'superagent';

function buildUri (host, path, version = 'v2') {
  path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
  return `https://api.${host}/api/${version}/${path}`;
}

function requestApi (path, { method, data, host, version, contentType, authToken }) {
  let response = request[method](buildUri(host, path, version))
    .set('Authorization', `Bearer ${authToken}`)
    .type(contentType || 'json');

  return response.send(data); // trigger request
}

let extensions = {
  notifications,
  webrtcSessions
};

function mergeOptions (destination, provided) {
  for (var key in provided) {
    let value = provided[key];
    if (value instanceof Object) {
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
    wsURL: `${wsHost}/stream/channels/${pcOptions.channelId}`,
    transport: 'websocket'
  };

  return stanzaOptions;
}

const REMAPPED_EVENTS = {
  'connected': 'session:started',
  '_connected': 'connected',
  'disconnected': 'session:end',
  '_disconnected': 'disconnected'
};

function client (clientOptions) {
  let stanzaioOpts = stanzaioOptions(clientOptions);
  let stanzaio = XMPP.createClient(stanzaioOpts);
  let subscribedTopics = [];
  let ping = require('./ping')(stanzaio, stanzaioOpts);
  let reconnect = new Reconnector(stanzaio, stanzaioOpts);

  const client = {
    _stanzaio: stanzaio,
    connected: false,
    autoReconnect: true,
    subscribedTopics: subscribedTopics,
    on (eventName, ...args) {
      if (REMAPPED_EVENTS[eventName]) {
        return this._stanzaio.on(REMAPPED_EVENTS[eventName], ...args);
      }
      return this._stanzaio.on(eventName, ...args);
    },
    off (eventName, ...args) {
      if (REMAPPED_EVENTS[eventName]) {
        return this._stanzaio.off(REMAPPED_EVENTS[eventName], ...args);
      }
      return this._stanzaio.off(eventName, ...args);
    },
    disconnect () {
      client.autoReconnect = false;
      stanzaio.disconnect();
    },
    reconnect () {
      // trigger a stop on the underlying connection, but allow reconnect
      client.autoReconnect = true;
      stanzaio.disconnect();
    },
    connect (connectionOptions) {
      let options = mergeOptions(clientOptions, connectionOptions);
      const opts = {
        method: 'post',
        host: options.apiHost || options.host.replace('wss://streaming.', ''),
        authToken: options.authToken
      };
      return requestApi('notifications/channels?connectionType=streaming', opts)
        .then(res => {
          options.channelId = res.body.id;
          client.autoReconnect = true;
          stanzaio.connect(stanzaioOptions(options));
        });
    }
  };

  client.on('_connected', function () {
    client.connected = true;
    reconnect.stop();
  });

  client.on('_disconnected', function () {
    client.connected = false;
    ping.stop();

    if (client.autoReconnect) {
      reconnect.start(client);
    }
  });

  // remapped session:started
  client.on('connected', function (event) {
    client.streamId = event.resource;
    ping.start();
  });

  // remapped session:end
  client.on('disconnected', function (event) {
    ping.stop();
  });

  client.on('auth:failed', function () {
    client.autoReconnect = false;
    client.disconnect();
  });

  Object.keys(extensions).forEach((extensionName) => {
    const extension = new extensions[extensionName](stanzaio, clientOptions[extensionName] || {});

    if (typeof extension.handleIq === 'function') {
      stanzaio.on('iq', extension.handleIq.bind(extension));
    }
    if (typeof extension.handleMessage === 'function') {
      stanzaio.on('message', extension.handleMessage.bind(extension));
    }

    if (!extension.tokenBucket) {
      // default rate limit
      // 20 stanzas per 1000 ms,
      // adding up to 25 stanzas over the course of the 1000ms
      // starting with 20 stanzas
      // = 45 stanzas max per 1000 ms
      // = 70 stanzas max per 2000 ms
      extension.tokenBucket = new TokenBucket(20, 25, 1000);
      extension.tokenBucket.content = 25;
    }

    extension.on('send', function (data, message = false) {
      return extension.tokenBucket.removeTokens(1, () => {
        if (message === true) {
          return stanzaio.sendMessage(data);
        }
        return stanzaio.sendIq(data);
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
