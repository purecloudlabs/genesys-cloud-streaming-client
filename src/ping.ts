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
  private pingIntervalId: any;

  constructor (private client: Client, private options: PingOptions = {}) {
    this.pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
    this.failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
    this.numberOfFailedPings = 0;
    this.pingIntervalId = null;
  }

  private async performPing (): Promise<void> {
    const intervalIdAtStart = this.pingIntervalId;

    try {
      await this.client._stanzaio.ping(this.options.jid);
      this.numberOfFailedPings = 0;

    } catch (err) {
      const info = {
        channelId: this.client.config.channelId,
        jid: this.client._stanzaio.jid
      };

      /* need to check this because we could have already stopped the pinging. In which case, we don't want to count the missed ping */
      if (intervalIdAtStart !== this.pingIntervalId) {
        return this.client.logger.warn('Disregarding a missed ping for an old interval', Object.assign({ error: err }, info));
      }

      this.client.logger.warn('Missed a ping.', Object.assign({ error: err }, info, { intervalIdAtStart, pingIntervalId: this.pingIntervalId }));
      if (++this.numberOfFailedPings > this.failedPingsBeforeDisconnect) {
        this.stop();
        this.client.logger.error('Missed too many pings, disconnecting', Object.assign({ numberOfFailedPings: this.numberOfFailedPings }, info));
        this.client._stanzaio.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
      }
    }
  }

  start () {
    if (this.pingIntervalId === null) {
      this.pingIntervalId = setInterval(this.performPing.bind(this), this.pingInterval);
    }
  }

  stop () {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
      this.numberOfFailedPings = 0;
    }
  }
}
