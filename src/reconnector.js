'use strict';

const backoff = require('backoff-web');

class Reconnector {
  constructor (stanzaio) {
    this.backoff = backoff.exponential({
      randomisationFactor: 0.2,
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2
    });

    this.backoff.on('backoff', (number, delay) => {
      this.stanzaio.emit('backoff', { number, delay });
    });

    this.backoff.on('ready', (number, delay) => {
      this.stanzaio.connect();
      this.backoff.backoff();
    });

    this.stanzaio = stanzaio;

    // self bound methods so we can clean up the handlers
    this._cleanupReconnect = this.cleanupReconnect.bind(this);
    this.stanzaio.on('connected', this._cleanupReconnect);

    // disable reconnecting when there's an auth failure
    this.stanzaio.on('auth:failed', this._cleanupReconnect);

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
    this.stanzaio.connect();
    this.backoff.backoff();
    this._backoffActive = true;
  }

  stop () {
    this.backoff.reset();
    this._backoffActive = false;
  }
}

module.exports = Reconnector;
