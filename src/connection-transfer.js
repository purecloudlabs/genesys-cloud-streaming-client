"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionTransfer = void 0;
const xep0051_1 = require("./stanza-definitions/xep0051");
class ConnectionTransfer {
    constructor(client, stanzaInstance) {
        this.client = client;
        this.stanzaInstance = stanzaInstance;
        stanzaInstance.stanzas.define(xep0051_1.connectionTransfer);
        // Hawk maps `v2.system.socket_closing` to XEP-0051 Connection Transfer
        // The docs says we have up to one minute to disconnect and connect a new WebSocket, so we should be proactive in reconnecting.
        stanzaInstance.on('iq:set:connectionTransfer', (iq) => {
            client.logger.warn('connection transfer (socket_closing) event received', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
            void client.disconnect();
            client.emit('disconnected', { reconnecting: true });
            void client.connect({ keepTryingOnFailure: true });
        });
    }
}
exports.ConnectionTransfer = ConnectionTransfer;
