'use strict';

const backoff = require('backoff-web');

class Reconnector {
  constructor (client) {
    this.client = client;
    this.backoff = backoff.exponential({
      randomisationFactor: 0.2,
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2
    });

    this.backoff.failAfter(10);

    this.backoff.on('ready', (number, delay) => {
      if (this.client.connected) {
        this.client.logger.debug('Backoff ready, client already connected');
        return;
      }
      if (this.client._stanzaio.transport &&
          this.client._stanzaio.transport.conn) {
        const conn = this.client._stanzaio.transport.conn;
        if (conn.readyState <= 1) {
          if (conn.readyState === 1) {
            this.client.logger.debug('Backoff ready, client not connected, but has websocket open');
          }
          if (conn.readyState === 0) {
            this.client.logger.debug('Backoff ready, client not connected, but has websocket pending');
          }
          this.backoff.backoff();
          return;
        }
      }
      this.client.logger.debug('Backoff ready, attempting reconnect');
      this.client._stanzaio.connect();
      this.backoff.backoff();
    });

    this.backoff.on('fail', () => {
      this.hardReconnect();
    });

    // self bound methods so we can clean up the handlers
    this._cleanupReconnect = this.cleanupReconnect.bind(this);
    this.client.on('connected', () => {
      this._hasConnected = true;
      this._cleanupReconnect();
    });

    // disable reconnecting when there's an auth failure
    this.client.on('sasl:failure', (err) => {
      const temporaryFailure = err && err.condition === 'temporary-auth-failure';
      const channelExpired = this._hasConnected && err && err.condition === 'not-authorized';
      if (channelExpired) {
        this.hardReconnect();
      } else if (temporaryFailure) {
        this.client.logger.info('Temporary auth failure, continuing reconnect attempts');
      } else {
        this.client.logger.error('Critical error reconnecting; stopping automatic reconnect', err);
        this._cleanupReconnect();
      }
    });

    const stanzaio = this.client._stanzaio;
    stanzaio.disco.addFeature('urn:xmpp:cxfr');
    const CxfrStanza = stanzaio.stanzas.define({
      name: 'cxfr',
      namespace: 'urn:xmpp:cxfr',
      tags: ['cxfr'],
      element: 'query',
      fields: {
        domain: stanzaio.stanzas.utils.textSub('urn:xmpp:cxfr', 'domain'),
        server: stanzaio.stanzas.utils.textSub('urn:xmpp:cxfr', 'server')
      }
    });
    stanzaio.stanzas.extendIQ(CxfrStanza);

    this.client.on('iq:set:cxfr', () => {
      // After 10 minutes, reconnect automatically
      const timeout = setTimeout(this.client.reconnect, 10 * 60 * 1000);
      // If no `pending` response received from app, proceed with reconnect
      const failureTimeout = setTimeout(() => {
        clearTimeout(timeout);
        this.client.reconnect();
      }, 1000);
      // send request to app to reconnect. app can say `pending` to allow for max 1 hour
      // delay in reconnect, and/or `done` to proceed with reconnect immediately
      this.client._stanzaio.emit('requestReconnect', (response) => {
        if (response.pending === true) {
          clearTimeout(failureTimeout);
        }
        if (response.done) {
          clearTimeout(failureTimeout);
          clearTimeout(timeout);
          this.client.reconnect();
        }
      });
    });

    this._backoffActive = false;
  }

  hardReconnect () {
    this.client.logger.error('Failed to reconnect to the streaming service. Attempting to connect with new channel.');
    this._cleanupReconnect();
    this._hasConnected = false;
    this.client.connect();
  }

  cleanupReconnect () {
    this.backoff.reset();
    this._backoffActive = false;
  }

  start () {
    if (this._backoffActive) {
      return;
    }
    this.client._stanzaio.connect();
    this.backoff.backoff();
    this._backoffActive = true;
  }

  stop () {
    this.backoff.reset();
    this._backoffActive = false;
  }
}

module.exports = Reconnector;
