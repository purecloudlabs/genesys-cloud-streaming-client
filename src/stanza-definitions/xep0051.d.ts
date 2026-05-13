import { Stanzas } from 'stanza';
import { DefinitionOptions } from 'stanza/jxt';
declare module 'stanza' {
    interface AgentEvents {
        'iq:set:connectionTransfer': Stanzas.ReceivedIQ & {
            query: ConnectionTransfer;
        };
    }
}
declare module 'stanza/protocol' {
    interface IQPayload {
        query?: ConnectionTransfer;
    }
}
export interface ConnectionTransfer {
    domain?: string;
    server?: string;
}
export declare const connectionTransfer: DefinitionOptions;
