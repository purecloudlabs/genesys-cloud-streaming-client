import { Logger } from 'genesys-cloud-client-logger';
import './polyfills';
import { AlertingLeaderExtension, AlertingLeaderApi } from './alerting-leader';
import { Notifications, NotificationsAPI } from './notifications';
import { WebrtcExtension, WebrtcExtensionAPI } from './webrtc';
import { Ping } from './ping';
import { StreamingClientExtension } from './types/streaming-client-extension';
import { HttpClient } from './http-client';
import { IClientOptions, IClientConfig, StreamingClientConnectOptions } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
import EventEmitter from 'events';
import { MessengerExtensionApi, MessengerExtension } from './messenger';
export declare class Client extends EventEmitter {
    activeStanzaInstance?: NamedAgent;
    connected: boolean;
    connecting: boolean;
    hardReconnectRequired: boolean;
    reconnectOnNoLongerSubscribed: boolean;
    useServerSidePings: boolean;
    logger: Logger;
    config: IClientConfig;
    isGuest: boolean;
    backgroundAssistantMode: boolean;
    private autoReconnect;
    private cancelConnectionAttempt;
    private extensions;
    private connectionManager;
    private channelReuses;
    private backoffReductionTimer;
    private hasMadeInitialAttempt;
    private jidResource;
    private boundStanzaDisconnect?;
    private boundStanzaNoLongerSubscribed?;
    private boundStanzaDuplicateId?;
    http: HttpClient;
    notifications: NotificationsAPI;
    _notifications: Notifications;
    webrtcSessions: WebrtcExtensionAPI;
    _webrtcSessions: WebrtcExtension;
    messenger: MessengerExtension;
    _messenger: MessengerExtensionApi;
    alertingLeader: AlertingLeaderApi;
    _alertingLeader: AlertingLeaderExtension;
    _ping: Ping;
    constructor(options: IClientOptions);
    private handleSendEventFromExtension;
    private checkIsBackgroundAssistant;
    private addInateEventHandlers;
    private removeStanzaBoundEventHandlers;
    private proxyStanzaEvents;
    private handleStanzaDisconnectedEvent;
    private handleNoLongerSubscribed;
    private handleDuplicateId;
    disconnect(): Promise<any>;
    private getSessionStoreKey;
    private getConnectionData;
    private setConnectionData;
    private increaseBackoff;
    private decreaseBackoff;
    private getStartingDelay;
    connect(connectOpts?: StreamingClientConnectOptions): Promise<void>;
    private backoffConnectRetryHandler;
    private networkErrorNeedsAuth;
    private saslErrorIsRetryable;
    /**
     * Performs an active network connectivity check by querying the API.
     * navigator.onLine is unreliable (VPNs, virtual adapters, etc.), so we
     * actually reach out to verify we can talk to the server.
     *
     * Returns true if connectivity is confirmed, false otherwise.
     * This is advisory only — it does not gate connection attempts.
     */
    checkNetworkConnectivity(): Promise<boolean>;
    private makeConnectionAttempt;
    private setupConnectionMonitoring;
    private prepareForConnect;
    stopServerLogging(): void;
    startServerLogging(): void;
    setAccessToken(token: string): void;
    static extend(namespace: any, extension: StreamingClientExtension | ((client: Client) => void)): void;
    get version(): string;
    static get version(): string;
}
