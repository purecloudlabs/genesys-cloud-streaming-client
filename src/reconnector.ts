'use strict';

const backoff = require('backoff-web');

import { Client } from './client';
import { DefinitionOptions, childText } from 'stanza/jxt';

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
  backoff: any;
  _hasConnected = false;
  _cleanupReconnect: any;
  _backoffActive = false;

  constructor (client) {
    this.client = client;
    this.backoff = backoff.exponential({
      randomisationFactor: 0.2,
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2
    });

    this.backoff.failAfter(10);

    this.backoff.on('ready', (num, delay) => {
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

    // self bound methods so we can clean up the handlers
    this._cleanupReconnect = this.cleanupReconnect.bind(this);
    this.client.on('connected', () => {
      this._hasConnected = true;
      this._cleanupReconnect();
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
        this._cleanupReconnect();
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

  hardReconnect () {
    this.client.logger.info('Attempting to reconnect with new channel.');
    this._cleanupReconnect();
    this._hasConnected = false;
    return this.client.connect();
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
    this.backoff.reset();
    this._backoffActive = false;
  }
}
