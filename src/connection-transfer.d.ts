import { Client } from './client';
import { NamedAgent } from './types/named-agent';
export declare class ConnectionTransfer {
    private client;
    private stanzaInstance;
    constructor(client: Client, stanzaInstance: NamedAgent);
}
