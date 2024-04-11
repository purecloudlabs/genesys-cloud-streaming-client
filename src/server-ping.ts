'use strict';

import { Client } from './client';
import { NamedAgent } from './types/named-agent';

const DEFAULT_PING_TIMEOUT = 70 * 1000;
const DEFAULT_MAXIMUM_MISSED_PINGS_BEFORE_DISCONNECT = 1;

export interface ServerPingOptions {
  pingTimeout?: number;
  missedPingsBeforeDisconnect?: number;
  jid?: string;
}

export class ServerPing {
  private pingTimeout: number;
  private missedPingsBeforeDisconnect: number;
  private numberOfMissedPings: number;

  private timeoutId?: number;

  constructor (private client: Client, private stanzaInstance: NamedAgent, private options: ServerPingOptions = {}) {
    this.pingTimeout = options.pingTimeout || DEFAULT_PING_TIMEOUT;
    this.missedPingsBeforeDisconnect = options.missedPingsBeforeDisconnect || DEFAULT_MAXIMUM_MISSED_PINGS_BEFORE_DISCONNECT;

    this.numberOfMissedPings = 0;
    this.timeoutId = undefined;
    console.log('Hjon: setting up ping timeout');

    this.start();
  }

  start () {
    this.client.on('connected', () => {
      this.setupPingTimeout();
    });

    this.stanzaInstance.on('iq:get:ping', iq => {
      clearTimeout(this.timeoutId);
      this.setupPingTimeout();
    });
  }

  stop () {
    clearTimeout(this.timeoutId);
    this.timeoutId = undefined;
  }

  private setupPingTimeout () {
    this.timeoutId = setTimeout(() => {
      console.log('Hjon: timeout fired');

      this.stanzaInstance.sendStreamError({ text: 'too many missed pings', condition: 'connection-timeout' });
    }, this.pingTimeout) as unknown as number;
  }
}
