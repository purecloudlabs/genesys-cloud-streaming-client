'use strict';

const backoff = require('backoff-web');
import { Backoff } from 'backoff-web'; // this is just an interface

import { Client } from './client';
import { DefinitionOptions, childText } from 'stanza/jxt';

const HARD_RECONNECT_RETRY_MS = 15000;

const CXFR_NAMESPACE = 'urn:xmpp:cxfr';
export const CXFRDefinition: DefinitionOptions = {
  aliases: ['iq.cxfr'],
  element: 'query',
  fields: {
    domain: childText(null, 'domain'),
    server: childText(null, 'server')
  },
  namespace: CXFR_NAMESPACE
};

export class Reconnector {
  client: Client;
  backoff: Backoff;
  _hasConnected = false;
  _backoffActive = false;

  /* deferred promise and hardReconnect retry info */
  _hardReconnectRetryInfo: null | {
    promise: Promise<void>;
    resolve: Function;
    reject: Function;
    interval: any;
  } = null;

  /* HTTP status codes that warrant retry */
  _retryStatusCodes = new Set([
    408,
    413,
    429,
    500,
    502,
    503,
    504,
  ]);

  constructor (client) {
    this.client = client;
    this.backoff = backoff.exponential({
      randomisationFactor: 0.2,
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2
    });

    this.backoff.failAfter(10);
    this.backoff.on('ready', (_num, _delay) => {
      if (this.client.connected) {
        this.client.logger.debug('Backoff ready, client already connected');
        return;
      }

      if (this.client._stanzaio.transport?.hasStream || this.client.connecting) {
        this.client.logger.debug('Backoff ready, connection is pending');
        this.backoff.backoff();
        return;
      }

      this.client.logger.debug('Backoff ready, attempting reconnect');
      this.client.connecting = true;
      this.client._stanzaio.connect();
      this.backoff.backoff();
    });

    this.backoff.on('fail', () => {
      return this.hardReconnect();
    });

    this.client.on('connected', () => {
      this._hasConnected = true;
      this.stop();
    });

    // disable reconnecting when there's an auth failure
    this.client._stanzaio.on('sasl', (sasl) => {
      if (sasl.type !== 'failure') {
        return;
      }

      const temporaryFailure = sasl.condition === 'temporary-auth-failure';
      const channelExpired = this._hasConnected && sasl.condition === 'not-authorized';
      if (channelExpired) {
        return this.hardReconnect();
      } else if (!temporaryFailure) {
        this.client.logger.error('Critical error reconnecting; stopping automatic reconnect', sasl);
        this.stop();
      }
    });

    const stanzaio = this.client._stanzaio;
    stanzaio.stanzas.define(CXFRDefinition);

    this.client._stanzaio.on('iq:set:cxfr' as any, (stanza) => {
      // After 10 minutes, reconnect automatically
      const timeout = setTimeout(this.client.reconnect, 10 * 60 * 1000);
      // If no `pending` response received from app, proceed with reconnect
      const failureTimeout = setTimeout(() => {
        clearTimeout(timeout);
        return this.client.reconnect();
      }, 1000);
      // send request to app to reconnect. app can say `pending` to allow for max 1 hour
      // delay in reconnect, and/or `done` to proceed with reconnect immediately
      this.client._stanzaio.emit('requestReconnect' as any, (response) => {
        if (response.pending === true) {
          clearTimeout(failureTimeout);
        }
        if (response.done) {
          clearTimeout(failureTimeout);
          clearTimeout(timeout);
          return this.client.reconnect();
        }
      });
    });

    this._backoffActive = false;
  }

  hardReconnect (): Promise<void> {
    if (this._hardReconnectRetryInfo) {
      return this._hardReconnectRetryInfo.promise;
    }

    this.cleanupReconnect();
    this._hasConnected = false;

    this._hardReconnectRetryInfo = {} as any;
    this._hardReconnectRetryInfo!.promise = new Promise<void>((resolve, reject) => {
      /* defer this to allow it to be canceled */
      this._hardReconnectRetryInfo!.resolve = resolve;
      this._hardReconnectRetryInfo!.reject = reject;
      this._hardReconnectRetryInfo!.interval = setInterval(async () => {
        this.client.logger.debug('inside setInterval');

        /* if we aren't online, don't retry the new channel */
        if (!navigator.onLine) {
          return this.client.logger.debug('Browser is offline. Not attempting to reconnect with new channel.');
        }

        try {
          this.client.logger.info('Attempting to reconnect with new channel.');

          await this.client.connect();

          this._stopHardReconnect();
        } catch (error) {
          /* this error comes from superagent for requests that timeout for network offline */
          if (error.message.startsWith('Request has been terminated')) {
            return this.client.logger.debug('request offline. attempting reconnect again', error);
          }
          /* error client thrown timeouts */
          else if (error.message.startsWith('Timeout: ')) {
            return this.client.logger.debug(`Streaming-client timedout. attempting reconnect again: "${error.message}"`);
          }
          /* superagent retriable error */
          else if (error && this._retryStatusCodes.has(error.status)) {
            return this.client.logger.debug('Received HTTP status code eligible for retry. attempt reconnect again', error);
          }

          /* if it is an error we can't retry, reject with it */
          this._stopHardReconnect(error);
        }
      }, HARD_RECONNECT_RETRY_MS);
    });

    return this._hardReconnectRetryInfo!.promise;
  }

  cleanupReconnect () {
    this.backoff.reset();
    this._backoffActive = false;
  }

  start () {
    if (this._backoffActive) {
      return;
    }
    this.backoff.backoff();
    this._backoffActive = true;
  }

  stop () {
    this.cleanupReconnect();
    this._stopHardReconnect();
  }

  private _stopHardReconnect (error?: any) {
    if (!this._hardReconnectRetryInfo) return;

    if (error) {
      this._hardReconnectRetryInfo.reject(error);
    } else {
      this._hardReconnectRetryInfo.resolve();
    }

    clearInterval(this._hardReconnectRetryInfo.interval);
    this._hardReconnectRetryInfo = null;
  }
}