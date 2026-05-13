import Logger from 'genesys-cloud-client-logger';
import { IClientConfig } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
export declare class ConnectionManager {
    private logger;
    private config;
    currentStanzaInstance?: NamedAgent;
    constructor(logger: Logger, config: IClientConfig);
    setConfig(config: IClientConfig): void;
    getNewStanzaConnection(): Promise<NamedAgent>;
    private handleSessionStarted;
    private handleSessionSasl;
    private handleSessionDisconnected;
    private checkForErrorStanza;
    private getStanzaOptions;
    private getJwtOptions;
    private getStandardOptions;
}
