import { EventEmitter } from 'events';
import { ExternalService, ExternalServiceList, ReceivedMessage } from 'stanza/protocol';
import { toBare } from 'stanza/JID';
import LRU from 'lru-cache';
import { JingleAction } from 'stanza/Constants';
import { SessionManager } from 'stanza/jingle';
import { v4 } from 'uuid';
import { Jingle } from 'stanza';
import { StatsEvent } from 'webrtc-stats-gatherer';
import throttle from 'lodash.throttle';
import JingleSession, { SessionOpts } from 'stanza/jingle/Session';
import { isFirefox } from 'browserama';

import { definitions, Propose } from './stanza-definitions/webrtc-signaling';
import { GenesysCloudMediaSession, IGenesysCloudMediaSessionParams, SessionEvents } from './types/media-session';
import { isAcdJid, isScreenRecordingJid, isSoftphoneJid, isVideoJid, calculatePayloadSize, retryPromise, RetryPromise } from './utils';
import Client from '.';
import { formatStatsEvent } from './stats-formatter';
import { ExtendedRTCIceServer, IClientOptions, SessionTypes, IPendingSession } from './types/interfaces';

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

export class WebrtcExtension extends EventEmitter {
  client: Client;
  ignoredSessions = new LRU({ max: 10, maxAge: 10 * 60 * 60 * 6 });
  jingleJs: Jingle.SessionManager;

  logger: any;
  pendingSessions: { [sessionId: string]: IPendingSession } = {};
  config: {
    allowIPv6: boolean;
    optOutOfWebrtcStatsTelemetry?: boolean;
  };
  private statsArr: any[] = [];
  private throttleSendStatsInterval = 25000;
  private currentMaxStatSize = desiredMaxStatsSize;
  private statsSizeDecreaseAmount = 3000;
  private statBuffer = 0;
  private throttledSendStats: any;
  private discoRetries = 0;
  private refreshIceServersRetryPromise: RetryPromise<ExtendedRTCIceServer[]> | undefined;
  private refreshIceServersTimer: any;

  get jid (): string {
    return this.client._stanzaio.jid;
  }

  constructor (client: Client, clientOptions: IClientOptions) {
    super();
    this.client = client;
    this.config = {
      allowIPv6: clientOptions.allowIPv6 === true,
      optOutOfWebrtcStatsTelemetry: clientOptions.optOutOfWebrtcStatsTelemetry
    };

    this.logger = client.logger;
    client._stanzaio.stanzas.define(definitions);
    client._stanzaio.jingle.prepareSession = this.prepareSession.bind(this);
    this.jingleJs = client._stanzaio.jingle;
    this.addEventListeners();
    this.proxyEvents();
    this.configureStanzaJingle();
    this.throttledSendStats = throttle(
      this.sendStats.bind(this),
      this.throttleSendStatsInterval,
      { leading: false, trailing: true }
    );
  }

  configureStanzaJingle () {
    Object.assign(this.client._stanzaio.jingle.config.peerConnectionConfig, {
      sdpSemantics: 'unified-plan'
    });

    /* clear out stanzas default use of google's stun server */
    this.client._stanzaio.jingle.config.iceServers = [];
    /**
     * NOTE: calling this here should not interfere with the `webrtc.ts` extension
     *  refreshingIceServers since that is async and this constructor is sync
     */
    this.setIceServers([]);
  }

  prepareSession (options: SessionOpts) {
    const pendingSession = this.pendingSessions[options.sid!];
    if (pendingSession) {
      delete this.pendingSessions[pendingSession.sessionId];
    }

    const ignoreHostCandidatesForForceTurnFF = this.getIceTransportPolicy() === 'relay' && isFirefox;

    const gcSessionOpts: IGenesysCloudMediaSessionParams = {
      options,
      optOutOfWebrtcStatsTelemetry: !!this.config.optOutOfWebrtcStatsTelemetry,
      conversationId: pendingSession?.conversationId,
      fromUserId: pendingSession?.fromJid,
      originalRoomJid: pendingSession?.originalRoomJid,
      sessionType: pendingSession?.sessionType,
      allowIPv6: this.config.allowIPv6,
      ignoreHostCandidatesFromRemote: ignoreHostCandidatesForForceTurnFF
    };

    const session = new GenesysCloudMediaSession(gcSessionOpts);
    this.proxyStatsForSession(session);
    return session;
  }

  // This should probably go into the webrtc sdk, but for now I'm putting here so it's in a central location.
  // This should be moved when the sdk is the primary consumer
  proxyStatsForSession (session: GenesysCloudMediaSession) {
    session.on('stats', (statsEvent: StatsEvent) => {
      /* if our logger was stopped, we need to stop stats logging too */
      if (this.client.logger['stopReason']) {
        return;
      }

      const statsCopy = JSON.parse(JSON.stringify(statsEvent));
      const extraDetails = {
        conference: (session as any).conversationId,
        session: session.sid,
        sessionType: session.sessionType
      };

      // format the event to what the api expects
      const event = formatStatsEvent(statsCopy, extraDetails);

      const currentEventSize = calculatePayloadSize(event);
      // Check if the size of the current event plus the size of the previous stats exceeds max size.
      const exceedsMaxStatSize =
        this.statBuffer + currentEventSize > this.currentMaxStatSize;

      this.statsArr.push(event);
      this.statBuffer += currentEventSize;

      // If it exceeds max size, don't append just send current payload.
      if (exceedsMaxStatSize) {
        this.flushStats();
      } else {
        this.throttledSendStats();
      }
    });
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

  flushStats () {
    this.throttledSendStats.flush();
  }

  async sendStats () {
    const statsToSend: any[] = [];
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

    const data = {
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
        host: this.client.config.apiHost,
        authToken,
        logger: this.client.logger,
        data
      });
      this.currentMaxStatSize = desiredMaxStatsSize;
    } catch (err: any) {
      if (err.status === 413) {
        const attemptedPayloadSize = this.currentMaxStatSize;
        this.currentMaxStatSize -= this.statsSizeDecreaseAmount;
        this.statsArr = [...statsToSend, ...this.statsArr];
        this.statBuffer = this.statsArr.reduce(
          (currentSize, stats) =>
            currentSize + calculatePayloadSize(stats),
          0
        );
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

    this.client._stanzaio.jingle.on('log', (level, message, data?) => {
      this.logger[level](message, data);
    });

    this.client._stanzaio.on('message', async (msg: any) => {
      if (msg.propose) {
        await this.handlePropose(msg);
      } else if (msg.retract) {
        this.handleRetract(msg.retract.sessionId);
      } else if (msg.accept) {
        this.handledIncomingRtcSession(msg.accept.sessionId, msg);
      } else if (msg.reject) {
        this.handledIncomingRtcSession(msg.reject.sessionId, msg);
      }
    });
  }

  proxyEvents () {
    // this.jingleJs.on('send', data => {
    //   if (data.jingle && data.jingle.sid && this.ignoredSessions.get(data.jingle.sid)) {
    //     this.logger.debug('Ignoring outbound stanza for ignored session', data.jingle.sid);
    //     return;
    //   }
    //   this.emit('send', data);
    // });

    this.client._stanzaio.on('jingle:outgoing', (session: JingleSession) => {
      return this.emit(events.OUTGOING_RTCSESSION, session);
    });

    this.client._stanzaio.on('jingle:incoming', (session: JingleSession) => {
      return this.emit(events.INCOMING_RTCSESSION, session);
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
      this.client._stanzaio.jingle.on(
        e,
        (session: GenesysCloudMediaSession, ...data: any) => {
          session.emit(e as any, ...data);
        }
      );
    }

    // this.client._stanzaio.on('jingle:log:*', (level, msg, details) => {
    //   return this.emit(events.TRACE_RTCSESSION, level.split(':')[1], msg, details);
    // });

    // this.client._stanzaio.on('jingle:error', req => {
    //   return this.emit(events.RTCSESSION_ERROR, req.error, req);
    // });
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
        id: sessionId
      };

      this.pendingSessions[sessionId] = sessionInfo;
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

      await this.client._stanzaio.send('presence', mediaPresence);
    } else {
      await this.client._stanzaio.send('message', session); // send as Message
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
    await this.client._stanzaio.send('message', proceed); // send as Message
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
      const firstMessage = this.client._stanzaio.send('message', reject1); // send as Message
      const reject2 = {
        to: session.fromJid,
        reject: {
          sessionId
        }
      };
      const secondMessage = this.client._stanzaio.send('message', reject2); // send as Message

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
    await this.client._stanzaio.send('message', accept); // send as Message
    this.logger.info('sent session-info:accept', logDetails);
  }

  notifyScreenShareStart (session: GenesysCloudMediaSession): Promise<void> {
    return this.client._stanzaio.send('iq', {
      to: `${session.peerID}`,
      from: this.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: session.sid,
        screenstart: {}
      } as any
    });
  }

  notifyScreenShareStop (session: GenesysCloudMediaSession): Promise<void> {
    return this.client._stanzaio.send('iq', {
      to: `${session.peerID}`,
      from: this.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: session.sid,
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
    this.logger.info('sending jingle retract', logDetails);
    await this.client._stanzaio.send('message', retract); // send as Message
    this.logger.info('sent jingle retract', logDetails);
  }

  async refreshIceServers (): Promise<ExtendedRTCIceServer[]> {
    if (!this.refreshIceServersRetryPromise) {
      this.refreshIceServersRetryPromise = retryPromise<ExtendedRTCIceServer[]>(
        this._refreshIceServers.bind(this),
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

  async _refreshIceServers (): Promise<ExtendedRTCIceServer[]> {
    const server = this.client._stanzaio.config.server;
    const turnServersPromise = this.client._stanzaio.getServices(
      server as string,
      'turn',
      '1'
    );
    const stunServersPromise = this.client._stanzaio.getServices(
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
    // const [turnServers, stunServers] = await Promise.all([turnServersPromise, stunServersPromise]) as any;

    this.logger.debug('STUN/TURN server discovery result', {
      turnServers,
      stunServers
    });

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

    this.setIceServers(iceServers);
    if (!stunServers.services.length) {
      this.logger.info('No stun servers received, setting iceTransportPolicy to "relay"');
      this.setIceTransportPolicy('relay');
    } else {
      this.setIceTransportPolicy('all');
    }

    return iceServers;
  }

  setIceServers (iceServers: any[]) {
    this.client._stanzaio.jingle.iceServers = iceServers;
  }

  getIceTransportPolicy () {
    return this.client._stanzaio.jingle.config.peerConnectionConfig!.iceTransportPolicy;
  }

  setIceTransportPolicy (policy: 'relay' | 'all') {
    this.client._stanzaio.jingle.config.peerConnectionConfig!.iceTransportPolicy = policy;
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
      jingle: this.client._stanzaio.jingle
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
  notifyScreenShareStart (session: GenesysCloudMediaSession): void;
  notifyScreenShareStop (session: GenesysCloudMediaSession): void;
  getSessionTypeByJid (jid: string): SessionTypes;
  jingle: SessionManager;
}
