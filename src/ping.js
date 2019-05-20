'use strict';

const DEFAULT_PING_INTERVAL = 10 * 1000;
const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;

export function createPing (client, options) {
  options = options || {};
  let pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
  let failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
  let numberOfFailedPings = 0;
  let pingIntervalId = null;

  function pingCallback (error, response) {
    if (response && !error) {
      numberOfFailedPings = 0;
    } else {
      client.logger.warn('Missed a ping.', error);
      if (++numberOfFailedPings > failedPingsBeforeDisconnect) {
        clearInterval(pingIntervalId);
        client.logger.error('Missed too many pings, disconnecting', numberOfFailedPings);
        client._stanzaio.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
      }
    }
  }

  function performPing () {
    client._stanzaio.ping(options.jid, pingCallback);
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
