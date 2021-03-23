'use strict';

import { TokenBucket } from 'limiter';
import { createClient as createStanzaClient, Agent, AgentConfig } from 'stanza';

import './polyfills';
import { Notifications, NotificationsAPI } from './notifications';
import { WebrtcExtension, WebrtcExtensionAPI } from './webrtc';
import { Reconnector } from './reconnector';
import { Ping } from './ping';
import { parseJwt, timeoutPromise } from './utils';
import { StreamingClientExtension } from './types/streaming-client-extension';
import { HttpClient } from './http-client';
import { RequestApiOptions } from './types/interfaces';

let extensions = {
  ping: Ping,
  reconnector: Reconnector,
  notifications: Notifications,
  webrtcSessions: WebrtcExtension
};

function stanzaioOptions (config: ClientOptions & { channelId: string }): AgentConfig {
  let wsHost = config.host.replace(/\/$/, '');
  let stanzaOptions: AgentConfig = {
    jid: config.jid,
    resource: config.jidResource,
    credentials: {
      username: config.jid,
      password: `authKey:${config.authToken}`
    },
    transports: {
      websocket: `${wsHost}/stream/channels/${config.channelId}`
    }
  };

  return stanzaOptions;
}

const HARD_RECONNECT_THRESHOLD = 2;

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
  '_connected': 'connected'
};

export interface ClientOptions {
  host: string;
  apiHost?: string;
  authToken?: string;
  jwt?: string;
  jid?: string;
  jidResource?: string;
  reconnectOnNoLongerSubscribed?: boolean;
  logger?: any;
  optOutOfWebrtcStatsTelemetry?: boolean;
  allowIPv6?: boolean;
}

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

  http: HttpClient;
  notifications!: NotificationsAPI;
  _notifications!: Notifications;
  reconnector!: Reconnector;
  webrtcSessions!: WebrtcExtensionAPI;
  _webrtcSessions!: WebrtcExtension;

  _ping!: Ping;
  _reconnector!: Reconnector;

  constructor (options: ClientOptions) {
    this.http = new HttpClient();

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
      jidResource: options.jidResource,
      channelId: null // created on connect
    };

    this.on('disconnected', () => {
      if (this._stanzaio.transport || this.connecting) {
        this.logger.info('disconnected event received, but reconnection is in progress');
        return;
      }

      this.connected = false;
      this._ping.stop();

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
    this.on('session:end', () => {
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

      return this._reconnector.hardReconnect();
    });

    Object.keys(extensions).forEach((extensionName) => {
      const extension: StreamingClientExtension = new extensions[extensionName](this, options);

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
        (extension.tokenBucket as any).content = 25;
      }

      if (typeof extension.on === 'function') {
        extension.on('send', function (data, message = false) {
          return extension.tokenBucket!.removeTokens(1, () => {
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
      this._reconnector.stop(new Error('Cancelling reconnect')); // just in case there is already an active reconnect trying
      this.http.stopAllRetries();
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

    let jidPromise: Promise<any>;
    if (this.config.jid) {
      jidPromise = Promise.resolve(this.config.jid);
    } else {
      const opts: RequestApiOptions = {
        method: 'get',
        host: this.config.apiHost,
        authToken: this.config.authToken
      };
      jidPromise = this.http.requestApiWithRetry('users/me', opts).promise
        .then(res => res.body.chat.jabberId);
    }

    const opts: RequestApiOptions = {
      method: 'post',
      host: this.config.apiHost,
      authToken: this.config.authToken,
      logger: this.logger
    };
    const channelPromise = this.http.requestApiWithRetry('notifications/channels?connectionType=streaming', opts).promise
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

  static extend (namespace, extension: StreamingClientExtension | ((client: Client) => void)) {
    if (extensions[namespace]) {
      throw new Error(`Cannot register already existing namespace ${namespace}`);
    }
    extensions[namespace] = extension;
  }

  static get version () {
    return '__STREAMING_CLIENT_VERSION__';
  }
}
