import { ReceivedMessage } from 'stanza/protocol';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';
import { GenesysMediaMessage, StreamingClientExtension } from './types/interfaces';
import { Emitter } from 'strict-event-emitter';
type MessageWithMediaMessage = {
    from?: string;
    id?: string;
    to?: string;
    mediaMessage: GenesysMediaMessage;
};
export type MediaMessageEvent = MessageWithMediaMessage & {
    fromMyUser: boolean;
    fromMyClient: boolean;
};
export type MessengerEvents = {
    mediaMessage: [MediaMessageEvent];
};
export declare class MessengerExtension extends Emitter<MessengerEvents> implements StreamingClientExtension {
    private client;
    private stanzaInstance;
    constructor(client: Client, stanzaInstance: NamedAgent);
    get bareJid(): string;
    handleStanzaInstanceChange(stanzaInstance: NamedAgent): void;
    isMediaMessage(msg: any): msg is MessageWithMediaMessage;
    handleMessage(msg: ReceivedMessage): void;
    /**
     * @param msg
     * @returns Promise<messageId>
     */
    broadcastMessage(msg: MessageWithMediaMessage): Promise<string>;
    get expose(): MessengerExtensionApi;
}
export interface MessengerExtensionApi extends Pick<Emitter<MessengerEvents>, 'on' | 'off' | 'once' | 'addListener' | 'removeListener'> {
    broadcastMessage(msg: MessageWithMediaMessage): Promise<string>;
}
export {};
