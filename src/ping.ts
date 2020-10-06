'use strict';

import { Client } from './client';

const DEFAULT_PING_INTERVAL = 10 * 1000;
const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;

export interface PingOptions {
  pingInterval?: number;
  failedPingsBeforeDisconnect?: number;
  jid?: string;
}

export default function (client: Client, options: PingOptions = {}) {
  let pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
  let failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
  let numberOfFailedPings = 0;
  let pingIntervalId: any = null;

  async function performPing (): Promise<void> {
    try {
      await client._stanzaio.ping(options.jid);
      numberOfFailedPings = 0;

    } catch (err) {
      const info = {
        channelId: client.config.channelId,
        jid: client._stanzaio.jid
      };
      client.logger.warn('Missed a ping.', Object.assign({ error: err }, info));
      if (++numberOfFailedPings > failedPingsBeforeDisconnect) {
        clearInterval(pingIntervalId);
        client.logger.error('Missed too many pings, disconnecting', Object.assign({ numberOfFailedPings }, info));
        client._stanzaio.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
      }
    }
  }

  return {
    start () {
      if (pingIntervalId === null) {
        pingIntervalId = setInterval(performPing, pingInterval);
      }
    },
    stop () {
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
    }
  };
}
