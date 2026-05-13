'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ping = void 0;
const DEFAULT_PING_INTERVAL = 14 * 1000;
const DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT = 1;
class Ping {
    constructor(client, stanzaInstance, options = {}) {
        this.client = client;
        this.stanzaInstance = stanzaInstance;
        this.options = options;
        this.pingInterval = options.pingInterval || DEFAULT_PING_INTERVAL;
        this.failedPingsBeforeDisconnect = options.failedPingsBeforeDisconnect || DEFAULT_MAXIMUM_FAILED_PINGS_BEFORE_DISCONNECT;
        this.numberOfFailedPings = 0;
        this.nextPingTimeoutId = undefined;
        this.start();
    }
    start() {
        if (!this.nextPingTimeoutId) {
            this.nextPingTimeoutId = -1;
            this.queueNextPing();
        }
    }
    stop() {
        clearTimeout(this.nextPingTimeoutId);
        this.nextPingTimeoutId = undefined;
        this.numberOfFailedPings = 0;
    }
    async performPing() {
        var _a;
        try {
            await this.stanzaInstance.ping(this.options.jid);
            this.numberOfFailedPings = 0;
            this.queueNextPing();
        }
        catch (err) {
            const info = {
                channelId: this.client.config.channelId,
                jid: this.stanzaInstance.jid,
                stanzaInstanceId: this.stanzaInstance.id
            };
            this.client.logger.warn('Missed a ping.', Object.assign({ error: err }, info));
            /* if we have reached max number of missed pings, disconnect */
            if (++this.numberOfFailedPings > this.failedPingsBeforeDisconnect) {
                this.client.logger.error('Missed too many pings, disconnecting', Object.assign({ numberOfFailedPings: this.numberOfFailedPings }, info));
                this.stanzaInstance.sendStreamError({ text: 'too many missed pongs', condition: 'connection-timeout' });
                this.stop();
                (_a = this.stanzaInstance.transport) === null || _a === void 0 ? void 0 : _a.disconnect(false);
            }
            else {
                this.queueNextPing();
            }
        }
    }
    queueNextPing() {
        if (this.nextPingTimeoutId) {
            this.nextPingTimeoutId = setTimeout(this.performPing.bind(this), this.pingInterval);
        }
    }
}
exports.Ping = Ping;
