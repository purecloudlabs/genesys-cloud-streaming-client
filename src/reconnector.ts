'use strict';

const backoff = require('backoff-web');
import { Backoff } from 'backoff-web'; // this is just an interface

import { Client } from './client';
import { DefinitionOptions, childText } from 'stanza/jxt';
import { RetryPromise, retryPromise } from './utils';
import { HttpClient } from './http-client';

const HARD_RECONNECT_RETRY_MS = 15000;
const OFFLINE_ERROR = 'OFFLINE_ERROR';

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
  _hardReconnectRetryInfo: null | RetryPromise<void> = null;

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

      if (this.client._stanzaio.transport?.hasStream) {
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
        const msg = 'Critical error reconnecting; stopping automatic reconnect';
        this.client.logger.error(msg, sasl);
        this.stop(new Error(msg));
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

  async hardReconnect (maxAttempts?: number, interval = HARD_RECONNECT_RETRY_MS): Promise<void> {
    if (this._hardReconnectRetryInfo) {
      return this._hardReconnectRetryInfo.promise;
    }

    this.cleanupReconnect();
    this._hasConnected = false;

    this._hardReconnectRetryInfo = retryPromise(
      this._attemptHardReconnect.bind(this),
      (error, retryCount) => {
        return this._shouldRetryError(error, retryCount, maxAttempts);
      },
      interval,
      this.client.logger
    );

    try {
      await this._hardReconnectRetryInfo.promise;
      this._stopHardReconnect();
    } catch (error: any) {
      this._stopHardReconnect(error);
      throw error;
    }
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

  stop (error?: Error | string) {
    this.cleanupReconnect();
    this._stopHardReconnect(error);
  }

  private _stopHardReconnect (error?: Error | string | any) {
    if (!this._hardReconnectRetryInfo) return;

    // SANITY: this is here for cases where `_stopHardReconnect()`
    //  was called before the promise from `retryPromise()` finishes
    if (error) {
      /* ensure we are always working with an Error object */
      if (typeof error === 'string') {
        error = new Error(error);
      }

      this._hardReconnectRetryInfo.reject(error);
    } else {
      this._hardReconnectRetryInfo.resolve();
    }

    this._hardReconnectRetryInfo = null;
  }

  private _attemptHardReconnect (): Promise<void> {
    /* if we aren't online, don't retry the new channel */
    if (!navigator.onLine) {
      throw new Error(OFFLINE_ERROR);
    }

    this.client.logger.info('Attempting to reconnect with new channel.');

    return this.client.connect();
  }

  private _shouldRetryError (error: Error, attemptNumber?: number, maxAttempts?: number): boolean {
    if (typeof maxAttempts === 'number' && typeof attemptNumber === 'number') {
      if (attemptNumber > maxAttempts) {
        this.client.logger.debug('Max retry attempts reached trying to connect to new channel. Stopping retry',
          { attemptNumber, maxAttempts });
        return false;
      } else {
        this.client.logger.debug('Max retry attempts NOT reached trying to connect to new channel. Retrying',
          { attemptNumber, maxAttempts });
        return true;
      }
    }

    /* we throw this is we are offline */
    if (error.message === OFFLINE_ERROR) {
      this.client.logger.debug('Browser is offline. Not attempting to reconnect with new channel.');
      return true;
    } else if (error.message.startsWith('Request has been terminated')) {
      this.client.logger.debug('request offline. attempting reconnect again', error);
      return true;
    } else if (error.message.startsWith('Timeout: ')) {
      this.client.logger.debug(`Streaming-client timed out. attempting reconnect again: "${error.message}"`);
      return true;
    } else if (error && HttpClient.retryStatusCodes.has((error as any).status)) {
      this.client.logger.debug('Received HTTP status code eligible for retry. attempting reconnect again', error);
      return true;
    }

    return false;
  }
}
