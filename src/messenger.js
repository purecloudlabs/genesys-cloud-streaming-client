'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessengerExtension = void 0;
const strict_event_emitter_1 = require("strict-event-emitter");
const JID_1 = require("stanza/JID");
const uuid_1 = require("uuid");
class MessengerExtension extends strict_event_emitter_1.Emitter {
    constructor(client, stanzaInstance) {
        super();
        this.client = client;
        this.stanzaInstance = stanzaInstance;
    }
    get bareJid() {
        return (0, JID_1.toBare)(this.stanzaInstance.jid);
    }
    handleStanzaInstanceChange(stanzaInstance) {
        this.stanzaInstance = stanzaInstance;
    }
    isMediaMessage(msg) {
        return !!msg.mediaMessage;
    }
    handleMessage(msg) {
        if (!this.isMediaMessage(msg)) {
            return;
        }
        const fromMyClient = msg.from === this.stanzaInstance.jid;
        const fromMyUser = (0, JID_1.toBare)(msg.from) === this.bareJid;
        this.emit('mediaMessage', { ...msg, fromMyClient, fromMyUser });
    }
    /**
     * @param msg
     * @returns Promise<messageId>
     */
    async broadcastMessage(msg) {
        const id = (0, uuid_1.v4)();
        msg.id = id;
        msg.from = this.stanzaInstance.jid;
        if (!msg.to) {
            msg.to = this.bareJid;
        }
        await this.stanzaInstance.send('message', msg);
        return id;
    }
    get expose() {
        return {
            broadcastMessage: this.broadcastMessage.bind(this),
            on: this.on.bind(this),
            once: this.once.bind(this),
            off: this.off.bind(this),
            removeListener: this.removeListener.bind(this),
            addListener: this.addListener.bind(this)
        };
    }
}
exports.MessengerExtension = MessengerExtension;
