'use strict';

const DEFAULT_PING_INTERVAL = 5000;
const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;

module.exports = function (stanzaClient, options) {
  options = options || {};
  let logger = options.logger || console;
  let pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
  let failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
  let numberOfFailedPings = 0;
  let pingIntervalId = null;

  function pingCallback (error, response) {
    if (response && !error) {
      numberOfFailedPings = 0;
    } else {
      logger.warn('Missed a ping.', error);
      if (++numberOfFailedPings > failedPingsBeforeDisconnect) {
        logger.error('Missed ' + numberOfFailedPings + ' pings, disconnecting');
        stanzaClient.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
      }
    }
  }

  function performPing () {
    stanzaClient.ping(options.jid, pingCallback);
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
};
