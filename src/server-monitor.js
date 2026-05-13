'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerMonitor = void 0;
const DEFAULT_STANZA_TIMEOUT = 35 * 1000;
class ServerMonitor {
    constructor(client, stanzaInstance, options = {}) {
        this.client = client;
        this.stanzaInstance = stanzaInstance;
        this.stanzaTimeout = options.stanzaTimeout || DEFAULT_STANZA_TIMEOUT;
        this.timeoutId = undefined;
        this.start();
    }
    start() {
        this.boundSetupStanzaTimeout = this.setupStanzaTimeout.bind(this);
        this.client.on('connected', this.boundSetupStanzaTimeout);
        this.stanzaInstance.on('raw:incoming', this.boundSetupStanzaTimeout);
    }
    stop() {
        clearTimeout(this.timeoutId);
        this.timeoutId = undefined;
        if (this.boundSetupStanzaTimeout) {
            this.client.off('connected', this.boundSetupStanzaTimeout);
            this.stanzaInstance.off('raw:incoming', this.boundSetupStanzaTimeout);
            this.boundSetupStanzaTimeout = undefined;
        }
    }
    setupStanzaTimeout() {
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => {
            var _a;
            const info = {
                channelId: this.client.config.channelId,
                jid: this.stanzaInstance.jid,
                stanzaInstanceId: this.stanzaInstance.id,
                timeout: this.stanzaTimeout
            };
            this.client.logger.error('Time between XMPP stanzas exceeded timeout, disconnecting', info);
            this.stanzaInstance.sendStreamError({ text: 'time between stanzas exceeded timeout', condition: 'connection-timeout' });
            this.stop();
            (_a = this.stanzaInstance.transport) === null || _a === void 0 ? void 0 : _a.disconnect(false);
        }, this.stanzaTimeout);
    }
}
exports.ServerMonitor = ServerMonitor;
