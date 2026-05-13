import { IClientOptions, ILeaderStatus, StreamingClientExtension } from './types/interfaces';
import { Client } from './client';
import { EventEmitter } from 'events';
import { NamedAgent } from './types/named-agent';
export declare class AlertingLeaderExtension extends EventEmitter implements StreamingClientExtension {
    private client;
    private connectionId?;
    private alertableInteractionTypes;
    private abortController?;
    private leaderStatus;
    constructor(client: Client, options: IClientOptions);
    handleStanzaInstanceChange(stanzaInstance: NamedAgent): void;
    private setupAlertingLeader;
    private subscribeToAlertingLeader;
    private markAsAlertable;
    private getAlertingLeader;
    private claimAlertingLeader;
    get expose(): AlertingLeaderApi;
}
export interface AlertingLeaderApi {
    on: (event: string, handler: (...args: any) => void) => void;
    off: (event: string, handler: (...args: any) => void) => void;
    claimAlertingLeader(): Promise<void>;
    leaderStatus: ILeaderStatus;
}
