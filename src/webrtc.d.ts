import { EventEmitter } from 'events';
import { IQ } from 'stanza/protocol';
import { LRUCache } from 'lru-cache';
import { SessionManager } from 'stanza/jingle';
import { SessionOpts } from 'stanza/jingle/Session';
import { Client } from './client';
import { ExtendedRTCIceServer, IClientOptions, SessionTypes, IPendingSession, StreamingClientExtension, NRProxyStat, InsightAction } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
import { StanzaMediaSession } from './types/stanza-media-session';
import { IMediaSession } from './types/media-session';
import Logger from 'genesys-cloud-client-logger';
export interface InitRtcSessionOptions {
    stream?: MediaStream;
    provideVideo?: boolean;
    provideAudio?: boolean;
    mediaPurpose?: string;
    jid?: string;
    conversationId?: string;
    sourceCommunicationId?: string;
    videoGuest?: boolean;
}
export declare class WebrtcExtension extends EventEmitter implements StreamingClientExtension {
    client: Client;
    ignoredSessions: LRUCache<string, boolean, unknown>;
    private earlyIceCandidates;
    logger: Logger;
    pendingSessions: {
        [sessionId: string]: IPendingSession;
    };
    config: {
        allowIPv6: boolean;
        optOutOfWebrtcStatsTelemetry?: boolean;
    };
    private statsArr;
    private throttleSendStatsInterval;
    private currentMaxStatSize;
    private statsSizeDecreaseAmount;
    private statBuffer;
    private throttledSendStats;
    private discoRetries;
    private refreshIceServersRetryPromise;
    private refreshIceServersTimer;
    private iceServers;
    private stanzaInstance?;
    private stanzaSessions;
    private webrtcSessions;
    private reinviteCache;
    private sessionsMap;
    get jid(): string | undefined;
    constructor(client: Client, clientOptions: IClientOptions);
    private onOnlineStatusChange;
    handleStanzaInstanceChange(stanzaInstance: NamedAgent): Promise<void>;
    configureNewStanzaInstance(stanzaInstance: NamedAgent): Promise<void>;
    private configureStanzaIceServers;
    private handleGenesysOffer;
    private applyEarlyIceCandidates;
    private handleGenesysRenegotiate;
    private handleGenesysIceCandidate;
    private handleGenesysTerminate;
    private getSessionById;
    sendIq(iq: IQ): Promise<any>;
    handleMessage(msg: any): Promise<void>;
    handleGenesysWebrtcStanza(iq: IQ): Promise<boolean | void>;
    prepareSession(options: SessionOpts): StanzaMediaSession | undefined;
    proxyStatsForSession(session: IMediaSession): void;
    addStatToQueue<T extends {
        _eventType: string;
    }>(stat: InsightAction<T>): void;
    getLogDetailsForPendingSessionId(sessionId: string): {
        conversationId?: string;
        sessionId: string;
        sessionType?: SessionTypes;
    };
    sendStatsImmediately(): void;
    sendStats(): Promise<void>;
    addEventListeners(): void;
    /**
     * Stanza Handlers
     */
    private handlePropose;
    private handleRetract;
    /**
     * Inform the client that another client has already taken care of the pendingSession
     */
    private handledIncomingRtcSession;
    /**
     * Exposed Api
     */
    initiateRtcSession(opts: InitRtcSessionOptions): Promise<any>;
    acceptRtcSession(sessionId: string): Promise<void>;
    rejectRtcSession(sessionId: string, ignore?: boolean): Promise<void>;
    rtcSessionAccepted(sessionId: string): Promise<void>;
    notifyScreenShareStart(session: IMediaSession): Promise<void>;
    notifyScreenShareStop(session: IMediaSession): Promise<void>;
    cancelRtcSession(sessionId: string): Promise<void>;
    refreshIceServers(): Promise<ExtendedRTCIceServer[]>;
    _refreshIceServers(stanzaInstance?: NamedAgent): Promise<ExtendedRTCIceServer[]>;
    setIceServers(iceServers: any[], stanzaInstance: NamedAgent): void;
    getIceTransportPolicy(): RTCIceTransportPolicy | undefined;
    setIceTransportPolicy(policy: 'relay' | 'all', stanzaInstance: NamedAgent): void;
    getSessionTypeByJid(jid: string): SessionTypes;
    getSessionManager(): SessionManager | undefined;
    getAllSessions(): IMediaSession[];
    proxyNRStat(stat: NRProxyStat): void;
    get expose(): WebrtcExtensionAPI;
}
export interface WebrtcExtensionAPI {
    on: (event: string, handler: (...args: any) => void) => void;
    once: (event: string, handler: (...args: any) => void) => void;
    off: (event: string, handler: (...args: any) => void) => void;
    removeAllListeners(event?: string | symbol): void;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): void;
    refreshIceServers(): Promise<any[]>;
    acceptRtcSession(sessionId: string): void;
    rejectRtcSession(sessionId: string, ignore?: boolean): void;
    cancelRtcSession(sessionId: string): void;
    rtcSessionAccepted(sessionId: string): void;
    initiateRtcSession(opts: InitRtcSessionOptions): Promise<void>;
    notifyScreenShareStart(session: IMediaSession): void;
    notifyScreenShareStop(session: IMediaSession): void;
    getSessionTypeByJid(jid: string): SessionTypes;
    getSessionManager: () => SessionManager | undefined;
    getAllSessions: () => IMediaSession[];
    proxyNRStat: (stat: NRProxyStat) => void;
}
