'use strict';

// src imports
import { Notifications as notifications, Notifications, NotificationsAPI } from './notifications';
import { WebrtcExtension as webrtcSessions, WebrtcExtension, WebrtcExtensionAPI } from './webrtc';
import reconnector from './reconnector';
import ping from './ping';
import './polyfills';
import { requestApi, timeoutPromise } from './utils';
import { createClient as createStanzaClient, Agent } from 'stanza';

// extension imports
// import webrtcSessions from 'genesys-cloud-streaming-client-webrtc-sessions';

// external imports
import { TokenBucket } from 'limiter';

let extensions = {
  ping,
  reconnector,
  notifications,
  webrtcSessions
  // webrtcSessions
};

function stanzaioOptions (config) {
  let wsHost = config.host.replace(/\/$/, '');
  let stanzaOptions = {
    jid: config.jid,
    credentials: {
      username: config.jid,
      // TODO: don't commit this
      password: `authKey:${config.authToken}asdfds`
    },
    transports: {
      websocket: `${wsHost}/stream/channels/${config.channelId}`
    }
  };

  return stanzaOptions;
}

const HARD_RECONNECT_THRESHOLD = 2;

// from https://stackoverflow.com/questions/38552003/how-to-decode-jwt-token-in-javascript
function parseJwt (token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  return JSON.parse(jsonPayload);
}

function stanzaOptionsJwt (config) {
  const jwt = parseJwt(config.jwt);
  let jidDomain;
  try {
    jidDomain = jwt.data.jid.split('@')[1].replace('conference.', '');
  } catch (e) {
    throw new Error('failed to parse jid');
  }
  let wsHost = config.host.replace(/\/$/, '');
  let stanzaOptions = {
    transports: {
      websocket: `${wsHost}/stream/jwt/${config.jwt}`
    },
    server: jidDomain,
    sasl: ['anonymous']
  };

  return stanzaOptions;
}

const REMAPPED_EVENTS = {
  'connected': 'session:started',
  '_connected': 'connected',
  'disconnected': 'session:end',
  '_disconnected': 'disconnected'
};

export class Client {
  _stanzaio: Agent;
  connected = false;
  connecting = false;
  autoReconnect = true;
  reconnectOnNoLongerSubscribed: boolean;
  logger: any;
  leakyReconnectTimer: any;
  hardReconnectCount = 0;
  reconnectLeakTime = 1000 * 60 * 10; // 10 minutes
  deadChannels: string[] = [];
  config: any;
  streamId: any;

  notifications!: NotificationsAPI;
  _notifications!: Notifications;
  reconnector!: reconnector;
  webrtcSessions!: WebrtcExtensionAPI;
  _webrtcSessions!: WebrtcExtension;

  _ping: any;
  _reconnector: any;

  constructor (options) {
    const stanzaio = createStanzaClient({});

    // TODO: remove this hack when we can. basically stanza messes up the auth mechanism priority.
    (stanzaio.sasl as any).mechanisms.find(mech => mech.name === 'ANONYMOUS').priority = 0;
    (stanzaio.sasl as any).mechanisms = (stanzaio.sasl as any).mechanisms.sort((a, b) => b.priority - a.priority);

    this._stanzaio = stanzaio;

    this.reconnectOnNoLongerSubscribed = options.reconnectOnNoLongerSubscribed !== false;

    this.logger = options.logger || console;

    this.config = {
      host: options.host,
      apiHost: options.apiHost || options.host.replace('wss://streaming.', ''),
      authToken: options.authToken,
      jwt: options.jwt,
      jid: options.jid,
      channelId: null // created on connect
    };

    this.on('_disconnected', (event) => {
      if (this._stanzaio.transport || this.connecting) {
        this.logger.info('disconnected event received, but reconnection is in progress');
        return;
      }

      this.connected = false;
      this._ping.stop();

      // example url: "wss://streaming.inindca.com/stream/channels/streaming-cgr4iprj4e8038aluvgmdn74fr"
      this.logger.info('Streaming client disconnected.');

      const channelId = this.config.channelId;
      if (this.autoReconnect && !this.deadChannels.includes(channelId)) {
        this.logger.info('Streaming client disconnected unexpectedly. Attempting to auto reconnect', { channelId });
        this._reconnector.start();
      }
    });

    // remapped session:started
    this.on('connected', async (event) => {
      this.streamId = event.resource;
      this._ping.start();
      this.connected = true;
      this._reconnector.stop();
      this.connecting = false;
    });

    // remapped session:end
    this.on('disconnected', (event) => {
      this._ping.stop();
    });

    this._stanzaio.on('sasl', (sasl) => {
      if (sasl.type === 'failure') {
        this.logger.error('Authentication failed connecting to streaming service', { ...sasl, channelId: this.config.channelId });
        if (sasl.condition !== 'temporary-auth-failure') {
          this._ping.stop();
          this.autoReconnect = false;
          return this.disconnect();
        } else {
          this.logger.info('Temporary auth failure, continuing reconnect attempts');
        }
      }
    });

    this.on('notify:no_longer_subscribed', (data) => {
      this._ping.stop();

      const channelId = data.eventBody.channelId;
      this.deadChannels.push(channelId);

      if (channelId !== this.config.channelId) {
        this.logger.warn('received no_longer_subscribed event for a non active channelId');
        return;
      }

      if (this.hardReconnectCount >= HARD_RECONNECT_THRESHOLD) {
        this.logger.error(`no_longer_subscribed has been called ${this.hardReconnectCount} times and the threshold is ${HARD_RECONNECT_THRESHOLD}, not attempting to reconnect
          channelId: ${this.config.channelId}`);
        this.cleanupLeakTimer();
        return;
      }

      this.logger.info('no_longer_subscribed received');

      if (!this.reconnectOnNoLongerSubscribed) {
        this.logger.info('`reconnectOnNoLongerSubscribed` is false, not attempting to reconnect streaming client');
        return;
      }

      this.logger.info('streaming client attempting to reconnect on a new channel');
      this.hardReconnectCount++;

      if (!this.leakyReconnectTimer) {
        this.leakyReconnectTimer = setInterval(() => {
          if (this.hardReconnectCount > 0) {
            this.hardReconnectCount--;
          } else {
            this.cleanupLeakTimer();
          }
        }, this.reconnectLeakTime);
      }

      this._reconnector.hardReconnect();
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
            return stanzaio.sendIQ(data);
          });
        });
      }

      this[extensionName] = extension.expose;
      this[`_${extensionName}`] = extension;
    });
  }

  cleanupLeakTimer () {
    clearInterval(this.leakyReconnectTimer);
    this.leakyReconnectTimer = null;
  }

  on (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      (this._stanzaio.on as any)(REMAPPED_EVENTS[eventName], ...args);
    } else {
      (this._stanzaio.on as any)(eventName, ...args);
    }
    return this;
  }

  once (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      (this._stanzaio.once as any)(REMAPPED_EVENTS[eventName], ...args);
    } else {
      (this._stanzaio.once as any)(eventName, ...args);
    }
    return this;
  }

  off (eventName, ...args) {
    if (REMAPPED_EVENTS[eventName]) {
      (this._stanzaio.off as any)(REMAPPED_EVENTS[eventName], ...args);
    } else {
      (this._stanzaio.off as any)(eventName, ...args);
    }
    return this;
  }

  disconnect () {
    this.logger.info('streamingClient.disconnect was called');
    return timeoutPromise(resolve => {
      this._stanzaio.once('disconnected', resolve);
      this.autoReconnect = false;
      this._stanzaio.disconnect();
    }, 1000, 'disconnecting streaming service');
  }

  reconnect () {
    this.logger.info('streamingClient.reconnect was called');
    return timeoutPromise(resolve => {
      this._stanzaio.once('session:started', resolve);
      // trigger a stop on the underlying connection, but allow reconnect
      this.autoReconnect = true;
      this._stanzaio.disconnect();
    }, 10 * 1000, 'reconnecting streaming service');
  }

  connect () {
    this.logger.info('streamingClient.connect was called');
    this.connecting = true;
    if (this.config.jwt) {
      return timeoutPromise(resolve => {
        this.once('connected', resolve);
        const options = stanzaOptionsJwt(this.config);
        this._stanzaio.updateConfig(options);
        this._stanzaio.connect();
      }, 10 * 1000, 'connecting to streaming service with jwt')
      .catch((err) => {
        this.connecting = false;
        return Promise.reject(err);
      });
    }

    let jidPromise;
    if (this.config.jid) {
      jidPromise = Promise.resolve(this.config.jid);
    } else {
      const opts = {
        method: 'get',
        host: this.config.apiHost,
        authToken: this.config.authToken
      };
      jidPromise = requestApi('users/me', opts)
        .then(res => res.body.chat.jabberId);
    }

    const opts = {
      method: 'post',
      host: this.config.apiHost,
      authToken: this.config.authToken,
      logger: this.logger
    };
    const channelPromise = requestApi('notifications/channels?connectionType=streaming', opts)
      .then(res => res.body.id);

    return Promise.all([jidPromise, channelPromise])
      .then(([jid, channelId]) => {
        this.config.jid = jid;
        this.config.channelId = channelId;
        this.autoReconnect = true;
        return timeoutPromise(resolve => {
          this.once('connected', resolve);
          const options = stanzaioOptions(this.config);
          this._stanzaio.updateConfig(options);
          this._stanzaio.connect();
        }, 10 * 1000, 'connecting to streaming service', { jid, channelId });
      })
      .catch((err) => {
        this.connecting = false;
        return Promise.reject(err);
      });

  }

  static extend (namespace, extender) {
    if (extensions[namespace]) {
      throw new Error(`Cannot register already existing namespace ${namespace}`);
    }
    extensions[namespace] = extender;
  }

  static get version () {
    return '__STREAMING_CLIENT_VERSION__';
  }
}
