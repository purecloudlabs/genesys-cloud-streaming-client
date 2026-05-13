import { Client } from './client';
import { NamedAgent } from './types/named-agent';
export interface ServerMonitorOptions {
    stanzaTimeout?: number;
}
export declare class ServerMonitor {
    private client;
    private stanzaInstance;
    private stanzaTimeout;
    private timeoutId?;
    private boundSetupStanzaTimeout?;
    constructor(client: Client, stanzaInstance: NamedAgent, options?: ServerMonitorOptions);
    private start;
    stop(): void;
    private setupStanzaTimeout;
}
