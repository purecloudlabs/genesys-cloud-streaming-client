'use strict';

import { TokenBucket } from 'limiter';
import { Logger } from 'genesys-cloud-client-logger';

import './polyfills';
import { Notifications, NotificationsAPI } from './notifications';
import { WebrtcExtension, WebrtcExtensionAPI } from './webrtc';
import { Ping } from './ping';
import { parseJwt, timeoutPromise } from './utils';
import { StreamingClientExtension } from './types/streaming-client-extension';
import { HttpClient } from './http-client';
import { RequestApiOptions, IClientOptions, IClientConfig, StreamingClientConnectOptions } from './types/interfaces';
import { AxiosError } from 'axios';
import { NamedAgent } from './types/named-agent';
import EventEmitter from 'events';
import { ConnectionManager } from './connection-manager';
import { backOff } from 'exponential-backoff';
import OfflineError from './types/offline-error';
import SaslError from './types/sasl-error';
import { TimeoutError } from './types/timeout-error';

let extensions = {
  notifications: Notifications,
  webrtcSessions: WebrtcExtension
};

const STANZA_DISCONNECTED = 'stanzaDisconnected';
const NO_LONGER_SUBSCRIBED = 'notify:no_longer_subscribed';

export class Client extends EventEmitter {
  activeStanzaInstance?: NamedAgent;
  connected = false;
  connecting = false;
  hardReconnectRequired = true;
  reconnectOnNoLongerSubscribed: boolean;
  logger: Logger;
  config: IClientConfig;
  isGuest = false;
  backgroundAssistantMode = false;

  private autoReconnect = true;
  private extensions: StreamingClientExtension[] = [];
  private connectionManager: ConnectionManager;

  http: HttpClient;
  notifications!: NotificationsAPI;
  _notifications!: Notifications;
  webrtcSessions!: WebrtcExtensionAPI;
  _webrtcSessions!: WebrtcExtension;

  _ping!: Ping;

  constructor (options: IClientOptions) {
    super();
    this.http = new HttpClient();

    this.reconnectOnNoLongerSubscribed = options.reconnectOnNoLongerSubscribed !== false;

    this.config = {
      host: options.host,
      apiHost: options.apiHost || options.host.replace('wss://streaming.', ''),
      authToken: options.authToken,
      jwt: options.jwt,
      jid: options.jid,
      jidResource: options.jidResource,
      channelId: null as any, // created on connect
      appName: options.appName,
      appVersion: options.appVersion
    };

    this.backgroundAssistantMode = this.checkIsBackgroundAssistant();
    this.isGuest = !this.backgroundAssistantMode && !options.authToken;

    let loggerAccessToken = options.authToken || '';
    let loggerUrl = `https://api.${this.config.apiHost}/api/v2/diagnostics/trace`;
    if (this.backgroundAssistantMode) {
      loggerAccessToken = options.jwt!;
      loggerUrl += '/backgroundassistant';
    }

    this.logger = new Logger({
      accessToken: loggerAccessToken,
      url: loggerUrl,
      uploadDebounceTime: 1000,
      initializeServerLogging: !this.isGuest && !options.optOutOfWebrtcStatsTelemetry,
      /* streaming-client logging info */
      appVersion: Client.version,
      appName: 'streaming-client',
      logLevel: this.config.logLevel || 'info',
      logger: options.logger || console,
      formatters: options.logFormatters,
      /* secondary/parent app info */
      originAppName: options.appName,
      originAppVersion: options.appVersion,
      originAppId: options.appId
    });

    this.connectionManager = new ConnectionManager(this.logger, this.config);

    Object.keys(extensions).forEach((extensionName) => {
      const extension: StreamingClientExtension = new extensions[extensionName](this, options);
      this.extensions.push(extension);

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
        extension.on('send', this.handleSendEventFromExtension.bind(this, extension));
      }

      this[extensionName] = extension.expose;
      this[`_${extensionName}`] = extension;
    });
  }

  private handleSendEventFromExtension (extension: StreamingClientExtension, data: any, message = false) {
    return extension.tokenBucket!.removeTokens(1, () => {
      const stanza = this.activeStanzaInstance;

      if (!stanza) {
        return this.logger.warn('cannot send message, no active stanza client', { data, message }, { skipServer: true });
      }

      if (message === true) {
        return stanza.sendMessage(data);
      }
      return stanza.sendIQ(data);
    });
  }

  private checkIsBackgroundAssistant (): boolean {
    if (this.config.jwt) {
      const jwt = parseJwt(this.config.jwt);

      return jwt && jwt.iss === 'urn:purecloud:screenrecording';
    }

    return false;
  }

  private addInateEventHandlers (stanza: NamedAgent) {
    this.on(STANZA_DISCONNECTED, this.handleStanzaDisconnectedEvent.bind(this, stanza));
    this.on(NO_LONGER_SUBSCRIBED, this.handleNoLongerSubscribed.bind(this, stanza));

    this.extensions.forEach(extension => {
      if (typeof extension.handleIq === 'function') {
        stanza.on('iq', extension.handleIq.bind(extension));
      }
      if (typeof extension.handleMessage === 'function') {
        stanza.on('message', extension.handleMessage.bind(extension));
      }
    });
  }

  private proxyStanzaEvents (stanza: NamedAgent) {
    stanza.originalEmitter = stanza.emit;
    (stanza as unknown as Client).emit = (eventName: string, ...args: any[]): boolean => {
      const hasListeners = stanza.originalEmitter!(eventName, ...args);

      // there are a few events that need to be handled specially. stanza emits a `connected` event
      // which means the web socket connected but that doesn't mean it's not going to immediately close.
      // For this reason, we are going to equate the `session:started` event as "connected" which
      // essentially means the websocket connection is stable.
      //
      // we are also going to let streaming client control its own connected and disconnected state so
      // we will emit those events separately "when we are ready".

      // as per block comment, we'll ignore the connected event
      if (eventName === 'connected') {
        return hasListeners;
      } else if (eventName === 'disconnected') {
        eventName = STANZA_DISCONNECTED;
      }

      return this.emit(eventName, ...args);
    };
  }

  private async handleStanzaDisconnectedEvent (disconnectedInstance: NamedAgent): Promise<any> {
    this.logger.info('stanzaDisconnected event received', { stanzaInstanceId: disconnectedInstance.id, channelId: disconnectedInstance.channelId });
    this.connected = false;
    this.connecting = false;
    disconnectedInstance.pinger!.stop();

    this.removeAllListeners(STANZA_DISCONNECTED);
    this.removeAllListeners(NO_LONGER_SUBSCRIBED);

    // unproxy events
    if (disconnectedInstance.originalEmitter) {
      disconnectedInstance.emit = disconnectedInstance.originalEmitter as any;
    }

    this.activeStanzaInstance = undefined;

    this.emit('disconnected', { reconnecting: this.autoReconnect });

    if (this.autoReconnect) {
      return this.connect({ keepTryingOnFailure: true });
    }
  }

  private handleNoLongerSubscribed (stanzaInstance: NamedAgent) {
    this.logger.warn('noLongerSubscribed event received', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
    stanzaInstance.pinger!.stop();

    this.hardReconnectRequired = true;

    if (!this.reconnectOnNoLongerSubscribed) {
      this.autoReconnect = false;
    }
  }

  async disconnect () {
    this.logger.info('streamingClient.disconnect was called');

    if (!this.activeStanzaInstance) {
      return;
    }

    return timeoutPromise(resolve => {
      this.activeStanzaInstance!.once('disconnected', resolve);
      this.autoReconnect = false;
      this.http.stopAllRetries();
      this.activeStanzaInstance!.disconnect();
    }, 1000, 'disconnecting streaming service');
  }

  async connect (connectOpts: StreamingClientConnectOptions = { keepTryingOnFailure: false }) {
    if (this.connecting) {
      const error = new Error('Already trying to connect streaming client');
      return this.logger.warn(error);
    }

    try {
      await backOff(() => this.makeConnectionAttempt(), {
        jitter: 'full',
        maxDelay: 10000,
        numOfAttempts: connectOpts.keepTryingOnFailure ? Infinity : 1,
        startingDelay: 2000,
        retry: this.backoffConnectRetryHandler.bind(this, connectOpts)
      });
    } catch (err: any) {
      let error = err;
      if (err.name === 'AxiosError') {
        const axiosError = err as AxiosError;
        const config = axiosError.config;

        // sanitized error for logging
        error = {
          config: {
            url: config.url,
            method: config.method
          },
          status: axiosError.response?.status,
          code: axiosError.code,
          name: axiosError.name,
          message: axiosError.message
        };
      }

      this.logger.error('Failed to connect streaming client', { error });
      throw err;
    }
  }

  private backoffConnectRetryHandler (connectOpts: StreamingClientConnectOptions, err: any, connectionAttempt: number): boolean {
    // if we exceed the `numOfAttempts` in the backoff config it still calls this retry fn and just ignores the result
    // if that's the case, we just want to bail out and ignore all the extra logging here.
    if (!connectOpts.keepTryingOnFailure) {
      return false;
    }

    const additionalErrorDetails: any = { connectionAttempt, error: err };

    if (err.name === 'AxiosError') {
      const axiosError = err as AxiosError;
      const config = axiosError.config;
      let sanitizedError = {
        config: {
          url: config.url,
          method: config.method
        },
        status: axiosError.response?.status,
        code: axiosError.code,
        name: axiosError.name,
        message: axiosError.message
      };

      additionalErrorDetails.error = sanitizedError;

      if ([401, 403].includes(err.response?.status || 0)) {
        this.logger.error('Streaming client received an error that it can\'t recover from and will not attempt to reconnect', additionalErrorDetails);
        return false;
      }
    }

    // if we get a sasl error, that means we made it all the way to the point of trying to open a websocket and
    // it was rejected for some reason. At this point we should do a hard reconnect then try again.
    if (err instanceof SaslError) {
      this.logger.info('hardReconnectRequired set to true due to sasl error');
      this.hardReconnectRequired = true;
      Object.assign(additionalErrorDetails, { channelId: err.channelId, stanzaInstanceId: err.stanzaInstanceId });
    }

    // we don't need to log the stack for a timeout message
    if (err instanceof TimeoutError) {
      additionalErrorDetails.error = err.message;

      const details = (err as any).details;
      if (details) {
        additionalErrorDetails.details = details;
      }
    }

    this.logger.error('Failed streaming client connection attempt, retrying', additionalErrorDetails, { skipServer: err instanceof OfflineError });
    return true;
  }

  private async makeConnectionAttempt () {
    if (!navigator.onLine) {
      throw new OfflineError('Browser if offline, skipping connection attempt');
    }

    await this.prepareForConnect();
    const stanzaInstance = await this.connectionManager.getNewStanzaConnection();
    this.connected = true;
    this.connecting = false;
    this.addInateEventHandlers(stanzaInstance);
    this.proxyStanzaEvents(stanzaInstance);
    stanzaInstance.pinger = new Ping(this, stanzaInstance);
    this.extensions.forEach(extension => extension.handleStanzaInstanceChange(stanzaInstance));
    this.activeStanzaInstance = stanzaInstance;
    this.emit('connected');
  }

  private async prepareForConnect () {
    if (this.config.jwt) {
      this.hardReconnectRequired = false;
      return this.connectionManager.setConfig(this.config);
    }

    if (this.hardReconnectRequired) {
      let jidPromise: Promise<any>;
      if (this.config.jid) {
        jidPromise = Promise.resolve(this.config.jid);
      } else {
        const jidRequestOpts: RequestApiOptions = {
          method: 'get',
          host: this.config.apiHost,
          authToken: this.config.authToken,
          logger: this.logger
        };
        jidPromise = this.http.requestApiWithRetry('users/me', jidRequestOpts).promise
          .then(res => res.data.chat.jabberId);
      }

      const channelRequestOpts: RequestApiOptions = {
        method: 'post',
        host: this.config.apiHost,
        authToken: this.config.authToken,
        logger: this.logger
      };
      const channelPromise = this.http.requestApiWithRetry('notifications/channels?connectionType=streaming', channelRequestOpts).promise
        .then(res => res.data.id);

      const [jid, channelId] = await Promise.all([jidPromise, channelPromise]);
      this.config.jid = jid;
      this.config.channelId = channelId;
      this.autoReconnect = true;
      this.logger.info('attempting to connect streaming client on channel', { channelId });
      this.connectionManager.setConfig(this.config);
      this.hardReconnectRequired = false;
    }
  }

  stopServerLogging () {
    /* flush all pending logs and webrtc stats – then turn off the logger */
    this.logger.sendAllLogsInstantly();
    this._webrtcSessions.flushStats();
    this.logger.stopServerLogging();
  }

  startServerLogging () {
    this.logger.startServerLogging();
  }

  setAccessToken (token: string): void {
    this.config.authToken = token;
    this.logger.setAccessToken(token);
  }

  static extend (namespace, extension: StreamingClientExtension | ((client: Client) => void)) {
    if (extensions[namespace]) {
      throw new Error(`Cannot register already existing namespace ${namespace}`);
    }
    extensions[namespace] = extension;
  }

  get version () {
    return Client.version;
  }

  static get version () {
    return '__STREAMING_CLIENT_VERSION__';
  }
}
