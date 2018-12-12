'use strict';

// src imports
import XMPP from './stanzaio-light';
import notifications from './notifications';
import reconnector from './reconnector';
import ping from './ping';
import { requestApi, timeoutPromise } from './utils';

// extension imports
import webrtcSessions from 'purecloud-streaming-client-webrtc-sessions';

// external imports
import {TokenBucket} from 'limiter';

let extensions = {
  ping,
  reconnector,
  notifications,
  webrtcSessions
};

function stanzaioOptions (config) {
  let wsHost = config.host.replace(/\/$/, '');
  let stanzaOptions = {
    jid: config.jid,
    credentials: {
      username: config.jid,
      password: `authKey:${config.authToken}`
    },
    wsURL: `${wsHost}/stream/channels/${config.channelId}`,
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

class Client {
  constructor (options) {
    const stanzaio = XMPP.createClient({});
    this._stanzaio = stanzaio;
    this.connected = false;
    this.autoReconnect = true;
    this.logger = options.logger || console;
    this.config = {
      host: options.host,
      apiHost: options.apiHost || options.host.replace('wss://streaming.', ''),
      authToken: options.authToken,
      jid: options.jid, // todo: fetch on init
      channelId: null // created on connect
    };

    this.on('_connected', () => {
      this.connected = true;
      this._reconnector.stop();
    });

    this.on('_disconnected', () => {
      this.connected = false;
      this._ping.stop();

      if (this.autoReconnect) {
        this._reconnector.start();
      }
    });

    // remapped session:started
    this.on('connected', (event) => {
      this.streamId = event.resource;
      this._ping.start();
    });

    // remapped session:end
    this.on('disconnected', (event) => {
      this._ping.stop();
    });

    this.on('auth:failed', (err) => {
      this.logger.error('Authentication failed connecting to streaming service', err);
      this.autoReconnect = false;
      this.disconnect();
    });

    Object.keys(extensions).forEach((extensionName) => {
      const extension = new extensions[extensionName](this, options);

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

      if (typeof extension.on === 'function') {
        extension.on('send', function (data, message = false) {
          return extension.tokenBucket.removeTokens(1, () => {
            if (message === true) {
              return stanzaio.sendMessage(data);
            }
            return stanzaio.sendIq(data);
          });
        });
      }

      this[extensionName] = extension.expose;
      this[`_${extensionName}`] = extension;
    });
  }

  on (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      return this._stanzaio.on(REMAPPED_EVENTS[eventName], ...args);
    }
    return this._stanzaio.on(eventName, ...args);
  }

  once (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      return this._stanzaio.once(REMAPPED_EVENTS[eventName], ...args);
    }
    return this._stanzaio.once(eventName, ...args);
  }

  off (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      return this._stanzaio.off(REMAPPED_EVENTS[eventName], ...args);
    }
    return this._stanzaio.off(eventName, ...args);
  }

  disconnect () {
    return timeoutPromise(resolve => {
      this._stanzaio.once('disconnected', resolve);
      this.autoReconnect = false;
      this._stanzaio.disconnect();
    }, 1000, 'disconnecting streaming service');
  }

  reconnect () {
    return timeoutPromise(resolve => {
      this._stanzaio.once('session:started', resolve);
      // trigger a stop on the underlying connection, but allow reconnect
      this.autoReconnect = true;
      this._stanzaio.disconnect();
    }, 1000, 'reconnecting streaming service');
  }

  connect () {
    const opts = {
      method: 'post',
      host: this.config.apiHost,
      authToken: this.config.authToken
    };
    return requestApi('notifications/channels?connectionType=streaming', opts)
      .then(res => {
        this.config.channelId = res.body.id;
        this.autoReconnect = true;
        return timeoutPromise(resolve => {
          this.once('connected', resolve);
          this._stanzaio.connect(stanzaioOptions(this.config));
        }, 10 * 1000, 'connecting to streaming service');
      });
  }

  static extend (namespace, extender) {
    if (extensions[namespace]) {
      /* eslint no-throw-literal: "off" */
      throw `Cannot register already existing namespace ${namespace}`;
    }
    extensions[namespace] = extender;
  }
}

module.exports = Client;
