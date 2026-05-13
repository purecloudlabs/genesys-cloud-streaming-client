import { DefinitionOptions } from 'stanza/jxt';
import { Stanzas } from 'stanza';
import { GenesysMediaMessage, GenesysWebrtcJsonRpcMessage } from '../types/interfaces';
export interface Propose {
    sessionId: string;
    conversationId: string;
    autoAnswer: boolean;
    persistentConversationId?: string;
    originalRoomJid?: string;
    fromUserId?: string;
    sdpOverXmpp?: boolean;
    privAnswerMode?: 'Auto';
}
declare module 'stanza/protocol' {
    interface IQPayload {
        genesysWebrtc?: GenesysWebrtcJsonRpcMessage;
    }
    interface ReceivedMessage {
        mediaMessage?: GenesysMediaMessage;
    }
}
declare module 'stanza' {
    interface AgentEvents {
        'iq:set:genesysWebrtc': Stanzas.ReceivedIQ & {
            genesysWebrtc: GenesysWebrtcJsonRpcMessage;
        };
    }
}
export declare const definitions: DefinitionOptions<any>[];
