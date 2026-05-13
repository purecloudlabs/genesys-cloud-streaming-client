"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SaslError extends Error {
    constructor(condition, channelId, stanzaInstanceId) {
        super();
        this.condition = condition;
        this.channelId = channelId;
        this.stanzaInstanceId = stanzaInstanceId;
        this.name = 'SaslError';
    }
}
exports.default = SaslError;
