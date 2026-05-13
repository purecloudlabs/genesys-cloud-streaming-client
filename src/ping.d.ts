import { Client } from './client';
import { NamedAgent } from './types/named-agent';
export interface PingOptions {
    pingInterval?: number;
    failedPingsBeforeDisconnect?: number;
    jid?: string;
}
export declare class Ping {
    private client;
    private stanzaInstance;
    private options;
    private pingInterval;
    private failedPingsBeforeDisconnect;
    private numberOfFailedPings;
    private nextPingTimeoutId;
    constructor(client: Client, stanzaInstance: NamedAgent, options?: PingOptions);
    start(): void;
    stop(): void;
    private performPing;
    private queueNextPing;
}
