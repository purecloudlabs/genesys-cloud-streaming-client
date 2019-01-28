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
      this.client.logger.error('Failed to reconnect to the streaming service. Attempting to connect with new channel.');
      // attempt with a new channel
      this.cleanupReconnect();
      this.client.connect();
    });

    // self bound methods so we can clean up the handlers
    this._cleanupReconnect = this.cleanupReconnect.bind(this);
    this.client.on('connected', this._cleanupReconnect);

    // disable reconnecting when there's an auth failure
    this.client.on('sasl:failure', (err) => {
      if (!err || err.condition !== 'temporary-auth-failure') {
        this.client.logger.error('Critical error reconnecting; stopping automatic reconnect', err);
        this._cleanupReconnect();
      }
    });

    this._backoffActive = false;
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
