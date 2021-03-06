'use strict';

import { Client } from './client';

const DEFAULT_PING_INTERVAL = 15 * 1000; // same default as stanza message timeouts
const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;

export interface PingOptions {
  pingInterval?: number;
  failedPingsBeforeDisconnect?: number;
  jid?: string;
}

export class Ping {
  private pingInterval: number;
  private failedPingsBeforeDisconnect: number;
  private numberOfFailedPings: number;
  private nextPingTimeoutId: any;

  constructor (private client: Client, private options: PingOptions = {}) {
    this.pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
    this.failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
    this.numberOfFailedPings = 0;
    this.nextPingTimeoutId = null;
  }

  start () {
    if (!this.nextPingTimeoutId) {
      this.queueNextPing();
    }
  }

  stop () {
    clearTimeout(this.nextPingTimeoutId);
    this.nextPingTimeoutId = null;
    this.numberOfFailedPings = 0;
  }

  private async performPing (): Promise<void> {
    try {
      await this.client._stanzaio.ping(this.options.jid);
      this.numberOfFailedPings = 0;
      this.queueNextPing();
    } catch (err) {
      const info = {
        channelId: this.client.config.channelId,
        jid: this.client._stanzaio.jid
      };
      this.client.logger.warn('Missed a ping.', Object.assign({ error: err }, info));

      /* if we have reached max number of missed pings, disconnect */
      if (++this.numberOfFailedPings > this.failedPingsBeforeDisconnect) {
        this.stop();
        this.client.logger.error('Missed too many pings, disconnecting', Object.assign({ numberOfFailedPings: this.numberOfFailedPings }, info));
        this.client._stanzaio.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
      } else {
        this.queueNextPing();
      }
    }
  }

  private queueNextPing () {
    this.nextPingTimeoutId = setTimeout(this.performPing.bind(this), this.pingInterval);
  }
}
