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
  }

  backOffAndTryAgain () {
    this.backoff.backoff();
  }

  cleanupReconnect () {
    this.backoff.reset();
    this.client.off('connected', this._cleanupReconnect);
  }

  start () {
    this.client.connect();
    this.backoff.backoff();
  }

  stop () {
    this.backoff.reset();
  }
}

module.exports = Reconnector;
