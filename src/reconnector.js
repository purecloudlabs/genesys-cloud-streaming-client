'use strict';

const backoff = require('backoff-web');

class Reconnector {
  constructor (client) {
    this.backoff = backoff.exponential({
      randomisationFactor: 0.2,
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2
    });

    this.backoff.on('backoff', (number, delay) => {
      this.client.emit('backoff', { number, delay });
    });

    this.backoff.on('ready', (number, delay) => {
      this.client.connect();
      this.backoff.backoff();
    });

    this.client = client;

    // self bound methods so we can clean up the handlers
    this._cleanupReconnect = this.cleanupReconnect.bind(this);
    this.client.on('connected', this._cleanupReconnect);

    this._backoffActive = false;
  }

  cleanupReconnect () {
    this.backoff.reset();
    this.client.off('connected', this._cleanupReconnect);
    this._backoffActive = false;
  }

  start () {
    if (this._backoffActive) {
      return;
    }
    this.client.connect();
    this.backoff.backoff();
    this._backoffActive = true;
  }

  stop () {
    this.backoff.reset();
    this._backoffActive = false;
  }
}

module.exports = Reconnector;
