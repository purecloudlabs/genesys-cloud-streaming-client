import { EventEmitter } from 'events';
import { ExternalService, ExternalServiceList, IQ, ReceivedMessage } from 'stanza/protocol';
import { toBare } from 'stanza/JID';
import { LRUCache } from 'lru-cache';
import { JingleAction } from 'stanza/Constants';
import { SessionManager } from 'stanza/jingle';
import { v4 } from 'uuid';
import { StatsEvent } from 'webrtc-stats-gatherer';
import throttle from 'lodash.throttle';
import JingleSession, { SessionOpts } from 'stanza/jingle/Session';
import { isFirefox } from 'browserama';

import { definitions, Propose } from './stanza-definitions/webrtc-signaling';
import { isAcdJid, isScreenRecordingJid, isSoftphoneJid, isVideoJid, calculatePayloadSize, retryPromise, RetryPromise, getUfragFromSdp, iceIsDifferent } from './utils';
import { Client } from './client';
import { deepFlatten, formatStatsEvent } from './stats-formatter';
import { ExtendedRTCIceServer, IClientOptions, SessionTypes, IPendingSession, StreamingClientExtension, GenesysWebrtcSdpParams, GenesysSessionTerminateParams, GenesysWebrtcOfferParams, NRProxyStat, FirstProposeStat, InsightActionDetails, InsightReport, InsightAction, FlatObject, OnlineStatusStat } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
import { StanzaMediaSession } from './types/stanza-media-session';
import { IGenesysCloudMediaSessionParams, IMediaSession, IStanzaMediaSessionParams, SessionEvents } from './types/media-session';
import { GenesysCloudMediaSession } from './types/genesys-cloud-media-session';
import Logger from 'genesys-cloud-client-logger';
import { HttpClient } from './http-client';

const events = {
  REQUEST_WEBRTC_DUMP: 'requestWebrtcDump', // dump triggered by someone in room

  /* jingle messaging */
  REQUEST_INCOMING_RTCSESSION: 'requestIncomingRtcSession', // incoming call
  CANCEL_INCOMING_RTCSESSION: 'cancelIncomingRtcSession', // retracted (caller hungup before you answered)
  HANDLED_INCOMING_RTCSESSION: 'handledIncomingRtcSession', // you answered on another client
  OUTGOING_RTCSESSION_PROCEED: 'outgoingRtcSessionProceed', // target answered, wants to continue
  OUTGOING_RTCSESSION_REJECTED: 'outgoingRtcSessionRejected', // target rejected the call

  // /* jingle */
  // RTC_ICESERVERS: 'rtcIceServers', // ice servers have been discovered
  INCOMING_RTCSESSION: 'incomingRtcSession', // jingle session created for incoming call
  OUTGOING_RTCSESSION: 'outgoingRtcSession', // jingle session created for outgoing call
  RTCSESSION_ERROR: 'rtcSessionError' // jingle error occurred
  // TRACE_RTCSESSION: 'traceRtcSession', // trace messages for logging, etc
  // UPGRADE_MEDIA_ERROR: 'upgradeMediaError', // error occurred joining conference

  // /* other  */
  // UPDATE_MEDIA_PRESENCE: 'updateMediaPresence',
  // LASTN_CHANGE: 'lastNChange'
};

const desiredMaxStatsSize = 15000;
const MAX_DISCO_RETRIES = 2;
const ICE_SERVER_TIMEOUT = 15000; // 15 seconds
const ICE_SERVER_REFRESH_PERIOD = 1000 * 60 * 60 * 6; // 6 hours

type ProposeStanza = ReceivedMessage & { propose: Propose };

export interface InitRtcSessionOptions {
  stream?: MediaStream;
  provideVideo?: boolean;
  provideAudio?: boolean;
  mediaPurpose?: string;
  jid?: string;
  conversationId?: string;
  sourceCommunicationId?: string;
}

export class WebrtcExtension extends EventEmitter implements StreamingClientExtension {
  client: Client;
  // sessionId maps to boolean where `true` means the sessionId is ignored
  ignoredSessions = new LRUCache<string, boolean>({ max: 10, ttl: 10 * 60 * 60 * 6 });

  // sessionId maps to a list of sdp ice candidates
  // hold onto early candidates for 1 minute
  private earlyIceCandidates = new LRUCache<string, string[]>({ max: 10, ttl: 1000 * 60, ttlAutopurge: true });

  logger: any;
  pendingSessions: { [sessionId: string]: IPendingSession } = {};
  config: {
    allowIPv6: boolean;
    optOutOfWebrtcStatsTelemetry?: boolean;
  };
  private statsArr: InsightActionDetails<any>[] = [];
  private throttleSendStatsInterval = 25000;
  private currentMaxStatSize = desiredMaxStatsSize;
  private statsSizeDecreaseAmount = 3000;
  private statBuffer = 0;
  private throttledSendStats: any;
  private discoRetries = 0;
  private refreshIceServersRetryPromise: RetryPromise<ExtendedRTCIceServer[]> | undefined;
  private refreshIceServersTimer: any;
  private iceServers: RTCIceServer[] = [];
  private stanzaInstance?: NamedAgent;
  private stanzaSessions: StanzaMediaSession[] = [];
  private webrtcSessions: GenesysCloudMediaSession[] = [];
  // Store a maximum of 5 previous non-duplicate reinvites.
  // These will automatically be purged after three minutes.
  private reinviteCache = new LRUCache<string, boolean>({
    max: 5,
    ttl: 1000 * 60 * 3
  });
  private sessionsMap: { [sessionId: string]: boolean } = {};

  get jid (): string | undefined {
    return this.stanzaInstance?.jid;
  }

  constructor (client: Client, clientOptions: IClientOptions) {
    super();
    this.client = client;
    this.config = {
      allowIPv6: clientOptions.allowIPv6 === true,
      optOutOfWebrtcStatsTelemetry: clientOptions.optOutOfWebrtcStatsTelemetry
    };

    this.logger = client.logger;
    this.addEventListeners();
    this.throttledSendStats = throttle(
      this.sendStats.bind(this),
      this.throttleSendStatsInterval,
      { leading: false, trailing: true }
    );

    this.client.on('jingle:outgoing', (session: JingleSession) => {
      this.logger.info('Emitting jingle:outgoing media-session (session-init)', session.sid);
      return this.emit(events.OUTGOING_RTCSESSION, session);
    });

    this.client.on('jingle:incoming', (session: JingleSession) => {
      this.logger.info('Emitting jingle:incoming media-session (session-init)', session.sid);
      return this.emit(events.INCOMING_RTCSESSION, session);
    });

    this.client.on('jingle:created', (session: JingleSession) => {
      // if this is not a JingleSession, this is a generic BaseSession from jingle, aka dummy session.
      // in this case, we can just kill this session because we will be using
      if (!(session instanceof StanzaMediaSession)) {
        session.end('cancel', true);
      }
    });

    window.addEventListener('offline', () => this.onOnlineStatusChange(false));
    window.addEventListener('online', () => this.onOnlineStatusChange(true));
  }

  private onOnlineStatusChange (online: boolean) {
    this.addStatToQueue({
      actionName: 'WebrtcStats',
      details: {
        _eventType: 'onlineStatus',
        _eventTimestamp: new Date().getTime(),
        online,
      }
    } as OnlineStatusStat);
  }

  async handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.stanzaInstance = stanzaInstance;

    // We create a new Stanza instance every time we connect. If we still have active StanzaMediaSessions,
    // the new instance doesn't know about them and won't properly process actions for those sessions
    // (e.g. it will reply to a `session-terminate`, but the session itself won't receive that action,
    // because Stanza doesn't know about it). Since we track those sessions ourselves, we can tell
    // the new Stanza instance about them so those actions will be processed properly.
    const sessionsMap = this.stanzaSessions.reduce((currentMap, session) => {
      session.parent = stanzaInstance.jingle;
      return { ...currentMap, [session.id]: session };
    }, {});
    this.stanzaInstance.jingle.sessions = sessionsMap;

    if (this.refreshIceServersTimer) {
      clearInterval(this.refreshIceServersTimer);
      this.refreshIceServersTimer = null;
    }

    stanzaInstance.on('iq:set:genesysWebrtc' as any, this.handleGenesysWebrtcStanza.bind(this));

    this.refreshIceServersTimer = setInterval(this.refreshIceServers.bind(this), ICE_SERVER_REFRESH_PERIOD);

    this.client.emit('sessionManagerChange', stanzaInstance);
  }

  async configureNewStanzaInstance (stanzaInstance: NamedAgent) {
    Object.assign(stanzaInstance.jingle.config.peerConnectionConfig!, {
      sdpSemantics: 'unified-plan'
    });

    await this.configureStanzaIceServers(stanzaInstance);

    stanzaInstance.stanzas.define(definitions);
    stanzaInstance.jingle.prepareSession = this.prepareSession.bind(this);

    stanzaInstance.jingle.on('log', (level, message, data?) => {
      this.logger[level](message, data);
    });

    const eventsToProxy: Array<keyof SessionEvents> = [
      'iceConnectionType',
      'peerTrackAdded',
      'peerTrackRemoved',
      'mute',
      'unmute',
      'sessionState',
      'connectionState',
      'terminated',
      'stats',
      'endOfCandidates'
    ];
    for (const e of eventsToProxy) {
      stanzaInstance.jingle.on(
        e as string,
        (session: JingleSession | StanzaMediaSession, ...data: any) => {
          if (!(session instanceof StanzaMediaSession)) {
            return;
          }

          session.emit(e as any, ...data);
        }
      );
    }
  }

  private configureStanzaIceServers (stanzaInstance: NamedAgent) {
    /* clear out stanzas default use of google's stun server */
    stanzaInstance.jingle.config.iceServers = [];

    /**
     * NOTE: calling this here should not interfere with the `webrtc.ts` extension
     *  refreshingIceServers since that is async and this constructor is sync
     */
    this.setIceServers([], stanzaInstance);

    return this._refreshIceServers(stanzaInstance);
  }

  private async handleGenesysOffer (iq: IQ) {
    const message = iq.genesysWebrtc!;
    const params = message.params as GenesysWebrtcOfferParams;

     // XMPP-SIP-Gateway will repeat reinvite offers until the client has responded.
     // We don't want to process the duplicate reinvites and instead will ignore them.
    if (params.reinvite && this.reinviteCache.get(message.id!)) {
      this.logger.info('Ignoring duplicate reinvite offer', message.id);
      return;
    }

    // If the reinvite isn't a duplicate, we should cache it so we can check against new offers.
    if (params.reinvite) {
      this.reinviteCache.set(message.id!, true);
    }

    const ignoreHostCandidatesForForceTurnFF = this.getIceTransportPolicy() === 'relay' && isFirefox;

    const commonParams = {
      id: params.sessionId,
      logger: this.logger,
      peerID: iq.from!,
      fromJid: iq.from!,
      sessionType: this.getSessionTypeByJid(iq.from!),
      conversationId: params.conversationId,
      ignoreHostCandidatesFromRemote: ignoreHostCandidatesForForceTurnFF,
      optOutOfWebrtcStatsTelemetry: !!this.config.optOutOfWebrtcStatsTelemetry,
      allowIPv6: this.config.allowIPv6,
      iceServers: this.iceServers,
      reinvite: !!params.reinvite,
      iceTransportPolicy: this.getIceTransportPolicy()!
    };

    let mediaSessionParams: IGenesysCloudMediaSessionParams;

    // we should only do something if the pending session tells us to
    const pendingSession = this.pendingSessions[params.sessionId];
    if (pendingSession) {
      mediaSessionParams = {
        ...commonParams,
        meetingId: pendingSession.meetingId,
        fromUserId: pendingSession.fromUserId,
        originalRoomJid: pendingSession.originalRoomJid,
        privAnswerMode: pendingSession.privAnswerMode
      };
      delete this.pendingSessions[pendingSession.sessionId];
    } else {
      mediaSessionParams = commonParams;
    }

    // if we receive an offer for an existing session and the ice info has not changed, this is
    // a renogotiate. If the ice has changed, it's a re-invite and we need to create a new session.
    const existingSession = this.webrtcSessions.find(s => s.id === mediaSessionParams.id);
    this.logger.info('offer received', { existingSession: !!existingSession, mediaSessionParams });

    if (existingSession) {
      existingSession.conversationId = params.conversationId;
      // renego
      if (!iceIsDifferent(existingSession.peerConnection.remoteDescription!.sdp, params.sdp)) {
        return this.handleGenesysRenegotiate(existingSession, params.sdp);
      }
    }

    // reinvite/new session handled the same way here
    const session = new GenesysCloudMediaSession(this, mediaSessionParams);

    await session.setRemoteDescription(params.sdp);
    this.proxyStatsForSession(session);

    session.on('sendIq' as any, (iq: IQ) => this.stanzaInstance?.sendIQ(iq));
    session.on('terminated', () => {
      delete this.sessionsMap[session.id];
      this.webrtcSessions = this.webrtcSessions.filter(s => s.id !== session.id);
    });

    this.webrtcSessions.push(session);
    this.logger.info('emitting sdp media-session (offer');

    this.applyEarlyIceCandidates(session);

    return this.emit(events.INCOMING_RTCSESSION, session);
  }

  private applyEarlyIceCandidates (session: GenesysCloudMediaSession) {
    const earlyCandidates = this.earlyIceCandidates.get(session.id);
    if (earlyCandidates) {
      this.earlyIceCandidates.delete(session.id);
      for (const candidate of earlyCandidates) {
        void session.addRemoteIceCandidate(candidate);
      }
    }
  }

  private async handleGenesysRenegotiate (existingSession: GenesysCloudMediaSession, newSdp: string) {
    await existingSession.peerConnection.setRemoteDescription({ sdp: newSdp, type: 'offer' });
    await existingSession.accept();
  }

  private async handleGenesysIceCandidate (iq: IQ) {
    const message = iq.genesysWebrtc!;
    const params: GenesysWebrtcSdpParams = message.params as GenesysWebrtcSdpParams;

    const session = this.getSessionById(params.sessionId, true);

    if (session) {
      await (session as GenesysCloudMediaSession).addRemoteIceCandidate(params.sdp);
    } else {
      const earlyCandidates = this.earlyIceCandidates.get(params.sessionId);
      if (earlyCandidates) {
        this.earlyIceCandidates.set(params.sessionId, [...earlyCandidates, params.sdp]);
      } else {
        this.earlyIceCandidates.set(params.sessionId, [params.sdp]);
      }
    }
  }

  private async handleGenesysTerminate (iq: IQ) {
    const message = iq.genesysWebrtc!;
    const params: GenesysSessionTerminateParams = message.params as GenesysSessionTerminateParams;

    const session = this.getSessionById(params.sessionId);
    (session as GenesysCloudMediaSession).onSessionTerminate(params.reason);
  }

  private getSessionById (id: string, nullIfNotFound = false): IMediaSession | undefined {
    const session = this.getAllSessions().find(session => session.id === id);

    if (!session && !nullIfNotFound) {
      const error = new Error('Failed to find session by id');
      this.logger.error(error, { sessionId: id });
      throw error;
    }

    return session;
  }

  async sendIq (iq: IQ): Promise<any> {
    if (!this.stanzaInstance) {
      throw new Error('Failed to send iq because there was no stanza instance');
    }
    return this.stanzaInstance.sendIQ(iq);
  }

  async handleMessage (msg) {
    if (msg.propose) {
      await this.handlePropose(msg);
    } else if (msg.retract) {
      this.handleRetract(msg.retract.sessionId);
    } else if (msg.accept) {
      this.handledIncomingRtcSession(msg.accept.sessionId, msg);
    } else if (msg.reject) {
      this.handledIncomingRtcSession(msg.reject.sessionId, msg);
    }
  }

  async handleGenesysWebrtcStanza (iq: IQ) {
    const webrtcInfo = iq.genesysWebrtc!;

    if (webrtcInfo.method === 'offer') {
      return this.handleGenesysOffer(iq);
    } else if (webrtcInfo.method === 'iceCandidate') {
      return this.handleGenesysIceCandidate(iq);
    } else if (webrtcInfo.method === 'terminate') {
      return this.handleGenesysTerminate(iq);
    }
  }

  prepareSession (options: SessionOpts): StanzaMediaSession | undefined {
    if (options.sid && this.sessionsMap[options.sid]) {
      this.logger.debug('skipping creation of jingle webrtc session due to sdpOverXmpp');
      return;
    }

    const pendingSession = this.pendingSessions[options.sid!];
    if (pendingSession) {
      delete this.pendingSessions[pendingSession.sessionId];
      delete this.sessionsMap[pendingSession.sessionId];
    }

    const ignoreHostCandidatesForForceTurnFF = this.getIceTransportPolicy() === 'relay' && isFirefox;

    const gcSessionOpts: IStanzaMediaSessionParams = {
      options,
      logger: this.logger,
      id: options.sid!,
      fromJid: options.peerID,
      peerID: options.peerID,
      optOutOfWebrtcStatsTelemetry: !!this.config.optOutOfWebrtcStatsTelemetry,
      conversationId: pendingSession?.conversationId,
      fromUserId: pendingSession?.fromJid,
      originalRoomJid: pendingSession?.originalRoomJid,
      sessionType: pendingSession?.sessionType,
      allowIPv6: this.config.allowIPv6,
      ignoreHostCandidatesFromRemote: ignoreHostCandidatesForForceTurnFF,
      meetingId: pendingSession?.meetingId
    };

    const session = new StanzaMediaSession(gcSessionOpts);
    this.proxyStatsForSession(session);

    this.stanzaSessions.push(session);
    session.on('terminated', () => {
      delete this.sessionsMap[session.id];
      this.stanzaSessions = this.stanzaSessions.filter(s => s.id !== session.id);
    });

    return session;
  }

  // This should probably go into the webrtc sdk, but for now I'm putting here so it's in a central location.
  // This should be moved when the sdk is the primary consumer
  proxyStatsForSession (session: IMediaSession) {
    session.on('stats', (statsEvent: StatsEvent) => {
      const statsCopy = JSON.parse(JSON.stringify(statsEvent));
      const extraDetails = {
        conversationId: (session as any).conversationId,
        sessionId: session.id,
        sessionType: session.sessionType
      };

      // format the event to what the api expects
      const event = formatStatsEvent(statsCopy, extraDetails);

      this.addStatToQueue(event);
    });
  }

  // this fn checks to see if the new stat fits inside the buffer. If not, send the queue;
  addStatToQueue<T extends {_eventType: string}> (stat: InsightAction<T>): void {
    if (this.config.optOutOfWebrtcStatsTelemetry) {
      return;
    }

    if (!stat.details._appId) {
      stat.details._appId = (this.logger as Logger).clientId;
      stat.details._appName = 'streamingclient';
      stat.details._appVersion = Client.version;
    }

    (stat.details as any)._originAppId = this.client.config.appId;

    // nr only accepts single level objects so we must flatten everything just in case
    const flattenedDetails: FlatObject = deepFlatten(stat.details);

    // new relic doesn't accept booleans so we convert them to strings
    Object.keys(flattenedDetails).forEach((key) => {
      const val = flattenedDetails[key];
      if (typeof val === 'boolean') {
        flattenedDetails[key] = `${val}`;
      }
    });

    const formattedStat = {
      ...stat,
      details: flattenedDetails
    };

    const currentEventSize = calculatePayloadSize(formattedStat);
    // Check if the size of the current event plus the size of the previous stats exceeds max size.
    const exceedsMaxStatSize =
      this.statBuffer + currentEventSize > this.currentMaxStatSize;

    this.statsArr.push(formattedStat);
    this.statBuffer += currentEventSize;

    // If it exceeds max size, don't append just send current payload.
    if (exceedsMaxStatSize) {
      this.sendStatsImmediately();
    } else {
      this.throttledSendStats();
    }
  }

  getLogDetailsForPendingSessionId (sessionId: string): { conversationId?: string, sessionId: string, sessionType?: SessionTypes } {
    const logDetails: any = {
      sessionId
    };

    const pendingSession = this.pendingSessions[sessionId];
    if (pendingSession) {
      logDetails.sessionType = pendingSession.sessionType;
      logDetails.conversationId = pendingSession.conversationId;
    }

    return logDetails;
  }

  sendStatsImmediately () {
    // `throttledSendStats` needs to have a scheduled exeuction for `flush` to invoke the throttled function
    this.throttledSendStats();
    this.throttledSendStats.flush();
  }

  async sendStats () {
    if (!navigator.onLine) {
      return;
    }

    const statsToSend: InsightActionDetails<any>[] = [];
    let currentSize = 0;

    for (const stats of this.statsArr) {
      const statSize = calculatePayloadSize(stats);
      if (currentSize + statSize < this.currentMaxStatSize) {
        statsToSend.push(stats);
        currentSize += statSize;
      } else {
        break;
      }
    }

    this.statsArr.splice(0, statsToSend.length);
    this.statBuffer = this.statsArr.reduce(
      (currentSize, stats) => currentSize + calculatePayloadSize(stats),
      0
    );

    if (!statsToSend.length || this.client.isGuest) {
      return;
    }

    const data: InsightReport = {
      appName: 'streamingclient',
      appVersion: Client.version,
      originAppName: this.client.config.appName,
      originAppVersion: this.client.config.appVersion,
      actions: statsToSend
    };

    // At least for now, we'll just fire and forget. Since this is non-critical, we'll not retry failures
    try {
      let authToken = this.client.config.authToken;
      let url = 'diagnostics/newrelic/insights';

      if (this.client.backgroundAssistantMode) {
        authToken = this.client.config.jwt;
        url += '/backgroundassistant';
      }

      await this.client.http.requestApi(url, {
        method: 'post',
        responseType: 'text',
        host: this.client.config.apiHost,
        authToken,
        logger: this.client.logger,
        data
      });
      this.currentMaxStatSize = desiredMaxStatsSize;
    } catch (err: any) {
      // re-add the stats to the buffer
      if (HttpClient.retryStatusCodes.has(err.response?.status) || !navigator.onLine) {
        this.statsArr = [...statsToSend, ...this.statsArr];
        this.statBuffer = this.statsArr.reduce(
          (currentSize, stats) =>
            currentSize + calculatePayloadSize(stats),
          0
        );
      }

      if (err.response?.status === 413) {
        const attemptedPayloadSize = this.currentMaxStatSize;
        this.currentMaxStatSize -= this.statsSizeDecreaseAmount;
        this.logger.info(
          'Failed to send stats due to 413, retrying with smaller set',
          { attemptedPayloadSize, newPayloadSize: this.currentMaxStatSize }
        );
        await this.sendStats();
      } else {
        this.logger.error('Failed to send stats', {
          err,
          numberOfFailedStats: statsToSend.length
        }, { skipServer: !navigator.onLine });
      }
    }
  }

  addEventListeners () {
    this.client.on('connected', () => {
      if (this.refreshIceServersTimer) {
        clearInterval(this.refreshIceServersTimer);
        this.refreshIceServersTimer = null;
      }

      this.refreshIceServersTimer = setInterval(this.refreshIceServers.bind(this), ICE_SERVER_REFRESH_PERIOD);

      return this.refreshIceServers()
        .catch((error) =>
          this.logger.error('Error fetching ice servers after streaming-client connected', {
            error,
            channelId: this.client.config.channelId
          })
        );
    });

    this.client.on('disconnected', () => {
      clearInterval(this.refreshIceServersTimer);
      this.refreshIceServersTimer = null;
    });
  }

  /**
   * Stanza Handlers
   */
  private async handlePropose (msg: ProposeStanza) {
    if (msg.from === this.jid) {
      return;
    }

    const sessionId = msg.propose.sessionId;

    let sessionInfo = this.pendingSessions[sessionId];
    const isDuplicatePropose = !!sessionInfo;

    const sessionType = this.getSessionTypeByJid(msg.from);
    const loggingParams = { sessionId: sessionId, conversationId: msg.propose.conversationId, sessionType, isDuplicatePropose };
    this.logger.info('propose received', loggingParams);

    if (!isDuplicatePropose) {
      const { appId } = this.client.config;
      const proposeStat: FirstProposeStat = {
        actionName: 'WebrtcStats',
        details: {
          _eventTimestamp: new Date().getTime(),
          _eventType: 'firstPropose',
          conversationId: loggingParams.conversationId,
          sdpViaXmppRequested: !!msg.propose.sdpOverXmpp,
          sessionId: sessionId,
          sessionType: sessionType,
        }
      };
      this.addStatToQueue(proposeStat);

      // TODO: is ofrom used?
      // const roomJid = (msg.ofrom && msg.ofrom.full) || msg.from.full || msg.from;
      const fromJid = msg.from;
      const roomJid = fromJid;
      msg.propose.originalRoomJid = msg.propose.originalRoomJid || roomJid;

      sessionInfo = {
        ...msg.propose,
        toJid: msg.to,
        fromJid,
        sessionType,
        roomJid,
        id: sessionId,
        sdpOverXmpp: msg.propose.sdpOverXmpp,
        privAnswerMode: msg.propose.privAnswerMode
      };

      if (!isDuplicatePropose) {
        this.sessionsMap[sessionInfo.id] = !!sessionInfo.sdpOverXmpp;
        this.pendingSessions[sessionId] = sessionInfo;
      }
    }

    if (sessionInfo.accepted) {
      this.logger.info('proceed already sent for this session, but sending another', loggingParams);
      await this.acceptRtcSession(sessionId);
      return;
    }

    this.emit(
      events.REQUEST_INCOMING_RTCSESSION,
      Object.assign(sessionInfo)
    );
  }

  private handleRetract (sessionId: string) {
    this.logger.info('retract received', this.getLogDetailsForPendingSessionId(sessionId));
    delete this.sessionsMap[sessionId];
    delete this.pendingSessions[sessionId];
    return this.emit(events.CANCEL_INCOMING_RTCSESSION, sessionId);
  }

  /**
   * Inform the client that another client has already taken care of the pendingSession
   */
  private handledIncomingRtcSession (sessionId: string, msg: any) {
    let acceptedOrRejected = msg.accept ? 'accept' : 'reject';
    this.logger.info(`${acceptedOrRejected} received`, this.getLogDetailsForPendingSessionId(sessionId));
    return this.emit(events.HANDLED_INCOMING_RTCSESSION, sessionId);
  }

  /**
   * Exposed Api
   */
  async initiateRtcSession (opts: InitRtcSessionOptions) {
    // send media presence to join conference or screen screenRecording
    // or send propose to single client for 1:1 video chat
    const session: any = {
      to: opts.jid,
      propose: {
        id: v4(),
        descriptions: []
      }
    };
    if (opts.stream) {
      for (let track of Array.from(opts.stream.getTracks())) {
        session.propose.descriptions.push({ media: track.kind });
      }
    }

    if (opts.provideVideo) {
      const videoDescriptionAlreadyExists =
        session.propose.descriptions.filter(
          (desciption) => desciption.media === 'video'
        ).length > 0;
      if (!videoDescriptionAlreadyExists) {
        session.propose.descriptions.push({ media: 'video' });
      }
    }

    if (opts.provideAudio) {
      const audioDescriptionAlreadyExists =
        session.propose.descriptions.filter(
          (desciption) => desciption.media === 'audio'
        ).length > 0;
      if (!audioDescriptionAlreadyExists) {
        session.propose.descriptions.push({ media: 'audio' });
      }
    }

    if (opts.mediaPurpose) {
      session.propose.descriptions.push({ media: opts.mediaPurpose });
    }

    if (opts.jid && opts.jid.match(/@conference/)) {
      let mediaDescriptions = session.propose.descriptions;
      if (mediaDescriptions.length === 0) {
        mediaDescriptions = [{ media: 'listener' }];
      }

      const mediaPresence = {
        type: 'upgradeMedia' as any,
        to: opts.jid,
        id: v4(),
        from: this.jid,
        media: {
          conversationId: opts.conversationId,
          sourceCommunicationId: opts.sourceCommunicationId
        }
      };

      // TODO? can't set last-n on parent element because it invalidates presence root schema

      for (const mediaDescription of mediaDescriptions) {
        mediaPresence.media[mediaDescription.media] = true;
      }

      await this.stanzaInstance!.send('presence', mediaPresence);
    } else {
      await this.stanzaInstance!.send('message', session); // send as Message
      this.pendingSessions[session.propose.id] = session;
    }

    return session.propose.id;
  }

  // jingle proceed
  async acceptRtcSession (sessionId: string): Promise<void> {
    const session = this.pendingSessions[sessionId];
    if (!session) {
      this.emit(
        events.RTCSESSION_ERROR,
        'Cannot accept session because it is not pending or does not exist'
      );
      return;
    }

    const proceed = {
      to: session.fromJid,
      proceed: {
        sessionId
      }
    };

    session.accepted = true;

    const details = this.getLogDetailsForPendingSessionId(sessionId);
    this.logger.info('sending jingle proceed', details);
    await this.stanzaInstance!.send('message', proceed); // send as Message
    this.logger.info('sent jingle proceed', details);
  }

  async rejectRtcSession (sessionId: string, ignore = false): Promise<void> {
    const logDetails = this.getLogDetailsForPendingSessionId(sessionId);
    const session = this.pendingSessions[sessionId];

    if (!session) {
      this.emit(
        events.RTCSESSION_ERROR,
        'Cannot reject session because it is not pending or does not exist'
      );
      return;
    }

    delete this.sessionsMap[sessionId];
    delete this.pendingSessions[sessionId];
    if (ignore) {
      this.ignoredSessions.set(sessionId, true);
    } else {
      const reject1 = {
        to: toBare(this.jid),
        reject: {
          sessionId
        }
      };
      const firstMessage = this.stanzaInstance!.send('message', reject1); // send as Message
      const reject2 = {
        to: session.fromJid,
        reject: {
          sessionId
        }
      };
      const secondMessage = this.stanzaInstance!.send('message', reject2); // send as Message

      this.logger.info('sending jingle reject', logDetails);
      await Promise.all([firstMessage, secondMessage]);
      this.logger.info('sent jingle reject', logDetails);
    }
  }

  async rtcSessionAccepted (sessionId: string): Promise<void> {
    const pendingSession = this.pendingSessions[sessionId];
    const logDetails = this.getLogDetailsForPendingSessionId(sessionId);

    const accept = {
      to: toBare(this.jid),
      accept: {
        sessionId
      }
    };

    this.logger.info('sending session-info:accept', logDetails);
    await this.stanzaInstance!.send('message', accept); // send as Message
    this.logger.info('sent session-info:accept', logDetails);
  }

  async notifyScreenShareStart (session: IMediaSession): Promise<void> {
    return this.stanzaInstance!.send('iq', {
      to: `${session.peerID}`,
      from: this.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: session.id,
        screenstart: {}
      } as any
    });
  }

  async notifyScreenShareStop (session: IMediaSession): Promise<void> {
    return this.stanzaInstance!.send('iq', {
      to: `${session.peerID}`,
      from: this.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: session.id,
        screenstop: {}
      } as any
    });
  }

  async cancelRtcSession (sessionId: string): Promise<void> {
    const session = this.pendingSessions[sessionId];
    const logDetails = this.getLogDetailsForPendingSessionId(sessionId);

    if (!session) {
      this.emit(
        events.RTCSESSION_ERROR,
        'Cannot cancel session because it is not pending or does not exist'
      );
      return;
    }

    const retract = {
      to: session.toJid,
      retract: {
        sessionId
      }
    };
    delete this.pendingSessions[sessionId];
    delete this.sessionsMap[sessionId];
    this.logger.info('sending jingle retract', logDetails);
    await this.stanzaInstance!.send('message', retract); // send as Message
    this.logger.info('sent jingle retract', logDetails);
  }

  async refreshIceServers (): Promise<ExtendedRTCIceServer[]> {
    if (!this.refreshIceServersRetryPromise) {
      this.refreshIceServersRetryPromise = retryPromise<ExtendedRTCIceServer[]>(
        this._refreshIceServers.bind(this, this.stanzaInstance),
        (error): boolean => {
          if (++this.discoRetries > MAX_DISCO_RETRIES) {
            this.logger.warn('fetching ice servers failed. max retries reached.', {
              retryAttempt: this.discoRetries,
              MAX_DISCO_RETRIES,
              error,
              channelId: this.client.config.channelId
            });
            return false;
          }

          this.logger.warn('fetching ice servers failed. retrying', {
            retryAttempt: this.discoRetries,
            error,
            channelId: this.client.config.channelId
          });
          return true;
        },
        0,
        this.client.logger
      );
    }

    return this.refreshIceServersRetryPromise.promise
      .finally(() => {
        this.discoRetries = 0;
        this.refreshIceServersRetryPromise = undefined;
      });
  }

  async _refreshIceServers (stanzaInstance?: NamedAgent): Promise<ExtendedRTCIceServer[]> {
    if (!stanzaInstance) {
      throw new Error('No stanza instance to refresh ice servers');
    }

    const server = stanzaInstance.config.server;
    const turnServersPromise = stanzaInstance.getServices(
      server as string,
      'turn',
      '1'
    );
    const stunServersPromise = stanzaInstance.getServices(
      server as string,
      'stun',
      '1'
    );

    const servicesPromise = new Promise<[Required<ExternalServiceList>, Required<ExternalServiceList>]>((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Timeout waiting for refresh ice servers to finish'));
      }, ICE_SERVER_TIMEOUT);

      Promise.all([
        turnServersPromise,
        stunServersPromise
      ])
        .then(([turn, stun]) => {
          resolve([turn, stun] as [Required<ExternalServiceList>, Required<ExternalServiceList>]);
        })
        .catch(reject);
    });

    const [turnServers, stunServers] = await servicesPromise;

    const iceServers = [
      ...turnServers.services,
      ...stunServers.services
    ].map((service: ExternalService) => {
      const port = service.port ? `:${service.port}` : '';
      const ice: ExtendedRTCIceServer = {
        type: service.type as string,
        urls: `${service.type}:${service.host}${port}`
      };
      if (['turn', 'turns'].includes(service.type as string)) {
        if (service.transport && service.transport !== 'udp') {
          ice.urls += `?transport=${service.transport}`;
        }
        if (service.username) {
          ice.username = service.username;
        }
        if (service.password) {
          ice.credential = service.password;
        }
      }
      return ice;
    });

    this.setIceServers(iceServers, stanzaInstance);
    if (!stunServers.services.length) {
      this.logger.info('No stun servers received, setting iceTransportPolicy to "relay"');
      this.setIceTransportPolicy('relay', stanzaInstance);
    } else {
      this.setIceTransportPolicy('all', stanzaInstance);
    }

    return iceServers;
  }

  setIceServers (iceServers: any[], stanzaInstance: NamedAgent) {
    stanzaInstance.jingle.iceServers = iceServers;
    this.iceServers = iceServers;
  }

  getIceTransportPolicy () {
    return this.stanzaInstance?.jingle.config.peerConnectionConfig!.iceTransportPolicy;
  }

  setIceTransportPolicy (policy: 'relay' | 'all', stanzaInstance: NamedAgent) {
    stanzaInstance.jingle.config.peerConnectionConfig!.iceTransportPolicy = policy;
  }

  getSessionTypeByJid (jid: string): SessionTypes {
    if (isAcdJid(jid)) {
      return SessionTypes.acdScreenShare;
    } else if (isScreenRecordingJid(jid)) {
      return SessionTypes.screenRecording;
    } else if (isSoftphoneJid(jid)) {
      return SessionTypes.softphone;
    } else if (isVideoJid(jid)) {
      return SessionTypes.collaborateVideo;
    } else {
      return SessionTypes.unknown;
    }
  }

  getSessionManager (): SessionManager | undefined {
    return this.stanzaInstance?.jingle;
  }

  getAllSessions (): IMediaSession[] {
    return [ ...this.stanzaSessions, ...this.webrtcSessions ] as IMediaSession[];
  }

  proxyNRStat (stat: NRProxyStat): void {
    this.addStatToQueue(stat as InsightAction<{_eventType: string}>);
  }

  get expose (): WebrtcExtensionAPI {
    return {
      on: this.on.bind(this),
      once: this.once.bind(this),
      off: this.off.bind(this),
      removeAllListeners: this.removeAllListeners.bind(this),
      removeListener: this.removeListener.bind(this),
      refreshIceServers: this.refreshIceServers.bind(this),
      acceptRtcSession: this.acceptRtcSession.bind(this),
      rejectRtcSession: this.rejectRtcSession.bind(this),
      cancelRtcSession: this.cancelRtcSession.bind(this),
      notifyScreenShareStart: this.notifyScreenShareStart.bind(this),
      notifyScreenShareStop: this.notifyScreenShareStop.bind(this),
      rtcSessionAccepted: this.rtcSessionAccepted.bind(this),
      initiateRtcSession: this.initiateRtcSession.bind(this),
      getSessionTypeByJid: this.getSessionTypeByJid.bind(this),
      getSessionManager: this.getSessionManager.bind(this),
      getAllSessions: this.getAllSessions.bind(this),
      proxyNRStat: this.proxyNRStat.bind(this)
    };
  }
}

export interface WebrtcExtensionAPI {
  on: (event: string, handler: (...args: any) => void) => void;
  once: (event: string, handler: (...args: any) => void) => void;
  off: (event: string, handler: (...args: any) => void) => void;
  removeAllListeners (event?: string | symbol): void;
  removeListener (event: string | symbol, listener: (...args: any[]) => void): void;
  refreshIceServers (): Promise<any[]>;
  acceptRtcSession (sessionId: string): void;
  rejectRtcSession (sessionId: string, ignore?: boolean): void;
  cancelRtcSession (sessionId: string): void;
  rtcSessionAccepted (sessionId: string): void;
  initiateRtcSession (opts: InitRtcSessionOptions): Promise<void>;
  notifyScreenShareStart (session: IMediaSession): void;
  notifyScreenShareStop (session: IMediaSession): void;
  getSessionTypeByJid (jid: string): SessionTypes;
  getSessionManager: () => SessionManager | undefined;
  getAllSessions: () => IMediaSession[];
  proxyNRStat: (stat: NRProxyStat) => void;
}
